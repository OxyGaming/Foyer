// Tests d'intégration de l'API sur une base SQLite temporaire.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "foyer-test-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.UPLOAD_DIR = path.join(tmp, "uploads");

// Applique les migrations Prisma telles quelles.
const db = new Database(path.join(tmp, "test.db"));
const migDir = path.join(import.meta.dirname, "../prisma/migrations");
for (const m of fs.readdirSync(migDir).filter((d) => fs.statSync(path.join(migDir, d)).isDirectory()).sort()) {
  db.exec(fs.readFileSync(path.join(migDir, m, "migration.sql"), "utf8"));
}
db.close();

const { api } = await import("./app");
const { prisma } = await import("./db");
const { hashPassword } = await import("./auth");
const { createHousehold } = await import("./household");

type Client = { call: (method: string, url: string, body?: unknown) => Promise<{ status: number; body: any }> };

function client(): Client & { cookie: string } {
  const c = {
    cookie: "",
    async call(method: string, url: string, body?: unknown) {
      const res = await api.request(url, {
        method,
        headers: { "Content-Type": "application/json", Cookie: c.cookie, Host: "foyer.test", Origin: "https://foyer.test" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get("set-cookie");
      if (set) c.cookie = set.split(";")[0];
      return { status: res.status, body: await res.json() };
    },
  };
  return c;
}

async function userWithHousehold(email: string, name: string) {
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email, passwordHash: await hashPassword("motdepasse-test") } });
    await createHousehold(tx, name, u.id);
  });
  const c = client();
  const r = await c.call("POST", "/auth/login", { email, password: "motdepasse-test" });
  expect(r.status).toBe(200);
  return c;
}

let a: Client;
let b: Client;
beforeAll(async () => {
  a = await userWithHousehold("a@foyer.test", "Foyer A");
  b = await userWithHousehold("b@foyer.test", "Foyer B");
});

describe("aucun champ obligatoire", () => {
  it("accepte un produit et une recette vides", async () => {
    expect((await a.call("POST", "/products", {})).status).toBe(201);
    expect((await a.call("POST", "/recipes", {})).status).toBe(201);
    const r = await a.call("POST", "/recipes", { name: "Tartiflette" });
    expect(r.body).toMatchObject({ name: "Tartiflette", ingredients: [], steps: [] });
  });
});

describe("stock", () => {
  it("calcule statut et quantité à acheter (exemple lessive)", async () => {
    const p = await a.call("POST", "/products", { name: "Lessive", quantity: 1, minStock: 2, targetStock: 4 });
    expect(p.body).toMatchObject({ quantity: 1, status: "low", toBuy: 3 });
    const line = p.body.stock[0].id;
    expect((await a.call("POST", `/stock/${line}/adjust`, { delta: 1 })).body).toMatchObject({ quantity: 2, status: "watch" });
    expect((await a.call("POST", `/stock/${line}/adjust`, { delta: -9 })).body).toMatchObject({ quantity: 0, status: "out" });
    const inv = await a.call("PATCH", `/stock/${line}`, { quantity: 5, inventory: true });
    expect(inv.body).toMatchObject({ quantity: 5, status: "ok", toBuy: null });
    const detail = await a.call("GET", `/products/${p.body.id}`);
    expect(detail.body.movements.map((m: { type: string }) => m.type)).toEqual(["inventory", "consume", "adjust", "adjust"]);
  });

  it("fusionne les lignes lors d'un déplacement", async () => {
    const locs = (await a.call("GET", "/locations")).body;
    const [l1, l2] = locs;
    const p = await a.call("POST", "/products", { name: "Riz", quantity: 2, locationId: l1.id });
    await a.call("POST", `/products/${p.body.id}/stock`, { locationId: l2.id, quantity: 3 });
    const line1 = p.body.stock[0].id;
    const moved = await a.call("PATCH", `/stock/${line1}`, { locationId: l2.id });
    expect(moved.body.stock).toHaveLength(1);
    expect(moved.body.quantity).toBe(5);
  });
});

describe("édition en masse", () => {
  let e: Client;
  beforeAll(async () => {
    e = await userWithHousehold("e@foyer.test", "Foyer E");
  });

  it("modifie et supprime plusieurs produits d'un coup", async () => {
    const [l1, l2] = (await e.call("GET", "/locations")).body;
    const cat = (await e.call("GET", "/categories")).body.find((c: { kind: string }) => c.kind === "product");
    const vide = (await e.call("POST", "/products", { name: "Café", defaultLocationId: l1.id })).body;
    const range = (await e.call("POST", "/products", { name: "Thé", quantity: 2, locationId: l2.id })).body;
    const jete = (await e.call("POST", "/products", { name: "Vieux", quantity: 1 })).body;

    const r = await e.call("POST", "/products/bulk", {
      updates: [
        { id: vide.id, quantity: 3, minStock: 5, categoryId: cat.id, brand: "  " },
        { id: range.id, name: "Thé vert", quantity: 4, unit: "Kg" },
      ],
      deletes: [jete.id],
    });
    expect(r.status).toBe(200);
    const byId = new Map(r.body.map((p: { id: string }) => [p.id, p]));
    expect(byId.get(vide.id)).toMatchObject({ quantity: 3, minStock: 5, status: "low", categoryId: cat.id, brand: null });
    expect((byId.get(vide.id) as { stock: { locationId: string }[] }).stock[0].locationId).toBe(l1.id);
    expect(byId.get(range.id)).toMatchObject({ name: "Thé vert", quantity: 4, unit: "kg" });
    expect(byId.has(jete.id)).toBe(false);
  });

  it("corrige la ligne « sans emplacement » existante au lieu d'en créer une autre", async () => {
    const [l1] = (await e.call("GET", "/locations")).body;
    const p = (await e.call("POST", "/products", { name: "Lardons", quantity: 700, unit: "g" })).body;
    const r = await e.call("POST", "/products/bulk", { updates: [{ id: p.id, defaultLocationId: l1.id, quantity: 650 }] });
    const after = r.body.find((x: { id: string }) => x.id === p.id);
    expect(after.stock).toHaveLength(1);
    expect(after).toMatchObject({ quantity: 650, defaultLocationId: l1.id });
  });

  it("refuse tout si une ligne est invalide", async () => {
    const [l1, l2] = (await e.call("GET", "/locations")).body;
    const p = (await e.call("POST", "/products", { name: "Sucre", quantity: 1, locationId: l1.id })).body;
    await e.call("POST", `/products/${p.id}/stock`, { locationId: l2.id, quantity: 1 });
    const other = (await e.call("POST", "/products", { name: "Sel" })).body;
    const r = await e.call("POST", "/products/bulk", { updates: [{ id: other.id, name: "Gros sel" }, { id: p.id, quantity: 9 }] });
    expect(r.status).toBe(400);
    expect((await e.call("GET", `/products/${other.id}`)).body.name).toBe("Sel");
    const theirs = (await b.call("POST", "/products", { name: "Autre foyer" })).body;
    expect((await e.call("POST", "/products/bulk", { deletes: [theirs.id] })).status).toBe(404);
  });
});

describe("doublons de produits", () => {
  let d: Client;
  beforeAll(async () => {
    d = await userWithHousehold("d@foyer.test", "Foyer D");
  });

  it("réutilise le produit créé par une recette au lieu d'en faire un doublon", async () => {
    const r = await d.call("POST", "/recipes", { name: "Crumble", ingredients: [{ name: "Farine", quantity: 100, unit: "g" }, { name: "Huile d’olive", quantity: 2, unit: "cs" }] });
    const [farineId, huileId] = r.body.ingredients.map((i: { productId: string }) => i.productId);
    // Rangé depuis l'écran Stock, sans unité : même fiche, l'unité supposée par la recette est remplacée.
    const farine = await d.call("POST", "/products", { name: "farine", quantity: 2 });
    expect(farine.status).toBe(200);
    expect(farine.body).toMatchObject({ id: farineId, reused: true, unit: null, quantity: 2 });
    // Apostrophe droite vs courbe : même produit.
    expect((await d.call("POST", "/products", { name: "Huile d'olive", quantity: 1, unit: "L" })).body).toMatchObject({ id: huileId, unit: "L" });
    // Déjà en stock en kg : la quantité saisie en g est convertie.
    const sucre = await d.call("POST", "/products", { name: "Sucre", quantity: 1, unit: "kg" });
    expect((await d.call("POST", "/products", { name: "sucre", quantity: 500, unit: "g" })).body).toMatchObject({ id: sucre.body.id, unit: "kg", quantity: 0.5 });
  });

  it("fusionne deux fiches : stock, recettes, achats et historique suivent", async () => {
    const locs = (await d.call("GET", "/locations")).body;
    const keep = (await d.call("POST", "/products", { name: "Sel fin", quantity: 1, unit: "kg", locationId: locs[0].id })).body;
    const drop = (await d.call("POST", "/products", { name: "Sel de table", quantity: 500, unit: "g", locationId: locs[0].id, minStock: 200 })).body;
    await d.call("POST", "/purchases", { productId: drop.id, quantity: 500, totalCents: 90 });
    const dropQty = (await d.call("GET", `/products/${drop.id}`)).body.quantity; // en g
    const r = await d.call("POST", "/recipes", { name: "Pâtes", ingredients: [{ name: "Sel", productId: drop.id, quantity: 1, unit: "pincée" }] });

    const merged = await d.call("POST", `/products/${drop.id}/merge`, { intoId: keep.id });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ id: keep.id, quantity: 1 + dropQty / 1000, minStock: 0.2 });
    expect(merged.body.stock).toHaveLength(1);
    expect((await d.call("GET", `/products/${drop.id}`)).status).toBe(404);
    expect((await d.call("GET", `/recipes/${r.body.id}`)).body.ingredients[0].productId).toBe(keep.id);
    const detail = (await d.call("GET", `/products/${keep.id}`)).body;
    expect(detail.purchases.length).toBeGreaterThan(0);

    // Unités incomparables avec du stock : refus explicite, rien n'est modifié.
    const paquet = (await d.call("POST", "/products", { name: "Pâtes", quantity: 2, unit: "paquet" })).body;
    const refus = await d.call("POST", `/products/${paquet.id}/merge`, { intoId: keep.id });
    expect(refus.status).toBe(400);
    expect((await d.call("GET", `/products/${paquet.id}`)).status).toBe(200);
  });

  it("ne fusionne pas avec le produit d'un autre foyer", async () => {
    const mine = (await d.call("POST", "/products", { name: "Poivre" })).body;
    const theirs = (await b.call("POST", "/products", { name: "Poivre" })).body;
    expect((await d.call("POST", `/products/${mine.id}/merge`, { intoId: theirs.id })).status).toBe(404);
  });
});

describe("recettes ↔ produits", () => {
  it("relie les ingrédients au même produit malgré accents et ligatures", async () => {
    const r1 = await a.call("POST", "/recipes", { name: "Crêpes", ingredients: [{ name: "Œufs", quantity: 3 }, { name: "Sel" }] });
    const r2 = await a.call("POST", "/recipes", { name: "Omelette", ingredients: [{ name: "oeufs", quantity: 2 }] });
    expect(r1.body.ingredients[0].productId).toBeTruthy();
    expect(r2.body.ingredients[0].productId).toBe(r1.body.ingredients[0].productId);
    expect(r1.body.ingredients[1]).toMatchObject({ name: "Sel", quantity: null, unit: null });
  });

  it("importe plusieurs recettes d'un coup et partage les produits (pluriels compris)", async () => {
    const res = await a.call("POST", "/recipes/import", {
      recipes: [
        { name: "Salade lentilles – thon", tags: ["Import"], ingredients: [{ name: "Tomates", quantity: 2 }, { name: "Huile d’olive" }] },
        { name: "Burger thon", ingredients: [{ name: "tomate" }, { name: "Huile d'olive" }], steps: [{ text: "Monter le burger" }] },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
    const [r1, r2] = await Promise.all(res.body.ids.map(async (id: string) => (await a.call("GET", `/recipes/${id}`)).body));
    expect(r1.tags).toEqual(["Import"]);
    expect(r2.steps).toHaveLength(1);
    expect(r2.ingredients[0].productId).toBe(r1.ingredients[0].productId);
    expect(r2.ingredients[1].productId).toBe(r1.ingredients[1].productId);
    expect((await a.call("POST", "/recipes/import", { recipes: [] })).status).toBe(400);
  });
});

describe("isolation entre foyers", () => {
  it("ne laisse rien lire ni modifier d'un autre foyer", async () => {
    const p = (await a.call("POST", "/products", { name: "Secret", quantity: 1 })).body;
    const r = (await a.call("POST", "/recipes", { name: "Recette A" })).body;
    const cat = (await a.call("GET", "/categories")).body[0];

    expect((await b.call("GET", "/products")).body.find((x: { id: string }) => x.id === p.id)).toBeUndefined();
    expect((await b.call("GET", `/products/${p.id}`)).status).toBe(404);
    expect((await b.call("POST", `/stock/${p.stock[0].id}/adjust`, { delta: 5 })).status).toBe(404);
    expect((await b.call("PATCH", `/recipes/${r.id}`, { name: "hack" })).status).toBe(404);
    expect((await b.call("DELETE", `/recipes/${r.id}`)).status).toBe(404);
    expect((await b.call("POST", "/products", { categoryId: cat.id })).status).toBe(400);

    const ing = await b.call("POST", "/recipes", { ingredients: [{ name: "Secret", productId: p.id }] });
    expect(ing.body.ingredients[0].productId).not.toBe(p.id);
    expect((await a.call("GET", `/products/${p.id}`)).body.quantity).toBe(1);
  });

  it("refuse les requêtes non authentifiées", async () => {
    expect((await client().call("GET", "/products")).status).toBe(401);
  });
});

describe("invitations", () => {
  it("un code rattache au foyer une seule fois", async () => {
    const inv = (await a.call("POST", "/household/invites")).body;
    const c = client();
    const reg = await c.call("POST", "/auth/register", { code: inv.code.toLowerCase(), email: "conjoint@foyer.test", password: "motdepasse-2", name: "Conjoint" });
    expect(reg.status).toBe(200);
    const me = (await c.call("GET", "/auth/me")).body;
    expect(me.household.name).toBe("Foyer A");
    expect(me.household.members).toHaveLength(2);
    const again = await client().call("POST", "/auth/register", { code: inv.code, email: "x@foyer.test", password: "motdepasse-3" });
    expect(again.status).toBe(400);
  });
});

describe("planning et courses (phase 2)", () => {
  let c: Client;
  let carbo: string;
  let crepes: string;
  let oeufs: string;
  beforeAll(async () => {
    c = await userWithHousehold("courses@foyer.test", "Foyer courses");
    carbo = (await c.call("POST", "/recipes", { name: "Carbonara", servings: 2, ingredients: [{ name: "Œufs", quantity: 3 }, { name: "Pâtes", quantity: 250, unit: "g" }] })).body.id;
    const r = (await c.call("POST", "/recipes", { name: "Crêpes", servings: 4, ingredients: [{ name: "oeufs", quantity: 3 }, { name: "Lait", quantity: 500, unit: "ml" }, { name: "Sel" }] })).body;
    crepes = r.id;
    oeufs = r.ingredients[0].productId;
    await c.call("POST", "/plan", { date: "2026-10-05", meal: "dinner", recipeId: carbo });
    await c.call("POST", "/plan", { date: "2026-10-07", meal: "lunch", recipeId: crepes });
  });

  const sync = () => c.call("POST", "/shopping/sync", { from: "2026-10-05", to: "2026-10-11" });
  const line = (items: { productId: string | null; name: string }[], name: string) => items.find((i) => i.name === name) as any;

  it("additionne les besoins : 🥚 Œufs — 6 sur une seule ligne", async () => {
    const r = await sync();
    const eggs = r.body.items.filter((i: { productId: string }) => i.productId === oeufs);
    expect(eggs).toHaveLength(1);
    expect(eggs[0]).toMatchObject({ quantity: 6, neededQty: 6, source: "plan", recipesLabel: "Carbonara, Crêpes" });
    expect(line(r.body.items, "Lait")).toMatchObject({ quantity: 500, unit: "ml" });
  });

  it("déduit le stock : 4 œufs en stock → 2 à acheter, puis « stock suffisant »", async () => {
    await c.call("POST", `/products/${oeufs}/stock`, { quantity: 4 });
    expect(line((await sync()).body.items, "Œufs")).toMatchObject({ quantity: 2, stockQty: 4 });
    await c.call("POST", `/products/${oeufs}/stock`, { quantity: 10 });
    expect(line((await sync()).body.items, "Œufs")).toMatchObject({ quantity: 0 });
    await c.call("POST", `/products/${oeufs}/stock`, { quantity: 0 });
  });

  it("garde une quantité corrigée à la main et les articles cochés", async () => {
    const eggs = line((await sync()).body.items, "Œufs");
    await c.call("PATCH", `/shopping/items/${eggs.id}`, { quantity: 12 });
    expect(line((await sync()).body.items, "Œufs")).toMatchObject({ quantity: 6, quantityOverride: 12 });
    const lait = line((await sync()).body.items, "Lait");
    await c.call("PATCH", `/shopping/items/${lait.id}`, { checked: true });
    const planItems = (await c.call("GET", "/plan?from=2026-10-05&to=2026-10-11")).body;
    await c.call("DELETE", `/plan/${planItems.find((p: { recipeId: string }) => p.recipeId === crepes).id}`);
    const after = (await sync()).body.items;
    expect(line(after, "Lait")).toMatchObject({ checked: true });
    expect(line(after, "Œufs")).toMatchObject({ quantity: 3 });
    await c.call("POST", "/plan", { date: "2026-10-07", meal: "lunch", recipeId: crepes });
  });

  it("ajout manuel idempotent (id client) et fusion d'un doublon", async () => {
    const id = "offline-abc12345";
    const a1 = await c.call("POST", "/shopping/items", { id, name: "Papier toilette", quantity: 1 });
    const a2 = await c.call("POST", "/shopping/items", { id, name: "Papier toilette", quantity: 1 });
    expect(a2.body.id).toBe(a1.body.id);
    const merged = await c.call("POST", "/shopping/items", { name: "papier toilette", quantity: 2 });
    expect(merged.body).toMatchObject({ id, quantity: 3 });
  });

  it("range les achats : stock augmenté, achat enregistré, article retiré", async () => {
    const items = (await c.call("GET", "/shopping")).body.items;
    const pq = line(items, "Papier toilette");
    const r = await c.call("POST", "/shopping/stock-in", { entries: [{ itemId: pq.id, addToStock: true, quantity: 3, totalCents: 598 }] });
    expect(r.body.stocked).toBe(1);
    expect(line(r.body.items, "Papier toilette")).toBeUndefined();
    const product = (await c.call("GET", "/products")).body.find((p: { name: string }) => p.name === "Papier toilette");
    expect(product.quantity).toBe(3);
    const detail = (await c.call("GET", `/products/${product.id}`)).body;
    expect(detail.movements[0]).toMatchObject({ type: "purchase", delta: 3 });
    expect(await prisma.purchase.count({ where: { productId: product.id, totalCents: 598 } })).toBe(1);
  });

  it("range la quantité réellement achetée, dans son unité (500 g prévus, 5 kg achetés)", async () => {
    const pdt = (await c.call("POST", "/products", { name: "Pommes de terre", quantity: 200, unit: "g" })).body;
    await c.call("POST", "/shopping/items", { name: "Pommes de terre", productId: pdt.id, quantity: 500, unit: "g" });
    const item = line((await c.call("GET", "/shopping")).body.items, "Pommes de terre");
    await c.call("POST", "/shopping/stock-in", { entries: [{ itemId: item.id, addToStock: true, quantity: 5, unit: "kilo", totalCents: 450 }] });
    const after = (await c.call("GET", `/products/${pdt.id}`)).body;
    expect(after).toMatchObject({ unit: "g", quantity: 5200 });
    expect(after.purchases[0]).toMatchObject({ quantity: 5000, unit: "g", totalCents: 450 });

    // Unité incomparable avec un stock déjà chiffré : refus clair, la liste n'est pas vidée.
    await c.call("POST", "/shopping/items", { name: "Pommes de terre", productId: pdt.id, quantity: 1 });
    const again = line((await c.call("GET", "/shopping")).body.items, "Pommes de terre");
    const refus = await c.call("POST", "/shopping/stock-in", { entries: [{ itemId: again.id, addToStock: true, quantity: 2, unit: "sachet" }] });
    expect(refus.status).toBe(400);
    expect(line((await c.call("GET", "/shopping")).body.items, "Pommes de terre")).toBeTruthy();
  });

  it("déplace un repas vers un autre jour/repas et réordonne", async () => {
    const [first] = (await c.call("GET", "/plan?from=2026-10-05&to=2026-10-05")).body;
    const extra = (await c.call("POST", "/plan", { date: "2026-10-06", meal: "dinner", title: "Restes" })).body;
    const moved = await c.call("PATCH", `/plan/${first.id}`, { date: "2026-10-06", meal: "dinner", position: 0 });
    expect(moved.body).toMatchObject({ date: "2026-10-06", meal: "dinner", position: 0 });
    const slot = (await c.call("GET", "/plan?from=2026-10-06&to=2026-10-06")).body;
    expect(slot.map((i: { id: string }) => i.id)).toEqual([first.id, extra.id]);
  });

  it("« cuisiné » retire les ingrédients du stock", async () => {
    await c.call("POST", `/products/${oeufs}/stock`, { quantity: 5 });
    const item = (await c.call("GET", "/plan?from=2026-10-06&to=2026-10-06")).body.find((i: { recipeId: string }) => i.recipeId === carbo);
    const r = await c.call("POST", `/plan/${item.id}/cook`, { consume: [{ productId: oeufs, quantity: 3 }] });
    expect(r.body.item.cookedAt).toBeTruthy();
    expect((await c.call("GET", `/products/${oeufs}`)).body.quantity).toBe(2);
    // Un repas cuisiné ne compte plus dans la liste.
    expect(line((await sync()).body.items, "Pâtes")).toBeUndefined();
  });

  it("isole planning et courses entre foyers", async () => {
    const mine = (await c.call("GET", "/plan?from=2026-10-01&to=2026-10-31")).body[0];
    expect((await b.call("PATCH", `/plan/${mine.id}`, { date: "2026-10-01" })).status).toBe(404);
    expect((await b.call("POST", "/plan", { date: "2026-10-01", meal: "lunch", recipeId: carbo })).status).toBe(400);
    expect((await b.call("POST", "/plan", { id: mine.id, date: "2026-10-01", meal: "lunch" })).status).toBe(409);
    const item = (await c.call("GET", "/shopping")).body.items[0];
    expect((await b.call("PATCH", `/shopping/items/${item.id}`, { checked: true })).status).toBe(404);
    expect((await b.call("GET", "/shopping")).body.items).toHaveLength(0);
    expect((await b.call("POST", `/plan/${mine.id}/cook`, { consume: [{ productId: oeufs, quantity: 1 }] })).status).toBe(404);
  });
});

describe("achats, prix et inventaire (phase 3)", () => {
  let c: Client;
  let lessive: any;
  beforeAll(async () => {
    c = await userWithHousehold("prix@foyer.test", "Foyer prix");
    lessive = (await c.call("POST", "/products", { name: "Lessive", quantity: 1, minStock: 2, targetStock: 4 })).body;
  });

  it("enregistre un achat : prix unitaire, magasin créé une fois, stock augmenté", async () => {
    const r = await c.call("POST", "/purchases", { productId: lessive.id, date: "2026-09-12", quantity: 2, totalCents: 598, storeName: "Leclerc" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ quantity: 2, totalCents: 598, store: { name: "Leclerc" } });
    await c.call("POST", "/purchases", { productId: lessive.id, date: "2026-09-20", quantity: 1, totalCents: 349, storeName: "leclerc", isPromo: true });
    expect((await c.call("GET", "/purchases/stores")).body).toHaveLength(1);
    const p = (await c.call("GET", `/products/${lessive.id}`)).body;
    expect(p.quantity).toBe(4);
    expect(p.purchases).toHaveLength(2);
    expect(p.pricing).toMatchObject({ count: 2, best: { unitCents: 299 }, last: { unitCents: 349, isPromo: true } });
    expect(p.pricing.avgCents).toBeCloseTo(315.67, 1);
    expect(p.pricing.history).toHaveLength(2);
  });

  it("résume les prix dans la liste, sans historique, et rien sans prix", async () => {
    const list = (await c.call("GET", "/products")).body;
    const inList = list.find((x: { id: string }) => x.id === lessive.id).pricing;
    expect(inList.count).toBe(2);
    expect(inList.history).toBeUndefined();
    const sansPrix = (await c.call("POST", "/products", { name: "Sel", quantity: 1 })).body;
    await c.call("POST", "/purchases", { productId: sansPrix.id, quantity: 1 });
    expect((await c.call("GET", `/products/${sansPrix.id}`)).body.pricing).toBeNull();
  });

  it("garde le résumé des prix après un +1 (réponse mise en cache par l'appli)", async () => {
    const adj = await c.call("POST", `/stock/${lessive.stock[0].id}/adjust`, { delta: 1 });
    expect(adj.body.pricing?.count).toBe(2);
  });

  it("corrige et supprime un achat sans toucher au stock", async () => {
    const [latest] = (await c.call("GET", `/products/${lessive.id}`)).body.purchases;
    await c.call("PATCH", `/purchases/${latest.id}`, { totalCents: 299 });
    const p1 = (await c.call("GET", `/products/${lessive.id}`)).body;
    expect(p1.pricing.avgCents).toBeCloseTo(299);
    await c.call("DELETE", `/purchases/${latest.id}`);
    const p2 = (await c.call("GET", `/products/${lessive.id}`)).body;
    expect(p2.purchases).toHaveLength(1);
    expect(p2.quantity).toBe(p1.quantity);
  });

  it("liste les achats d'une période", async () => {
    const r = (await c.call("GET", "/purchases?from=2026-09-01&to=2026-09-15")).body;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ totalCents: 598, product: { name: "Lessive" } });
  });

  it("range les courses avec le magasin du passage en caisse", async () => {
    await c.call("POST", "/shopping/items", { name: "Lessive", quantity: 3 });
    const item = (await c.call("GET", "/shopping")).body.items.find((i: { name: string }) => i.name === "Lessive");
    await c.call("POST", "/shopping/stock-in", { storeName: "Lidl", entries: [{ itemId: item.id, addToStock: true, quantity: 3, totalCents: 900 }] });
    const p = (await c.call("GET", `/products/${lessive.id}`)).body;
    expect(p.purchases[0]).toMatchObject({ quantity: 3, totalCents: 900, store: { name: "Lidl" } });
  });

  it("inventaire groupé : corrige et historise les écarts", async () => {
    const before = (await c.call("GET", `/products/${lessive.id}`)).body;
    const line = before.stock[0];
    const r = await c.call("POST", "/inventory", { entries: [{ productId: lessive.id, locationId: line.locationId, quantity: 2 }] });
    expect(r.body).toEqual({ counted: 1, corrected: 1 });
    expect((await c.call("GET", `/products/${lessive.id}`)).body.quantity).toBe(2);
    const hist = (await c.call("GET", "/inventory/history")).body;
    expect(hist[0]).toMatchObject({ delta: 2 - before.quantity, quantityAfter: 2, product: { name: "Lessive" } });
  });

  it("isole achats et inventaire entre foyers", async () => {
    const [purchase] = (await c.call("GET", `/products/${lessive.id}`)).body.purchases;
    expect((await b.call("POST", "/purchases", { productId: lessive.id, quantity: 1 })).status).toBe(404);
    expect((await b.call("PATCH", `/purchases/${purchase.id}`, { totalCents: 1 })).status).toBe(404);
    await b.call("DELETE", `/purchases/${purchase.id}`);
    expect((await c.call("GET", `/products/${lessive.id}`)).body.purchases.some((x: { id: string }) => x.id === purchase.id)).toBe(true);
    expect((await b.call("POST", "/inventory", { entries: [{ productId: lessive.id, quantity: 99 }] })).body.corrected).toBe(0);
    expect((await b.call("GET", "/purchases")).body).toHaveLength(0);
  });
});

describe("recettes en masse et liens ingrédients ↔ stock", () => {
  let r: Client;
  beforeAll(async () => {
    r = await userWithHousehold("r@foyer.test", "Foyer R");
  });

  it("modifie et supprime plusieurs recettes d'un coup, le planning garde le nom", async () => {
    const cat = (await r.call("POST", "/categories", { kind: "recipe", name: "Plat" })).body;
    const quiche = (await r.call("POST", "/recipes", { name: "Quiche", ingredients: [{ name: "Œufs", quantity: 3 }] })).body;
    const soupe = (await r.call("POST", "/recipes", { name: "Soupe", tags: ["hiver"] })).body;
    const vieille = (await r.call("POST", "/recipes", { name: "Vieille recette" })).body;
    await r.call("POST", "/plan", { date: "2026-10-05", meal: "dinner", recipeId: vieille.id });

    const res = await r.call("POST", "/recipes/bulk", {
      updates: [
        { id: quiche.id, servings: 6, difficulty: 2, categoryIds: [cat.id], favorite: true },
        { id: soupe.id, name: "Soupe de potiron", tags: ["hiver", "rapide"], prepMinutes: 10 },
      ],
      deletes: [vieille.id],
    });
    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((x: { id: string }) => [x.id, x]));
    expect(byId.get(quiche.id)).toMatchObject({ servings: 6, difficulty: 2, categoryIds: [cat.id], favorite: true });
    // Ingrédients non envoyés : pas touchés.
    expect((byId.get(quiche.id) as { ingredients: unknown[] }).ingredients).toHaveLength(1);
    expect(byId.get(soupe.id)).toMatchObject({ name: "Soupe de potiron", tags: ["hiver", "rapide"], prepMinutes: 10 });
    expect(byId.has(vieille.id)).toBe(false);
    const plan = (await r.call("GET", "/plan?from=2026-10-05&to=2026-10-05")).body;
    expect(plan[0]).toMatchObject({ recipeId: null, title: "Vieille recette" });
  });

  it("refuse tout si une recette n'est pas du foyer", async () => {
    const mine = (await r.call("POST", "/recipes", { name: "Gratin" })).body;
    const theirs = (await b.call("POST", "/recipes", { name: "Autre foyer" })).body;
    const res = await r.call("POST", "/recipes/bulk", { updates: [{ id: mine.id, name: "Gratin dauphinois" }], deletes: [theirs.id] });
    expect(res.status).toBe(404);
    expect((await r.call("GET", `/recipes/${mine.id}`)).body.name).toBe("Gratin");
  });

  it("relie des ingrédients à un autre produit, et le lien survit à l'enregistrement de la recette", async () => {
    const tarte = (await r.call("POST", "/recipes", { name: "Tarte", ingredients: [{ name: "Crème", quantity: 20, unit: "cl" }] })).body;
    const ing = tarte.ingredients[0];
    const fraiche = (await r.call("POST", "/products", { name: "Crème fraîche épaisse", unit: "cl" })).body;
    const res = await r.call("POST", "/recipes/ingredients/link", { ids: [ing.id], productId: fraiche.id });
    expect(res.status).toBe(200);
    expect(res.body.find((x: { id: string }) => x.id === tarte.id).ingredients[0]).toMatchObject({ id: ing.id, name: "Crème", productId: fraiche.id });
    // Réenregistrée telle quelle depuis l'écran de modification : le lien est conservé.
    const again = await r.call("PATCH", `/recipes/${tarte.id}`, { ingredients: [{ name: "Crème", productId: fraiche.id, quantity: 20, unit: "cl" }] });
    expect(again.body.ingredients[0].productId).toBe(fraiche.id);

    const theirs = (await b.call("POST", "/products", { name: "Crème B" })).body;
    expect((await r.call("POST", "/recipes/ingredients/link", { ids: [again.body.ingredients[0].id], productId: theirs.id })).status).toBe(404);
  });
});

describe("variantes acceptées d'un ingrédient", () => {
  let v: Client;
  beforeAll(async () => {
    v = await userWithHousehold("v@foyer.test", "Foyer V");
  });

  it("enregistre, modifie en masse et suit les fusions de produits", async () => {
    const tagl = (await v.call("POST", "/products", { name: "Tagliatelles", unit: "g", quantity: 500 })).body;
    const coqu = (await v.call("POST", "/products", { name: "Coquillettes", unit: "g" })).body;
    const theirs = (await b.call("POST", "/products", { name: "Penne B" })).body;
    const r = await v.call("POST", "/recipes", {
      name: "Pâtes au beurre",
      ingredients: [{ name: "Pâtes", quantity: 250, unit: "g", alternatives: [tagl.id, theirs.id, tagl.id] }],
    });
    const ing = r.body.ingredients[0];
    // Produit d'un autre foyer et doublon écartés.
    expect(ing.alternatives).toEqual([tagl.id]);
    expect((await v.call("GET", `/products/${tagl.id}`)).body.recipes.map((x: { id: string }) => x.id)).toEqual([r.body.id]);

    const linked = await v.call("POST", "/recipes/ingredients/link", { ids: [ing.id], alternatives: [tagl.id, coqu.id, ing.productId] });
    const after = linked.body.find((x: { id: string }) => x.id === r.body.id).ingredients[0];
    // Le produit principal n'est pas sa propre variante.
    expect(after).toMatchObject({ productId: ing.productId, alternatives: [tagl.id, coqu.id] });

    const dup = (await v.call("POST", "/products", { name: "Coquillettes bio", unit: "g" })).body;
    await v.call("POST", `/products/${coqu.id}/merge`, { intoId: dup.id });
    expect((await v.call("GET", `/recipes/${r.body.id}`)).body.ingredients[0].alternatives).toEqual([tagl.id, dup.id]);
  });
});

describe("ingrédients depuis l'édition en masse", () => {
  let m: Client;
  beforeAll(async () => {
    m = await userWithHousehold("m@foyer.test", "Foyer M");
  });

  it("remplace les ingrédients, relie les nouveaux au stock et garde les précisions", async () => {
    const r = (await m.call("POST", "/recipes", { name: "Omelette", ingredients: [{ name: "Œufs", quantity: 3, note: "bio" }] })).body;
    const list = (await m.call("GET", "/recipes")).body;
    const summary = list.find((x: { id: string }) => x.id === r.id);
    expect(summary.ingredients[0]).toMatchObject({ name: "Œufs", note: "bio" });
    const res = await m.call("POST", "/recipes/bulk", {
      updates: [{ id: r.id, ingredients: [{ ...summary.ingredients[0], quantity: 4 }, { name: "Ciboulette", quantity: 1, unit: "c. à soupe" }] }],
    });
    expect(res.status).toBe(200);
    const after = res.body.find((x: { id: string }) => x.id === r.id).ingredients;
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ name: "Œufs", quantity: 4, note: "bio", productId: summary.ingredients[0].productId });
    expect(after[1].productId).toBeTruthy();
    expect((await m.call("GET", "/products")).body.some((p: { name: string }) => p.name === "Ciboulette")).toBe(true);
  });
});
