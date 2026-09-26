import { describe, expect, it } from "vitest";
import { priceStats, stockValueCents, unitPriceCents } from "./prices";

const p = (id: string, date: string, quantity: number | null, totalCents: number | null, unit: string | null = null, isPromo = false) => ({ id, date, quantity, totalCents, unit, isPromo });

describe("priceStats", () => {
  it("coût moyen pondéré : 6 × 0,99 · 6 × 1,09 · 6 × 1,05 → 1,04 €/unité", () => {
    const s = priceStats([p("a", "2026-09-01", 6, 594), p("b", "2026-09-10", 6, 654), p("c", "2026-09-20", 6, 630)], null)!;
    expect(Math.round(s.avgCents)).toBe(104);
    expect(s.last.unitCents).toBeCloseTo(105);
    expect(s.best).toMatchObject({ id: "a", unitCents: 99 });
    expect(s.history.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("pondère par les quantités, pas par le nombre d'achats", () => {
    // 10 à 1 € + 2 à 2 € → 14 € / 12 = 1,1667 € (et non 1,50 €)
    const s = priceStats([p("a", "2026-01-01", 10, 1000), p("b", "2026-01-02", 2, 400)], null)!;
    expect(s.avgCents).toBeCloseTo(116.67, 1);
  });

  it("ne renvoie rien sans prix exploitable", () => {
    expect(priceStats([], null)).toBeNull();
    expect(priceStats([p("a", "2026-01-01", 2, null), p("b", "2026-01-02", null, 300)], null)).toBeNull();
  });

  it("ramène les achats à l'unité du produit et ignore l'incomparable", () => {
    // 500 g à 1 € et 1 kg à 1,60 € → produit en kg : 2,60 € / 1,5 kg
    const s = priceStats([p("a", "2026-01-01", 500, 100, "g"), p("b", "2026-01-02", 1, 160, "kg"), p("c", "2026-01-03", 2, 999, "paquet")], "kg")!;
    expect(s.count).toBe(2);
    expect(s.avgCents).toBeCloseTo(173.33, 1);
    expect(s.best.unitCents).toBeCloseTo(160);
  });
});

describe("valeurs", () => {
  it("prix unitaire d'un achat (lessive : 2 × 5,98 €)", () => {
    expect(unitPriceCents({ quantity: 2, totalCents: 598 })).toBe(299);
    expect(unitPriceCents({ quantity: 0, totalCents: 598 })).toBeNull();
  });
  it("valeur de stock au coût moyen, seulement si calculable", () => {
    expect(stockValueCents(4, 104.33)).toBe(417);
    expect(stockValueCents(4, null)).toBeNull();
    expect(stockValueCents(0, 100)).toBeNull();
    expect(stockValueCents(null, 100)).toBeNull();
  });
});
