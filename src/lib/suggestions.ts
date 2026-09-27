import { addDays } from "../../shared/dates";
import type { Cookable } from "../../shared/cookable";
import type { MealPlanItem, RecipeSummary } from "./types";

export type Suggestions = { ready: RecipeSummary[]; forgotten: RecipeSummary[] };

/**
 * Suggestions pour un créneau :
 *  - « avec le stock » : recettes réalisables, pas déjà prévues dans les 3 jours autour ;
 *  - « pas au menu depuis un moment » : favoris non planifiés depuis 3 semaines
 *    (ou jamais), ni prévus dans la semaine autour du créneau.
 */
export function suggestRecipes(
  recipes: RecipeSummary[],
  cookable: Map<string, Cookable> | undefined,
  plan: MealPlanItem[],
  date: string,
  limit = 4,
): Suggestions {
  const near = (days: number) => new Set(plan.filter((p) => p.recipeId && p.date >= addDays(date, -days) && p.date <= addDays(date, days)).map((p) => p.recipeId!));
  const lastPlanned = new Map<string, string>();
  for (const p of plan) {
    if (p.recipeId && p.date <= date && (lastPlanned.get(p.recipeId) ?? "") < p.date) lastPlanned.set(p.recipeId, p.date);
  }

  const soon = near(3);
  const ready = recipes
    .filter((r) => cookable?.get(r.id)?.complete && !soon.has(r.id))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, "fr"))
    .slice(0, limit);

  const week = near(7);
  const threshold = addDays(date, -21);
  const readyIds = new Set(ready.map((r) => r.id));
  const forgotten = recipes
    .filter((r) => r.favorite && !week.has(r.id) && !readyIds.has(r.id) && (lastPlanned.get(r.id) ?? "") < threshold)
    .sort((a, b) => (lastPlanned.get(a.id) ?? "").localeCompare(lastPlanned.get(b.id) ?? "") || a.name.localeCompare(b.name, "fr"))
    .slice(0, limit);

  return { ready, forgotten };
}
