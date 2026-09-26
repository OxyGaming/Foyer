import { describe, expect, it } from "vitest";
import { parseIngredientLine } from "./ingredients";

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
    expect(parseIngredientLine("2 gros oignons")).toMatchObject({ name: "Gros oignons", quantity: 2, unit: null });
  });
  it("ignore les lignes vides et les puces", () => {
    expect(parseIngredientLine("   ")).toBeNull();
    expect(parseIngredientLine("- 1 L lait")).toMatchObject({ name: "Lait", quantity: 1, unit: "L" });
  });
});
