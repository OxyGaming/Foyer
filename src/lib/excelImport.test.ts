import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseRecipeSheets } from "./excelImport";
import { EXAMPLE_RECIPES, recipeWorkbook } from "./excelTemplate";

describe("parseRecipeSheets", () => {
  it("relit le modèle généré (aller-retour Excel)", async () => {
    const buffer = await writeXlsxFile(recipeWorkbook()).toBuffer();
    const { recipes, ignored } = parseRecipeSheets(await readXlsxFile(buffer));
    expect(ignored).toEqual([]);
    expect(recipes.map((r) => r.name)).toEqual(EXAMPLE_RECIPES.map((r) => r.name));
    const quiche = recipes[0];
    expect(quiche.extra).toMatchObject({ servings: 4, prepMinutes: 15, cookMinutes: 35, tags: ["Tarte"] });
    expect(quiche.steps).toHaveLength(3);
    expect(quiche.ingredients).toEqual(EXAMPLE_RECIPES[0].ingredients.map((i) => ({ ...i, productId: null })));
    expect(recipes[1].ingredients[2]).toMatchObject({ name: "Sel", quantity: null, unit: null });
  });

  it("reconnaît les colonnes par leur nom, dans n'importe quel ordre", () => {
    const { recipes } = parseRecipeSheets([
      {
        sheet: "Feuil1",
        data: [
          ["Mes recettes"],
          ["Qté", "Unité", "Nom de la recette", "Produit"],
          ["1,5", "kg", "Raclette", "pommes de terre"],
          [1.2, "kg", null, "Fromage à raclette"],
          ["5-6", null, "Tarte merguez", "Merguez"],
          ["quelques", null, null, "Cornichons"],
        ],
      },
    ]);
    expect(recipes.map((r) => r.name)).toEqual(["Raclette", "Tarte merguez"]);
    expect(recipes[0].ingredients).toMatchObject([
      { name: "Pommes de terre", quantity: 1.5, unit: "kg" },
      { name: "Fromage à raclette", quantity: 1.2, unit: "kg" },
    ]);
    expect(recipes[1].ingredients).toMatchObject([
      { name: "Merguez", quantity: 6, note: "5 à 6" },
      { name: "Cornichons", quantity: null, note: "quelques" },
    ]);
  });

  it("découpe un ingrédient saisi d'un bloc et lit les temps en texte", () => {
    const { recipes } = parseRecipeSheets([
      { sheet: "Recettes", data: [["Recette", "Personnes", "Préparation", "Cuisson", "Étape 1", "Étape 2"], ["Quiche", "4 pers.", "20 min", "1 h 10", "Préchauffer", "2) Cuire"]] },
      { sheet: "Ingrédients", data: [["Recette", "Ingrédient"], ["Quiche", "200 g lardons (fumés)"]] },
    ]);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].extra).toMatchObject({ servings: 4, prepMinutes: 20, cookMinutes: 70 });
    expect(recipes[0].steps).toEqual(["Préchauffer", "Cuire"]);
    expect(recipes[0].ingredients[0]).toMatchObject({ name: "Lardons", quantity: 200, unit: "g", note: "fumés" });
  });

  it("signale les doublons et les lignes sans recette", () => {
    const { recipes, ignored } = parseRecipeSheets(
      [{ sheet: "Ingrédients", data: [["Ingrédient", "Recette"], ["Sel", null], ["Oeufs", "Quiche lorraine"]] }],
      ["Quiche Lorraine"],
    );
    expect(ignored).toEqual(["Ingrédients, ligne 2 : recette non indiquée pour « Sel »"]);
    expect(recipes[0].duplicateOf).toEqual({ name: "Quiche Lorraine", existing: true });
  });

  it("explique quand le classeur n'a pas le bon format", () => {
    const { recipes, ignored } = parseRecipeSheets([{ sheet: "Feuil1", data: [["a", "b"], [1, 2]] }]);
    expect(recipes).toEqual([]);
    expect(ignored[0]).toMatch(/modèle/);
  });
});
