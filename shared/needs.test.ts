import { describe, expect, it } from "vitest";
import { computeNeeds, consumptionFor, type NeedsProduct, type NeedsRecipe } from "./needs";
import { convertQty, readableQty, roundForPurchase, unitDimension } from "./units";

const products = (list: NeedsProduct[]) => new Map(list.map((p) => [p.id, p]));
const recipes = (list: NeedsRecipe[]) => new Map(list.map((r) => [r.id, r]));

const carbonara: NeedsRecipe = { id: "carbo", name: "Carbonara", servings: 2, ingredients: [{ name: "Œufs", productId: "oeufs", quantity: 3, unit: null }] };
const crepes: NeedsRecipe = {
  id: "crepes",
  name: "Crêpes",
  servings: 4,
  ingredients: [
    { name: "Œufs", productId: "oeufs", quantity: 3, unit: "pièces" },
    { name: "Lait", productId: "lait", quantity: 500, unit: "ml" },
    { name: "Sel", productId: "sel", quantity: null, unit: null },
  ],
};

describe("unités", () => {
  it("convertit dans une même dimension", () => {
    expect(convertQty(500, "ml", "L")).toBe(0.5);
    expect(convertQty(1.5, "kg", "g")).toBe(1500);
    expect(convertQty(2, "pièces", null)).toBe(2);
    expect(convertQty(2, "g", "ml")).toBeNull();
    expect(convertQty(1, "paquet", "paquets")).toBe(1);
  });
  it("sépare les unités inconnues", () => {
    expect(unitDimension("c. à soupe")).not.toBe(unitDimension("g"));
  });
  it("choisit une unité lisible pour les totaux", () => {
    expect(readableQty(1500, "ml")).toEqual({ quantity: 1.5, unit: "L" });
    expect(readableQty(150, "cl")).toEqual({ quantity: 1.5, unit: "L" });
    expect(readableQty(2600, "g")).toEqual({ quantity: 2.6, unit: "kg" });
    expect(readableQty(250, "g")).toEqual({ quantity: 250, unit: "g" });
    expect(readableQty(6, null)).toEqual({ quantity: 6, unit: null });
  });
  it("arrondit les pièces au-dessus", () => {
    expect(roundForPurchase(1.2, null)).toBe(2);
    expect(roundForPurchase(0.333, "L")).toBe(0.33);
  });
});

describe("computeNeeds", () => {
  const p = products([
    { id: "oeufs", name: "Œufs", unit: null, quantity: null },
    { id: "lait", name: "Lait", unit: "L", quantity: null },
    { id: "sel", name: "Sel", unit: null, quantity: null },
  ]);

  it("additionne les besoins de plusieurs recettes (Carbonara + Crêpes = 6 œufs)", () => {
    const needs = computeNeeds([{ recipeId: "carbo", servings: null, cooked: false }, { recipeId: "crepes", servings: null, cooked: false }], recipes([carbonara, crepes]), p);
    expect(needs.find((n) => n.productId === "oeufs")).toMatchObject({ needed: 6, toBuy: 6, recipes: ["Carbonara", "Crêpes"] });
  });

  it("déduit le stock (6 nécessaires, 4 en stock → 2)", () => {
    const withStock = products([{ id: "oeufs", name: "Œufs", unit: null, quantity: 4 }]);
    const needs = computeNeeds([{ recipeId: "carbo", servings: null, cooked: false }, { recipeId: "crepes", servings: null, cooked: false }], recipes([carbonara, crepes]), withStock);
    expect(needs[0]).toMatchObject({ needed: 6, stock: 4, toBuy: 2, covered: false });
  });

  it("indique quand le stock suffit", () => {
    const withStock = products([{ id: "oeufs", name: "Œufs", unit: null, quantity: 12 }]);
    const needs = computeNeeds([{ recipeId: "carbo", servings: null, cooked: false }], recipes([carbonara]), withStock);
    expect(needs[0]).toMatchObject({ toBuy: 0, covered: true });
  });

  it("convertit vers l'unité du stock (500 ml → 0,5 L)", () => {
    const withStock = products([{ id: "lait", name: "Lait", unit: "L", quantity: 0.2 }, { id: "oeufs", name: "Œufs", unit: null, quantity: null }, { id: "sel", name: "Sel", unit: null, quantity: 1 }]);
    const needs = computeNeeds([{ recipeId: "crepes", servings: null, cooked: false }], recipes([crepes]), withStock);
    expect(needs.find((n) => n.productId === "lait")).toMatchObject({ unit: "L", needed: 0.5, stock: 0.2, toBuy: 0.3 });
    expect(needs.find((n) => n.productId === "sel")).toMatchObject({ needed: null, toBuy: null, covered: true });
  });

  it("adapte aux portions prévues et ignore les repas déjà cuisinés", () => {
    const needs = computeNeeds([{ recipeId: "carbo", servings: 4, cooked: false }, { recipeId: "carbo", servings: null, cooked: true }], recipes([carbonara]), p);
    expect(needs[0]).toMatchObject({ needed: 6 });
  });

  it("ne soustrait pas un stock d'unité incomparable", () => {
    const pm = products([{ id: "lait", name: "Lait", unit: "bouteille", quantity: 3 }]);
    const r: NeedsRecipe = { id: "r", name: "R", servings: null, ingredients: [{ name: "Lait", productId: "lait", quantity: 250, unit: "ml" }] };
    const needs = computeNeeds([{ recipeId: "r", servings: null, cooked: false }], recipes([r]), pm);
    expect(needs[0]).toMatchObject({ unit: "ml", needed: 250, stock: null, toBuy: 250 });
  });
});

describe("consumptionFor", () => {
  it("exprime la consommation dans l'unité du produit et ignore l'incomparable", () => {
    const pm = products([
      { id: "oeufs", name: "Œufs", unit: null, quantity: 10 },
      { id: "lait", name: "Lait", unit: "L", quantity: 1 },
      { id: "sel", name: "Sel", unit: null, quantity: 1 },
    ]);
    expect(consumptionFor(crepes, 8, pm)).toEqual([
      { productId: "oeufs", name: "Œufs", quantity: 6, unit: null },
      { productId: "lait", name: "Lait", quantity: 1, unit: "L" },
    ]);
  });
});
