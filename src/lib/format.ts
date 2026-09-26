const qtyFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export function formatQty(q: number | null | undefined, unit?: string | null): string {
  if (q == null) return unit ?? "";
  return unit ? `${qtyFmt.format(q)} ${unit}` : qtyFmt.format(q);
}

export function formatMinutes(m: number | null | undefined): string | null {
  if (m == null) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

export const DIFFICULTY = ["", "Facile", "Moyen", "Difficile"];

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const formatDateTime = (iso: string) => dateFmt.format(new Date(iso));

/** "2,5" ou "2.5" → 2.5 ; vide → null. Les saisies mobiles FR utilisent la virgule. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const numToInput = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

export const UNIT_SUGGESTIONS = ["pièce", "g", "kg", "ml", "cl", "L", "paquet", "boîte", "bouteille", "sachet", "pot", "rouleau", "tube", "c. à soupe", "c. à café", "pincée"];
