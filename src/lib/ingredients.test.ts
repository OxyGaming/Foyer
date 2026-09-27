import { describe, expect, it } from "vitest";
import { parseIngredientLine, parseIngredientLines } from "./ingredients";

describe("parseIngredientLine", () => {
  it("accepte un ingrédient sans quantité", () => {
    expect(parseIngredientLine("Sel")).toMatchObject({ name: "Sel", quantity: null, unit: null });
  });
  it("lit quantité + unité + « de »", () => {
    expect(parseIngredientLine("500 ml de lait")).toMatchObject({ name: "Lait", quantity: 500, unit: "ml" });
    expect(parseIngredientLine("250 g farine")).toMatchObject({ name: "Farine", quantity: 250, unit: "g" });
    expect(parseIngredientLine("2,5 kg de pommes de terre")).toMatchObject({ name: "Pommes de terre", quantity: 2.5, unit: "kg" });
    expect(parseIngredientLine("1 c. à soupe d'huile")).toMatchObject({ name: "Huile", quantity: 1, unit: "c. à soupe" });
  });
  it("lit une quantité sans unité", () => {
    expect(parseIngredientLine("3 œufs")).toMatchObject({ name: "Œufs", quantity: 3, unit: null });
  });
  it("lit le format « Nom — quantité unité »", () => {
    expect(parseIngredientLine("Farine — 250 g")).toMatchObject({ name: "Farine", quantity: 250, unit: "g" });
  });
  it("ne confond pas une unité avec le début d'un mot", () => {
    expect(parseIngredientLine("2 gros oignons")).toMatchObject({ name: "Oignons", quantity: 2, unit: null, note: "gros" });
  });
  it("ignore les lignes vides et les puces", () => {
    expect(parseIngredientLine("   ")).toBeNull();
    expect(parseIngredientLine("- 1 L lait")).toMatchObject({ name: "Lait", quantity: 1, unit: "L" });
  });
  it("met les parenthèses en note", () => {
    expect(parseIngredientLine("1 potimarron (~1 kg)")).toMatchObject({ name: "Potimarron", quantity: 1, unit: null, note: "~1 kg" });
    expect(parseIngredientLine("10 cl vin blanc (facultatif)")).toMatchObject({ name: "Vin blanc", quantity: 10, unit: "cl", note: "facultatif" });
  });
  it("retient le haut d'une fourchette", () => {
    expect(parseIngredientLine("5-6 merguez")).toMatchObject({ name: "Merguez", quantity: 6, note: "5 à 6" });
    expect(parseIngredientLine("3-4 patates douces")).toMatchObject({ name: "Patates douces", quantity: 4 });
  });
  it("lit les unités courantes des listes de courses", () => {
    expect(parseIngredientLine("2 boîtes de thon")).toMatchObject({ name: "Thon", quantity: 2, unit: "boîtes" });
    expect(parseIngredientLine("1 boîte lait de coco")).toMatchObject({ name: "Lait de coco", quantity: 1, unit: "boîte" });
    expect(parseIngredientLine("2 gousses d’ail")).toMatchObject({ name: "Ail", quantity: 2, unit: "gousses" });
    expect(parseIngredientLine("1 morceau de gingembre")).toMatchObject({ name: "Gingembre", unit: "morceau" });
    expect(parseIngredientLine("1,2 kg fromage à raclette")).toMatchObject({ name: "Fromage à raclette", quantity: 1.2, unit: "kg" });
    expect(parseIngredientLine("1 grosse courge butternut")).toMatchObject({ name: "Courge butternut", note: "grosse" });
  });
  it("sépare « Sel, poivre, muscade » sans toucher aux lignes chiffrées", () => {
    expect(parseIngredientLines("Sel, poivre, muscade").map((i) => i.name)).toEqual(["Sel", "Poivre", "Muscade"]);
    expect(parseIngredientLines("Curry ou gingembre").map((i) => i.name)).toEqual(["Curry ou gingembre"]);
    expect(parseIngredientLines("1,5 kg pommes de terre")).toHaveLength(1);
  });
});
