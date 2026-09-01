import { describe, expect, it } from "vitest";
import { repairPlanBuildFor } from "./repair-plan-build";
import type { BuildSelection, Part, RecommendationPlan } from "./types";

function part(id: string, category: Part["category"]): Part {
  return { id, category, name: id, source: "danawa", dataQuality: "seed", priceWon: 100_000, specs: {}, missingFields: [], updatedAt: "2026-08-31T00:00:00.000Z" };
}

const build: BuildSelection = {
  cpu: { partId: "cpu-old", quantity: 1 },
  motherboard: { partId: "mb-old", quantity: 1 },
  memory: [{ partId: "ram-old", quantity: 4 }],
  ssd: [{ partId: "ssd-old", quantity: 2 }],
  hdd: [],
  m2SlotSelection: { M2_1: "ssd-old" },
  useIntegratedGraphics: true
};

describe("repair plan build projection", () => {
  it("applies replacements and quantity changes without mutating the source build", () => {
    const plan = {
      changes: [
        { kind: "replace_part", category: "motherboard", toPart: part("mb-new", "motherboard") },
        { kind: "change_quantity", category: "memory", toPart: part("ram-old", "memory"), toQuantity: 2 },
        { kind: "replace_part", category: "ssd", toPart: part("ssd-new", "ssd"), toQuantity: 1 }
      ]
    } as RecommendationPlan;
    const projected = repairPlanBuildFor(build, plan);
    expect(projected).toMatchObject({ motherboard: { partId: "mb-new", quantity: 1 }, memory: [{ partId: "ram-old", quantity: 2 }], ssd: [{ partId: "ssd-new", quantity: 1 }], m2SlotSelection: undefined });
    expect(build).toMatchObject({ motherboard: { partId: "mb-old" }, memory: [{ quantity: 4 }], ssd: [{ partId: "ssd-old", quantity: 2 }], m2SlotSelection: { M2_1: "ssd-old" } });
  });
});
