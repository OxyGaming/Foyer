import { describe, expect, it } from "vitest";
import { buildPrintPlan, markerFor } from "./printPlan";
import type { MealPlanItem, RecipeSummary } from "./types";

type Ing = Omit<RecipeSummary["ingredients"][number], "id" | "note" | "alternatives">;
const recipe = (id: string, servings: number | null, ingredients: Ing[]): RecipeSummary => ({
  id, name: id, favorite: false, description: null, photoId: null, tags: [], servings, prepMinutes: null, cookMinutes: null,
  difficulty: null, updatedAt: "", categoryIds: [], ingredients: ingredients.map((i, n) => ({ ...i, id: `${id}-${n}`, note: null, alternatives: [] })), stepCount: 0,
});
const meal = (id: string, date: string, m: MealPlanItem["meal"], recipeId: string | null, extra: Partial<MealPlanItem> = {}): MealPlanItem => ({
  id, date, meal: m, position: 0, recipeId, title: null, servings: null, note: null, cookedAt: null, ...extra,
});

const recipes = new Map([
  ["Carbonara", recipe("Carbonara", 2, [
    { name: "Œufs", productId: "oeufs", quantity: 3, unit: null },
    { name: "Spaghetti", productId: "pates", quantity: 250, unit: "g" },
  ])],
  ["Crêpes", recipe("Crêpes", 4, [
    { name: "Œufs", productId: "oeufs", quantity: 3, unit: null },
    { name: "Lait", productId: "lait", quantity: 500, unit: "ml" },
  ])],
  ["Gratin", recipe("Gratin", null, [
    { name: "Lait", productId: "lait", quantity: 0.5, unit: "L" },
    { name: "Sel", productId: null, quantity: null, unit: null },
  ])],
]);

describe("buildPrintPlan", () => {
  const items = [
    meal("a", "2026-10-05", "dinner", "Carbonara", { servings: 4 }),
    meal("b", "2026-10-07", "lunch", "Crêpes"),
    meal("c", "2026-10-08", "dinner", "Gratin"),
    meal("d", "2026-10-09", "lunch", null, { title: "Restes" }),
  ];
  const plan = buildPrintPlan(items, recipes);

  it("liste les ingrédients de chaque repas, quantités ajustées aux portions", () => {
    expect(plan.cells.get("2026-10-05|dinner")![0]).toMatchObject({
      title: "Carbonara",
      servings: 4,
      ingredients: [{ name: "Œufs", quantity: 6 }, { name: "Spaghetti", quantity: 500, unit: "g" }],
    });
    expect(plan.cells.get("2026-10-09|lunch")![0]).toMatchObject({ title: "Restes", isRecipe: false, ingredients: [] });
  });

  it("repère les ingrédients présents dans plusieurs repas, avec où et combien", () => {
    expect(plan.shared.map((s) => s.name)).toEqual(["Lait", "Œufs"]);
    const lait = plan.shared[0];
    expect(lait.uses.map((u) => u.title)).toEqual(["Crêpes", "Gratin"]);
    expect(lait.total).toEqual({ quantity: 1, unit: "L" });
    expect(plan.shared[1].total).toEqual({ quantity: 9, unit: null });
  });

  it("n'attribue pas de repère à un ingrédient utilisé une seule fois", () => {
    expect(plan.markers.has("pates")).toBe(false);
    expect(plan.markers.get("oeufs")).toEqual(plan.shared[1].marker);
  });
});

describe("markerFor", () => {
  it("combine 4 couleurs et 4 formes, numéro unique", () => {
    const markers = Array.from({ length: 16 }, (_, i) => markerFor(i));
    expect(new Set(markers.map((m) => `${m.color}|${m.shape}`)).size).toBe(16);
    expect(markers.map((m) => m.index)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
});
