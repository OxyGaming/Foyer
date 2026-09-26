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

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const euroShort = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** 598 → « 5,98 € ». Les grands montants sans centimes si demandé (axes, tuiles). */
export const formatCents = (cents: number, short = false) =>
  (short && (Math.abs(cents) >= 10000 || Math.round(cents) % 100 === 0) ? euroShort : euro).format(cents / 100);

// Prix au gramme ou au millilitre illisibles (0,00 €) : on les affiche au kilo
// ou au litre, comme sur les étiquettes en magasin.
const PRICE_SCALE: Record<string, [number, string]> = { g: [1000, "kg"], mg: [1e6, "kg"], ml: [1000, "L"], cl: [100, "L"] };

export function scaleUnitPrice(cents: number, unit: string | null | undefined): { cents: number; unit: string } {
  const s = PRICE_SCALE[(unit ?? "").trim().toLowerCase()];
  return s ? { cents: cents * s[0], unit: s[1] } : { cents, unit: unit || "unité" };
}

/** Prix unitaire : 299 + « kg » → « 2,99 €/kg » ; 0,48 c/g → « 4,80 €/kg » ; sans unité → « /unité ». */
export function formatUnitPrice(cents: number, unit: string | null | undefined) {
  const s = scaleUnitPrice(cents, unit);
  return `${euro.format(s.cents / 100)}/${s.unit}`;
}

/** « 5,98 » ou « 5.98 » → 598 centimes ; vide → null. */
export function parseEuros(s: string): number | null {
  const n = parseNum(s.replace(/[€\s]/g, ""));
  return n == null ? null : Math.round(n * 100);
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
export const formatDate = (iso: string) => dayFmt.format(new Date(iso));
