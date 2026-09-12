import { describe, expect, it } from "vitest";
import { assertCompleteReplacementSnapshot, accessoryReplacementCoverageFor, coreReplacementCoverageFor, replacementCoverageFor } from "./private-catalog-import";

describe("private catalog replacement coverage", () => {
  it("detects missing core categories before a destructive replacement", () => {
    const coverage = coreReplacementCoverageFor([
      { category: "cpu" },
      { category: "gpu" }
    ] as never[]);

    expect(coverage.complete).toBe(false);
    expect(coverage.missingCategories).toContain("motherboard");
    expect(coverage.missingCategories).toContain("psu");
  });

  it("requires every accessory category for accessory replacement", () => {
    const coverage = accessoryReplacementCoverageFor([{ category: "cooling_fan" }]);

    expect(coverage.complete).toBe(false);
    expect(coverage.missingCategories).toContain("storage_accessory");
    expect(coverage.missingCategories).toContain("ups");
  });

  it("accepts a complete category set regardless of record count", () => {
    const coverage = replacementCoverageFor(
      [{ category: "cpu" }, { category: "motherboard" }, { category: "gpu" }],
      ["cpu", "motherboard", "gpu"]
    );

    expect(coverage).toEqual({ complete: true, missingCategories: [] });
    expect(() => assertCompleteReplacementSnapshot("--replace-danawa", coverage)).not.toThrow();
  });

  it("explains that partial snapshots must be merged instead", () => {
    const coverage = { complete: false, missingCategories: ["psu"] };

    expect(() => assertCompleteReplacementSnapshot("--replace-danawa", coverage)).toThrow("부분 데이터는 --apply만 사용해 병합");
    expect(() => assertCompleteReplacementSnapshot("--replace-accessories", coverage)).toThrow("부분 데이터는 --include-accessories만 사용해 병합");
  });
});
