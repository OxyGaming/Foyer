// Texte d'un PDF, reconstitué en lignes et en colonnes, lu dans le navigateur
// (pdf.js) : la facture ne quitte pas l'appareil.

/** Une ligne visuelle du document : ses cellules de gauche à droite. */
export type PdfRow = string[];

type Item = { str: string; x: number; y: number; w: number; h: number };

/** Regroupe les morceaux de texte d'une page en lignes (même hauteur) puis en cellules (séparées par un blanc net). */
export function itemsToRows(items: Item[]): PdfRow[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, it.h * 0.45);
    if (last && Math.abs(last[0].y - it.y) <= tol) last.push(it);
    else lines.push([it]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let end = -Infinity;
    for (const it of line) {
      const gap = it.x - end;
      if (!cells.length || gap > Math.max(4, it.h * 0.9)) cells.push(it.str.trim());
      else cells[cells.length - 1] += (gap > it.h * 0.15 ? " " : "") + it.str.trim();
      end = it.x + it.w;
    }
    return cells.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
  }).filter((r) => r.length > 0);
}

export async function pdfRows(file: File): Promise<PdfRow[]> {
  // Chargé à la demande : pdf.js est lourd et ne sert qu'ici.
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const rows: PdfRow[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) || 8 });
    }
    rows.push(...itemsToRows(items));
  }
  await task.destroy();
  return rows;
}
