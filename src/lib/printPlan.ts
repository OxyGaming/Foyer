// Préparation du planning imprimable : ingrédients de chaque repas (quantités
// ajustées aux portions prévues) et repérage des ingrédients utilisés dans
// plusieurs repas de la semaine.
import type { Meal } from "../../shared/dates";
import { servingsFactor } from "../../shared/needs";
import { normalize } from "../../shared/text";
import { convertQty, readableQty, roundForPurchase } from "../../shared/units";
import type { MealPlanItem, RecipeSummary } from "./types";

/**
 * Repères des ingrédients partagés. Seules 4 couleurs restent distinctes deux à
 * deux (validées « toutes paires », y compris daltonisme) : la forme multiplie
 * les combinaisons et le numéro garantit l'identification, même en noir et blanc.
 */
export const MARKER_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7"] as const;
export const MARKER_SHAPES = ["circle", "square", "diamond", "triangle"] as const;
export type Marker = { index: number; color: string; shape: (typeof MARKER_SHAPES)[number] };

export function markerFor(i: number): Marker {
  return { index: i + 1, color: MARKER_COLORS[i % 4], shape: MARKER_SHAPES[Math.floor(i / 4) % 4] };
}

export type PrintIngredient = { key: string; name: string; quantity: number | null; unit: string | null };
export type PrintEntry = { id: string; title: string; servings: number | null; isRecipe: boolean; ingredients: PrintIngredient[] };
export type SharedIngredient = {
  key: string;
  name: string;
  marker: Marker;
  /** Repas qui l'utilisent, dans l'ordre de la semaine. */
  uses: { date: string; meal: Meal; title: string }[];
  /** Total si toutes les quantités sont comparables, sinon null. */
  total: { quantity: number; unit: string | null } | null;
};

/** Clé d'un ingrédient : son produit s'il est relié au stock, sinon son nom normalisé. */
const keyOf = (i: { productId: string | null; name: string }) => i.productId ?? `name:${normalize(i.name)}`;

export function buildPrintPlan(items: MealPlanItem[], recipes: Map<string, RecipeSummary>) {
  const cells = new Map<string, PrintEntry[]>();
  const usage = new Map<string, { name: string; uses: SharedIngredient["uses"]; qty: { quantity: number | null; unit: string | null }[] }>();

  const ordered = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
  for (const item of ordered) {
    const recipe = item.recipeId ? recipes.get(item.recipeId) : undefined;
    const title = recipe?.name || item.title || "Repas";
    const factor = servingsFactor(item.servings, recipe?.servings ?? null);
    const ingredients: PrintIngredient[] = [];
    const seenHere = new Set<string>();
    for (const ing of recipe?.ingredients ?? []) {
      if (!ing.name) continue;
      const key = keyOf(ing);
      const quantity = ing.quantity != null ? roundForPurchase(ing.quantity * factor, ing.unit) : null;
      ingredients.push({ key, name: ing.name, quantity, unit: ing.unit });
      const u = usage.get(key) ?? { name: ing.name, uses: [], qty: [] };
      if (!seenHere.has(key)) u.uses.push({ date: item.date, meal: item.meal, title });
      seenHere.add(key);
      u.qty.push({ quantity, unit: ing.unit });
      usage.set(key, u);
    }
    const cellKey = `${item.date}|${item.meal}`;
    cells.set(cellKey, [...(cells.get(cellKey) ?? []), { id: item.id, title, servings: item.servings ?? recipe?.servings ?? null, isRecipe: !!recipe, ingredients }]);
  }

  // Partagé = présent dans au moins deux repas. Les plus utilisés reçoivent les premiers repères.
  const shared: SharedIngredient[] = [...usage.entries()]
    .filter(([, u]) => u.uses.length >= 2)
    .sort((a, b) => b[1].uses.length - a[1].uses.length || a[1].name.localeCompare(b[1].name, "fr"))
    .map(([key, u], i) => ({ key, name: u.name, marker: markerFor(i), uses: u.uses, total: sumQuantities(u.qty) }));

  return { cells, shared, markers: new Map(shared.map((s) => [s.key, s.marker])) };
}

function sumQuantities(list: { quantity: number | null; unit: string | null }[]): SharedIngredient["total"] {
  if (!list.length || list.some((q) => q.quantity == null)) return null;
  const unit = list[0].unit;
  let total = 0;
  for (const q of list) {
    const v = convertQty(q.quantity!, q.unit, unit);
    if (v == null) return null;
    total += v;
  }
  return readableQty(roundForPurchase(total, unit), unit);
}
