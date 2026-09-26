import { Hono } from "hono";
import { z } from "zod";
import { normalize } from "../../shared/text";
import { type AuthVars, requireAuth } from "../auth";
import { prisma, type Tx } from "../db";
import { HttpError, nameText, notFound, optId, optInt, optNumber, optText, parseJson } from "../http";
import { assertPhoto, releasePhoto } from "../photos";

export const recipeRoutes = new Hono<{ Variables: AuthVars }>();
recipeRoutes.use(requireAuth);

const ingredientInput = z.object({
  name: nameText(120),
  productId: optId,
  quantity: optNumber,
  unit: optText(24),
  note: optText(200),
});

const recipeFields = {
  name: nameText(160),
  description: optText(2000),
  servings: optNumber,
  prepMinutes: optInt,
  cookMinutes: optInt,
  difficulty: z.number().int().min(1).max(3).nullish().transform((v) => v ?? null),
  notes: optText(8000),
  favorite: z.boolean().optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  photoId: optId,
  categoryIds: z.array(z.string().max(64)).max(30).optional(),
  ingredients: z.array(ingredientInput).max(200).optional(),
  steps: z.array(z.object({ text: nameText(4000) })).max(100).optional(),
};
const recipeInput = z.object(recipeFields);

const recipeDetail = {
  id: true, name: true, description: true, servings: true, prepMinutes: true, cookMinutes: true, difficulty: true,
  notes: true, favorite: true, tags: true, photoId: true, createdAt: true, updatedAt: true,
  categories: { select: { categoryId: true } },
  ingredients: { orderBy: { position: "asc" as const }, select: { id: true, name: true, productId: true, quantity: true, unit: true, note: true } },
  steps: { orderBy: { position: "asc" as const }, select: { id: true, text: true } },
} as const;

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function present<T extends { tags: string; categories: { categoryId: string }[] }>(r: T) {
  const { categories, tags, ...rest } = r;
  return { ...rest, tags: parseTags(tags), categoryIds: categories.map((c) => c.categoryId) };
}

async function loadRecipe(householdId: string, id: string) {
  const r = await prisma.recipe.findFirst({ where: { id, householdId }, select: recipeDetail });
  if (!r) notFound("Recette");
  return present(r);
}

recipeRoutes.get("/", async (c) => {
  const recipes = await prisma.recipe.findMany({
    where: { householdId: c.var.householdId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, description: true, photoId: true, favorite: true, tags: true, servings: true,
      prepMinutes: true, cookMinutes: true, difficulty: true, updatedAt: true,
      categories: { select: { categoryId: true } },
      ingredients: { select: { name: true, productId: true } },
      _count: { select: { steps: true } },
    },
  });
  return c.json(
    recipes.map(({ _count, ...r }) => ({ ...present(r), stepCount: _count.steps })),
  );
});

recipeRoutes.get("/:id", async (c) => c.json(await loadRecipe(c.var.householdId, c.req.param("id"))));

/**
 * Relie chaque ingrédient à un produit du catalogue (même nom, sans tenir compte
 * des accents/majuscules), en le créant si besoin : c'est ce qui permettra de
 * croiser recettes, stock et liste de courses. Un ingrédient sans nom reste libre.
 */
async function resolveIngredients(tx: Tx, householdId: string, list: z.output<typeof ingredientInput>[]) {
  const products = await tx.product.findMany({ where: { householdId }, select: { id: true, name: true } });
  const byName = new Map(products.map((p) => [normalize(p.name), p.id]));
  const ids = new Set(products.map((p) => p.id));
  const out = [];
  for (const [position, ing] of list.entries()) {
    let productId = ing.productId && ids.has(ing.productId) ? ing.productId : null;
    if (!productId && ing.name) {
      const key = normalize(ing.name);
      productId = byName.get(key) ?? null;
      if (!productId) {
        const created = await tx.product.create({ data: { householdId, name: ing.name, unit: ing.unit } });
        productId = created.id;
        byName.set(key, productId);
      }
    }
    out.push({ ...ing, productId, position });
  }
  return out;
}

async function writeRecipe(tx: Tx, householdId: string, recipeId: string, b: Partial<z.output<typeof recipeInput>>) {
  const { categoryIds, ingredients, steps, tags, ...fields } = b;
  await tx.recipe.update({
    where: { id: recipeId },
    data: { ...fields, ...(tags ? { tags: JSON.stringify([...new Set(tags.filter(Boolean))]) } : {}) },
  });
  if (categoryIds) {
    const valid = await tx.category.findMany({ where: { householdId, kind: "recipe", id: { in: categoryIds } }, select: { id: true } });
    await tx.recipeCategory.deleteMany({ where: { recipeId } });
    if (valid.length) await tx.recipeCategory.createMany({ data: valid.map((v) => ({ recipeId, categoryId: v.id })) });
  }
  if (ingredients) {
    const resolved = await resolveIngredients(tx, householdId, ingredients.filter((i) => i.name || i.productId));
    await tx.recipeIngredient.deleteMany({ where: { recipeId } });
    if (resolved.length) await tx.recipeIngredient.createMany({ data: resolved.map((i) => ({ ...i, recipeId })) });
  }
  if (steps) {
    const kept = steps.filter((s) => s.text);
    await tx.recipeStep.deleteMany({ where: { recipeId } });
    if (kept.length) await tx.recipeStep.createMany({ data: kept.map((s, position) => ({ recipeId, position, text: s.text })) });
  }
}

recipeRoutes.post("/", async (c) => {
  const householdId = c.var.householdId;
  const body = await parseJson(c.req, recipeInput);
  await assertPhoto(householdId, body.photoId);
  const id = await prisma.$transaction(async (tx) => {
    const r = await tx.recipe.create({ data: { householdId, createdById: c.var.userId } });
    await writeRecipe(tx, householdId, r.id, body);
    return r.id;
  });
  return c.json(await loadRecipe(householdId, id), 201);
});

recipeRoutes.patch("/:id", async (c) => {
  const householdId = c.var.householdId;
  const existing = await prisma.recipe.findFirst({ where: { id: c.req.param("id"), householdId }, select: { id: true, photoId: true } });
  if (!existing) notFound("Recette");
  const body = await parseJson(c.req, recipeInput.partial());
  if (body.photoId !== undefined) await assertPhoto(householdId, body.photoId);
  await prisma.$transaction((tx) => writeRecipe(tx, householdId, existing.id, body));
  if (body.photoId !== undefined && body.photoId !== existing.photoId) await releasePhoto(existing.photoId);
  return c.json(await loadRecipe(householdId, existing.id));
});

recipeRoutes.post("/:id/duplicate", async (c) => {
  const householdId = c.var.householdId;
  const src = await loadRecipe(householdId, c.req.param("id"));
  const id = await prisma.$transaction(async (tx) => {
    const r = await tx.recipe.create({ data: { householdId, createdById: c.var.userId, photoId: src.photoId } });
    await writeRecipe(tx, householdId, r.id, {
      name: `${src.name || "Recette"} (copie)`,
      description: src.description,
      servings: src.servings,
      prepMinutes: src.prepMinutes,
      cookMinutes: src.cookMinutes,
      difficulty: src.difficulty,
      notes: src.notes,
      tags: src.tags,
      categoryIds: src.categoryIds,
      ingredients: src.ingredients.map(({ id: _id, ...i }) => i),
      steps: src.steps.map((s) => ({ text: s.text })),
    });
    return r.id;
  });
  return c.json(await loadRecipe(householdId, id), 201);
});

recipeRoutes.delete("/:id", async (c) => {
  const existing = await prisma.recipe.findFirst({ where: { id: c.req.param("id"), householdId: c.var.householdId }, select: { id: true, photoId: true } });
  if (!existing) throw new HttpError(404, "Recette introuvable");
  await prisma.recipe.delete({ where: { id: existing.id } });
  await releasePhoto(existing.photoId);
  return c.json({ ok: true });
});
