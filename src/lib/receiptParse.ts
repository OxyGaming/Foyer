// Lecture d'une facture de drive (texte du PDF déjà découpé en lignes et
// cellules) : magasin, date, articles avec quantité et prix payé. Les formats
// varient d'une enseigne à l'autre : on reste tolérant, l'écran de relecture
// permet de corriger.
import { normalize, productKey } from "../../shared/text";
import { canonicalUnit } from "../../shared/units";
import type { PdfRow } from "./pdfText";

export type ReceiptLine = {
  /** Libellé tel qu'imprimé (sert aussi à reconnaître l'article la fois suivante). */
  label: string;
  /** Nombre d'articles. */
  count: number;
  /** Quantité totale achetée, avec son unité (6 × 1 L → 6 L ; 0,512 kg). */
  quantity: number;
  unit: string;
  totalCents: number | null;
  isPromo: boolean;
};

export type ParsedReceipt = { store: string | null; date: string | null; totalCents: number | null; lines: ReceiptLine[] };

const STORES: [string, RegExp][] = [
  ["E.Leclerc", /leclerc/],
  ["Carrefour", /carrefour/],
  ["Auchan", /auchan/],
  ["Intermarché", /intermarche/],
  ["Super U", /(super u|hyper u|systeme u|coursesu|magasins u\b)/],
  ["Chronodrive", /chronodrive/],
  ["Monoprix", /monoprix/],
  ["Casino", /\bcasino\b/],
  ["Franprix", /franprix/],
  ["Lidl", /\blidl\b/],
  ["Aldi", /\baldi\b/],
  ["Cora", /\bcora\b/],
  ["Netto", /\bnetto\b/],
  ["Match", /supermarches match/],
  ["Picard", /\bpicard\b/],
  ["Grand Frais", /grand frais/],
];

const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

// Lignes qui ne sont pas des articles : totaux, taxes, paiement, livraison, en-têtes…
const SKIP = /(sous[- ]?total|\btotal\b|\btva\b|\btaux\b|\bht\b|net a payer|a payer|reglement|paiement|carte bancaire|\bcb\b|visa|mastercard|rendu|monnaie|frais de|livraison|retrait|preparation|commande n|facture n|n° de|client|siret|tel\b|telephone|adresse|page \d|cagnotte|fidelite|points?\b|solde|economies? realisees|nombre d.articles)/;
const DISCOUNT = /(remise|reduction|\breduc|promo|coupon|bon d.achat|offre|avantage|immediate|\blot\b.*-|-\d+ ?%)/;

const MONEY_CELL = /^(-?)\s?(\d{1,5})[,.](\d{2})\s?(€|eur)?$/i;
const moneyOf = (cell: string): number | null => {
  const m = cell.replace(/\s/g, " ").trim().replace(/^€\s?/, "").match(MONEY_CELL);
  return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3])) : null;
};
const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

/** Taille d'un article lue dans son libellé : « 6X1L » → 6 L, « 500G » → 500 g, « X12 » → 12 pièces. */
export function parseSize(label: string): { quantity: number; unit: string } | null {
  const s = label.toLowerCase().replace(/,/g, ".");
  let m = s.match(/(\d+)\s?x\s?(\d+(?:\.\d+)?)\s?(kg|g|cl|ml|l)\b/);
  if (m) return { quantity: Number(m[1]) * Number(m[2]), unit: canonicalUnit(m[3])! };
  m = s.match(/(\d+(?:\.\d+)?)\s?(kg|g|cl|ml|l)\b/);
  if (m) return { quantity: Number(m[1]), unit: canonicalUnit(m[2])! };
  m = s.match(/(?:\bx\s?(\d+)\b|\b(\d+)\s?(?:pcs|pieces?|unites?|oeufs?|rouleaux)\b)/);
  if (m) return { quantity: Number(m[1] ?? m[2]), unit: "pièce" };
  return null;
}

function findDate(rows: string[]): string | null {
  const iso = (d: number, mo: number, y: number) => {
    const year = y < 100 ? 2000 + y : y;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const inRow = (r: string) => {
    let m = r.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
    if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
    m = normalize(r).match(/\b(\d{1,2})(?:er)? (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre) (\d{4})\b/);
    if (m) return iso(Number(m[1]), MONTHS.indexOf(m[2]) + 1, Number(m[3]));
    return null;
  };
  // D'abord les lignes qui parlent de la commande ou de la facture.
  for (const r of rows) if (/(commande|facture|livr|retrait|date)/.test(normalize(r))) {
    const d = inRow(r);
    if (d) return d;
  }
  for (const r of rows) {
    const d = inRow(r);
    if (d) return d;
  }
  return null;
}

export function parseReceipt(rows: PdfRow[]): ParsedReceipt {
  const flat = rows.map((r) => r.join(" "));
  const all = normalize(flat.join("\n"));
  const store = STORES.find(([, re]) => re.test(all))?.[0] ?? null;
  const date = findDate(flat);

  const lines: ReceiptLine[] = [];
  let totalCents: number | null = null;
  let pending: string | null = null;

  for (const cells of rows) {
    const text = cells.join(" ");
    const norm = normalize(text);
    const amounts = cells.map(moneyOf).filter((v): v is number => v != null);

    // Totaux : on garde le plus grand montant annoncé comme total.
    if (/(total|net a payer|montant)/.test(norm) && amounts.length) {
      const t = Math.max(...amounts.map(Math.abs));
      totalCents = Math.max(totalCents ?? 0, t);
      pending = null;
      continue;
    }

    const labelCells = cells.filter((c) => moneyOf(c) == null && letters(c) >= 3 && !/€\s?\/\s?(kg|l)/i.test(c));
    let label = labelCells.join(" ").trim();

    if (!amounts.length) {
      // Libellé sur sa propre ligne, montants à la suivante ; sinon rayon, en-tête…
      pending = label && !SKIP.test(norm) ? label : null;
      continue;
    }

    // Remise : s'impute à l'article précédent.
    if (lines.length && (DISCOUNT.test(normalize(label)) || (!label && amounts[amounts.length - 1] < 0)) && amounts[amounts.length - 1] < 0) {
      const prev = lines[lines.length - 1];
      prev.totalCents = Math.max(0, (prev.totalCents ?? 0) + amounts[amounts.length - 1]);
      prev.isPromo = true;
      pending = null;
      continue;
    }

    if (!label && pending) label = pending;
    pending = null;
    if (!label || SKIP.test(normalize(label))) continue;

    const total = amounts[amounts.length - 1];
    if (total < 0) continue;
    // Quantité : prix unitaire × quantité = total quand les deux prix figurent
    // (plus sûr qu'un chiffre isolé, qui peut être un code TVA) ; sinon cellule « 2 », « x2 », « 2 x ».
    let count: number | null = null;
    if (amounts.length >= 2 && amounts[0] > 0) {
      const k = total / amounts[0];
      if (Math.abs(k - Math.round(k)) < 0.01 && Math.round(k) >= 1 && Math.round(k) <= 99) count = Math.round(k);
    }
    if (count == null) {
      for (const c of cells) {
        const m = c.trim().match(/^(?:x\s?(\d{1,3})|(\d{1,3})\s?x?|qt[ée]\s?:?\s?(\d{1,3}))$/i);
        if (m) {
          count = Number(m[1] ?? m[2] ?? m[3]);
          break;
        }
      }
    }
    count = count && count > 0 ? count : 1;

    // Article pesé : « 0,512 kg » (souvent avec un prix au kilo).
    const weight = text.toLowerCase().replace(/,/g, ".").match(/(\d+\.\d+)\s?kg\b/);
    const size = parseSize(label);
    let quantity = count;
    let unit = "pièce";
    if (weight && /€\s?\/\s?kg|\/kg|prix au kg/i.test(text)) {
      quantity = Number(weight[1]);
      unit = "kg";
    } else if (size) {
      quantity = Math.round(count * size.quantity * 1000) / 1000;
      unit = size.unit;
    }
    lines.push({ label: label.replace(/\s+/g, " "), count, quantity, unit, totalCents: total, isPromo: false });
  }
  return { store, date, totalCents, lines };
}

/** Nom de produit proposé à partir d'un libellé : sans tailles ni chiffres, en minuscules. « CREME FR.EP 30% 20CL » → « Creme fr.ep ». */
export function suggestName(label: string): string {
  const s = label
    .replace(/\d+\s?x\s?\d+([,.]\d+)?\s?(kg|g|cl|ml|l)\b/gi, "")
    .replace(/\d+([,.]\d+)?\s?(kg|g|cl|ml|l|%)(?=\s|$)/gi, "")
    .replace(/\bx\s?\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : label;
}

const STOP = new Set(["les", "des", "pour", "avec", "aux", "sans", "uht", "the"]);
const tokens = (s: string) =>
  productKey(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/\d/.test(t) && !STOP.has(t));

/**
 * Produit le plus probable pour un libellé : déjà associé lors d'une facture
 * précédente, sinon celui dont les mots du nom se retrouvent dans le libellé
 * (abréviations comprises : « ECR » → « écrémé »).
 */
export function matchProduct<P extends { id: string; name: string }>(label: string, products: P[], learned: Map<string, string>): { productId: string | null; how: "learned" | "name" | null } {
  const known = learned.get(normalize(label).slice(0, 200));
  if (known && products.some((p) => p.id === known)) return { productId: known, how: "learned" };
  const words = tokens(label);
  let best: { id: string; hit: number; score: number } | null = null;
  for (const p of products) {
    const own = tokens(p.name);
    if (!own.length) continue;
    const hit = own.filter((t) => words.some((w) => w === t || t.startsWith(w) || (w.length >= 4 && w.startsWith(t)))).length;
    const score = hit / own.length;
    if (!hit || score < 0.6) continue;
    if (!best || hit > best.hit || (hit === best.hit && score > best.score)) best = { id: p.id, hit, score };
  }
  return best ? { productId: best.id, how: "name" } : { productId: null, how: null };
}
