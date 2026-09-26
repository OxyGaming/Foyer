import { normalize } from "../../shared/text";
import { parseIngredientLines } from "./ingredients";
import type { Ingredient, RecipeInput } from "./types";

// Import de recettes depuis un texte libre (liste de courses, notes du téléphone,
// page copiée…). Formats reconnus, mélangeables :
//
//   ☐ Crumble de potimarron        ← titre (case à cocher, « # Titre », ou ligne suivie d'une liste)
//   * 1 potimarron (~1 kg)         ← ingrédient (puce)
//   Préparation :                  ← les lignes suivantes deviennent des étapes
//   1. Éplucher le potimarron      ← étape (numérotée)
//
// Une ligne seule qui n'annonce aucune liste (« Semaine 9/10 ») est ignorée
// dès que le texte contient des titres explicites ; sinon chaque ligne est une
// recette sans ingrédient (« Tartiflette » seul reste une recette valide).

export type ImportedRecipe = {
  key: string;
  name: string;
  ingredients: Omit<Ingredient, "id">[];
  steps: string[];
  notes: string[];
  /** Champs lus dans un tableur (portions, temps, tags…). */
  extra?: Pick<RecipeInput, "description" | "servings" | "prepMinutes" | "cookMinutes" | "tags">;
  /** Nom de la recette dont celle-ci semble être un doublon (dans le texte ou déjà enregistrée). */
  duplicateOf: { name: string; existing: boolean } | null;
};

export type ParsedImport = { recipes: ImportedRecipe[]; ignored: string[] };

const BOX = String.raw`(?:[☐☑☒□■✓✔✅🔲⬜]️?|\[[ xX]?\])`;
// Case seule en début de ligne (« ☐ Crumble ») = titre ; après une puce (« * ☐ 1 oignon ») = élément de liste.
const CHECKBOX = new RegExp(String.raw`^\s*${BOX}\s*`, "u");
const HEADING = /^\s*#{1,6}\s+/;
const BULLET = new RegExp(String.raw`^\s*[-*•·◦▪]\s*(?:${BOX}\s*)?`, "u");
const NUMBERED = /^\s*(?:\d{1,2}\s*[.)]|[ée]tape\s*\d+\s*[:.)-]?)\s+/i;
const LABEL = /^\s*(ingr[ée]dients?|pr[ée]paration|[ée]tapes?|instructions?|d[ée]roul[ée])\s*:?\s*$/i;

type Kind = "blank" | "title" | "label" | "bullet" | "step" | "plain";

function classify(line: string): Kind {
  if (!line.trim()) return "blank";
  if (CHECKBOX.test(line) || HEADING.test(line)) return "title";
  if (LABEL.test(line)) return "label";
  if (NUMBERED.test(line)) return "step";
  if (BULLET.test(line)) return "bullet";
  return "plain";
}

const STOP = new Set(["de", "du", "des", "la", "le", "les", "et", "a", "au", "aux", "d", "l", "en", "avec"]);

/** Clé de doublon : mêmes mots, dans n'importe quel ordre (« Patate douce – noix – roquefort » = « … roquefort – noix »). */
export function recipeKey(name: string): string {
  const words = normalize(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w));
  return [...new Set(words)].sort().join(" ");
}

/** Une puce qui est une phrase (« Déjà prévu dans le curry ci-dessus. ») est une remarque, pas un ingrédient. */
const isRemark = (text: string) => !/\d/.test(text) && /[.!]$/.test(text.trim()) && text.trim().split(/\s+/).length >= 4;

const cleanTitle = (line: string) =>
  line.replace(CHECKBOX, "").replace(HEADING, "").replace(/\s*:\s*$/, "").replace(/\s+/g, " ").trim();

export function parseRecipeText(text: string, existingNames: string[] = []): ParsedImport {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kinds = lines.map(classify);
  const explicitTitles = kinds.includes("title");
  const nextKind = (i: number) => {
    for (let j = i + 1; j < lines.length; j++) if (kinds[j] !== "blank") return kinds[j];
    return null;
  };

  const recipes: ImportedRecipe[] = [];
  const ignored: string[] = [];
  let current: ImportedRecipe | null = null;
  let mode: "ingredients" | "steps" = "ingredients";
  // Vrai après « Ingrédients : » ou « Préparation : » : les lignes sans puce appartiennent alors à la recette.
  let labelled = false;

  const start = (name: string) => {
    current = { key: `r${recipes.length}`, name, ingredients: [], steps: [], notes: [], duplicateOf: null };
    recipes.push(current);
    mode = "ingredients";
    labelled = false;
  };
  const addItem = (text: string, as: "ingredients" | "steps") => {
    const r = current as ImportedRecipe | null;
    if (!r) return void ignored.push(text.trim());
    const item = text.replace(BULLET, "").replace(CHECKBOX, "").trim();
    if (as === "steps") r.steps.push(item.replace(NUMBERED, "").trim());
    else if (isRemark(item)) r.notes.push(item);
    else r.ingredients.push(...parseIngredientLines(item));
  };

  lines.forEach((line, i) => {
    const kind = kinds[i];
    const next = nextKind(i);
    const announcesList = next === "bullet" || next === "step" || next === "label";
    switch (kind) {
      case "blank":
        return;
      case "title":
        return start(cleanTitle(line));
      case "label":
        mode = /ingr/i.test(line) ? "ingredients" : "steps";
        labelled = true;
        return;
      case "step":
        return addItem(line, "steps");
      case "bullet":
        return addItem(line, mode);
      case "plain": {
        const t = line.trim();
        // Sous-titre de liste (« Pour la pâte : ») : on l'ignore sans couper la recette.
        if (current && /:\s*$/.test(t)) return;
        if (announcesList && !/:\s*$/.test(t)) return start(cleanTitle(line));
        if (current && labelled) return addItem(line, mode);
        if (explicitTitles) return void ignored.push(t);
        return start(cleanTitle(line));
      }
    }
  });

  markDuplicates(recipes, existingNames);
  return { recipes: recipes.filter((r) => r.name || r.ingredients.length), ignored };
}

/** Renseigne duplicateOf : recette déjà enregistrée, ou déjà vue plus haut dans l'import. */
export function markDuplicates(recipes: ImportedRecipe[], existingNames: string[]) {
  const seen = new Map<string, string>();
  const existing = new Map(existingNames.map((n) => [recipeKey(n), n]));
  for (const r of recipes) {
    const k = recipeKey(r.name);
    if (!k) continue;
    const before = existing.get(k);
    if (before) r.duplicateOf = { name: before, existing: true };
    else if (seen.has(k)) r.duplicateOf = { name: seen.get(k)!, existing: false };
    else seen.set(k, r.name);
  }
}
