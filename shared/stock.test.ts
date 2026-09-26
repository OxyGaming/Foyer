import { describe, expect, it } from "vitest";
import { quantityToBuy, stockStatus, totalQuantity } from "./stock";
import { normalize } from "./text";

describe("stockStatus", () => {
  it("n'alerte pas sans seuil ni quantité", () => {
    expect(stockStatus(3, null)).toBe("none");
    expect(stockStatus(null, 2)).toBe("none");
  });
  it("classe selon le minimum", () => {
    expect(stockStatus(3, 2)).toBe("ok");
    expect(stockStatus(2, 2)).toBe("watch");
    expect(stockStatus(1, 2)).toBe("low");
    expect(stockStatus(0, 2)).toBe("out");
    expect(stockStatus(0, 0)).toBe("out");
  });
});

describe("quantityToBuy", () => {
  it("revient au stock cible (exemple lessive)", () => {
    expect(quantityToBuy(1, 2, 4)).toBe(3);
  });
  it("revient au minimum sans cible", () => {
    expect(quantityToBuy(0, 2, null)).toBe(2);
  });
  it("ne suggère rien si le stock est normal", () => {
    expect(quantityToBuy(5, 2, 4)).toBeNull();
  });
});

describe("totalQuantity", () => {
  it("ignore les quantités inconnues", () => {
    expect(totalQuantity([{ quantity: 2 }, { quantity: null }, { quantity: 1.5 }])).toBe(3.5);
    expect(totalQuantity([{ quantity: null }])).toBeNull();
    expect(totalQuantity([])).toBeNull();
  });
});

describe("normalize", () => {
  it("ignore accents et casse", () => {
    expect(normalize("  Crêpes  Œufs ")).toBe("crepes oeufs");
  });
});
