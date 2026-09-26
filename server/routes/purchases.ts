import { Hono } from "hono";
import { z } from "zod";
import { isIsoDate } from "../../shared/dates";
import { normalize } from "../../shared/text";
import { type AuthVars, requireAuth } from "../auth";
import { prisma, type Tx } from "../db";
import { HttpError, notFound, optId, optNumber, optText, parseJson } from "../http";
import { addToStock, defaultStockLocation, setStock } from "./products";

export const purchaseRoutes = new Hono<{ Variables: AuthVars }>();
purchaseRoutes.use(requireAuth);

export const purchaseSelect = {
  id: true, productId: true, date: true, quantity: true, unit: true, totalCents: true, isPromo: true, note: true, storeId: true,
  store: { select: { name: true } },
} as const;

/** Magasin désigné par son nom : réutilisé s'il existe (sans tenir compte des accents), créé sinon. */
export async function resolveStore(tx: Tx, householdId: string, name: string | null | undefined) {
  const n = name?.trim();
  if (!n) return null;
  const stores = await tx.store.findMany({ where: { householdId }, select: { id: true, name: true } });
  const match = stores.find((s) => normalize(s.name) === normalize(n));
  return match?.id ?? (await tx.store.create({ data: { householdId, name: n } })).id;
}

const day = z
  .string()
  .refine((s) => isIsoDate(s.slice(0, 10)), "date invalide")
  // Une date seule (« 2026-09-12 ») est enregistrée à midi : pas de bascule de jour selon le fuseau.
  .transform((s) => new Date(s.length === 10 ? `${s}T12:00:00` : s));

const purchaseFields = {
  date: day.optional(),
  quantity: optNumber,
  totalCents: z.number().int().min(0).max(10_000_000).nullish().transform((v) => v ?? null),
  storeName: optText(80),
  isPromo: z.boolean().optional(),
  note: optText(500),
};

purchaseRoutes.get("/stores", async (c) => {
  const stores = await prisma.store.findMany({
    where: { householdId: c.var.householdId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { purchases: true } } },
  });
  return c.json(stores.map(({ _count, ...s }) => ({ ...s, usage: _count.purchases })));
});

/** Achats d'une période (dépenses) avec le produit, du plus récent au plus ancien. */
purchaseRoutes.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) throw new HttpError(400, "Période invalide");
  const purchases = await prisma.purchase.findMany({
    where: {
      householdId: c.var.householdId,
      date: { ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}) },
    },
    orderBy: { date: "desc" },
    take: 2000,
    select: { ...purchaseSelect, product: { select: { name: true, categoryId: true, photoId: true } } },
  });
  return c.json(purchases);
});

/** Nouvel achat saisi à la main, avec entrée en stock facultative. */
purchaseRoutes.post("/", async (c) => {
  const householdId = c.var.householdId;
  const body = await parseJson(
    c.req,
    // locationId absent = « non précisé » (emplacement par défaut) ; null/"" = sans emplacement.
    z.object({ productId: z.string().max(64), ...purchaseFields, addToStock: z.boolean().default(true), locationId: z.string().max(64).nullish() }),
  );
  const product = await prisma.product.findFirst({ where: { id: body.productId, householdId } });
  if (!product) notFound("Produit");
  if (body.locationId && !(await prisma.location.findFirst({ where: { id: body.locationId, householdId } }))) throw new HttpError(400, "Emplacement inconnu");

  const purchase = await prisma.$transaction(async (tx) => {
    const storeId = await resolveStore(tx, householdId, body.storeName);
    const created = await tx.purchase.create({
      data: {
        householdId, productId: product.id, date: body.date ?? new Date(), quantity: body.quantity, unit: product.unit,
        totalCents: body.totalCents, storeId, isPromo: body.isPromo ?? false, note: body.note, userId: c.var.userId,
      },
      select: purchaseSelect,
    });
    if (body.addToStock && body.quantity != null && body.quantity > 0) {
      await addToStock(tx, {
        householdId, productId: product.id, locationId: body.locationId === undefined ? await defaultStockLocation(tx, product) : body.locationId || null, delta: body.quantity,
        type: "purchase", userId: c.var.userId, purchaseId: created.id, note: body.storeName ?? undefined,
      });
    }
    return created;
  });
  return c.json(purchase, 201);
});

/** Corrige un achat (prix oublié, date…). Le stock n'est pas modifié. */
purchaseRoutes.patch("/:id", async (c) => {
  const householdId = c.var.householdId;
  const existing = await prisma.purchase.findFirst({ where: { id: c.req.param("id"), householdId } });
  if (!existing) notFound("Achat");
  const body = await parseJson(c.req, z.object(purchaseFields).partial());
  const updated = await prisma.$transaction(async (tx) => {
    const { storeName, ...fields } = body;
    const data: Record<string, unknown> = { ...fields };
    if (storeName !== undefined) data.storeId = await resolveStore(tx, householdId, storeName);
    return tx.purchase.update({ where: { id: existing.id }, data, select: purchaseSelect });
  });
  return c.json(updated);
});

/** Supprime un achat de l'historique des prix (le stock n'est pas modifié). */
purchaseRoutes.delete("/:id", async (c) => {
  await prisma.purchase.deleteMany({ where: { id: c.req.param("id"), householdId: c.var.householdId } });
  return c.json({ ok: true });
});

// ─── Inventaire ──────────────────────────────────────────────────────────────

export const inventoryRoutes = new Hono<{ Variables: AuthVars }>();
inventoryRoutes.use(requireAuth);

/**
 * Enregistre un comptage : chaque ligne (produit × emplacement) prend la
 * quantité comptée ; l'écart est historisé comme mouvement « inventaire ».
 */
inventoryRoutes.post("/", async (c) => {
  const householdId = c.var.householdId;
  const body = await parseJson(
    c.req,
    z.object({ entries: z.array(z.object({ productId: z.string().max(64), locationId: optId, quantity: z.number().finite().min(0).max(1e9) })).max(1000) }),
  );
  const products = new Set((await prisma.product.findMany({ where: { householdId }, select: { id: true } })).map((p) => p.id));
  const locations = new Set((await prisma.location.findMany({ where: { householdId }, select: { id: true } })).map((l) => l.id));
  let corrected = 0;
  await prisma.$transaction(async (tx) => {
    for (const e of body.entries) {
      if (!products.has(e.productId) || (e.locationId && !locations.has(e.locationId))) continue;
      const before = await tx.stockItem.findFirst({ where: { productId: e.productId, locationId: e.locationId }, select: { quantity: true } });
      await setStock(tx, { householdId, productId: e.productId, locationId: e.locationId, quantity: e.quantity, type: "inventory", userId: c.var.userId });
      if (before?.quantity !== e.quantity) corrected++;
    }
  });
  return c.json({ counted: body.entries.length, corrected });
});

/** Dernières corrections d'inventaire (écarts non nuls). */
inventoryRoutes.get("/history", async (c) => {
  const moves = await prisma.stockMovement.findMany({
    where: { householdId: c.var.householdId, type: "inventory", NOT: { delta: 0 } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, delta: true, quantityAfter: true, createdAt: true, product: { select: { id: true, name: true, unit: true } }, stockItem: { select: { locationId: true } } },
  });
  return c.json(moves);
});
