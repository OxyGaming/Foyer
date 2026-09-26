import { parseNum } from "./format";
import type { Ingredient } from "./types";

// Unités reconnues en tête de ligne (« 500 ml de lait », « 2 c. à soupe d'huile »).
const UNITS = [
  "c. à soupe", "c. à café", "cuillères à soupe", "cuillères à café", "cuillère à soupe", "cuillère à café", "cs", "cc", "càs", "càc",
  "kg", "g", "mg", "l", "cl", "ml", "dl",
  "pincées", "pincée", "sachets", "sachet", "boîtes", "boîte", "pots", "pot", "tranches", "tranche", "gousses", "gousse",
  "pièces", "pièce", "paquets", "paquet", "bouteilles", "bouteille", "verres", "verre", "tasses", "tasse", "brins", "brin",
  "morceaux", "morceau", "briques", "brique", "bocaux", "bocal", "feuilles", "feuille", "bottes", "botte", "poignées", "poignée",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unitRe = new RegExp(`^(${UNITS.map(escapeRe).join("|")})(?=\\s|$)\\s*`, "i");
// « 5-6 tomates », « 2 à 3 oignons » : on retient le haut de la fourchette (plus sûr pour les courses).
const rangeRe = /^(\d+(?:[.,]\d+)?)\s*(?:-|–|à)\s*(\d+(?:[.,]\d+)?)\s+/;
const numRe = /^(\d+(?:[.,]\d+)?|\d+\/\d+|½|¼|¾)\s*/;
// Taille indiquée devant le nom : gardée en note pour que « 1 grosse courge » rejoigne le produit « Courge ».
const sizeRe = /^(gros|grosse|grosses|petit|petite|petits|petites|beau|belle|beaux|belles)\s+/i;

function readNum(raw: string): number | null {
  if (raw === "½") return 0.5;
  if (raw === "¼") return 0.25;
  if (raw === "¾") return 0.75;
  if (raw.includes("/")) {
    const [a, b] = raw.split("/").map(Number);
    return b ? a / b : null;
  }
  return parseNum(raw);
}

/**
 * Transforme une ligne libre en ingrédient. Tout ce qui n'est pas reconnu
 * reste dans le nom : « Sel » → { name: "Sel" }. Les parenthèses deviennent
 * une note : « 10 cl vin blanc (facultatif) ».
 */
export function parseIngredientLine(line: string): Omit<Ingredient, "id"> | null {
  let rest = line.replace(/^[-•*·◦▪\s]+/, "").trim();
  if (!rest) return null;
  const notes: string[] = [];
  rest = rest
    .replace(/\s*\(([^)]*)\)/g, (_, n: string) => {
      if (n.trim()) notes.push(n.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  let quantity: number | null = null;
  let unit: string | null = null;

  const range = rest.match(rangeRe);
  const num = range ?? rest.match(numRe);
  if (num) {
    if (range) {
      quantity = Math.max(parseNum(range[1]) ?? 0, parseNum(range[2]) ?? 0);
      notes.unshift(`${range[1]} à ${range[2]}`);
    } else {
      quantity = readNum(num[1]);
    }
    rest = rest.slice(num[0].length);
    const u = rest.match(unitRe);
    if (u) {
      unit = u[1].toLowerCase() === "l" ? "L" : u[1];
      rest = rest.slice(u[0].length);
    }
    rest = rest.replace(/^(de |d'|d’)/i, "");
    const size = rest.match(sizeRe);
    if (size && rest.length > size[0].length) {
      notes.unshift(size[1].toLowerCase());
      rest = rest.slice(size[0].length);
    }
  }
  // « Farine — 250 g » / « Farine : 250 g »
  const tail = !num && rest.match(/^(.*?)\s*[—–:-]\s*(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (tail) {
    rest = tail[1];
    quantity = parseNum(tail[2]);
    unit = tail[3].trim() || null;
  }
  const name = rest.trim();
  if (!name && quantity == null) return null;
  return { name: name.charAt(0).toUpperCase() + name.slice(1), productId: null, quantity, unit, note: notes.join(", ") || null };
}

/**
 * Comme parseIngredientLine, mais « Sel, poivre, muscade » (sans quantité)
 * donne trois ingrédients, pour que chacun soit relié à son produit.
 */
export function parseIngredientLines(line: string): Omit<Ingredient, "id">[] {
  const clean = line.replace(/^[-•*·◦▪\s]+/, "");
  const parts = !/\d/.test(clean) && !clean.includes("(") && clean.includes(",") ? clean.split(",") : [clean];
  return parts.map(parseIngredientLine).filter((x) => x !== null);
}
