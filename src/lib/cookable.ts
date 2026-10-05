import { useMemo } from "react";
import { cookability, type Cookable, type Missing, rankCookable, type StockProduct } from "../../shared/cookable";
import type { NeedsRecipe } from "../../shared/needs";
import { clientId } from "./planQueries";
import { useProducts, useRecipes } from "./queries";
import { useAddItem } from "./shoppingQueries";
import type { Product } from "./types";

export type { Cookable, Missing };

export function stockMap(products: Product[] | undefined): Map<string, StockProduct> {
  return new Map((products ?? []).map((p) => [p.id, { id: p.id, name: p.name, unit: p.unit, quantity: p.quantity, hasStockLine: p.stock.length > 0, parentId: p.parentId, preferredId: p.preferredId }]));
}

/** Toutes les recettes, classées par faisabilité avec le stock actuel. */
export function useCookable() {
  const recipes = useRecipes();
  const products = useProducts();
  const data = useMemo(() => {
    if (!recipes.data || !products.data) return null;
    const stock = stockMap(products.data);
    const byId = new Map<string, Cookable>();
    for (const r of recipes.data) byId.set(r.id, cookability(r as NeedsRecipe, stock));
    return { byId, ranked: rankCookable([...byId.values()]) };
  }, [recipes.data, products.data]);
  return { data, isPending: recipes.isPending || products.isPending };
}

/** Ajoute les ingrédients manquants à la liste de courses (fonctionne hors ligne). */
export function useAddMissingToShopping() {
  const add = useAddItem();
  return (missing: Missing[]) => {
    for (const m of missing) {
      add.mutate({ id: clientId(), name: m.name, productId: m.productId, quantity: m.toBuy, unit: m.unit });
    }
  };
}
