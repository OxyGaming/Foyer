// Calcul des besoins du planning et de la consommation d'une recette.
import { compatibleUnits, convertQty, isBasicUnit, roundForPurchase, unitDimension } from "./units";

export type NeedsIngredient = {
  name: string;
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  /** Autres produits acceptés (« Pâtes » → tagliatelles, coquillettes). */
  alternatives?: string[];
};
export type NeedsRecipe = { id: string; name: string; servings: number | null; ingredients: NeedsIngredient[] };
/** `hasStockLine` : rangé quelque part, même sans quantité (« de la farine au placard »). */
export type NeedsProduct = { id: string; name: string; unit: string | null; quantity: number | null; hasStockLine?: boolean };
export type NeedsMeal = { recipeId: string | null; servings: number | null; cooked: boolean };

export type Need = {
  /** Clé stable produit + dimension d'unité (un même produit en g et en « paquet » = 2 lignes). */
  key: string;
  productId: string;
  name: string;
  unit: string | null;
  /** Total requis par le planning ; null si aucun ingrédient n'a de quantité (« Sel »). */
  needed: number | null;
  /** Stock converti dans `unit` ; null si inconnu ou non comparable. */
  stock: number | null;
  /** Quantité à acheter ; 0 = stock suffisant ; null = quantité non chiffrable. */
  toBuy: number | null;
  covered: boolean;
  recipes: string[];
};

/** Rapport portions prévues / portions de la recette (1 si l'une des deux est inconnue). */
export function servingsFactor(planned: number | null, recipe: number | null) {
  return planned && recipe ? planned / recipe : 1;
}

/** Il en reste, ou il est rangé sans quantité indiquée (on fait confiance). */
export const isPresent = (p: NeedsProduct) => (p.quantity != null ? p.quantity > 0 : !!p.hasStockLine);

/**
 * Produit réellement utilisé pour un ingrédient qui accepte des variantes :
 * le principal s'il suffit, sinon la première variante qui suffit, sinon la
 * première présente (même en quantité insuffisante), sinon le principal — c'est
 * lui qu'on achète. Chaque ingrédient est jugé sur le stock entier.
 */
export function chooseProduct<P extends NeedsProduct>(ing: NeedsIngredient, products: Map<string, P>, factor = 1): P | undefined {
  const options = [ing.productId, ...(ing.alternatives ?? [])].flatMap((id) => {
    const p = id ? products.get(id) : undefined;
    return p ? [p] : [];
  });
  if (options.length <= 1) return options[0];
  const covers = (p: P) => {
    if (!isPresent(p)) return false;
    if (ing.quantity == null || isBasicUnit(ing.unit) || p.quantity == null) return true;
    const q = convertQty(ing.quantity * factor, ing.unit, p.unit);
    return q == null || p.quantity + 1e-9 >= q;
  };
  return options.find(covers) ?? options.find(isPresent) ?? options[0];
}

export function computeNeeds(meals: NeedsMeal[], recipes: Map<string, NeedsRecipe>, products: Map<string, NeedsProduct>): Need[] {
  type Acc = { productId: string; unit: string | null; sum: number | null; recipes: Set<string> };
  const acc = new Map<string, Acc>();

  for (const meal of meals) {
    if (meal.cooked || !meal.recipeId) continue;
    const recipe = recipes.get(meal.recipeId);
    if (!recipe) continue;
    const factor = servingsFactor(meal.servings, recipe.servings);
    for (const ing of recipe.ingredients) {
      const product = chooseProduct(ing, products, factor);
      if (!product) continue;
      // « 1 pincée de sel » : traité comme un ingrédient sans quantité, dans l'unité du stock.
      const basic = isBasicUnit(ing.unit);
      const ingUnit = basic ? product.unit : ing.unit;
      const ingQty = basic ? null : ing.quantity;
      const key = `${product.id}|${unitDimension(ingUnit)}`;
      let a = acc.get(key);
      if (!a) {
        // On exprime le besoin dans l'unité du stock quand c'est possible :
        // l'achat pourra alors être rangé tel quel.
        const unit = compatibleUnits(product.unit, ingUnit) && product.unit ? product.unit : ingUnit;
        a = { productId: product.id, unit, sum: null, recipes: new Set() };
        acc.set(key, a);
      }
      a.recipes.add(recipe.name || "Recette");
      if (ingQty != null) {
        const q = convertQty(ingQty * factor, ingUnit, a.unit);
        if (q != null) a.sum = (a.sum ?? 0) + q;
      }
    }
  }

  const out: Need[] = [];
  for (const [key, a] of acc) {
    const product = products.get(a.productId)!;
    const stock = product.quantity != null ? convertQty(product.quantity, product.unit, a.unit) : null;
    // En stock : il en reste, ou il est rangé sans quantité indiquée (on fait
    // confiance, comme « Que puis-je cuisiner »).
    const inStock = isPresent(product);
    let toBuy: number | null;
    if (a.sum != null && stock != null) {
      const raw = Math.max(0, a.sum - stock);
      toBuy = raw > 1e-9 ? roundForPurchase(raw, a.unit) : 0;
    } else if (inStock) {
      // Sans quantité, stock sans quantité, ou stock dans une unité
      // incomparable (« 2 c. à soupe » d'une bouteille) : couvert.
      toBuy = 0;
    } else {
      toBuy = a.sum != null ? roundForPurchase(a.sum, a.unit) : null;
    }
    // Couvert ⇔ rien à acheter : c'est ce que la liste de courses affiche.
    const covered = toBuy === 0;
    out.push({
      key,
      productId: a.productId,
      name: product.name,
      unit: a.unit,
      needed: a.sum != null ? roundForPurchase(a.sum, a.unit) : null,
      stock: stock != null ? Math.round(stock * 1000) / 1000 : null,
      toBuy,
      covered,
      recipes: [...a.recipes],
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, "fr"));
}

export type Consumption = { productId: string; name: string; quantity: number; unit: string | null };

/**
 * Ce qu'une recette retire du stock, dans l'unité de chaque produit.
 * Les ingrédients non chiffrés ou dans une unité incomparable sont ignorés
 * (on ne devine pas qu'« 1 c. à soupe » représente X g d'un paquet).
 */
export function consumptionFor(recipe: NeedsRecipe, plannedServings: number | null, products: Map<string, NeedsProduct>): Consumption[] {
  const factor = servingsFactor(plannedServings, recipe.servings);
  const byProduct = new Map<string, Consumption>();
  for (const ing of recipe.ingredients) {
    const product = chooseProduct(ing, products, factor);
    if (!product || ing.quantity == null) continue;
    const q = convertQty(ing.quantity * factor, ing.unit, product.unit);
    if (q == null || q <= 0) continue;
    const prev = byProduct.get(product.id);
    if (prev) prev.quantity += q;
    else byProduct.set(product.id, { productId: product.id, name: product.name, quantity: q, unit: product.unit });
  }
  return [...byProduct.values()].map((c) => ({ ...c, quantity: Math.round(c.quantity * 1000) / 1000 }));
}
