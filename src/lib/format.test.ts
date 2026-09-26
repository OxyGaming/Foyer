import { describe, expect, it } from "vitest";
import { formatUnitPrice, parseEuros, scaleUnitPrice } from "./format";

const nbsp = (s: string) => s.replace(/ | /g, " ");

describe("prix unitaires", () => {
  it("affiche au kilo / au litre les prix au gramme / au millilitre", () => {
    expect(scaleUnitPrice(0.48, "g")).toEqual({ cents: 480, unit: "kg" });
    expect(nbsp(formatUnitPrice(0.1043, "ml"))).toBe("1,04 €/L");
    expect(nbsp(formatUnitPrice(299, null))).toBe("2,99 €/unité");
    expect(nbsp(formatUnitPrice(299, "kg"))).toBe("2,99 €/kg");
  });
  it("lit un montant saisi en euros", () => {
    expect(parseEuros("5,98")).toBe(598);
    expect(parseEuros("5.98 €")).toBe(598);
    expect(parseEuros("")).toBeNull();
  });
});
