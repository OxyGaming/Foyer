import { Hono } from "hono";
import { z } from "zod";
import { type AuthVars, requireAuth } from "../auth";
import { prisma } from "../db";
import { HttpError, nameText, notFound, optId, optInt, optText, parseJson } from "../http";
import { assertPhoto, releasePhoto } from "../photos";

// ─── Catégories ──────────────────────────────────────────────────────────────

export const categoryRoutes = new Hono<{ Variables: AuthVars }>();
categoryRoutes.use(requireAuth);

const categoryInput = z.object({
  kind: z.enum(["recipe", "product"]).optional(),
  name: nameText(80),
  icon: optText(16),
  color: optText(16),
  parentId: optId,
  sortOrder: optInt,
  photoId: optId,
});

categoryRoutes.get("/", async (c) => {
  const categories = await prisma.category.findMany({
    where: { householdId: c.var.householdId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, kind: true, name: true, icon: true, color: true, parentId: true, sortOrder: true, photoId: true,
      _count: { select: { products: true, recipes: true } },
    },
  });
  return c.json(categories.map(({ _count, ...cat }) => ({ ...cat, usage: _count.products + _count.recipes })));
});

async function assertParent(householdId: string, table: "category" | "location", parentId: string | null, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw new HttpError(400, "Un élément ne peut pas être son propre parent");
  // Remonte l'arborescence pour éviter les cycles.
  let cur: string | null = parentId;
  for (let depth = 0; cur && depth < 20; depth++) {
    const row: { id: string; parentId: string | null } | null =
      table === "category"
        ? await prisma.category.findFirst({ where: { id: cur, householdId }, select: { id: true, parentId: true } })
        : await prisma.location.findFirst({ where: { id: cur, householdId }, select: { id: true, parentId: true } });
    if (!row) throw new HttpError(400, "Parent inconnu");
    if (selfId && row.parentId === selfId) throw new HttpError(400, "Déplacement impossible : boucle dans l'arborescence");
    cur = row.parentId;
  }
}

categoryRoutes.post("/", async (c) => {
  const body = await parseJson(c.req, categoryInput);
  const householdId = c.var.householdId;
  await assertParent(householdId, "category", body.parentId);
  await assertPhoto(householdId, body.photoId);
  const cat = await prisma.category.create({
    data: {
      householdId,
      kind: body.kind ?? "product",
      name: body.name,
      icon: body.icon,
      color: body.color,
      parentId: body.parentId,
      sortOrder: body.sortOrder ?? 0,
      photoId: body.photoId,
    },
  });
  return c.json(cat, 201);
});

categoryRoutes.patch("/:id", async (c) => {
  const householdId = c.var.householdId;
  const id = c.req.param("id");
  const existing = await prisma.category.findFirst({ where: { id, householdId } });
  if (!existing) notFound("Catégorie");
  const body = await parseJson(c.req, categoryInput.partial());
  if (body.parentId !== undefined) await assertParent(householdId, "category", body.parentId, id);
  if (body.photoId !== undefined) await assertPhoto(householdId, body.photoId);
  const { kind: _kind, ...data } = body;
  const cat = await prisma.category.update({ where: { id }, data: { ...data, sortOrder: data.sortOrder ?? undefined } });
  if (body.photoId !== undefined && existing.photoId !== body.photoId) await releasePhoto(existing.photoId);
  return c.json(cat);
});

categoryRoutes.delete("/:id", async (c) => {
  const existing = await prisma.category.findFirst({ where: { id: c.req.param("id"), householdId: c.var.householdId } });
  if (!existing) notFound("Catégorie");
  // Les sous-catégories remontent d'un niveau ; produits et recettes restent (sans catégorie).
  await prisma.$transaction([
    prisma.category.updateMany({ where: { parentId: existing.id }, data: { parentId: existing.parentId } }),
    prisma.category.delete({ where: { id: existing.id } }),
  ]);
  await releasePhoto(existing.photoId);
  return c.json({ ok: true });
});

// ─── Emplacements ────────────────────────────────────────────────────────────

export const locationRoutes = new Hono<{ Variables: AuthVars }>();
locationRoutes.use(requireAuth);

const locationInput = z.object({ name: nameText(80), icon: optText(16), parentId: optId, sortOrder: optInt });

locationRoutes.get("/", async (c) => {
  const locations = await prisma.location.findMany({
    where: { householdId: c.var.householdId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, icon: true, parentId: true, sortOrder: true, _count: { select: { stockItems: true } } },
  });
  return c.json(locations.map(({ _count, ...l }) => ({ ...l, usage: _count.stockItems })));
});

locationRoutes.post("/", async (c) => {
  const body = await parseJson(c.req, locationInput);
  await assertParent(c.var.householdId, "location", body.parentId);
  const loc = await prisma.location.create({
    data: { householdId: c.var.householdId, name: body.name, icon: body.icon, parentId: body.parentId, sortOrder: body.sortOrder ?? 0 },
  });
  return c.json(loc, 201);
});

locationRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await prisma.location.findFirst({ where: { id, householdId: c.var.householdId } });
  if (!existing) notFound("Emplacement");
  const body = await parseJson(c.req, locationInput.partial());
  if (body.parentId !== undefined) await assertParent(c.var.householdId, "location", body.parentId, id);
  const loc = await prisma.location.update({ where: { id }, data: { ...body, sortOrder: body.sortOrder ?? undefined } });
  return c.json(loc);
});

locationRoutes.delete("/:id", async (c) => {
  const existing = await prisma.location.findFirst({ where: { id: c.req.param("id"), householdId: c.var.householdId } });
  if (!existing) notFound("Emplacement");
  const stockHere = await prisma.stockItem.count({ where: { locationId: existing.id } });
  if (stockHere > 0) {
    throw new HttpError(409, `${stockHere} ligne(s) de stock sont rangées ici : déplacez-les avant de supprimer l'emplacement`);
  }
  await prisma.$transaction([
    prisma.location.updateMany({ where: { parentId: existing.id }, data: { parentId: existing.parentId } }),
    prisma.location.delete({ where: { id: existing.id } }),
  ]);
  return c.json({ ok: true });
});
