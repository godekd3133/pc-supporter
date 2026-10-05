import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { formatRadiatorSupports, partSummary, suggestionSpecRows } from "./app-format";

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

describe("radiator support formatting", () => {
  it("shows size-specific physical limits and configuration conditions", () => {
    const result = formatRadiatorSupports([{ position: "top", sizesMm: [240, 280], requirements: [{ sizesMm: [240], maxRadiatorThicknessMm: 27.5, maxAssemblyThicknessMm: 55.5, maxMemoryHeightMm: 35, maxRadiatorWidthMm: 125, maxRadiatorLengthMm: 300, maxGpuLengthMm: 320, exclusiveUpperBound: true }, { sizesMm: [280], configurationNote: "HDD 케이지 분리 후 장착" }] }]);
    expect(result).toContain("상단 · 240mm, 280mm");
    expect(result).toContain("240mm 기준: 라디에이터 두께 27.5mm 미만");
    expect(result).toContain("팬 포함 두께 55.5mm 미만");
    expect(result).toContain("메모리 높이 35mm 미만");
    expect(result).toContain("라디에이터 폭 125mm 미만");
    expect(result).toContain("라디에이터 길이 300mm 미만");
    expect(result).toContain("GPU 길이 320mm 미만");
    expect(result).toContain("280mm 기준: HDD 케이지 분리 후 장착");
  });

  it("labels the PSU shroud and includes inclusive limits without changing unconditional supports", () => {
    expect(formatRadiatorSupports([{ position: "psu_shroud", sizesMm: [240], requirements: [{ maxAssemblyThicknessMm: 55 }] }])).toContain("파워 커버 · 240mm (장착 조건: 팬 포함 두께 55mm 이하)");
    expect(formatRadiatorSupports([{ position: "top", sizesMm: [240] }])).toBe("상단 · 240mm");
  });
});
