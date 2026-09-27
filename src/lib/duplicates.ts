// Produits homonymes (« Farine » / « farine », « Huile d’olive » / « Huile d'olive ») :
// recettes et courses n'en voient qu'un, le stock est souvent sur l'autre.
import { productKey } from "../../shared/text";
import { formatQty } from "./format";
import type { Product } from "./types";

type DupProduct = Pick<Product, "id" | "name" | "unit" | "quantity" | "stock" | "createdAt">;

/** « 2 kg · 1 emplacement » / « pas de stock » : de quoi reconnaître deux fiches homonymes. */
export function stockSummary(p: Pick<Product, "quantity" | "unit" | "stock">) {
  if (!p.stock.length) return `pas de stock${p.unit ? ` · unité ${p.unit}` : ""}`;
  const qty = p.quantity != null ? formatQty(p.quantity, p.unit) : "quantité inconnue";
  return `${qty} · ${p.stock.length} emplacement${p.stock.length > 1 ? "s" : ""}`;
}

/** Fiche à garder par défaut : celle qui a du stock (c'est elle que l'on consulte), sinon la plus ancienne. */
export function preferredKeeper<T extends DupProduct>(list: T[]): T {
  return [...list].sort(
    (a, b) =>
      b.stock.length - a.stock.length ||
      Number(b.quantity != null && b.quantity > 0) - Number(a.quantity != null && a.quantity > 0) ||
      a.createdAt.localeCompare(b.createdAt),
  )[0];
}

/** Groupes d'au moins deux produits de même nom, par ordre alphabétique. */
export function findDuplicates<T extends DupProduct>(products: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const p of products) {
    const key = productKey(p.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => a[0].name.localeCompare(b[0].name, "fr"));
}
