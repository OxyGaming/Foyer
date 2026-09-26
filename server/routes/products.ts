import { Hono } from "hono";
import { z } from "zod";
import { quantityToBuy, roundQty, stockStatus, totalQuantity } from "../../shared/stock";
import { type AuthVars, requireAuth } from "../auth";
import { prisma, type Tx } from "../db";
import { HttpError, nameText, notFound, optId, optNumber, optText, parseJson } from "../http";
import { assertPhoto, releasePhoto } from "../photos";

export const productRoutes = new Hono<{ Variables: AuthVars }>();
productRoutes.use(requireAuth);

const productFields = {
  name: nameText(120),
  photoId: optId,
  categoryId: optId,
  unit: optText(24),
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
} as const;

type ProductRow = {
  minStock: number | null;
  targetStock: number | null;
  stockItems: { id: string; locationId: string | null; quantity: number | null; updatedAt: Date }[];
};

function present<T extends ProductRow>(p: T) {
  const { stockItems, ...rest } = p;
  const quantity = totalQuantity(stockItems);
  return {
    ...rest,
    stock: stockItems,
    quantity,
    status: stockStatus(quantity, p.minStock),
    toBuy: quantityToBuy(quantity, p.minStock, p.targetStock),
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
  return c.json(products.map(present));
});

productRoutes.get("/:id", async (c) => {
  const householdId = c.var.householdId;
  const p = await loadProduct(householdId, c.req.param("id"));
  const [movements, recipes] = await Promise.all([
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
  ]);
  return c.json({ ...present(p), movements, recipes });
});

productRoutes.post("/", async (c) => {
  const body = await parseJson(c.req, productInput);
  const householdId = c.var.householdId;
  await assertRefs(householdId, body);
  const { quantity, locationId, ...fields } = body;
  const id = await prisma.$transaction(async (tx) => {
    const p = await tx.product.create({ data: { ...fields, householdId, defaultLocationId: fields.defaultLocationId ?? locationId } });
    if (quantity != null || locationId) {
      await setStock(tx, { householdId, productId: p.id, locationId, quantity, type: "adjust", userId: c.var.userId, note: "Création" });
    }
    return p.id;
  });
  return c.json(present(await loadProduct(householdId, id)), 201);
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
