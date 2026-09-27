// « Que puis-je cuisiner avec mon stock ? »
//
// Un ingrédient chiffré (« 3 œufs ») compte : disponible si le stock suffit,
// « pas assez » s'il en manque, manquant s'il n'y en a pas. Un ingrédient sans
// quantité (« Sel ») est un basique : il ne bloque jamais la recette, on le
// signale seulement s'il semble absent du stock.
import { servingsFactor, type NeedsProduct, type NeedsRecipe } from "./needs";
import { convertQty, isBasicUnit, roundForPurchase } from "./units";

export type Missing = {
  productId: string;
  name: string;
  /** Quantité à acheter pour pouvoir faire la recette (unité du produit), si chiffrable. */
  toBuy: number | null;
  unit: string | null;
  /** true : il y en a, mais pas assez. */
  short: boolean;
};

export type Cookable = {
  recipeId: string;
  /** Ingrédients chiffrés reliés au stock. */
  counted: number;
  available: number;
  missing: Missing[];
  /** Basiques sans quantité apparemment absents (« Sel »), non bloquants. */
  basicsMissing: string[];
  complete: boolean;
};

export type StockProduct = NeedsProduct & { hasStockLine: boolean };

export function cookability(recipe: NeedsRecipe, products: Map<string, StockProduct>, plannedServings: number | null = null): Cookable {
  const factor = servingsFactor(plannedServings, recipe.servings);
  // Plusieurs lignes du même produit (« 2 œufs » + « 1 œuf pour dorer ») : on additionne.
  const needs = new Map<string, { qty: number | null; unit: string | null; basic: boolean }>();
  for (const ing of recipe.ingredients) {
    if (!ing.productId || !products.has(ing.productId)) continue;
    const p = products.get(ing.productId)!;
    const cur = needs.get(p.id);
    // « 1 pincée de sel », « poivre à goût » : des basiques, même chiffrés.
    if (ing.quantity == null || isBasicUnit(ing.unit)) {
      if (!cur) needs.set(p.id, { qty: null, unit: p.unit, basic: true });
      continue;
    }
    const q = convertQty(ing.quantity * factor, ing.unit, p.unit);
    if (!cur || cur.basic) needs.set(p.id, { qty: q, unit: p.unit, basic: false });
    else if (cur.qty != null && q != null) cur.qty += q;
    else cur.qty = null; // unités incomparables : on sait seulement qu'il en faut
  }

  let counted = 0;
  let available = 0;
  const missing: Missing[] = [];
  const basicsMissing: string[] = [];
  for (const [id, need] of needs) {
    const p = products.get(id)!;
    const stock = p.quantity;
    const present = (stock != null && stock > 0) || (stock == null && p.hasStockLine);
    if (need.basic) {
      if (!present) basicsMissing.push(p.name);
      continue;
    }
    counted++;
    if (!present) {
      missing.push({ productId: id, name: p.name, toBuy: need.qty != null ? roundForPurchase(need.qty, p.unit) : null, unit: p.unit, short: false });
    } else if (need.qty != null && stock != null && stock + 1e-9 < need.qty) {
      missing.push({ productId: id, name: p.name, toBuy: roundForPurchase(need.qty - stock, p.unit), unit: p.unit, short: true });
    } else {
      // Présent, quantité suffisante ou inconnue (on fait confiance).
      available++;
    }
  }
  return { recipeId: recipe.id, counted, available, missing, basicsMissing, complete: counted > 0 && missing.length === 0 };
}

/** Classement : réalisables d'abord, puis par nombre d'ingrédients manquants. */
export function rankCookable(results: Cookable[]): Cookable[] {
  return results
    .filter((r) => r.counted > 0)
    .sort((a, b) => a.missing.length - b.missing.length || b.available - a.available || a.basicsMissing.length - b.basicsMissing.length);
}
