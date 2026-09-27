import { describe, expect, it } from "vitest";
import { weekDays, weekStart } from "./dates";

describe("weekStart", () => {
  // 2026-09-27 est un dimanche.
  it("commence le lundi par défaut", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21");
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
    expect(weekStart("2026-09-22")).toBe("2026-09-21");
  });

  it("semaine du samedi au vendredi", () => {
    expect(weekStart("2026-09-26", 6)).toBe("2026-09-26"); // samedi
    expect(weekStart("2026-09-27", 6)).toBe("2026-09-26"); // dimanche
    expect(weekStart("2026-10-02", 6)).toBe("2026-09-26"); // vendredi
    expect(weekStart("2026-10-03", 6)).toBe("2026-10-03"); // samedi suivant
    expect(weekDays(weekStart("2026-09-30", 6)).at(-1)).toBe("2026-10-02");
  });

  it("semaine du dimanche au samedi", () => {
    expect(weekStart("2026-09-27", 0)).toBe("2026-09-27");
    expect(weekStart("2026-10-03", 0)).toBe("2026-09-27");
  });
});
