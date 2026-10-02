import { describe, expect, it } from "vitest";
import { groupIngredients } from "./ingredientLinks";
import type { Product, RecipeSummary } from "./types";

const product = (id: string, name: string, unit: string | null, quantity: number | null): Product => ({
  id, name, unit, quantity, photoId: null, categoryId: null, minStock: null, targetStock: null, defaultLocationId: null, brand: null, reference: null,
  notes: null, createdAt: "", updatedAt: "", stock: quantity != null ? [{ id: `s-${id}`, locationId: null, quantity, updatedAt: "" }] : [], status: "none", toBuy: null, pricing: null,
});
const recipe = (id: string, ingredients: Omit<RecipeSummary["ingredients"][number], "id" | "note">[]): RecipeSummary => ({
  id, name: id, favorite: false, description: null, photoId: null, tags: [], servings: null, prepMinutes: null, cookMinutes: null,
  difficulty: null, updatedAt: "", categoryIds: [], stepCount: 0, ingredients: ingredients.map((i, n) => ({ ...i, id: `${id}-${n}`, note: null })),
});

describe("liens ingrédients ↔ stock", () => {
  const products = [product("pates", "Pâtes", "g", 0), product("tagl", "Tagliatelles", "g", 500), product("oignon", "Oignon", "g", 0)];
  const recipes = [
    recipe("Pâtes au beurre", [{ name: "Pâtes", productId: "pates", quantity: 250, unit: "g", alternatives: ["tagl", "inconnu"] }]),
    recipe("Bolognaise", [
      { name: "Pâtes", productId: "pates", quantity: 300, unit: "g", alternatives: [] },
      { name: "Oignons", productId: "oignon", quantity: 2, unit: null, alternatives: [] },
    ]),
    recipe("Salade", [{ name: "Ciboulette", productId: null, quantity: null, unit: null, alternatives: [] }]),
  ];
  const groups = new Map(groupIngredients(recipes, products).map((g) => [g.key, g]));

  it("regroupe par produit, avec les recettes et les variantes connues", () => {
    const pates = groups.get("pates")!;
    expect(pates.uses.map((u) => u.recipeName)).toEqual(["Bolognaise", "Pâtes au beurre"]);
    expect(pates.alternatives).toEqual(["tagl"]);
    // Les tagliatelles en stock suffisent : rien ne manque.
    expect(pates.missing).toBe(false);
    expect([...pates.issues]).toEqual(["variants"]);
  });

  it("signale les orphelins, les unités incomparables et les absents", () => {
    expect([...groups.get("nom:ciboulette")!.issues]).toEqual(["unlinked"]);
    const oignon = groups.get("oignon")!;
    expect(oignon.aliases).toEqual([]);
    expect(oignon.uses[0].unitMismatch).toBe(true);
    expect([...oignon.issues].sort()).toEqual(["missing", "units"]);
  });

  it("repère un ingrédient relié à un produit d'un autre nom", () => {
    const beurre = groupIngredients([recipe("Crêpes", [{ name: "Lait", productId: "beurre", quantity: 500, unit: "ml", alternatives: [] }])], [product("beurre", "Beurre", "g", 0)])[0];
    expect(beurre.aliases).toEqual(["Lait"]);
    expect(beurre.issues.has("names")).toBe(true);
  });
});
