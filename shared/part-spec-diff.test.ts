import { describe, expect, it } from "vitest";
import type { Part, PartCategory } from "./types";
import { partSpecComparisonRowsFor, partSpecDiffFor } from "./part-spec-diff";

function part(category: PartCategory, id: string, specs: Part["specs"]): Part {
  return {
    id,
    category,
    name: id,
    source: "seed",
    specs,
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

describe("part spec diff", () => {
  it("reports CPU changes with explicit units and preserves missing values", () => {
    const current = part("cpu", "current-cpu", { socket: "AM5", cores: 6, threads: 12, boostClockGhz: 5.1, tdpW: 65 });
    const candidate = part("cpu", "candidate-cpu", { socket: "AM5", cores: 8, threads: 16, boostClockGhz: 5.4 });

    expect(partSpecDiffFor("cpu", [current], candidate)).toEqual([
      { key: "cores", label: "코어", before: "6코어", after: "8코어" },
      { key: "threads", label: "스레드", before: "12스레드", after: "16스레드" },
      { key: "boostClockGhz", label: "부스트", before: "5.1GHz", after: "5.4GHz" },
      { key: "tdpW", label: "TDP", before: "65W", after: "미확인" }
    ]);
  });

  it("aggregates mixed memory kits and reports profile or voltage changes", () => {
    const currentA = part("memory", "current-memory-a", { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, memoryProfiles: ["EXPO"], memoryVoltageV: 1.25 });
    const currentB = part("memory", "current-memory-b", { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, memoryProfiles: ["EXPO"], memoryVoltageV: 1.25 });
    const candidate = part("memory", "candidate-memory", { memoryType: "DDR5", capacityGb: 32, speedMhz: 6000, memoryProfiles: ["XMP"], memoryVoltageV: 1.35 });

    expect(partSpecDiffFor("memory", [currentA, currentB], candidate)).toEqual([
      { key: "capacityGb", label: "용량", before: "16GB", after: "32GB" },
      { key: "speedMhz", label: "속도", before: "5600MHz", after: "6000MHz" },
      { key: "memoryVoltageV", label: "전압", before: "1.25V", after: "1.35V" },
      { key: "memoryProfiles", label: "프로파일", before: "EXPO", after: "XMP" }
    ]);
  });

  it("does not invent a difference when both sides are missing", () => {
    const current = part("gpu", "current-gpu", { vramGb: 12 });
    const candidate = part("gpu", "candidate-gpu", { vramGb: 12 });

    expect(partSpecDiffFor("gpu", [current], candidate)).toEqual([]);
  });

  it("returns no diff when there is no selected current part", () => {
    const candidate = part("psu", "candidate-psu", { wattageW: 850 });

    expect(partSpecDiffFor("psu", [], candidate)).toEqual([]);
  });

  it("builds side-by-side rows and marks only observable differences", () => {
    const first = part("gpu", "first-gpu", { vramGb: 12, gpuMemoryType: "GDDR6X", powerW: 285 });
    const second = part("gpu", "second-gpu", { vramGb: 16, gpuMemoryType: "GDDR6X" });

    expect(partSpecComparisonRowsFor("gpu", [first, second])).toEqual([
      { key: "vramGb", label: "VRAM", values: ["12GB", "16GB"], changed: true },
      { key: "gpuMemoryType", label: "메모리", values: ["GDDR6X", "GDDR6X"], changed: false },
      { key: "powerW", label: "소비전력", values: ["285W", "미확인"], changed: true }
    ]);
  });

  it("does not render rows when every compared value is missing", () => {
    const first = part("case", "first-case", {});
    const second = part("case", "second-case", {});

    expect(partSpecComparisonRowsFor("case", [first, second])).toEqual([]);
  });
});
