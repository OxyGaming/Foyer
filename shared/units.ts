// Unités : reconnaissance et conversion entre unités d'une même dimension.
// Les unités inconnues (« paquet », « c. à soupe »…) forment chacune leur
// propre dimension : on ne les additionne qu'entre elles.

type Unit = { dim: string; factor: number; label: string };

// Une seule écriture par unité : « Kg », « kilo », « kgs » → « kg » ;
// « cs », « càs », « cuillère à soupe » → « c. à soupe ». Les variantes sont
// comparées sans accents, points, espaces ni apostrophes, en minuscules.
// ⚠ La migration 20260927110000_unit_canonical reprend cette table.
const ALIASES: Record<string, string[]> = {
  "kg": ["kg", "kgs", "kilo", "kilos", "kilogramme", "kilogrammes", "kilogram", "kilograms"],
  "g": ["g", "gr", "grs", "gramme", "grammes", "gram", "grams"],
  "mg": ["mg", "milligramme", "milligrammes"],
  "L": ["l", "lt", "ltr", "litre", "litres", "liter"],
  "cl": ["cl", "centilitre", "centilitres"],
  "ml": ["ml", "millilitre", "millilitres"],
  "dl": ["dl", "decilitre", "decilitres"],
  "pièce": ["piece", "pieces", "pc", "pcs", "unite", "unites"],
  "c. à soupe": ["cs", "cas", "casoupe", "cuilasoupe", "cuillereasoupe", "cuilleresasoupe", "cuillerasoupe", "cuillersasoupe"],
  "c. à café": ["cc", "cac", "cacafe", "cuilacafe", "cuillereacafe", "cuilleresacafe", "cuilleracafe", "cuillersacafe"],
  "pincée": ["pincee", "pincees"],
};
const compact = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.\s'’]/g, "");
const CANONICAL = new Map(Object.entries(ALIASES).flatMap(([canon, variants]) => variants.map((v) => [v, canon] as const)));

/** Écriture unique d'une unité ; une unité inconnue (« gousse ») est gardée telle quelle. Vide → null. */
export function canonicalUnit(unit: string | null | undefined): string | null {
  const t = (unit ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  return CANONICAL.get(compact(t)) ?? t;
}

const KNOWN: Record<string, Unit> = {
  mg: { dim: "mass", factor: 0.001, label: "mg" },
  g: { dim: "mass", factor: 1, label: "g" },
  kg: { dim: "mass", factor: 1000, label: "kg" },
  ml: { dim: "volume", factor: 1, label: "ml" },
  cl: { dim: "volume", factor: 10, label: "cl" },
  dl: { dim: "volume", factor: 100, label: "dl" },
  L: { dim: "volume", factor: 1000, label: "L" },
  pièce: { dim: "count", factor: 1, label: "" },
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
  const c = canonicalUnit(unit);
  if (!c) return KNOWN.pièce;
  return KNOWN[c] ?? { dim: `other:${key(c)}`, factor: 1, label: c };
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

const FAMILY: Record<string, string[]> = { mass: ["g", "kg"], volume: ["ml", "cl", "L"], count: ["pièce"] };
const PURCHASE_UNITS = ["pièce", "g", "kg", "ml", "cl", "L", "paquet", "boîte", "bouteille", "brique", "sachet", "pot", "barquette"];

/**
 * Unités proposées pour saisir un achat d'un produit compté en `unit`. Stock déjà
 * chiffré (`locked`) : seulement celles convertibles (g ↔ kg) ; sinon un choix large,
 * le produit adoptera l'unité de l'achat.
 */
export function purchaseUnitChoices(unit: string | null | undefined, locked: boolean): string[] {
  const own = canonicalUnit(unit) ?? "pièce";
  const family = FAMILY[unitDimension(own)];
  if (locked) return family ?? [own];
  return [...new Set([...(family ?? [own]), ...PURCHASE_UNITS])];
}

/** Arrondi d'affichage/achat : à l'unité supérieure pour les pièces, au centième sinon. */
export function roundForPurchase(qty: number, unit: string | null | undefined): number {
  if (unitDimension(unit) === "count") return Math.ceil(qty - 1e-9);
  return Math.round(qty * 100) / 100;
}
