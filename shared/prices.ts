// Prix d'achat : coût moyen pondéré, dernier prix, meilleur prix, historique.
// Règle : sans prix exploitable, on ne renvoie rien (jamais de valeur inventée).
import { convertQty } from "./units";

export type PricedPurchase = {
  id: string;
  date: string | Date;
  quantity: number | null;
  unit: string | null;
  totalCents: number | null;
  isPromo?: boolean;
  store?: string | null;
};

export type PricePoint = { id: string; date: string; unitCents: number; isPromo: boolean; store: string | null };

export type PriceStats = {
  /** Nombre d'achats ayant un prix et une quantité exploitables. */
  count: number;
  /** Coût moyen pondéré par les quantités, en centimes par unité du produit. */
  avgCents: number;
  last: PricePoint;
  best: PricePoint;
  /** Du plus ancien au plus récent. */
  history: PricePoint[];
};

const iso = (d: string | Date) => (typeof d === "string" ? d : d.toISOString());

/**
 * Quantité d'un achat ramenée à l'unité actuelle du produit (500 g → 0,5 kg).
 * null si l'achat n'est pas exploitable (pas de quantité, unités incomparables).
 */
function normalizedQty(p: PricedPurchase, productUnit: string | null): number | null {
  if (p.quantity == null || p.quantity <= 0) return null;
  const q = convertQty(p.quantity, p.unit, productUnit);
  return q != null && q > 0 ? q : null;
}

export function priceStats(purchases: PricedPurchase[], productUnit: string | null): PriceStats | null {
  const points: (PricePoint & { qty: number; total: number })[] = [];
  for (const p of purchases) {
    if (p.totalCents == null) continue;
    const qty = normalizedQty(p, productUnit);
    if (qty == null) continue;
    points.push({ id: p.id, date: iso(p.date), unitCents: p.totalCents / qty, isPromo: !!p.isPromo, store: p.store ?? null, qty, total: p.totalCents });
  }
  if (!points.length) return null;
  points.sort((a, b) => a.date.localeCompare(b.date));
  const totalQty = points.reduce((s, p) => s + p.qty, 0);
  const totalCents = points.reduce((s, p) => s + p.total, 0);
  const strip = ({ qty: _q, total: _t, ...pt }: (typeof points)[number]): PricePoint => pt;
  const best = points.reduce((b, p) => (p.unitCents < b.unitCents ? p : b));
  return {
    count: points.length,
    avgCents: totalCents / totalQty,
    last: strip(points[points.length - 1]),
    best: strip(best),
    history: points.map(strip),
  };
}

/** Prix unitaire d'un achat isolé (affichage de l'historique), en centimes. */
export function unitPriceCents(p: { quantity: number | null; totalCents: number | null }): number | null {
  return p.totalCents != null && p.quantity != null && p.quantity > 0 ? p.totalCents / p.quantity : null;
}

/** Valeur d'une quantité de stock au coût moyen ; null si non calculable. */
export function stockValueCents(quantity: number | null, avgCents: number | null | undefined): number | null {
  if (quantity == null || quantity <= 0 || avgCents == null) return null;
  return Math.round(quantity * avgCents);
}
