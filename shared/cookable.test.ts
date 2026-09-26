import { describe, expect, it } from "vitest";
import { cookability, rankCookable, type StockProduct } from "./cookable";
import type { NeedsRecipe } from "./needs";

const prod = (id: string, quantity: number | null, unit: string | null = null, hasStockLine = quantity != null): StockProduct => ({ id, name: id, unit, quantity, hasStockLine });
const stock = (...ps: StockProduct[]) => new Map(ps.map((p) => [p.id, p]));
const recipe = (id: string, ingredients: NeedsRecipe["ingredients"], servings: number | null = null): NeedsRecipe => ({ id, name: id, servings, ingredients });

const pouletCreme = recipe("poulet-creme", [
  { name: "poulet", productId: "poulet", quantity: 500, unit: "g" },
  { name: "creme", productId: "creme", quantity: 20, unit: "cl" },
  { name: "sel", productId: "sel", quantity: null, unit: null },
]);

describe("cookability", () => {
  it("réalisable quand tout est en stock (conversion cl → L)", () => {
    const r = cookability(pouletCreme, stock(prod("poulet", 1, "kg"), prod("creme", 0.5, "L"), prod("sel", 1)));
    expect(r).toMatchObject({ counted: 2, available: 2, complete: true, missing: [], basicsMissing: [] });
  });

  it("liste ce qui manque et ce qui est insuffisant, avec la quantité à acheter", () => {
    const r = cookability(pouletCreme, stock(prod("poulet", 0.2, "kg"), prod("creme", 0, "L"), prod("sel", null)));
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual([
      { productId: "poulet", name: "poulet", toBuy: 0.3, unit: "kg", short: true },
      { productId: "creme", name: "creme", toBuy: 0.2, unit: "L", short: false },
    ]);
  });

  it("un basique sans quantité ne bloque pas la recette", () => {
    const r = cookability(pouletCreme, stock(prod("poulet", 1, "kg"), prod("creme", 1, "L"), prod("sel", null)));
    expect(r.complete).toBe(true);
    expect(r.basicsMissing).toEqual(["sel"]);
  });

  it("traite « 1 pincée de sel » comme un basique", () => {
    const r = recipe("r", [{ name: "sel", productId: "sel", quantity: 1, unit: "pincée" }, { name: "riz", productId: "riz", quantity: 100, unit: "g" }]);
    const c = cookability(r, stock(prod("sel", null), prod("riz", 1, "kg")));
    expect(c).toMatchObject({ complete: true, counted: 1, basicsMissing: ["sel"] });
  });

  it("fait confiance à un produit présent sans quantité connue", () => {
    const r = cookability(pouletCreme, stock(prod("poulet", null, "kg", true), prod("creme", 1, "L"), prod("sel", 1)));
    expect(r.complete).toBe(true);
  });

  it("tient compte des portions prévues", () => {
    const omelette = recipe("omelette", [{ name: "oeufs", productId: "oeufs", quantity: 3, unit: null }], 2);
    expect(cookability(omelette, stock(prod("oeufs", 4)), 2).complete).toBe(true);
    expect(cookability(omelette, stock(prod("oeufs", 4)), 4).missing[0]).toMatchObject({ toBuy: 2, short: true });
  });

  it("additionne un même produit utilisé deux fois", () => {
    const r = recipe("r", [
      { name: "oeufs", productId: "oeufs", quantity: 2, unit: null },
      { name: "oeuf (dorure)", productId: "oeufs", quantity: 1, unit: null },
    ]);
    expect(cookability(r, stock(prod("oeufs", 2))).missing[0]).toMatchObject({ toBuy: 1, short: true });
  });
});

describe("rankCookable", () => {
  it("met les recettes réalisables en premier et ignore celles sans ingrédient suivi", () => {
    const s = stock(prod("poulet", 1, "kg"), prod("creme", 0, "L"), prod("sel", 1), prod("riz", 1, "kg"));
    const riz = recipe("riz", [{ name: "riz", productId: "riz", quantity: 200, unit: "g" }]);
    const vide = recipe("vide", [{ name: "sel", productId: "sel", quantity: null, unit: null }]);
    const ranked = rankCookable([pouletCreme, riz, vide].map((x) => cookability(x, s)));
    expect(ranked.map((r) => r.recipeId)).toEqual(["riz", "poulet-creme"]);
  });
});
