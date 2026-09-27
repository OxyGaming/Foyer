// Unités : reconnaissance et conversion entre unités d'une même dimension.
// Les unités inconnues (« paquet », « c. à soupe »…) forment chacune leur
// propre dimension : on ne les additionne qu'entre elles.

type Unit = { dim: string; factor: number; label: string };

const KNOWN: Record<string, Unit> = {
  mg: { dim: "mass", factor: 0.001, label: "mg" },
  g: { dim: "mass", factor: 1, label: "g" },
  gr: { dim: "mass", factor: 1, label: "g" },
  gramme: { dim: "mass", factor: 1, label: "g" },
  kg: { dim: "mass", factor: 1000, label: "kg" },
  kilo: { dim: "mass", factor: 1000, label: "kg" },
  ml: { dim: "volume", factor: 1, label: "ml" },
  cl: { dim: "volume", factor: 10, label: "cl" },
  dl: { dim: "volume", factor: 100, label: "dl" },
  l: { dim: "volume", factor: 1000, label: "L" },
  litre: { dim: "volume", factor: 1000, label: "L" },
  piece: { dim: "count", factor: 1, label: "" },
  pc: { dim: "count", factor: 1, label: "" },
  unite: { dim: "count", factor: 1, label: "" },
  u: { dim: "count", factor: 1, label: "" },
};

function key(unit: string | null | undefined): string {
  const k = (unit ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.$/, "")
    .trim();
  // Pluriels simples : « pièces » → « piece », « litres » → « litre ».
  return k.length > 3 && k.endsWith("s") ? k.slice(0, -1) : k;
}

export function parseUnit(unit: string | null | undefined): Unit {
  const k = key(unit);
  if (!k) return KNOWN.piece;
  return KNOWN[k] ?? { dim: `other:${k}`, factor: 1, label: unit!.trim() };
}

// « 1 pincée de sel », « poivre à goût » : on ne mesure pas, seule la présence compte.
const BASIC_UNITS = new Set(["pincee", "pincees", "a gout", "au gout", "un peu", "filet", "trait"]);
export const isBasicUnit = (u: string | null | undefined) =>
  !!u && BASIC_UNITS.has(u.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());

/** Dimension d'une unité : "mass", "volume", "count" ou "other:<nom>". */
export const unitDimension = (unit: string | null | undefined) => parseUnit(unit).dim;

export const compatibleUnits = (a: string | null | undefined, b: string | null | undefined) => unitDimension(a) === unitDimension(b);

/** Convertit une quantité ; null si les unités ne sont pas comparables. */
export function convertQty(qty: number, from: string | null | undefined, to: string | null | undefined): number | null {
  const f = parseUnit(from);
  const t = parseUnit(to);
  if (f.dim !== t.dim) return null;
  return (qty * f.factor) / t.factor;
}

/** Unité la plus lisible pour un total : 1500 ml → 1,5 L ; 2600 g → 2,6 kg ; 150 cl → 1,5 L. */
export function readableQty(qty: number, unit: string | null | undefined): { quantity: number; unit: string | null } {
  const u = parseUnit(unit);
  const base = qty * u.factor; // en g ou en ml
  if (u.dim === "mass" && base >= 1000) return { quantity: Math.round((base / 1000) * 100) / 100, unit: "kg" };
  if (u.dim === "volume" && base >= 1000) return { quantity: Math.round((base / 1000) * 100) / 100, unit: "L" };
  return { quantity: qty, unit: unit ?? null };
}

/** Arrondi d'affichage/achat : à l'unité supérieure pour les pièces, au centième sinon. */
export function roundForPurchase(qty: number, unit: string | null | undefined): number {
  if (unitDimension(unit) === "count") return Math.ceil(qty - 1e-9);
  return Math.round(qty * 100) / 100;
}
