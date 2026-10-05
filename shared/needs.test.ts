import { describe, expect, it } from "vitest";
import { chooseProduct, computeNeeds, consumptionFor, type NeedsProduct, type NeedsRecipe } from "./needs";
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
    expect(needs.find((n) => n.productId === "sel")).toMatchObject({ needed: null, toBuy: 0, covered: true });
  });

  it("adapte aux portions prévues et ignore les repas déjà cuisinés", () => {
    const needs = computeNeeds([{ recipeId: "carbo", servings: 4, cooked: false }, { recipeId: "carbo", servings: null, cooked: true }], recipes([carbonara]), p);
    expect(needs[0]).toMatchObject({ needed: 6 });
  });

  it("stock d'unité incomparable : couvert s'il en reste, sinon on achète le besoin", () => {
    const r: NeedsRecipe = { id: "r", name: "R", servings: null, ingredients: [{ name: "Lait", productId: "lait", quantity: 250, unit: "ml" }] };
    const meals = [{ recipeId: "r", servings: null, cooked: false }];
    const some = computeNeeds(meals, recipes([r]), products([{ id: "lait", name: "Lait", unit: "bouteille", quantity: 3 }]));
    expect(some[0]).toMatchObject({ unit: "ml", needed: 250, stock: null, toBuy: 0, covered: true });
    const none = computeNeeds(meals, recipes([r]), products([{ id: "lait", name: "Lait", unit: "bouteille", quantity: 0 }]));
    expect(none[0]).toMatchObject({ toBuy: 250, covered: false });
  });

  it("rangé sans quantité indiquée : on fait confiance, rien à acheter", () => {
    const r: NeedsRecipe = {
      id: "r",
      name: "R",
      servings: null,
      ingredients: [
        { name: "Farine", productId: "farine", quantity: 100, unit: "g" },
        { name: "Huile", productId: "huile", quantity: 2, unit: "c. à soupe" },
        { name: "Sel", productId: "sel", quantity: 1, unit: "pincée" },
      ],
    };
    const meals = [{ recipeId: "r", servings: null, cooked: false }];
    const needs = computeNeeds(
      meals,
      recipes([r]),
      products([
        { id: "farine", name: "Farine", unit: "g", quantity: null, hasStockLine: true },
        { id: "huile", name: "Huile", unit: "bouteille", quantity: null, hasStockLine: true },
        { id: "sel", name: "Sel", unit: null, quantity: null, hasStockLine: true },
      ]),
    );
    expect(needs.map((n) => [n.name, n.toBuy, n.covered])).toEqual([
      ["Farine", 0, true],
      ["Huile", 0, true],
      ["Sel", 0, true],
    ]);
    // Jamais rangé : on achète.
    const none = computeNeeds(meals, recipes([r]), products([{ id: "farine", name: "Farine", unit: "g", quantity: null }]));
    expect(none[0]).toMatchObject({ toBuy: 100, covered: false });
  });

  it("1 pincée de sel avec 1 kg en stock : rien à acheter", () => {
    const r: NeedsRecipe = { id: "r", name: "R", servings: null, ingredients: [{ name: "Sel", productId: "sel", quantity: 1, unit: "pincée" }] };
    const meals = [{ recipeId: "r", servings: null, cooked: false }];
    const full = computeNeeds(meals, recipes([r]), products([{ id: "sel", name: "Sel", unit: "kg", quantity: 1 }]));
    expect(full).toHaveLength(1);
    expect(full[0]).toMatchObject({ unit: "kg", needed: null, stock: 1, toBuy: 0, covered: true });
    const empty = computeNeeds(meals, recipes([r]), products([{ id: "sel", name: "Sel", unit: "kg", quantity: 0 }]));
    expect(empty[0]).toMatchObject({ unit: "kg", needed: null, toBuy: null, covered: false });
  });

  it("une pincée s'ajoute à la ligne chiffrée du même produit", () => {
    const r: NeedsRecipe = {
      id: "r",
      name: "R",
      servings: null,
      ingredients: [
        { name: "Sel", productId: "sel", quantity: 200, unit: "g" },
        { name: "Sel", productId: "sel", quantity: 1, unit: "pincée" },
      ],
    };
    const needs = computeNeeds([{ recipeId: "r", servings: null, cooked: false }], recipes([r]), products([{ id: "sel", name: "Sel", unit: "kg", quantity: 0.1 }]));
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ unit: "kg", needed: 0.2, toBuy: 0.1 });
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

describe("variantes acceptées (« Pâtes » → tagliatelles, coquillettes)", () => {
  const prod = (id: string, quantity: number | null, unit: string | null = "g", hasStockLine = quantity != null) => ({ id, name: id, unit, quantity, hasStockLine });
  const map = (...ps: ReturnType<typeof prod>[]) => new Map(ps.map((p) => [p.id, p]));
  const pates = { name: "Pâtes", productId: "pates", quantity: 250, unit: "g", alternatives: ["tagliatelles", "coquillettes"] };

  it("prend le principal s'il suffit, sinon la première variante qui suffit", () => {
    expect(chooseProduct(pates, map(prod("pates", 500), prod("tagliatelles", 500)))?.id).toBe("pates");
    expect(chooseProduct(pates, map(prod("pates", 0), prod("tagliatelles", 100), prod("coquillettes", 0.3, "kg")))?.id).toBe("coquillettes");
  });

  it("à défaut, une variante présente même insuffisante, sinon le principal (à acheter)", () => {
    expect(chooseProduct(pates, map(prod("pates", 0), prod("tagliatelles", 100), prod("coquillettes", 0)))?.id).toBe("tagliatelles");
    expect(chooseProduct(pates, map(prod("pates", 0), prod("tagliatelles", 0)))?.id).toBe("pates");
    // Un produit hors des variantes (pâtes fourrées) n'est jamais pris.
    expect(chooseProduct(pates, map(prod("pates", 0), prod("raviolis", 1000)))?.id).toBe("pates");
  });

  it("les besoins du planning sont couverts par la variante en stock", () => {
    const recipes = new Map([["r", { id: "r", name: "Pâtes au beurre", servings: 2, ingredients: [pates] }]]);
    const needs = computeNeeds([{ recipeId: "r", servings: 4, cooked: false }], recipes, map(prod("pates", 0), prod("tagliatelles", 600)));
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ productId: "pates", needed: 500, stock: 600, toBuy: 0, covered: true });
  });
});

describe("familles de produits (« Pâtes » → spaghetti, coquillettes)", () => {
  type P = NeedsProduct;
  const prod = (id: string, quantity: number | null, extra: Partial<P> = {}): P => ({ id, name: id, unit: "g", quantity, hasStockLine: quantity != null, ...extra });
  const family = (...ps: P[]) => new Map(ps.map((p) => [p.id, p]));
  const pates = (stock: [number, number, number], extra: Partial<P> = {}) =>
    family(prod("pates", stock[0], extra), prod("spaghetti", stock[1], { parentId: "pates" }), prod("coquillettes", stock[2], { parentId: "pates" }), prod("raviolis", 1000));
  const r = (id: string, productId: string, quantity: number): NeedsRecipe => ({ id, name: id, servings: null, ingredients: [{ name: productId, productId, quantity, unit: "g" }] });
  const plan = (...ids: string[]) => ids.map((recipeId) => ({ recipeId, servings: null, cooked: false }));

  it("un générique accepte toute la famille et additionne les stocks", () => {
    const needs = computeNeeds(plan("gratin"), recipes([r("gratin", "pates", 250)]), pates([0, 150, 150]));
    expect(needs).toEqual([expect.objectContaining({ productId: "pates", needed: 250, stock: 300, toBuy: 0, covered: true })]);
  });

  it("une déclinaison précise n'accepte qu'elle-même", () => {
    const needs = computeNeeds(plan("carbo"), recipes([r("carbo", "spaghetti", 250)]), pates([0, 100, 500]));
    expect(needs[0]).toMatchObject({ productId: "spaghetti", stock: 100, toBuy: 150 });
  });

  it("ne compte pas deux fois le même stock (le précis se sert d'abord)", () => {
    const needs = computeNeeds(plan("gratin", "carbo"), recipes([r("gratin", "pates", 250), r("carbo", "spaghetti", 250)]), pates([0, 300, 100]));
    expect(needs.find((n) => n.key.startsWith("spaghetti"))).toMatchObject({ toBuy: 0 });
    // Restent 50 g de spaghetti + 100 g de coquillettes pour 250 g : 100 g à acheter.
    expect(needs.find((n) => n.key.startsWith("pates"))).toMatchObject({ stock: 150, toBuy: 100 });
  });

  it("achète la déclinaison préférée du générique", () => {
    const needs = computeNeeds(plan("gratin"), recipes([r("gratin", "pates", 250)]), pates([0, 0, 0], { preferredId: "coquillettes" }));
    expect(needs[0]).toMatchObject({ productId: "coquillettes", name: "coquillettes", toBuy: 250 });
  });

  it("cuisiner puise dans une seule déclinaison si elle suffit (la plus entamée), sinon dans plusieurs", () => {
    expect(consumptionFor(r("gratin", "pates", 250), null, pates([0, 300, 1000]))).toEqual([{ productId: "spaghetti", name: "spaghetti", quantity: 250, unit: "g" }]);
    expect(consumptionFor(r("gratin", "pates", 250), null, pates([0, 200, 100]))).toEqual([
      { productId: "spaghetti", name: "spaghetti", quantity: 200, unit: "g" },
      { productId: "coquillettes", name: "coquillettes", quantity: 50, unit: "g" },
    ]);
  });
});
