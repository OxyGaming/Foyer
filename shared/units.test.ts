import { describe, expect, it } from "vitest";
import { canonicalUnit, convertQty, unitDimension } from "./units";

describe("canonicalUnit", () => {
  it("ramène les variantes à une seule écriture", () => {
    for (const u of ["kg", "Kg", "KG", "kilo", "Kilos", "kgs", "kilogramme"]) expect(canonicalUnit(u)).toBe("kg");
    for (const u of ["g", "gr", "Grammes", "gramme"]) expect(canonicalUnit(u)).toBe("g");
    for (const u of ["l", "L", "Lt", "litre", "Litres"]) expect(canonicalUnit(u)).toBe("L");
    for (const u of ["cs", "CS", "càs", "c. à s.", "c.à.s", "cuillère à soupe", "cuillères à soupe", "C. à soupe"]) expect(canonicalUnit(u)).toBe("c. à soupe");
    for (const u of ["cc", "càc", "cuillère à café", "c. à café"]) expect(canonicalUnit(u)).toBe("c. à café");
    for (const u of ["pincée", "pincées", "Pincee"]) expect(canonicalUnit(u)).toBe("pincée");
    for (const u of ["pièce", "pièces", "pcs", "unité"]) expect(canonicalUnit(u)).toBe("pièce");
  });
  it("garde les unités inconnues telles quelles, sans espaces superflus", () => {
    expect(canonicalUnit("  gousse ")).toBe("gousse");
    expect(canonicalUnit("boîte  de  conserve")).toBe("boîte de conserve");
    expect(canonicalUnit("  ")).toBeNull();
    expect(canonicalUnit(null)).toBeNull();
  });
  it("convertit toutes les variantes", () => {
    expect(convertQty(1, "kgs", "g")).toBe(1000);
    expect(convertQty(1, "Lt", "ml")).toBe(1000);
    expect(unitDimension("càs")).toBe(unitDimension("cuillère à soupe"));
    expect(unitDimension("gousses")).toBe(unitDimension("gousse"));
  });
});
