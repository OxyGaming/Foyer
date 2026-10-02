// Liens ingrédients ↔ stock : chaque produit (ou ingrédient orphelin) avec les
// recettes qui l'utilisent, ses variantes acceptées et ce qui mérite un coup d'œil.
import { compatibleUnits, isBasicUnit } from "../../shared/units";
import { productKey } from "../../shared/text";
import type { Product, RecipeSummary } from "./types";

export type IngredientUse = {
  ingredientId: string;
  recipeId: string;
  recipeName: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  productId: string | null;
  alternatives: string[];
  /** Unité de la recette incomparable avec celle du stock (« 2 pièces » vs grammes). */
  unitMismatch: boolean;
};

export type LinkIssue = "unlinked" | "units" | "missing" | "variants";

export type LinkGroup = {
  key: string;
  product: Product | null;
  name: string;
  uses: IngredientUse[];
  /** Noms d'ingrédient différents du nom du produit (« Crème » → « Crème fraîche épaisse »). */
  aliases: string[];
  /** Union des variantes acceptées dans les recettes. */
  alternatives: string[];
  /** Ni le produit ni aucune variante n'est en stock. */
  missing: boolean;
  issues: Set<LinkIssue>;
};

const present = (p: Product | undefined) => !!p && (p.quantity != null ? p.quantity > 0 : p.stock.length > 0);

export function groupIngredients(recipes: RecipeSummary[], products: Product[]): LinkGroup[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, LinkGroup>();
  for (const r of recipes) {
    for (const i of r.ingredients) {
      if (!i.name && !i.productId) continue;
      const product = i.productId ? byId.get(i.productId) ?? null : null;
      const key = product ? product.id : `nom:${productKey(i.name)}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, product, name: product?.name || i.name || "Sans nom", uses: [], aliases: [], alternatives: [], missing: false, issues: new Set() };
        groups.set(key, g);
      }
      const unitMismatch = !!product && i.quantity != null && !isBasicUnit(i.unit) && !compatibleUnits(i.unit, product.unit);
      g.uses.push({
        ingredientId: i.id,
        recipeId: r.id,
        recipeName: r.name || "Recette sans nom",
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        productId: product?.id ?? null,
        alternatives: i.alternatives.filter((a) => byId.has(a)),
        unitMismatch,
      });
    }
  }
  for (const g of groups.values()) {
    g.uses.sort((a, b) => a.recipeName.localeCompare(b.recipeName, "fr"));
    const own = productKey(g.name);
    g.aliases = [...new Set(g.uses.map((u) => u.name).filter((n) => n && productKey(n) !== own))];
    g.alternatives = [...new Set(g.uses.flatMap((u) => u.alternatives))];
    g.missing = !!g.product && !present(g.product) && !g.alternatives.some((a) => present(byId.get(a)));
    if (!g.product) g.issues.add("unlinked");
    if (g.uses.some((u) => u.unitMismatch)) g.issues.add("units");
    if (g.missing) g.issues.add("missing");
    if (g.alternatives.length) g.issues.add("variants");
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
