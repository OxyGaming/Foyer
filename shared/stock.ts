// Règles de stock partagées entre le serveur et l'interface.
import { convertQty } from "./units";

export type StockStatus = "ok" | "watch" | "low" | "out" | "none";

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  ok: "Normal",
  watch: "À surveiller",
  low: "À acheter",
  out: "Rupture",
  none: "",
};

/** Somme des quantités connues. null si aucune quantité n'est renseignée. */
export function totalQuantity(items: { quantity: number | null }[]): number | null {
  let total: number | null = null;
  for (const it of items) {
    if (it.quantity != null) total = (total ?? 0) + it.quantity;
  }
  return total;
}

/**
 * Statut d'alerte. Sans seuil minimum ou sans quantité connue : "none"
 * (on n'affiche pas d'alerte plutôt que d'en inventer une).
 */
export function stockStatus(quantity: number | null, minStock: number | null): StockStatus {
  if (minStock == null || quantity == null) return "none";
  if (quantity <= 0) return "out";
  if (quantity < minStock) return "low";
  if (quantity === minStock) return "watch";
  return "ok";
}

/**
 * Quantité suggérée à acheter pour revenir au stock cible (ou, à défaut, au minimum).
 * Stock 1, minimum 2, cible 4 → 3. Retourne null quand aucune suggestion n'a de sens.
 */
export function quantityToBuy(
  quantity: number | null,
  minStock: number | null,
  targetStock: number | null,
): number | null {
  const status = stockStatus(quantity, minStock);
  if (status === "none" || status === "ok") return null;
  const goal = targetStock ?? minStock!;
  const need = goal - (quantity ?? 0);
  return need > 0 ? roundQty(need) : null;
}

export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Familles de produits : un générique (« Pâtes ») est jugé sur le stock cumulé
// de toute sa famille ; ses déclinaisons n'ont pas d'alerte propre quand il a
// un minimum (c'est la famille qui manque, pas « les coquillettes »).

export type FamilyMember = { id: string; name: string; unit: string | null; quantity: number | null; hasStockLine: boolean };
export type StockProduct = FamilyMember & { minStock: number | null; targetStock: number | null };

/**
 * Stock cumulé de `members` exprimé dans `unit`. `uncounted` : membres rangés
 * mais hors du total (quantité non renseignée ou unité non convertible).
 */
export function familyQuantity<M extends FamilyMember>(unit: string | null, members: M[]): { quantity: number | null; uncounted: M[] } {
  let total: number | null = null;
  const uncounted: M[] = [];
  for (const m of members) {
    const q = m.quantity == null ? null : convertQty(m.quantity, m.unit, unit);
    if (q == null) {
      if (m.quantity != null ? m.quantity !== 0 : m.hasStockLine) uncounted.push(m);
      continue;
    }
    total = (total ?? 0) + q;
  }
  return { quantity: total == null ? null : roundQty(total), uncounted };
}

export type StockState = {
  status: StockStatus;
  toBuy: number | null;
  /** Sur un générique : stock de toute la famille, dans son unité. */
  family: { quantity: number | null; uncounted: string[] } | null;
};

/** Statut et quantité à acheter d'un produit, en tenant compte de sa famille. */
export function stockState<P extends StockProduct>(p: P, parent: P | undefined, children: P[]): StockState {
  if (children.length) {
    const { quantity, uncounted } = familyQuantity(p.unit, [p, ...children]);
    return {
      status: stockStatus(quantity, p.minStock),
      toBuy: quantityToBuy(quantity, p.minStock, p.targetStock),
      family: { quantity, uncounted: uncounted.map((m) => m.name) },
    };
  }
  if (parent?.minStock != null) return { status: "none", toBuy: null, family: null };
  return { status: stockStatus(p.quantity, p.minStock), toBuy: quantityToBuy(p.quantity, p.minStock, p.targetStock), family: null };
}
