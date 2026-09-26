import { Hono } from "hono";
import { z } from "zod";
import { isIsoDate, MEALS } from "../../shared/dates";
import { type AuthVars, requireAuth } from "../auth";
import { prisma, type Tx } from "../db";
import { HttpError, notFound, optId, optNumber, optText, parseJson } from "../http";
import { consumeStock } from "./products";

export const planRoutes = new Hono<{ Variables: AuthVars }>();
planRoutes.use(requireAuth);

const isoDate = z.string().refine(isIsoDate, "date invalide (AAAA-MM-JJ)");
const meal = z.enum(MEALS);
/** Identifiant fourni par le client (création hors ligne idempotente). */
const clientId = z.string().regex(/^[a-z0-9_-]{8,40}$/i).optional();

const itemSelect = {
  id: true, date: true, meal: true, position: true, recipeId: true, title: true, servings: true, note: true, cookedAt: true,
} as const;

planRoutes.get("/", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) throw new HttpError(400, "Période invalide");
  const items = await prisma.mealPlanItem.findMany({
    where: { householdId: c.var.householdId, date: { gte: from, lte: to } },
    orderBy: [{ date: "asc" }, { meal: "asc" }, { position: "asc" }],
    select: itemSelect,
  });
  return c.json(items);
});

async function assertRecipe(householdId: string, recipeId: string | null | undefined) {
  if (recipeId && !(await prisma.recipe.findFirst({ where: { id: recipeId, householdId }, select: { id: true } }))) {
    throw new HttpError(400, "Recette inconnue");
  }
}

/** Renumérote un créneau en insérant éventuellement `insertId` à l'index voulu. */
async function reorderSlot(tx: Tx, householdId: string, date: string, mealName: string, insertId?: string, index?: number) {
  const items = await tx.mealPlanItem.findMany({
    where: { householdId, date, meal: mealName, ...(insertId ? { id: { not: insertId } } : {}) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const ids = items.map((i) => i.id);
  if (insertId) ids.splice(Math.max(0, Math.min(index ?? ids.length, ids.length)), 0, insertId);
  for (const [position, id] of ids.entries()) await tx.mealPlanItem.update({ where: { id }, data: { position } });
}

planRoutes.post("/", async (c) => {
  const householdId = c.var.householdId;
  const body = await parseJson(
    c.req,
    z.object({ id: clientId, date: isoDate, meal, recipeId: optId, title: optText(120), servings: optNumber, note: optText(500) }),
  );
  await assertRecipe(householdId, body.recipeId);
  if (body.id) {
    const existing = await prisma.mealPlanItem.findUnique({ where: { id: body.id }, select: { ...itemSelect, householdId: true } });
    if (existing) {
      if (existing.householdId !== householdId) throw new HttpError(409, "Identifiant déjà utilisé");
      const { householdId: _h, ...rest } = existing;
      return c.json(rest, 200);
    }
  }
  const item = await prisma.$transaction(async (tx) => {
    const count = await tx.mealPlanItem.count({ where: { householdId, date: body.date, meal: body.meal } });
    return tx.mealPlanItem.create({
      data: { ...body, householdId, position: count, createdById: c.var.userId },
      select: itemSelect,
    });
  });
  return c.json(item, 201);
});

/** Modifier, déplacer (autre jour / autre repas) ou réordonner un créneau. */
planRoutes.patch("/:id", async (c) => {
  const householdId = c.var.householdId;
  const item = await prisma.mealPlanItem.findFirst({ where: { id: c.req.param("id"), householdId } });
  if (!item) notFound("Repas");
  const body = await parseJson(
    c.req,
    z.object({
      date: isoDate.optional(),
      meal: meal.optional(),
      position: z.number().int().min(0).max(100).optional(),
      recipeId: optId.optional(),
      title: optText(120).optional(),
      servings: optNumber.optional(),
      note: optText(500).optional(),
      cooked: z.boolean().optional(),
    }),
  );
  if (body.recipeId !== undefined) await assertRecipe(householdId, body.recipeId);
  const { position, cooked, ...fields } = body;
  const updated = await prisma.$transaction(async (tx) => {
    const date = fields.date ?? item.date;
    const mealName = fields.meal ?? item.meal;
    const moved = date !== item.date || mealName !== item.meal;
    await tx.mealPlanItem.update({
      where: { id: item.id },
      data: { ...fields, ...(cooked !== undefined ? { cookedAt: cooked ? new Date() : null } : {}) },
    });
    if (moved || position !== undefined) {
      await reorderSlot(tx, householdId, date, mealName, item.id, position);
      if (moved) await reorderSlot(tx, householdId, item.date, item.meal);
    }
    return tx.mealPlanItem.findUniqueOrThrow({ where: { id: item.id }, select: itemSelect });
  });
  return c.json(updated);
});

planRoutes.delete("/:id", async (c) => {
  const householdId = c.var.householdId;
  const item = await prisma.mealPlanItem.findFirst({ where: { id: c.req.param("id"), householdId } });
  if (item) {
    await prisma.$transaction(async (tx) => {
      await tx.mealPlanItem.delete({ where: { id: item.id } });
      await reorderSlot(tx, householdId, item.date, item.meal);
    });
  }
  return c.json({ ok: true });
});

/**
 * Marque le repas comme cuisiné et retire du stock les quantités confirmées
 * par l'utilisateur (calculées côté appli avec consumptionFor, modifiables).
 */
planRoutes.post("/:id/cook", async (c) => {
  const householdId = c.var.householdId;
  const item = await prisma.mealPlanItem.findFirst({ where: { id: c.req.param("id"), householdId }, include: { recipe: { select: { name: true } } } });
  if (!item) notFound("Repas");
  const body = await parseJson(
    c.req,
    z.object({ consume: z.array(z.object({ productId: z.string().max(64), quantity: z.number().finite().positive().max(1e6) })).max(200).default([]) }),
  );
  const note = item.recipe?.name || item.title || "Repas";
  const consumed = await prisma.$transaction(async (tx) => {
    const done: { productId: string; quantity: number }[] = [];
    for (const line of body.consume) {
      const q = await consumeStock(tx, { householdId, productId: line.productId, quantity: line.quantity, userId: c.var.userId, note });
      done.push({ productId: line.productId, quantity: q });
    }
    await tx.mealPlanItem.update({ where: { id: item.id }, data: { cookedAt: new Date() } });
    return done;
  });
  const updated = await prisma.mealPlanItem.findUniqueOrThrow({ where: { id: item.id }, select: itemSelect });
  return c.json({ item: updated, consumed });
});
