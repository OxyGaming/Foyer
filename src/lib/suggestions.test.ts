import { describe, expect, it } from "vitest";
import type { Cookable } from "../../shared/cookable";
import { suggestRecipes } from "./suggestions";
import type { MealPlanItem, RecipeSummary } from "./types";

const recipe = (id: string, favorite = false): RecipeSummary => ({
  id, name: id, favorite, description: null, photoId: null, tags: [], servings: null, prepMinutes: null, cookMinutes: null,
  difficulty: null, updatedAt: "", categoryIds: [], ingredients: [], stepCount: 0,
});
const meal = (recipeId: string, date: string): MealPlanItem => ({ id: `${recipeId}-${date}`, date, meal: "dinner", position: 0, recipeId, title: null, servings: null, note: null, cookedAt: null });
const ok = (id: string): Cookable => ({ recipeId: id, counted: 1, available: 1, missing: [], basicsMissing: [], complete: true });

describe("suggestRecipes", () => {
  const recipes = [recipe("pates"), recipe("gratin", true), recipe("curry", true), recipe("soupe", true)];
  const cookable = new Map([["pates", ok("pates")], ["gratin", ok("gratin")]]);

  it("propose d'abord ce qui est réalisable, favoris en tête, hors repas déjà prévus autour", () => {
    const s = suggestRecipes(recipes, cookable, [meal("pates", "2026-10-11")], "2026-10-10");
    expect(s.ready.map((r) => r.id)).toEqual(["gratin"]);
  });

  it("ressort les favoris oubliés (jamais planifiés d'abord), pas ceux vus récemment", () => {
    const plan = [meal("curry", "2026-08-01"), meal("soupe", "2026-10-01")];
    const s = suggestRecipes(recipes, cookable, plan, "2026-10-10");
    // gratin est déjà suggéré comme réalisable ; soupe a été planifiée il y a 9 jours.
    expect(s.forgotten.map((r) => r.id)).toEqual(["curry"]);
  });

  it("ne suggère rien d'inventé sans données", () => {
    expect(suggestRecipes([], undefined, [], "2026-10-10")).toEqual({ ready: [], forgotten: [] });
  });
});
