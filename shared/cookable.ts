// « Que puis-je cuisiner avec mon stock ? »
//
// Un ingrédient chiffré (« 3 œufs ») compte : disponible si le stock suffit,
// « pas assez » s'il en manque, manquant s'il n'y en a pas. Un ingrédient sans
// quantité (« Sel ») est un basique : il ne bloque jamais la recette, on le
// signale seulement s'il semble absent du stock.
import { recipeNeeds, type NeedsProduct, type NeedsRecipe } from "./needs";

export type Missing = {
  productId: string;
  name: string;
  /** Quantité à acheter pour pouvoir faire la recette, si chiffrable. */
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

/**
 * Même calcul que la liste de courses, pour une seule recette : un ingrédient
 * générique (« Pâtes ») est disponible si la famille en a assez, toutes
 * déclinaisons confondues ; un même produit utilisé deux fois s'additionne.
 */
export function cookability(recipe: NeedsRecipe, products: Map<string, StockProduct>, plannedServings: number | null = null): Cookable {
  let counted = 0;
  let available = 0;
  const missing: Missing[] = [];
  const basicsMissing: string[] = [];
  for (const n of recipeNeeds(recipe, plannedServings, products)) {
    // « Sel », « 1 pincée de sel » : des basiques, jamais bloquants.
    if (n.needed == null) {
      if (!n.covered) basicsMissing.push(n.name);
      continue;
    }
    counted++;
    if (n.covered) available++;
    else missing.push({ productId: n.productId, name: n.name, toBuy: n.toBuy, unit: n.unit, short: n.present });
  }
  return { recipeId: recipe.id, counted, available, missing, basicsMissing, complete: counted > 0 && missing.length === 0 };
}

/** Classement : réalisables d'abord, puis par nombre d'ingrédients manquants. */
export function rankCookable(results: Cookable[]): Cookable[] {
  return results
    .filter((r) => r.counted > 0)
    .sort((a, b) => a.missing.length - b.missing.length || b.available - a.available || a.basicsMissing.length - b.basicsMissing.length);
}
