import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { partSummary, suggestionSpecRows } from "./app-format";

describe("partSummary", () => {
  it("keeps customer-facing CPU specs without including benchmark scores", () => {
    const cpu: Part = {
      id: "cpu-test",
      category: "cpu",
      name: "Test CPU",
      source: "seed",
      dataQuality: "seed",
      specs: { socket: "AM5", cores: 8, threads: 16, boostClockGhz: 5.2, cinebenchR23Multi: 18_000 },
      missingFields: [],
      updatedAt: "2026-09-28T00:00:00.000Z"
    };

    const summary = partSummary(cpu);

    expect(summary).toContain("AM5");
    expect(summary).toBe("AM5");
    expect(summary).not.toContain("R23");
    expect(summary).not.toContain("18,000");
    const specRows = suggestionSpecRows(cpu);
    expect(specRows.map(([label]) => label)).toContain("코어 / 스레드");
    expect(specRows.some(([label]) => label.includes("Cinebench"))).toBe(false);
  });
});
