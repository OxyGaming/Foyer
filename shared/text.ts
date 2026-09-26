/** Minuscules sans accents ni espaces superflus — pour comparer et rechercher. */
export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/\s+/g, " ")
    .trim();
}

export function matches(haystack: string | null | undefined, needle: string): boolean {
  const n = normalize(needle);
  return n.length > 0 && normalize(haystack).includes(n);
}

/**
 * Clé de rapprochement d'un nom de produit : insensible aux accents, à la casse,
 * au type d'apostrophe et au pluriel simple (« Tomates » = « tomate »,
 * « Huile d’olive » = « huile d'olive »).
 */
export function productKey(s: string | null | undefined): string {
  return normalize(s)
    .replace(/[’`´]/g, "'")
    .split(" ")
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");
}
