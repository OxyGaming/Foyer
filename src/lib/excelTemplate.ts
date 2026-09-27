import type { Cell, Row, Sheet } from "write-excel-file/browser";

// Classeur au format attendu par parseRecipeSheets : sert de modèle vierge
// (avec deux exemples) et à produire un fichier déjà rempli.

export type WorkbookRecipe = {
  name: string;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  tags?: string[];
  description?: string | null;
  steps?: string[];
  notes?: string[];
  ingredients: { name: string; quantity: number | null; unit: string | null; note: string | null }[];
};

export const RECIPE_HEADERS = ["Recette", "Portions", "Préparation (min)", "Cuisson (min)", "Tags", "Description", "Étapes (une par ligne)", "Notes"];
export const INGREDIENT_HEADERS = ["Recette", "Ingrédient", "Quantité", "Unité", "Note"];

const head = (labels: string[]): Row =>
  labels.map((value) => ({ value, fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: "#3F7A5A", alignVertical: "center", height: 22 }) as Cell);

const cell = (v: string | number | null | undefined, wrap = false): Cell =>
  v == null || v === "" ? null : { value: v, ...(wrap ? { wrap: true, alignVertical: "top" } : { alignVertical: "top" }) };

export const EXAMPLE_RECIPES: WorkbookRecipe[] = [
  {
    name: "Quiche Lorraine",
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 35,
    tags: ["Tarte"],
    steps: ["Préchauffer le four à 180 °C.", "Étaler la pâte, répartir les lardons.", "Battre œufs, crème et lait, verser, cuire 35 min."],
    ingredients: [
      { name: "Pâte brisée", quantity: 1, unit: null, note: null },
      { name: "Lardons", quantity: 200, unit: "g", note: null },
      { name: "Œufs", quantity: 3, unit: null, note: null },
      { name: "Crème fraîche", quantity: 20, unit: "cl", note: null },
      { name: "Muscade", quantity: 1, unit: "pincée", note: "facultatif" },
    ],
  },
  {
    name: "Salade lentilles – thon",
    servings: 4,
    ingredients: [
      { name: "Lentilles vertes", quantity: 300, unit: "g", note: null },
      { name: "Thon", quantity: 2, unit: "boîte", note: null },
      { name: "Sel", quantity: null, unit: null, note: null },
    ],
  },
];

const HELP = [
  "Comment remplir ce fichier",
  "",
  "Onglet « Recettes » : une ligne par recette. Seul le nom est utile, le reste est facultatif.",
  "  • Étapes : une étape par ligne dans la même cellule (Alt + Entrée dans Excel).",
  "  • Tags : séparés par des virgules.",
  "Onglet « Ingrédients » : une ligne par ingrédient, avec le nom exact de la recette dans la colonne Recette.",
  "  • Laisser Recette vide reprend la recette de la ligne du dessus.",
  "  • Quantité : un nombre (1,5 accepté). « 5-6 » donne 6 avec la note « 5 à 6 ».",
  "  • Unité : g, kg, ml, cl, L, c. à soupe, c. à café, pincée, boîte, gousse, tranche… ou vide pour des pièces.",
  "  • Une recette présente seulement dans cet onglet est créée quand même.",
  "",
  "Remplacez les deux recettes d'exemple par les vôtres, puis importez le fichier dans Foyer : Recettes → Importer.",
  "Un aperçu s'affiche avant tout enregistrement ; les recettes déjà présentes sont signalées.",
];

export function recipeWorkbook(recipes: WorkbookRecipe[] = EXAMPLE_RECIPES): Sheet<never>[] {
  const recipeRows: Row[] = recipes.map((r) => [
    cell(r.name),
    cell(r.servings),
    cell(r.prepMinutes),
    cell(r.cookMinutes),
    cell(r.tags?.join(", ")),
    cell(r.description, true),
    cell(r.steps?.join("\n"), true),
    cell(r.notes?.join("\n"), true),
  ]);
  const ingredientRows: Row[] = recipes.flatMap((r) =>
    r.ingredients.map((i) => [cell(r.name), cell(i.name), cell(i.quantity), cell(i.unit), cell(i.note)]),
  );
  return [
    {
      sheet: "Recettes",
      data: [head(RECIPE_HEADERS), ...recipeRows],
      columns: [{ width: 38 }, { width: 10 }, { width: 17 }, { width: 14 }, { width: 18 }, { width: 30 }, { width: 60 }, { width: 30 }],
      stickyRowsCount: 1,
    },
    {
      sheet: "Ingrédients",
      data: [head(INGREDIENT_HEADERS), ...ingredientRows],
      columns: [{ width: 38 }, { width: 30 }, { width: 11 }, { width: 13 }, { width: 24 }],
      stickyRowsCount: 1,
    },
    {
      sheet: "Aide",
      data: HELP.map((line, i) => [i === 0 ? { value: line, fontWeight: "bold", fontSize: 14 } : cell(line)]),
      columns: [{ width: 110 }],
      showGridLines: false,
    },
  ];
}
