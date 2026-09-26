// Règles de stock partagées entre le serveur et l'interface.

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
