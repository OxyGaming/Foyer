// Calcul des besoins du planning et de la consommation d'une recette.
//
// Familles de produits : un ingrédient relié à un générique (« Pâtes ») accepte
// n'importe laquelle de ses déclinaisons (spaghetti, coquillettes…), et leurs
// stocks s'additionnent. Relié à « Spaghetti », il ne prend que celui-là.
import { compatibleUnits, convertQty, isBasicUnit, roundForPurchase, unitDimension } from "./units";

export type NeedsIngredient = {
  name: string;
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  /** Remplaçants propres à la recette, en plus de la famille du produit. */
  alternatives?: string[];
};
export type NeedsRecipe = { id: string; name: string; servings: number | null; ingredients: NeedsIngredient[] };
/**
 * `hasStockLine` : rangé quelque part, même sans quantité (« de la farine au placard »).
 * `parentId` : générique de la famille ; `preferredId` (sur un générique) : déclinaison à acheter.
 */
export type NeedsProduct = {
  id: string;
  name: string;
  unit: string | null;
  quantity: number | null;
  hasStockLine?: boolean;
  parentId?: string | null;
  preferredId?: string | null;
};
export type NeedsMeal = { recipeId: string | null; servings: number | null; cooked: boolean };

export type Need = {
  /** Clé stable produit + dimension d'unité (un même produit en g et en « paquet » = 2 lignes). */
  key: string;
  /** Produit à acheter (la déclinaison préférée d'un générique, sinon le produit de la recette). */
  productId: string;
  name: string;
  unit: string | null;
  /** Total requis par le planning ; null si aucun ingrédient n'a de quantité (« Sel »). */
  needed: number | null;
  /** Stock (de toute la famille) converti dans `unit` ; null si inconnu ou non comparable. */
  stock: number | null;
  /** Quantité à acheter ; 0 = stock suffisant ; null = quantité non chiffrable. */
  toBuy: number | null;
  covered: boolean;
  /** Au moins un produit qui convient est en stock (même en quantité insuffisante). */
  present: boolean;
  recipes: string[];
};

/** Rapport portions prévues / portions de la recette (1 si l'une des deux est inconnue). */
export function servingsFactor(planned: number | null, recipe: number | null) {
  return planned && recipe ? planned / recipe : 1;
}

/** Il en reste, ou il est rangé sans quantité indiquée (on fait confiance). */
export const isPresent = (p: NeedsProduct) => (p.quantity != null ? p.quantity > 0 : !!p.hasStockLine);

/** Déclinaisons de chaque générique, par nom. */
export function familyIndex<P extends NeedsProduct>(products: Map<string, P>): Map<string, P[]> {
  const out = new Map<string, P[]>();
  for (const p of products.values()) {
    if (!p.parentId || !products.has(p.parentId)) continue;
    const list = out.get(p.parentId) ?? [];
    list.push(p);
    out.set(p.parentId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return out;
}

/**
 * Produits qui conviennent pour un ingrédient, par ordre de préférence : le
 * produit, ses déclinaisons s'il est générique, puis les remplaçants propres à
 * la recette (avec leurs déclinaisons).
 */
export function optionsFor<P extends NeedsProduct>(ing: NeedsIngredient, products: Map<string, P>, family = familyIndex(products)): P[] {
  const out: P[] = [];
  const seen = new Set<string>();
  for (const id of [ing.productId, ...(ing.alternatives ?? [])]) {
    const p = id ? products.get(id) : undefined;
    if (!p) continue;
    for (const q of [p, ...(family.get(p.id) ?? [])]) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      out.push(q);
    }
  }
  return out;
}

/** Ce qu'on achète quand il en manque : la déclinaison préférée d'un générique, sinon le produit lui-même. */
export function buyTarget<P extends NeedsProduct>(main: P, products: Map<string, P>): P {
  const pref = main.preferredId ? products.get(main.preferredId) : undefined;
  return pref && pref.parentId === main.id ? pref : main;
}

/** Stock restant de chaque produit pendant un calcul (unité du produit ; null = inconnu). */
type Left = Map<string, number | null>;
type Pick<P> = { product: P; quantity: number | null };

function remaining(p: NeedsProduct, left: Left) {
  return left.has(p.id) ? left.get(p.id)! : p.quantity;
}
function presentIn(p: NeedsProduct, left: Left) {
  const rem = remaining(p, left);
  return rem != null ? rem > 1e-9 : !!p.hasStockLine;
}
/** Ce qu'il reste d'un produit, exprimé dans `unit` ; null si inconnu ou non comparable. */
function capacity(p: NeedsProduct, unit: string | null, left: Left) {
  const rem = remaining(p, left);
  return rem != null ? convertQty(Math.max(0, rem), p.unit, unit) : null;
}
/** Stock cumulé des produits qui conviennent, dans `unit` ; null si aucun n'est chiffrable. */
function poolStock(members: NeedsProduct[], unit: string | null, left: Left) {
  const caps = members.map((m) => capacity(m, unit, left)).filter((c): c is number => c != null);
  return caps.length ? caps.reduce((a, b) => a + b, 0) : null;
}
function take(p: NeedsProduct, qty: number, unit: string | null, left: Left): number | null {
  const q = convertQty(qty, unit, p.unit);
  const rem = remaining(p, left);
  if (q != null && rem != null) left.set(p.id, rem - q);
  return q;
}

/**
 * Prélève `qty` (dans `unit`) sur les produits qui conviennent. On préfère un
 * seul produit qui suffit (pas deux sortes de pâtes dans le même plat) : le
 * premier de la liste, sinon le plus entamé. À défaut, on complète avec les plus
 * fournis. Un produit présent sans quantité connue (ou incomparable) suffit :
 * on fait confiance.
 */
function allocate<P extends NeedsProduct>(qty: number, unit: string | null, members: P[], left: Left): { picks: Pick<P>[]; missing: number } {
  const caps = new Map(members.map((m) => [m.id, capacity(m, unit, left)]));
  const covering = members.filter((m) => {
    const cap = caps.get(m.id)!;
    return presentIn(m, left) && (cap == null || cap + 1e-9 >= qty);
  });
  if (covering.length) {
    const rank = (m: P) => (m === members[0] ? -Infinity : (caps.get(m.id) ?? Infinity));
    const best = [...covering].sort((a, b) => rank(a) - rank(b))[0];
    return { picks: [{ product: best, quantity: take(best, qty, unit, left) }], missing: 0 };
  }
  const picks: Pick<P>[] = [];
  let need = qty;
  const stocked = members.filter((m) => (caps.get(m.id) ?? 0) > 1e-9).sort((a, b) => caps.get(b.id)! - caps.get(a.id)!);
  for (const m of stocked) {
    if (need <= 1e-9) break;
    const part = Math.min(need, caps.get(m.id)!);
    picks.push({ product: m, quantity: take(m, part, unit, left) });
    need -= part;
  }
  return { picks, missing: Math.max(0, need) };
}

/**
 * Produit réellement utilisé pour un ingrédient (affichage d'une recette) : le
 * produit s'il suffit, sinon une déclinaison ou un remplaçant qui suffit, sinon
 * le plus fourni, sinon le produit de la recette — c'est lui qu'on achète.
 */
export function chooseProduct<P extends NeedsProduct>(ing: NeedsIngredient, products: Map<string, P>, factor = 1): P | undefined {
  const options = optionsFor(ing, products);
  if (options.length <= 1) return options[0];
  if (ing.quantity == null || isBasicUnit(ing.unit)) return options.find((p) => presentIn(p, new Map())) ?? options[0];
  return allocate(ing.quantity * factor, ing.unit, options, new Map()).picks[0]?.product ?? options[0];
}

type Row = { main: NeedsProduct; buy: NeedsProduct; unit: string | null; sum: number | null; members: NeedsProduct[]; recipes: Set<string> };

/** Besoins dans l'ordre des recettes et des ingrédients. */
function needRows(entries: { recipe: NeedsRecipe; factor: number }[], products: Map<string, NeedsProduct>): Need[] {
  const family = familyIndex(products);
  const rows = new Map<string, Row>();
  for (const { recipe, factor } of entries) {
    for (const ing of recipe.ingredients) {
      const options = optionsFor(ing, products, family);
      const main = options[0];
      if (!main) continue;
      const buy = buyTarget(main, products);
      // « 1 pincée de sel » : traité comme un ingrédient sans quantité, dans l'unité du stock.
      const basic = isBasicUnit(ing.unit);
      const ingUnit = basic ? buy.unit : ing.unit;
      const ingQty = basic ? null : ing.quantity;
      const key = `${main.id}|${unitDimension(ingUnit)}`;
      let row = rows.get(key);
      if (!row) {
        // On exprime le besoin dans l'unité du produit acheté quand c'est
        // possible : l'achat pourra alors être rangé tel quel.
        const unit = compatibleUnits(buy.unit, ingUnit) && buy.unit ? buy.unit : ingUnit;
        row = { main, buy, unit, sum: null, members: [], recipes: new Set() };
        rows.set(key, row);
      }
      for (const o of options) if (!row.members.includes(o)) row.members.push(o);
      row.recipes.add(recipe.name || "Recette");
      if (ingQty != null) {
        const q = convertQty(ingQty * factor, ingUnit, row.unit);
        if (q != null) row.sum = (row.sum ?? 0) + q;
      }
    }
  }

  // Les ingrédients précis (« Spaghetti ») se servent avant les génériques
  // (« Pâtes ») : chacun puise dans ce qui reste, sans compter deux fois le même stock.
  const left: Left = new Map();
  const order = [...rows.entries()].sort(([, a], [, b]) => a.members.length - b.members.length);
  const out = new Map<string, Need>();
  for (const [key, row] of order) {
    const stock = poolStock(row.members, row.unit, left);
    const present = row.members.some((m) => presentIn(m, left));
    let toBuy: number | null;
    if (row.sum != null) {
      const { missing } = allocate(row.sum, row.unit, row.members, left);
      toBuy = missing > 1e-9 ? roundForPurchase(missing, row.unit) : 0;
    } else {
      // Sans quantité (« Sel ») : couvert s'il y en a.
      toBuy = present ? 0 : null;
    }
    out.set(key, {
      key,
      productId: row.buy.id,
      name: row.buy.name,
      unit: row.unit,
      needed: row.sum != null ? roundForPurchase(row.sum, row.unit) : null,
      stock: stock != null ? Math.round(stock * 1000) / 1000 : null,
      toBuy,
      // Couvert ⇔ rien à acheter : c'est ce que la liste de courses affiche.
      covered: toBuy === 0,
      present,
      recipes: [...row.recipes],
    });
  }
  return [...rows.keys()].map((k) => out.get(k)!);
}

export function computeNeeds(meals: NeedsMeal[], recipes: Map<string, NeedsRecipe>, products: Map<string, NeedsProduct>): Need[] {
  const entries: { recipe: NeedsRecipe; factor: number }[] = [];
  for (const meal of meals) {
    if (meal.cooked || !meal.recipeId) continue;
    const recipe = recipes.get(meal.recipeId);
    if (recipe) entries.push({ recipe, factor: servingsFactor(meal.servings, recipe.servings) });
  }
  return needRows(entries, products).sort((x, y) => x.name.localeCompare(y.name, "fr"));
}

/** Besoins d'une seule recette, dans l'ordre de ses ingrédients. */
export function recipeNeeds(recipe: NeedsRecipe, plannedServings: number | null, products: Map<string, NeedsProduct>): Need[] {
  return needRows([{ recipe, factor: servingsFactor(plannedServings, recipe.servings) }], products);
}

export type Consumption = { productId: string; name: string; quantity: number; unit: string | null };

/**
 * Ce qu'une recette retire du stock, dans l'unité de chaque produit. Un
 * ingrédient générique puise dans les déclinaisons en stock (au besoin dans
 * plusieurs). Les ingrédients non chiffrés ou dans une unité incomparable sont
 * ignorés (on ne devine pas qu'« 1 c. à soupe » représente X g d'un paquet).
 */
export function consumptionFor(recipe: NeedsRecipe, plannedServings: number | null, products: Map<string, NeedsProduct>): Consumption[] {
  const factor = servingsFactor(plannedServings, recipe.servings);
  const family = familyIndex(products);
  const left: Left = new Map();
  const byProduct = new Map<string, Consumption>();
  const add = (product: NeedsProduct, q: number | null) => {
    if (q == null || q <= 0) return;
    const prev = byProduct.get(product.id);
    if (prev) prev.quantity += q;
    else byProduct.set(product.id, { productId: product.id, name: product.name, quantity: q, unit: product.unit });
  };
  for (const ing of recipe.ingredients) {
    const options = optionsFor(ing, products, family);
    if (!options.length || ing.quantity == null) continue;
    const qty = ing.quantity * factor;
    const { picks } = allocate(qty, ing.unit, options, left);
    // Rien en stock : on propose quand même le produit de la recette (modifiable).
    if (!picks.length) add(options[0], convertQty(qty, ing.unit, options[0].unit));
    for (const p of picks) add(p.product, p.quantity);
  }
  return [...byProduct.values()].map((c) => ({ ...c, quantity: Math.round(c.quantity * 1000) / 1000 }));
}
