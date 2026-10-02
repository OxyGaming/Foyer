import { Hono } from "hono";
import { z } from "zod";
import { productKey } from "../../shared/text";
import { type AuthVars, requireAuth } from "../auth";
import { prisma, type Tx } from "../db";
import { HttpError, nameText, notFound, optId, optInt, optNumber, optText, optUnit, parseJson } from "../http";
import { assertPhoto, releasePhoto } from "../photos";

export const recipeRoutes = new Hono<{ Variables: AuthVars }>();
recipeRoutes.use(requireAuth);

const ingredientInput = z.object({
  name: nameText(120),
  productId: optId,
  quantity: optNumber,
  unit: optUnit(),
  note: optText(200),
  /** Autres produits acceptés à la place du produit principal. */
  alternatives: z.array(z.string().min(1).max(64)).max(50).optional(),
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
  ingredients: { orderBy: { position: "asc" as const }, select: { id: true, name: true, productId: true, quantity: true, unit: true, note: true, alternatives: true } },
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

type WithAlternatives<I> = Omit<I, "alternatives"> & { alternatives: string[] };

function present<T extends { tags: string; categories: { categoryId: string }[]; ingredients: { alternatives: string }[] }>(r: T) {
  const { categories, tags, ingredients, ...rest } = r;
  return {
    ...rest,
    tags: parseTags(tags),
    categoryIds: categories.map((c) => c.categoryId),
    ingredients: ingredients.map((i) => ({ ...i, alternatives: parseTags(i.alternatives) }) as WithAlternatives<T["ingredients"][number]>),
  };
}

async function loadRecipe(householdId: string, id: string) {
  const r = await prisma.recipe.findFirst({ where: { id, householdId }, select: recipeDetail });
  if (!r) notFound("Recette");
  return present(r);
}

/** Liste des recettes (résumé, avec les ingrédients pour les filtres et le croisement avec le stock). */
async function listRecipes(householdId: string) {
  const recipes = await prisma.recipe.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, description: true, photoId: true, favorite: true, tags: true, servings: true,
      prepMinutes: true, cookMinutes: true, difficulty: true, updatedAt: true,
      categories: { select: { categoryId: true } },
      ingredients: { orderBy: { position: "asc" }, select: { id: true, name: true, productId: true, quantity: true, unit: true, note: true, alternatives: true } },
      _count: { select: { steps: true } },
    },
  });
  return recipes.map(({ _count, ...r }) => ({ ...present(r), stepCount: _count.steps }));
}

recipeRoutes.get("/", async (c) => c.json(await listRecipes(c.var.householdId)));

recipeRoutes.get("/:id", async (c) => c.json(await loadRecipe(c.var.householdId, c.req.param("id"))));

/**
 * Relie chaque ingrédient à un produit du catalogue (même nom, sans tenir compte
 * des accents/majuscules ni du pluriel simple), en le créant si besoin : c'est ce qui permettra de
 * croiser recettes, stock et liste de courses. Un ingrédient sans nom reste libre.
 */
async function resolveIngredients(tx: Tx, householdId: string, list: z.output<typeof ingredientInput>[]) {
  const products = await tx.product.findMany({ where: { householdId }, select: { id: true, name: true } });
  const byName = new Map(products.map((p) => [productKey(p.name), p.id]));
  const ids = new Set(products.map((p) => p.id));
  const out = [];
  for (const [position, ing] of list.entries()) {
    const { alternatives = [], ...rest } = ing;
    let productId = ing.productId && ids.has(ing.productId) ? ing.productId : null;
    if (!productId && ing.name) {
      const key = productKey(ing.name);
      productId = byName.get(key) ?? null;
      if (!productId) {
        const created = await tx.product.create({ data: { householdId, name: ing.name, unit: ing.unit } });
        productId = created.id;
        byName.set(key, productId);
      }
    }
    // Variantes : produits du foyer, sans le produit principal ni doublon.
    const alts = [...new Set(alternatives)].filter((id) => ids.has(id) && id !== productId);
    out.push({ ...rest, productId, position, alternatives: JSON.stringify(alts) });
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

/** Import groupé (texte collé, analysé côté appli) : tout ou rien, dans une seule transaction. */
recipeRoutes.post("/import", async (c) => {
  const householdId = c.var.householdId;
  const { recipes } = await parseJson(c.req, z.object({ recipes: z.array(recipeInput.omit({ photoId: true })).min(1).max(300) }));
  const ids = await prisma.$transaction(
    async (tx) => {
      const out: string[] = [];
      for (const body of recipes) {
        const r = await tx.recipe.create({ data: { householdId, createdById: c.var.userId } });
        await writeRecipe(tx, householdId, r.id, body);
        out.push(r.id);
      }
      return out;
    },
    { timeout: 60_000 },
  );
  return c.json({ count: ids.length, ids }, 201);
});

const bulkInput = z.object({
  updates: z
    .array(z.object({ id: z.string().min(1).max(64), ...recipeInput.omit({ photoId: true, steps: true }).partial().shape }))
    .max(2000)
    .default([]),
  deletes: z.array(z.string().min(1).max(64)).max(2000).default([]),
});

/**
 * Édition en masse (vue tableur / fiches à faire défiler) : informations générales
 * et ingrédients des recettes (pas les étapes). Tout passe ou rien ; renvoie la liste à jour.
 */
recipeRoutes.post("/bulk", async (c) => {
  const householdId = c.var.householdId;
  const { updates, deletes } = await parseJson(c.req, bulkInput);
  const ids = [...new Set([...updates.map((u) => u.id), ...deletes])];
  const existing = await prisma.recipe.findMany({ where: { householdId, id: { in: ids } }, select: { id: true, name: true, photoId: true } });
  if (existing.length !== ids.length) notFound("Recette");
  const byId = new Map(existing.map((r) => [r.id, r]));

  await prisma.$transaction(
    async (tx) => {
      for (const { id, ...fields } of updates) await writeRecipe(tx, householdId, id, fields);
      for (const id of deletes) {
        // Comme pour une suppression unitaire : le planning garde le nom du plat.
        await tx.mealPlanItem.updateMany({ where: { recipeId: id, title: null }, data: { title: byId.get(id)!.name || "Recette supprimée" } });
      }
      if (deletes.length) await tx.recipe.deleteMany({ where: { householdId, id: { in: deletes } } });
    },
    { timeout: 60_000 },
  );
  for (const id of deletes) await releasePhoto(byId.get(id)!.photoId);
  return c.json(await listRecipes(householdId));
});

/**
 * Liens ingrédients ↔ stock, sur des ingrédients de n'importe quelles recettes du
 * foyer : `productId` change le produit principal (rapprochement automatique
 * erroné, ingrédient orphelin) ; `alternatives` remplace les variantes acceptées.
 */
recipeRoutes.post("/ingredients/link", async (c) => {
  const householdId = c.var.householdId;
  const { ids, productId, alternatives } = await parseJson(
    c.req,
    z.object({
      ids: z.array(z.string().min(1).max(64)).min(1).max(2000),
      productId: z.string().min(1).max(64).optional(),
      alternatives: z.array(z.string().min(1).max(64)).max(50).optional(),
    }),
  );
  const wanted = [...new Set([...(productId ? [productId] : []), ...(alternatives ?? [])])];
  if ((await prisma.product.count({ where: { householdId, id: { in: wanted } } })) !== wanted.length) notFound("Produit");
  const unique = [...new Set(ids)];
  const rows = await prisma.recipeIngredient.findMany({ where: { id: { in: unique }, recipe: { householdId } }, select: { id: true, productId: true, alternatives: true } });
  if (rows.length !== unique.length) notFound("Ingrédient");
  await prisma.$transaction(
    rows.map((row) => {
      const main = productId ?? row.productId;
      const alts = (alternatives ?? parseTags(row.alternatives)).filter((id) => id !== main);
      return prisma.recipeIngredient.update({ where: { id: row.id }, data: { productId: main, alternatives: JSON.stringify([...new Set(alts)]) } });
    }),
  );
  return c.json(await listRecipes(householdId));
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
  const existing = await prisma.recipe.findFirst({ where: { id: c.req.param("id"), householdId: c.var.householdId }, select: { id: true, photoId: true, name: true } });
  if (!existing) throw new HttpError(404, "Recette introuvable");
  await prisma.$transaction([
    // Le planning garde le nom du plat, sans lien vers la recette supprimée.
    prisma.mealPlanItem.updateMany({ where: { recipeId: existing.id, title: null }, data: { title: existing.name || "Recette supprimée" } }),
    prisma.recipe.delete({ where: { id: existing.id } }),
  ]);
  await releasePhoto(existing.photoId);
  return c.json({ ok: true });
});
