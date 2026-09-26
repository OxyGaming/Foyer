import { parseNum } from "./format";
import type { Ingredient } from "./types";

// Unités reconnues en tête de ligne (« 500 ml de lait », « 2 c. à soupe d'huile »).
const UNITS = [
  "c. à soupe", "c. à café", "cuillères à soupe", "cuillères à café", "cuillère à soupe", "cuillère à café", "cs", "cc", "càs", "càc",
  "kg", "g", "mg", "l", "cl", "ml", "dl",
  "pincées", "pincée", "sachets", "sachet", "boîtes", "boîte", "pots", "pot", "tranches", "tranche", "gousses", "gousse",
  "pièces", "pièce", "paquets", "paquet", "bouteilles", "bouteille", "verres", "verre", "tasses", "tasse", "brins", "brin",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unitRe = new RegExp(`^(${UNITS.map(escapeRe).join("|")})(?=\\s|$)\\s*`, "i");

/**
 * Transforme une ligne libre en ingrédient. Tout ce qui n'est pas reconnu
 * reste dans le nom : « Sel » → { name: "Sel" }.
 */
export function parseIngredientLine(line: string): Omit<Ingredient, "id"> | null {
  let rest = line.replace(/^[-•*\s]+/, "").trim();
  if (!rest) return null;
  let quantity: number | null = null;
  let unit: string | null = null;

  const num = rest.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+|½|¼|¾)\s*/);
  if (num) {
    const raw = num[1];
    quantity = raw === "½" ? 0.5 : raw === "¼" ? 0.25 : raw === "¾" ? 0.75 : raw.includes("/") ? Number(raw.split("/")[0]) / Number(raw.split("/")[1]) : parseNum(raw);
    rest = rest.slice(num[0].length);
    const u = rest.match(unitRe);
    if (u) {
      unit = u[1].toLowerCase() === "l" ? "L" : u[1];
      rest = rest.slice(u[0].length);
    }
    rest = rest.replace(/^(de |d'|d’)/i, "");
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
  return { name: name.charAt(0).toUpperCase() + name.slice(1), productId: null, quantity, unit, note: null };
}
