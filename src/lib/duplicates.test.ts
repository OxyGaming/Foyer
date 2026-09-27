import { describe, expect, it } from "vitest";
import { findDuplicates, preferredKeeper } from "./duplicates";

const p = (id: string, name: string, stock = 0, quantity: number | null = null, createdAt = "2026-09-01") => ({
  id,
  name,
  unit: null,
  quantity,
  createdAt,
  stock: Array.from({ length: stock }, (_, i) => ({ id: `${id}-${i}`, locationId: null, quantity, updatedAt: createdAt })),
});

describe("doublons", () => {
  it("regroupe les homonymes (casse, accents, apostrophes, pluriel)", () => {
    const groups = findDuplicates([p("1", "Farine"), p("2", "farine"), p("3", "Huile d’olive"), p("4", "Huile d'olive"), p("5", "Sel"), p("6", "Œufs"), p("7", "oeuf"), p("8", "")]);
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([["1", "2"], ["3", "4"], ["6", "7"]]);
  });

  it("garde par défaut la fiche qui a du stock, sinon la plus ancienne", () => {
    expect(preferredKeeper([p("vide", "Farine"), p("stock", "Farine", 1, 2)]).id).toBe("stock");
    expect(preferredKeeper([p("récent", "Sel", 0, null, "2026-09-20"), p("ancien", "Sel", 0, null, "2026-09-01")]).id).toBe("ancien");
  });
});
