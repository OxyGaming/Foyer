import { describe, expect, it } from "vitest";
import { parseRecipeText, recipeKey } from "./recipeImport";

const LIST = `☐ Crumble de potimarron

* 1 potimarron (~1 kg)
* 100 g farine
* Huile d’olive
* Sel, poivre, muscade

☐ Patate douce – noix – roquefort

* 3-4 patates douces
* 150 g roquefort

Semaine 9/10
☐ Raclette

* 1,2 kg fromage à raclette
* Cornichons

☐ Patate douce – roquefort – noix

* 3-4 patates douces

☑ Curry coco butternut coco

* Déjà prévu dans le curry de butternut ci-dessus.
`;

describe("parseRecipeText", () => {
  it("lit une liste à cases à cocher et puces", () => {
    const { recipes, ignored } = parseRecipeText(LIST);
    expect(recipes.map((r) => r.name)).toEqual([
      "Crumble de potimarron",
      "Patate douce – noix – roquefort",
      "Raclette",
      "Patate douce – roquefort – noix",
      "Curry coco butternut coco",
    ]);
    expect(recipes[0].ingredients.map((i) => i.name)).toEqual(["Potimarron", "Farine", "Huile d’olive", "Sel", "Poivre", "Muscade"]);
    expect(recipes[0].ingredients[0]).toMatchObject({ quantity: 1, note: "~1 kg" });
    expect(recipes[2].ingredients[0]).toMatchObject({ name: "Fromage à raclette", quantity: 1.2, unit: "kg" });
    expect(ignored).toEqual(["Semaine 9/10"]);
  });

  it("repère les doublons, même dans le désordre", () => {
    const { recipes } = parseRecipeText(LIST);
    expect(recipes[1].duplicateOf).toBeNull();
    expect(recipes[3].duplicateOf).toEqual({ name: "Patate douce – noix – roquefort", existing: false });
  });

  it("signale les recettes déjà enregistrées", () => {
    const { recipes } = parseRecipeText(LIST, ["raclette"]);
    expect(recipes[2].duplicateOf).toEqual({ name: "raclette", existing: true });
  });

  it("garde une phrase en remarque plutôt qu'en ingrédient", () => {
    const curry = parseRecipeText(LIST).recipes[4];
    expect(curry.ingredients).toEqual([]);
    expect(curry.notes).toEqual(["Déjà prévu dans le curry de butternut ci-dessus."]);
  });

  it("lit titres sans case, sections Ingrédients / Préparation et étapes", () => {
    const { recipes } = parseRecipeText(`# Crêpes
Ingrédients :
250 g de farine
3 œufs
Pour la garniture :
- Sucre
Préparation
1. Mélanger la farine et les œufs.
2) Laisser reposer 1 h.

Omelette
- 3 œufs
- Sel`);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].ingredients.map((i) => i.name)).toEqual(["Farine", "Œufs", "Sucre"]);
    expect(recipes[0].steps).toEqual(["Mélanger la farine et les œufs.", "Laisser reposer 1 h."]);
    expect(recipes[1]).toMatchObject({ name: "Omelette", steps: [] });
    expect(recipes[1].ingredients).toHaveLength(2);
  });

  it("accepte une simple liste de noms", () => {
    const { recipes } = parseRecipeText("Tartiflette\nLasagnes\n\nCrêpes");
    expect(recipes.map((r) => r.name)).toEqual(["Tartiflette", "Lasagnes", "Crêpes"]);
  });
});

describe("recipeKey", () => {
  it("ignore ordre, accents, petits mots et pluriels", () => {
    expect(recipeKey("Salade lentilles – thon")).toBe(recipeKey("salade de lentille et thon"));
    expect(recipeKey("Crumble de potimarron")).not.toBe(recipeKey("Crumble potimarron – noix"));
  });
});
