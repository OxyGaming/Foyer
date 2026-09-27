import { Hono } from "hono";
import { z } from "zod";
import { isIsoDate } from "../../shared/dates";
import { computeNeeds, type NeedsProduct, type NeedsRecipe } from "../../shared/needs";
import { quantityToBuy, stockStatus, totalQuantity } from "../../shared/stock";
import { normalize } from "../../shared/text";
import { compatibleUnits, convertQty } from "../../shared/units";
import { type AuthVars, requireAuth } from "../auth";
import { prisma } from "../db";
import { HttpError, nameText, notFound, optId, optNumber, optText, optUnit, parseJson } from "../http";
import { addToStock, defaultStockLocation } from "./products";
import { resolveStore } from "./purchases";

export const shoppingRoutes = new Hono<{ Variables: AuthVars }>();
shoppingRoutes.use(requireAuth);

const clientId = z.string().regex(/^[a-z0-9_-]{8,40}$/i).optional();

const itemSelect = {
  id: true, productId: true, name: true, quantity: true, unit: true, quantityOverride: true, neededQty: true, stockQty: true,
  source: true, recipesLabel: true, checked: true, checkedAt: true, note: true, position: true, createdAt: true,
} as const;

/** Une liste active par foyer (créée à la première utilisation). */
async function activeList(householdId: string) {
  return (
    (await prisma.shoppingList.findFirst({ where: { householdId }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.shoppingList.create({ data: { householdId } }))
  );
}

async function listPayload(householdId: string) {
  const list = await activeList(householdId);
  const items = await prisma.shoppingListItem.findMany({
    where: { listId: list.id },
    orderBy: [{ checked: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    select: itemSelect,
  });
  return { list: { id: list.id, planFrom: list.planFrom, planTo: list.planTo }, items };
}

async function productsWithStock(householdId: string) {
  const products = await prisma.product.findMany({
    where: { householdId },
    select: { id: true, name: true, unit: true, minStock: true, targetStock: true, defaultLocationId: true, stockItems: { select: { quantity: true } } },
  });
  return products.map((p) => ({ ...p, quantity: totalQuantity(p.stockItems) }));
}

async function nextPosition(listId: string) {
  const last = await prisma.shoppingListItem.findFirst({ where: { listId }, orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? -1) + 1;
}

shoppingRoutes.get("/", async (c) => c.json(await listPayload(c.var.householdId)));

/**
 * (Re)génère les articles issus du planning sur la période : besoins des
 * recettes additionnés, moins le stock. Les articles déjà cochés et les
 * quantités corrigées à la main sont conservés.
 */
shoppingRoutes.post("/sync", async (c) => {
  const householdId = c.var.householdId;
  const body = await parseJson(c.req, z.object({ from: z.string().refine(isIsoDate), to: z.string().refine(isIsoDate) }));
  if (body.to < body.from) throw new HttpError(400, "Période invalide");
  const list = await activeList(householdId);

  const meals = await prisma.mealPlanItem.findMany({
    where: { householdId, date: { gte: body.from, lte: body.to }, recipeId: { not: null } },
    select: { recipeId: true, servings: true, cookedAt: true },
  });
  const recipeRows = await prisma.recipe.findMany({
    where: { householdId, id: { in: [...new Set(meals.map((m) => m.recipeId!))] } },
    select: { id: true, name: true, servings: true, ingredients: { select: { name: true, productId: true, quantity: true, unit: true } } },
  });
  const products = await productsWithStock(householdId);
  const needs = computeNeeds(
    meals.map((m) => ({ recipeId: m.recipeId, servings: m.servings, cooked: m.cookedAt != null })),
    new Map<string, NeedsRecipe>(recipeRows.map((r) => [r.id, r])),
    new Map<string, NeedsProduct>(products.map((p) => [p.id, p])),
  );

  const existing = await prisma.shoppingListItem.findMany({ where: { listId: list.id, source: "plan" } });
  const byKey = new Map(existing.map((i) => [i.planKey, i]));
  let position = await nextPosition(list.id);

  await prisma.$transaction(async (tx) => {
    for (const n of needs) {
      const data = {
        productId: n.productId,
        name: n.name,
        unit: n.unit,
        quantity: n.toBuy,
        neededQty: n.needed,
        stockQty: n.stock,
        recipesLabel: n.recipes.join(", "),
      };
      const cur = byKey.get(n.key);
      if (cur) {
        byKey.delete(n.key);
        // Un article coché est « acheté » : on ne le modifie plus.
        if (!cur.checked) await tx.shoppingListItem.update({ where: { id: cur.id }, data });
      } else {
        await tx.shoppingListItem.create({ data: { ...data, listId: list.id, householdId, source: "plan", planKey: n.key, position: position++ } });
      }
    }
    // Besoins disparus (repas retiré, cuisiné…) : on retire les articles non cochés.
    const stale = [...byKey.values()].filter((i) => !i.checked).map((i) => i.id);
    if (stale.length) await tx.shoppingListItem.deleteMany({ where: { id: { in: stale } } });
    await tx.shoppingList.update({ where: { id: list.id }, data: { planFrom: body.from, planTo: body.to } });
  });
  return c.json(await listPayload(householdId));
});

/** Ajoute les produits sous leur seuil minimum qui ne sont pas déjà sur la liste. */
shoppingRoutes.post("/restock", async (c) => {
  const householdId = c.var.householdId;
  const list = await activeList(householdId);
  const products = await productsWithStock(householdId);
  const onList = new Set(
    (await prisma.shoppingListItem.findMany({ where: { listId: list.id, checked: false, productId: { not: null } }, select: { productId: true } })).map((i) => i.productId),
  );
  let position = await nextPosition(list.id);
  let added = 0;
  for (const p of products) {
    const toBuy = quantityToBuy(p.quantity, p.minStock, p.targetStock);
    if (toBuy == null || stockStatus(p.quantity, p.minStock) === "ok" || onList.has(p.id)) continue;
    await prisma.shoppingListItem.create({
      data: { listId: list.id, householdId, productId: p.id, name: p.name, unit: p.unit, quantity: toBuy, stockQty: p.quantity, source: "restock", position: position++ },
    });
    added++;
  }
  return c.json({ ...(await listPayload(householdId)), added });
});

/** Ajout manuel. Idempotent avec un id client ; fusionne avec un article identique non coché. */
shoppingRoutes.post("/items", async (c) => {
  const householdId = c.var.householdId;
  const body = await parseJson(
    c.req,
    z.object({ id: clientId, name: nameText(120), productId: optId, quantity: optNumber, unit: optUnit(), note: optText(200) }),
  );
  if (body.id) {
    const existing = await prisma.shoppingListItem.findUnique({ where: { id: body.id }, select: { ...itemSelect, householdId: true } });
    if (existing) {
      if (existing.householdId !== householdId) throw new HttpError(409, "Identifiant déjà utilisé");
      const { householdId: _h, ...rest } = existing;
      return c.json(rest);
    }
  }
  const list = await activeList(householdId);

  // Rattachement au catalogue par le nom (sans créer de produit).
  let productId = body.productId;
  let name = body.name;
  if (productId) {
    const p = await prisma.product.findFirst({ where: { id: productId, householdId }, select: { name: true } });
    if (!p) productId = null;
    else if (!name) name = p.name;
  }
  if (!productId && name) {
    const key = normalize(name);
    const match = (await prisma.product.findMany({ where: { householdId }, select: { id: true, name: true } })).find((p) => normalize(p.name) === key);
    productId = match?.id ?? null;
  }

  const twin = (await prisma.shoppingListItem.findMany({ where: { listId: list.id, checked: false, source: { not: "plan" } } })).find((i) =>
    productId ? i.productId === productId : normalize(i.name) === normalize(name),
  );
  if (twin && compatibleUnits(twin.unit, body.unit)) {
    const add = body.quantity != null ? convertQty(body.quantity, body.unit, twin.unit) : null;
    const updated = await prisma.shoppingListItem.update({
      where: { id: twin.id },
      data: { quantity: add != null ? (twin.quantity ?? 0) + add : twin.quantity },
      select: itemSelect,
    });
    return c.json(updated);
  }

  const item = await prisma.shoppingListItem.create({
    data: {
      ...(body.id ? { id: body.id } : {}),
      listId: list.id,
      householdId,
      productId,
      name,
      quantity: body.quantity,
      unit: body.unit,
      note: body.note,
      source: "manual",
      position: await nextPosition(list.id),
    },
    select: itemSelect,
  });
  return c.json(item, 201);
});

shoppingRoutes.patch("/items/:id", async (c) => {
  const householdId = c.var.householdId;
  const item = await prisma.shoppingListItem.findFirst({ where: { id: c.req.param("id"), householdId } });
  if (!item) notFound("Article");
  const body = await parseJson(
    c.req,
    z.object({
      checked: z.boolean().optional(),
      quantity: optNumber.optional(),
      resetQuantity: z.boolean().optional(),
      unit: optUnit().optional(),
      name: nameText(120).optional(),
      note: optText(200).optional(),
    }),
  );
  const { checked, quantity, resetQuantity, ...rest } = body;
  const data: Record<string, unknown> = { ...rest };
  if (checked !== undefined && checked !== item.checked) {
    data.checked = checked;
    data.checkedAt = checked ? new Date() : null;
  }
  // Sur un article du planning, la saisie devient une correction manuelle
  // (conservée lors des régénérations) ; « resetQuantity » revient au calcul.
  if (quantity !== undefined) data[item.source === "plan" ? "quantityOverride" : "quantity"] = quantity;
  if (resetQuantity) data.quantityOverride = null;
  const updated = await prisma.shoppingListItem.update({ where: { id: item.id }, data, select: itemSelect });
  return c.json(updated);
});

shoppingRoutes.delete("/items/:id", async (c) => {
  await prisma.shoppingListItem.deleteMany({ where: { id: c.req.param("id"), householdId: c.var.householdId } });
  return c.json({ ok: true });
});

shoppingRoutes.post("/clear-checked", async (c) => {
  const list = await activeList(c.var.householdId);
  await prisma.shoppingListItem.deleteMany({ where: { listId: list.id, checked: true } });
  return c.json(await listPayload(c.var.householdId));
});

/**
 * Retour de courses : range les articles achetés dans le stock et enregistre
 * l'achat (date, quantité, prix si saisi). Les articles traités quittent la liste.
 */
shoppingRoutes.post("/stock-in", async (c) => {
  const householdId = c.var.householdId;
  const body = await parseJson(
    c.req,
    z.object({
      entries: z
        .array(
          z.object({
            itemId: z.string().max(64),
            addToStock: z.boolean(),
            quantity: optNumber,
            locationId: optId,
            totalCents: z.number().int().min(0).max(10_000_000).nullish(),
          }),
        )
        .max(300),
      /** Magasin du passage en caisse (facultatif), commun à tous les articles. */
      storeName: optText(80),
    }),
  );
  const locations = new Set((await prisma.location.findMany({ where: { householdId }, select: { id: true } })).map((l) => l.id));
  let stocked = 0;

  await prisma.$transaction(async (tx) => {
    const storeId = await resolveStore(tx, householdId, body.storeName);
    for (const e of body.entries) {
      const item = await tx.shoppingListItem.findFirst({ where: { id: e.itemId, householdId } });
      if (!item) continue;
      if (e.addToStock) {
        let product = item.productId ? await tx.product.findFirst({ where: { id: item.productId, householdId } }) : null;
        // Article libre (« Papier toilette ») : on crée le produit à cette occasion.
        if (!product && item.name) product = await tx.product.create({ data: { householdId, name: item.name, unit: item.unit } });
        if (product) {
          const locationId = e.locationId && locations.has(e.locationId) ? e.locationId : await defaultStockLocation(tx, product);
          // Produit sans unité ni stock chiffré : il adopte l'unité de l'article acheté.
          let unit = product.unit;
          if (!product.unit && item.unit && (await tx.stockItem.count({ where: { productId: product.id, quantity: { not: null } } })) === 0) {
            await tx.product.update({ where: { id: product.id }, data: { unit: item.unit } });
            unit = item.unit;
          }
          const purchase = await tx.purchase.create({
            data: { householdId, productId: product.id, quantity: e.quantity, unit, totalCents: e.totalCents ?? null, storeId, userId: c.var.userId },
          });
          if (e.quantity != null && e.quantity > 0) {
            await addToStock(tx, { householdId, productId: product.id, locationId, delta: e.quantity, type: "purchase", userId: c.var.userId, purchaseId: purchase.id, note: body.storeName ? `Courses · ${body.storeName}` : "Courses" });
          } else {
            // Quantité inconnue : le produit est « présent » à cet emplacement.
            const line = await tx.stockItem.findFirst({ where: { productId: product.id, locationId } });
            if (!line) await tx.stockItem.create({ data: { householdId, productId: product.id, locationId, quantity: null } });
          }
          stocked++;
        }
      }
      await tx.shoppingListItem.delete({ where: { id: item.id } });
    }
  });
  return c.json({ ...(await listPayload(householdId)), stocked });
});
