import { describe, expect, it } from "vitest";
import { familyQuantity, quantityToBuy, stockState, stockStatus, totalQuantity } from "./stock";
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

describe("familles de produits", () => {
  const prod = (id: string, unit: string | null, quantity: number | null, extra: Partial<{ minStock: number; targetStock: number; hasStockLine: boolean }> = {}) => ({
    id,
    name: id,
    unit,
    quantity,
    hasStockLine: quantity != null,
    minStock: null,
    targetStock: null,
    ...extra,
  });

  it("additionne toute la famille dans l'unité du générique", () => {
    expect(familyQuantity("kg", [prod("Pâtes", "kg", 0.5), prod("Spaghetti", "g", 1500), prod("Coquillettes", "kg", 1)])).toEqual({ quantity: 3, uncounted: [] });
  });
  it("signale les produits hors total", () => {
    const r = familyQuantity("g", [prod("Spaghetti", "g", 200), prod("Penne", "paquet", 2), prod("Farfalle", "g", null, { hasStockLine: true }), prod("Vide", "g", null)]);
    expect(r.quantity).toBe(200);
    expect(r.uncounted.map((m) => m.id)).toEqual(["Penne", "Farfalle"]);
  });
  it("juge un générique sur le stock de toute la famille", () => {
    const head = prod("Pâtes", "kg", null, { minStock: 2, targetStock: 4 });
    const kids = [prod("Spaghetti", "g", 1500), prod("Coquillettes", "kg", 1)];
    expect(stockState(head, undefined, kids)).toEqual({ status: "ok", toBuy: null, family: { quantity: 2.5, uncounted: [] } });
    kids[1].quantity = 0;
    expect(stockState(head, undefined, kids)).toMatchObject({ status: "low", toBuy: 2.5 });
    kids[1].quantity = 0.5;
    expect(stockState(head, undefined, kids)).toMatchObject({ status: "watch", toBuy: 2 });
  });
  it("une déclinaison n'a pas d'alerte propre quand le générique a un minimum", () => {
    const head = prod("Pâtes", "kg", null, { minStock: 2 });
    expect(stockState(prod("Spaghetti", "g", 0, { minStock: 500 }), head, [])).toEqual({ status: "none", toBuy: null, family: null });
    // Sans minimum sur le générique, la déclinaison garde ses propres seuils.
    expect(stockState(prod("Spaghetti", "g", 0, { minStock: 500 }), prod("Pâtes", "kg", null), [])).toMatchObject({ status: "out", toBuy: 500 });
  });
});
