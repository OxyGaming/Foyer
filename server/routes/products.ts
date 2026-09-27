import { Hono } from "hono";
import { z } from "zod";
import { priceStats } from "../../shared/prices";
import { quantityToBuy, roundQty, stockStatus, totalQuantity } from "../../shared/stock";
import { productKey } from "../../shared/text";
import { compatibleUnits, convertQty } from "../../shared/units";
import { type AuthVars, requireAuth } from "../auth";
import { prisma, type Tx } from "../db";
import { HttpError, nameText, notFound, optId, optNumber, optText, optUnit, parseJson } from "../http";
import { assertPhoto, releasePhoto } from "../photos";

export const productRoutes = new Hono<{ Variables: AuthVars }>();
productRoutes.use(requireAuth);

const productFields = {
  name: nameText(120),
  photoId: optId,
  categoryId: optId,
  unit: optUnit(),
  minStock: optNumber,
  targetStock: optNumber,
  defaultLocationId: optId,
  brand: optText(80),
  reference: optText(80),
  notes: optText(4000),
};
const productInput = z.object({
  ...productFields,
  // Saisie rapide à la création : « Lessive, 3, Garage ».
  quantity: optNumber,
  locationId: optId,
});

const productSelect = {
  id: true, name: true, photoId: true, categoryId: true, unit: true, minStock: true, targetStock: true,
  defaultLocationId: true, brand: true, reference: true, notes: true, createdAt: true, updatedAt: true,
  stockItems: { select: { id: true, locationId: true, quantity: true, updatedAt: true }, orderBy: { updatedAt: "asc" as const } },
  // Achats chiffrés : de quoi calculer coût moyen, dernier et meilleur prix.
  purchases: {
    where: { totalCents: { not: null } },
    select: { id: true, date: true, quantity: true, unit: true, totalCents: true, isPromo: true, store: { select: { name: true } } },
  },
} as const;

type ProductRow = {
  unit: string | null;
  minStock: number | null;
  targetStock: number | null;
  stockItems: { id: string; locationId: string | null; quantity: number | null; updatedAt: Date }[];
  purchases: { id: string; date: Date; quantity: number | null; unit: string | null; totalCents: number | null; isPromo: boolean; store: { name: string } | null }[];
};

function pricing(p: ProductRow) {
  const stats = priceStats(p.purchases.map((x) => ({ ...x, store: x.store?.name })), p.unit);
  return stats && { count: stats.count, avgCents: stats.avgCents, last: stats.last, best: stats.best, history: stats.history };
}

function present<T extends ProductRow>(p: T, withHistory = false) {
  const { stockItems, purchases: _purchases, ...rest } = p;
  const quantity = totalQuantity(stockItems);
  const price = pricing(p);
  return {
    ...rest,
    stock: stockItems,
    quantity,
    status: stockStatus(quantity, p.minStock),
    toBuy: quantityToBuy(quantity, p.minStock, p.targetStock),
    // Sans prix exploitable : null (on n'invente pas de valeur).
    pricing: price && (withHistory ? price : { ...price, history: undefined }),
  };
}

async function assertRefs(householdId: string, b: { categoryId?: string | null; defaultLocationId?: string | null; locationId?: string | null; photoId?: string | null }) {
  if (b.categoryId && !(await prisma.category.findFirst({ where: { id: b.categoryId, householdId } }))) throw new HttpError(400, "Catégorie inconnue");
  for (const locId of [b.defaultLocationId, b.locationId]) {
    if (locId && !(await prisma.location.findFirst({ where: { id: locId, householdId } }))) throw new HttpError(400, "Emplacement inconnu");
  }
  if (b.photoId !== undefined) await assertPhoto(householdId, b.photoId);
}

async function loadProduct(householdId: string, id: string) {
  const p = await prisma.product.findFirst({ where: { id, householdId }, select: productSelect });
  if (!p) notFound("Produit");
  return p;
}

productRoutes.get("/", async (c) => {
  const products = await prisma.product.findMany({
    where: { householdId: c.var.householdId },
    orderBy: { name: "asc" },
    select: productSelect,
  });
  return c.json(products.map((p) => present(p)));
});

productRoutes.get("/:id", async (c) => {
  const householdId = c.var.householdId;
  const p = await loadProduct(householdId, c.req.param("id"));
  const [movements, recipes, purchases] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, type: true, delta: true, quantityAfter: true, note: true, createdAt: true, stockItem: { select: { locationId: true } }, userId: true },
    }),
    prisma.recipe.findMany({
      where: { householdId, ingredients: { some: { productId: p.id } } },
      select: { id: true, name: true, photoId: true },
      orderBy: { name: "asc" },
    }),
    prisma.purchase.findMany({
      where: { productId: p.id },
      orderBy: { date: "desc" },
      take: 100,
      select: { id: true, date: true, quantity: true, unit: true, totalCents: true, isPromo: true, note: true, store: { select: { name: true } } },
    }),
  ]);
  return c.json({ ...present(p, true), movements, recipes, purchases });
});

/**
 * Produit du même nom (au sens de productKey : « Huile d’olive » = « huile d'olive »)
 * réutilisable plutôt que d'en créer un doublon : c'est le cas si ses unités sont
 * comparables, ou s'il n'a encore aucun stock (souvent créé par une recette, son
 * unité n'était alors qu'une supposition).
 */
async function reusableTwin(tx: Tx, householdId: string, name: string, unit: string | null) {
  const key = productKey(name);
  if (!key) return null;
  const candidates = await tx.product.findMany({ where: { householdId }, select: { id: true, name: true, unit: true, _count: { select: { stockItems: true } } } });
  const twins = candidates.filter((p) => productKey(p.name) === key);
  return twins.find((p) => compatibleUnits(p.unit, unit)) ?? twins.find((p) => p._count.stockItems === 0) ?? null;
}

productRoutes.post("/", async (c) => {
  const body = await parseJson(c.req, productInput);
  const householdId = c.var.householdId;
  await assertRefs(householdId, body);
  const { quantity, locationId, ...fields } = body;
  const { id, reused } = await prisma.$transaction(async (tx) => {
    const twin = await reusableTwin(tx, householdId, fields.name, fields.unit ?? null);
    let productId: string;
    let qty = quantity;
    if (twin) {
      // Sans stock, l'unité saisie remplace celle supposée par une recette ;
      // sinon on garde celle du produit et on y convertit la quantité.
      const adoptUnit = twin._count.stockItems === 0;
      if (!adoptUnit && qty != null) qty = roundQty(convertQty(qty, fields.unit, twin.unit) ?? qty);
      // Complète le produit existant sans écraser ce qui est déjà renseigné.
      const current = await tx.product.findUniqueOrThrow({ where: { id: twin.id } });
      const fill = Object.fromEntries(
        Object.entries({ ...fields, defaultLocationId: fields.defaultLocationId ?? locationId }).filter(
          ([k, v]) => k !== "name" && (k === "unit" ? adoptUnit :v != null && current[k as keyof typeof current] == null),
        ),
      );
      if (Object.keys(fill).length) await tx.product.update({ where: { id: twin.id }, data: fill });
      productId = twin.id;
    } else {
      productId = (await tx.product.create({ data: { ...fields, householdId, defaultLocationId: fields.defaultLocationId ?? locationId } })).id;
    }
    if (qty != null || locationId) {
      await setStock(tx, { householdId, productId, locationId, quantity: qty, type: "adjust", userId: c.var.userId, note: twin ? undefined : "Création" });
    }
    return { id: productId, reused: !!twin };
  });
  return c.json({ ...present(await loadProduct(householdId, id)), reused }, reused ? 200 : 201);
});

/**
 * Fusionne ce produit dans `intoId` puis le supprime : stock, historique,
 * achats, ingrédients de recettes et articles de courses suivent. Le produit
 * gardé conserve ses informations et complète celles qui lui manquent.
 */
productRoutes.post("/:id/merge", async (c) => {
  const householdId = c.var.householdId;
  const source = await loadProduct(householdId, c.req.param("id"));
  const { intoId } = await parseJson(c.req, z.object({ intoId: z.string().min(1).max(64) }));
  if (intoId === source.id) throw new HttpError(400, "Choisissez un autre produit");
  const target = await loadProduct(householdId, intoId);

  // Quantités converties dans l'unité du produit gardé ; refus si ce n'est pas possible.
  const converted = source.stockItems.map((line) => {
    if (line.quantity == null) return { line, quantity: null };
    const q = convertQty(line.quantity, source.unit, target.unit);
    if (q == null) throw new HttpError(400, `Unités incompatibles (${source.unit ?? "pièce"} / ${target.unit ?? "pièce"}) : alignez l'unité d'un des deux produits avant de fusionner.`);
    return { line, quantity: roundQty(q) };
  });

  await prisma.$transaction(async (tx) => {
    for (const { line, quantity } of converted) {
      const twin = target.stockItems.find((t) => t.locationId === line.locationId);
      if (twin) {
        const merged = twin.quantity == null && quantity == null ? null : roundQty((twin.quantity ?? 0) + (quantity ?? 0));
        await tx.stockItem.update({ where: { id: twin.id }, data: { quantity: merged } });
        await tx.stockMovement.updateMany({ where: { stockItemId: line.id }, data: { stockItemId: twin.id } });
        await tx.stockItem.delete({ where: { id: line.id } });
      } else {
        await tx.stockItem.update({ where: { id: line.id }, data: { productId: target.id, quantity } });
      }
    }
    await tx.stockMovement.updateMany({ where: { productId: source.id }, data: { productId: target.id } });
    await tx.purchase.updateMany({ where: { productId: source.id }, data: { productId: target.id } });
    await tx.recipeIngredient.updateMany({ where: { productId: source.id }, data: { productId: target.id } });
    await tx.shoppingListItem.updateMany({ where: { productId: source.id }, data: { productId: target.id } });

    const sameUnit = compatibleUnits(source.unit, target.unit);
    const fill: Record<string, unknown> = {};
    for (const k of ["photoId", "categoryId", "defaultLocationId", "brand", "reference", "notes"] as const) {
      if (target[k] == null && source[k] != null) fill[k] = source[k];
    }
    // Seuils : seulement s'ils s'expriment dans la même unité.
    if (sameUnit) {
      for (const k of ["minStock", "targetStock"] as const) {
        if (target[k] == null && source[k] != null) fill[k] = convertQty(source[k]!, source.unit, target.unit);
      }
    }
    if (Object.keys(fill).length) await tx.product.update({ where: { id: target.id }, data: fill });
    await tx.product.delete({ where: { id: source.id } });
  });
  if (source.photoId && source.photoId !== target.photoId && target.photoId != null) await releasePhoto(source.photoId);
  return c.json(present(await loadProduct(householdId, target.id)));
});

const bulkInput = z.object({
  updates: z
    .array(z.object({ id: z.string().min(1).max(64), ...z.object(productFields).omit({ photoId: true }).partial().shape, quantity: optNumber.optional() }))
    .max(5000)
    .default([]),
  deletes: z.array(z.string().min(1).max(64)).max(5000).default([]),
});

/**
 * Édition en masse (vue tableur) : tout passe ou rien. La quantité ne se
 * modifie que pour un produit rangé à un seul endroit (ou nulle part : elle va
 * alors à son emplacement habituel). Renvoie la liste complète à jour.
 */
productRoutes.post("/bulk", async (c) => {
  const householdId = c.var.householdId;
  const { updates, deletes } = await parseJson(c.req, bulkInput);
  const ids = [...new Set([...updates.map((u) => u.id), ...deletes])];
  const existing = await prisma.product.findMany({
    where: { householdId, id: { in: ids } },
    select: { id: true, name: true, photoId: true, defaultLocationId: true, stockItems: { select: { locationId: true } } },
  });
  if (existing.length !== ids.length) notFound("Produit");
  const byId = new Map(existing.map((p) => [p.id, p]));

  const catIds = [...new Set(updates.map((u) => u.categoryId).filter((v): v is string => !!v))];
  const locIds = [...new Set(updates.map((u) => u.defaultLocationId).filter((v): v is string => !!v))];
  if ((await prisma.category.count({ where: { householdId, id: { in: catIds } } })) !== catIds.length) throw new HttpError(400, "Catégorie inconnue");
  if ((await prisma.location.count({ where: { householdId, id: { in: locIds } } })) !== locIds.length) throw new HttpError(400, "Emplacement inconnu");
  for (const u of updates) {
    const p = byId.get(u.id)!;
    if (u.quantity !== undefined && p.stockItems.length > 1) {
      throw new HttpError(400, `« ${p.name || "Sans nom"} » est rangé à plusieurs endroits : modifiez sa quantité depuis sa fiche.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const { id, quantity, ...fields } of updates) {
      const p = byId.get(id)!;
      if (Object.keys(fields).length) await tx.product.update({ where: { id }, data: fields });
      if (quantity !== undefined) {
        // Ligne existante (même « sans emplacement ») sinon emplacement habituel.
        const locationId = p.stockItems.length ? p.stockItems[0].locationId : fields.defaultLocationId !== undefined ? fields.defaultLocationId : p.defaultLocationId;
        await setStock(tx, { householdId, productId: id, locationId, quantity, type: "adjust", userId: c.var.userId, note: "Édition en masse" });
      }
    }
    if (deletes.length) await tx.product.deleteMany({ where: { householdId, id: { in: deletes } } });
  });
  for (const id of deletes) await releasePhoto(byId.get(id)!.photoId);

  const products = await prisma.product.findMany({ where: { householdId }, orderBy: { name: "asc" }, select: productSelect });
  return c.json(products.map((p) => present(p)));
});

productRoutes.patch("/:id", async (c) => {
  const householdId = c.var.householdId;
  const existing = await loadProduct(householdId, c.req.param("id"));
  const body = await parseJson(c.req, z.object(productFields).partial());
  await assertRefs(householdId, body);
  await prisma.product.update({ where: { id: existing.id }, data: body });
  if (body.photoId !== undefined && body.photoId !== existing.photoId) await releasePhoto(existing.photoId);
  return c.json(present(await loadProduct(householdId, existing.id)));
});

productRoutes.delete("/:id", async (c) => {
  const existing = await loadProduct(c.var.householdId, c.req.param("id"));
  // Les ingrédients de recettes gardent leur libellé (productId → null).
  await prisma.product.delete({ where: { id: existing.id } });
  await releasePhoto(existing.photoId);
  return c.json({ ok: true });
});

/** Définit la quantité à un emplacement (crée la ligne si besoin). */
productRoutes.post("/:id/stock", async (c) => {
  const householdId = c.var.householdId;
  const p = await loadProduct(householdId, c.req.param("id"));
  const body = await parseJson(c.req, z.object({ locationId: optId, quantity: optNumber, inventory: z.boolean().optional() }));
  await assertRefs(householdId, { locationId: body.locationId });
  await prisma.$transaction((tx) =>
    setStock(tx, { householdId, productId: p.id, locationId: body.locationId, quantity: body.quantity, type: body.inventory ? "inventory" : "adjust", userId: c.var.userId }),
  );
  return c.json(present(await loadProduct(householdId, p.id)));
});

// ─── Lignes de stock ─────────────────────────────────────────────────────────

export const stockRoutes = new Hono<{ Variables: AuthVars }>();
stockRoutes.use(requireAuth);

async function loadItem(householdId: string, id: string) {
  const item = await prisma.stockItem.findFirst({ where: { id, householdId } });
  if (!item) notFound("Ligne de stock");
  return item;
}

stockRoutes.post("/:id/adjust", async (c) => {
  const householdId = c.var.householdId;
  const item = await loadItem(householdId, c.req.param("id"));
  const { delta } = await parseJson(c.req, z.object({ delta: z.number().finite().min(-1e6).max(1e6) }));
  const quantity = Math.max(0, roundQty((item.quantity ?? 0) + delta));
  await prisma.$transaction((tx) =>
    setStock(tx, { householdId, productId: item.productId, locationId: item.locationId, quantity, type: delta < 0 ? "consume" : "adjust", userId: c.var.userId }),
  );
  return c.json(present(await loadProduct(householdId, item.productId)));
});

/** Modifie la quantité et/ou déplace la ligne (fusion si l'emplacement cible a déjà une ligne). */
stockRoutes.patch("/:id", async (c) => {
  const householdId = c.var.householdId;
  const item = await loadItem(householdId, c.req.param("id"));
  const body = await parseJson(c.req, z.object({ quantity: optNumber.optional(), locationId: optId.optional(), inventory: z.boolean().optional() }));
  await assertRefs(householdId, { locationId: body.locationId });
  await prisma.$transaction(async (tx) => {
    let current = item;
    if (body.locationId !== undefined && body.locationId !== item.locationId) {
      const target = await tx.stockItem.findFirst({ where: { productId: item.productId, locationId: body.locationId } });
      if (target) {
        const merged = target.quantity == null && item.quantity == null ? null : (target.quantity ?? 0) + (item.quantity ?? 0);
        await tx.stockItem.delete({ where: { id: item.id } });
        current = await tx.stockItem.update({ where: { id: target.id }, data: { quantity: merged } });
      } else {
        current = await tx.stockItem.update({ where: { id: item.id }, data: { locationId: body.locationId } });
      }
      await tx.stockMovement.create({
        data: { householdId, productId: item.productId, stockItemId: current.id, type: "move", delta: item.quantity, quantityAfter: current.quantity, userId: c.var.userId },
      });
    }
    if (body.quantity !== undefined) {
      await setStock(tx, { householdId, productId: item.productId, locationId: current.locationId, quantity: body.quantity, type: body.inventory ? "inventory" : "adjust", userId: c.var.userId });
    }
  });
  return c.json(present(await loadProduct(householdId, item.productId)));
});

stockRoutes.delete("/:id", async (c) => {
  const householdId = c.var.householdId;
  const item = await loadItem(householdId, c.req.param("id"));
  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: { householdId, productId: item.productId, type: "adjust", delta: item.quantity == null ? null : -item.quantity, quantityAfter: null, note: "Ligne supprimée", userId: c.var.userId },
    });
    await tx.stockItem.delete({ where: { id: item.id } });
  });
  return c.json(present(await loadProduct(householdId, item.productId)));
});

// ─── Écriture du stock + mouvement ───────────────────────────────────────────

/** Où ranger un achat sans emplacement précisé : l'habituel, sinon l'unique endroit déjà utilisé. */
export async function defaultStockLocation(tx: Tx, product: { id: string; defaultLocationId: string | null }) {
  if (product.defaultLocationId) return product.defaultLocationId;
  const lines = await tx.stockItem.findMany({ where: { productId: product.id }, select: { locationId: true } });
  return lines.length === 1 ? lines[0].locationId : null;
}

/** Ajoute une quantité à un emplacement (quantité inconnue → devient la quantité ajoutée). */
export async function addToStock(
  tx: Tx,
  a: { householdId: string; productId: string; locationId: string | null; delta: number; type: string; userId: string; note?: string; purchaseId?: string },
) {
  const existing = await tx.stockItem.findFirst({ where: { productId: a.productId, locationId: a.locationId } });
  const quantity = roundQty((existing?.quantity ?? 0) + a.delta);
  return setStock(tx, { ...a, quantity });
}

/**
 * Retire une quantité du stock d'un produit : emplacement habituel d'abord,
 * puis les autres lignes (les plus fournies en premier). Jamais sous zéro.
 * Retourne la quantité réellement retirée.
 */
export async function consumeStock(tx: Tx, a: { householdId: string; productId: string; quantity: number; userId: string; note?: string }) {
  const product = await tx.product.findFirst({ where: { id: a.productId, householdId: a.householdId }, select: { defaultLocationId: true } });
  if (!product) return 0;
  const lines = (await tx.stockItem.findMany({ where: { productId: a.productId } }))
    .filter((l) => l.quantity != null && l.quantity > 0)
    .sort((x, y) => Number(y.locationId === product.defaultLocationId) - Number(x.locationId === product.defaultLocationId) || y.quantity! - x.quantity!);
  let left = a.quantity;
  for (const line of lines) {
    if (left <= 1e-9) break;
    const take = Math.min(left, line.quantity!);
    await setStock(tx, { householdId: a.householdId, productId: a.productId, locationId: line.locationId, quantity: roundQty(line.quantity! - take), type: "consume", userId: a.userId, note: a.note });
    left -= take;
  }
  return roundQty(a.quantity - Math.max(0, left));
}

export async function setStock(
  tx: Tx,
  a: { householdId: string; productId: string; locationId: string | null; quantity: number | null; type: string; userId: string; note?: string; purchaseId?: string },
) {
  const existing = await tx.stockItem.findFirst({ where: { productId: a.productId, locationId: a.locationId } });
  const before = existing?.quantity ?? null;
  const item = existing
    ? await tx.stockItem.update({ where: { id: existing.id }, data: { quantity: a.quantity } })
    : await tx.stockItem.create({ data: { householdId: a.householdId, productId: a.productId, locationId: a.locationId, quantity: a.quantity } });
  if (existing && before === a.quantity && a.type !== "inventory") return item;
  await tx.stockMovement.create({
    data: {
      householdId: a.householdId,
      productId: a.productId,
      stockItemId: item.id,
      type: a.type,
      delta: a.quantity == null ? null : roundQty(a.quantity - (before ?? 0)),
      quantityAfter: a.quantity,
      note: a.note,
      purchaseId: a.purchaseId,
      userId: a.userId,
    },
  });
  return item;
}
