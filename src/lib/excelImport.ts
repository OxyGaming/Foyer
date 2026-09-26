import { normalize } from "../../shared/text";
import { parseNum } from "./format";
import { parseIngredientLine } from "./ingredients";
import { type ImportedRecipe, type ParsedImport, markDuplicates } from "./recipeImport";

// Import depuis un classeur Excel : pas de devinette, chaque information a sa colonne.
//
//   Onglet « Recettes »    : Recette | Portions | Préparation (min) | Cuisson (min) | Tags | Description | Étapes | Notes
//   Onglet « Ingrédients » : Recette | Ingrédient | Quantité | Unité | Note
//
// Les onglets et colonnes sont reconnus par leur en-tête (peu importe l'ordre,
// les accents ou les colonnes en plus). Une recette qui n'apparaît que dans
// « Ingrédients » est créée quand même. Dans « Ingrédients », une cellule
// Recette vide reprend la recette de la ligne du dessus.

export type SheetInput = { sheet: string; data: unknown[][] };

type Field =
  | "servings" | "prep" | "cook" | "quantity" | "unit" | "ingredient"
  | "note" | "tags" | "description" | "steps" | "recipe";

// L'ordre compte : « Nombre de portions » contient « nom », d'où « portion » testé avant « recette/nom ».
const ALIASES: [Field, string[]][] = [
  ["servings", ["portion", "personne", "pers"]],
  ["prep", ["preparation", "prep"]],
  ["cook", ["cuisson"]],
  ["quantity", ["quantite", "qte", "qty"]],
  ["unit", ["unite"]],
  ["ingredient", ["ingredient", "produit"]],
  ["note", ["note", "remarque", "precision"]],
  ["tags", ["tag", "categorie", "etiquette"]],
  ["description", ["description"]],
  ["steps", ["etape", "instruction", "deroule"]],
  ["recipe", ["recette", "plat", "nom"]],
];

type Columns = Partial<Record<Exclude<Field, "steps">, number>> & { steps: number[] };

const text = (c: unknown): string => (typeof c === "string" ? c.trim() : typeof c === "number" ? String(c) : "");
const num = (c: unknown): number | null => (typeof c === "number" ? c : parseNum(text(c)));
const firstNumber = (c: unknown): number | null => (typeof c === "number" ? c : parseNum(text(c).match(/\d+(?:[.,]\d+)?/)?.[0] ?? ""));
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « 45 », « 45 min », « 1 h 30 », « 1h » → minutes. */
function minutes(c: unknown): number | null {
  if (typeof c === "number") return Math.round(c);
  const t = normalize(text(c));
  const h = t.match(/(\d+)\s*h\s*(\d+)?/);
  if (h) return Number(h[1]) * 60 + Number(h[2] ?? 0);
  const n = firstNumber(t);
  return n == null ? null : Math.round(n);
}

function readColumns(row: unknown[]): Columns {
  const cols: Columns = { steps: [] };
  row.forEach((cell, i) => {
    const h = normalize(text(cell));
    if (!h) return;
    const field = ALIASES.find(([, words]) => words.some((w) => h.includes(w)))?.[0];
    if (!field) return;
    if (field === "steps") cols.steps.push(i);
    else if (cols[field] == null) cols[field] = i;
  });
  return cols;
}

/**
 * Ligne d'en-tête : la première (parmi les 10 premières) qui nomme au moins deux
 * colonnes connues, dont Recette ou Ingrédient. Un titre au-dessus du tableau
 * (« Mes recettes ») n'est donc pas pris pour un en-tête. À défaut, une colonne
 * « Recette » seule suffit (simple liste de noms).
 */
function findHeader(data: unknown[][]): { index: number; cols: Columns } | null {
  const rows = data.slice(0, 10).map((row) => readColumns(row ?? []));
  const known = (c: Columns) => Object.keys(c).filter((k) => k !== "steps").length + (c.steps.length ? 1 : 0);
  let index = rows.findIndex((c) => (c.recipe != null || c.ingredient != null) && known(c) >= 2);
  if (index < 0) index = rows.findIndex((c, i) => c.recipe != null && text(data[i][c.recipe]).length <= 30);
  return index < 0 ? null : { index, cols: rows[index] };
}

const rangeRe = /^(\d+(?:[.,]\d+)?)\s*(?:-|–|à)\s*(\d+(?:[.,]\d+)?)$/;

export function parseRecipeSheets(sheets: SheetInput[], existingNames: string[] = []): ParsedImport {
  const recipes: ImportedRecipe[] = [];
  const ignored: string[] = [];
  const byName = new Map<string, ImportedRecipe>();
  const recipe = (name: string) => {
    const k = normalize(name);
    let r = byName.get(k);
    if (!r) {
      r = { key: `x${recipes.length}`, name, ingredients: [], steps: [], notes: [], duplicateOf: null };
      byName.set(k, r);
      recipes.push(r);
    }
    return r;
  };

  const found = sheets
    .filter((s) => normalize(s.sheet) !== "aide")
    .map((s) => ({ ...s, header: findHeader(s.data) }))
    .filter((s) => s.header);
  const recipeSheets = found.filter((s) => s.header!.cols.ingredient == null);
  const ingredientSheets = found.filter((s) => s.header!.cols.ingredient != null);
  if (!found.length) {
    return { recipes, ignored: ["Aucun onglet avec une colonne « Recette » ou « Ingrédient » : utilisez le modèle."] };
  }

  // D'abord les fiches recettes (ordre du classeur), puis leurs ingrédients.
  for (const s of recipeSheets) {
    const { index, cols } = s.header!;
    s.data.slice(index + 1).forEach((row, n) => {
      const name = text(row[cols.recipe ?? -1]);
      if (!name) {
        if (row.some((c) => text(c))) ignored.push(`${s.sheet}, ligne ${index + n + 2} : pas de nom de recette`);
        return;
      }
      const r = recipe(name);
      const tags = text(row[cols.tags ?? -1]).split(/[,;]/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
      r.extra = {
        servings: firstNumber(row[cols.servings ?? -1]),
        prepMinutes: minutes(row[cols.prep ?? -1]),
        cookMinutes: minutes(row[cols.cook ?? -1]),
        description: text(row[cols.description ?? -1]) || null,
        ...(tags.length ? { tags } : {}),
      };
      for (const i of cols.steps) {
        r.steps.push(
          ...text(row[i])
            .split(/\n/)
            .map((l) => l.replace(/^\s*(?:\d{1,2}\s*[.)-]|[-*•])\s*/, "").trim())
            .filter(Boolean),
        );
      }
      const note = text(row[cols.note ?? -1]);
      if (note) r.notes.push(note);
    });
  }

  for (const s of ingredientSheets) {
    const { index, cols } = s.header!;
    let last = "";
    s.data.slice(index + 1).forEach((row, n) => {
      const line = index + n + 2;
      const name = text(row[cols.recipe ?? -1]) || last;
      const label = text(row[cols.ingredient ?? -1]);
      const rawQty = row[cols.quantity ?? -1];
      const unit = text(row[cols.unit ?? -1]) || null;
      const notes = [text(row[cols.note ?? -1])].filter(Boolean);
      if (!label && !text(rawQty)) return;
      if (!name) return void ignored.push(`${s.sheet}, ligne ${line} : recette non indiquée pour « ${label} »`);
      last = name;

      // Tout écrit dans la colonne Ingrédient (« 200 g lardons ») : on le découpe comme un texte.
      if (!text(rawQty) && !unit && /^\d/.test(label)) {
        const parsed = parseIngredientLine(label);
        if (parsed) {
          const note = [parsed.note, ...notes].filter(Boolean).join(", ") || null;
          recipe(name).ingredients.push({ ...parsed, note });
          return;
        }
      }
      let quantity = num(rawQty);
      const range = text(rawQty).match(rangeRe);
      if (range) {
        quantity = Math.max(parseNum(range[1]) ?? 0, parseNum(range[2]) ?? 0);
        notes.unshift(`${range[1]} à ${range[2]}`);
      } else if (quantity == null && text(rawQty)) {
        notes.unshift(text(rawQty)); // « quelques », « 1 poignée »…
      }
      recipe(name).ingredients.push({ name: capitalize(label), productId: null, quantity, unit, note: notes.join(", ") || null });
    });
  }

  markDuplicates(recipes, existingNames);
  return { recipes, ignored };
}
