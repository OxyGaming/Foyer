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

describe("recettes ↔ produits", () => {
  it("relie les ingrédients au même produit malgré accents et ligatures", async () => {
    const r1 = await a.call("POST", "/recipes", { name: "Crêpes", ingredients: [{ name: "Œufs", quantity: 3 }, { name: "Sel" }] });
    const r2 = await a.call("POST", "/recipes", { name: "Omelette", ingredients: [{ name: "oeufs", quantity: 2 }] });
    expect(r1.body.ingredients[0].productId).toBeTruthy();
    expect(r2.body.ingredients[0].productId).toBe(r1.body.ingredients[0].productId);
    expect(r1.body.ingredients[1]).toMatchObject({ name: "Sel", quantity: null, unit: null });
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
