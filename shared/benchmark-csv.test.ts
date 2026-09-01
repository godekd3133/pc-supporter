import { describe, expect, it } from "vitest";
import type { BenchmarkOverrideCsvItem } from "./benchmark-csv";
import { benchmarkOverridesToCsv, benchmarkReviewItemsToCsv, parseBenchmarkOverridesCsv } from "./benchmark-csv";

describe("benchmark override CSV", () => {
  it("round-trips quoted names, notes, URLs, and benchmark scores", () => {
    const items: BenchmarkOverrideCsvItem[] = [{
      partId: "gpu-1",
      partName: "GPU, 검수 \"완료\"",
      category: "gpu",
      scores: { gpu3dmarkTimeSpyScore: 12345, gpu3dmarkPortRoyalScore: 9876 },
      sourceNote: "3DMark 결과표,\n드라이버 고정",
      sourceKind: "independent_review",
      sourceUrl: "https://example.com/benchmark?name=\"gpu\"",
      updatedAt: "2026-08-28T00:00:00.000Z"
    }];

    const parsed = parseBenchmarkOverridesCsv(benchmarkOverridesToCsv(items));

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual([{
      partId: "gpu-1",
      gpu3dmarkTimeSpyScore: 12345,
      gpu3dmarkPortRoyalScore: 9876,
      sourceNote: "3DMark 결과표,\n드라이버 고정",
      sourceKind: "independent_review",
      sourceUrl: "https://example.com/benchmark?name=\"gpu\""
    }]);
  });

  it("keeps empty optional scores for server-side validation and reports invalid score cells", () => {
    const csv = [
      "partId,partName,category,cinebenchR23Single,cinebenchR23Multi,gpu3dmarkTimeSpyScore,gpu3dmarkPortRoyalScore,sourceNote,sourceUrl,updatedAt",
      "cpu-1,CPU,cpu,2100,, , ,공식 표,,2026-08-28"
    ].join("\n");
    expect(parseBenchmarkOverridesCsv(csv)).toEqual({
      items: [{ partId: "cpu-1", cinebenchR23Single: 2100, sourceNote: "공식 표" }],
      errors: []
    });

    const invalid = parseBenchmarkOverridesCsv([
      "partId,partName,category,cinebenchR23Single,cinebenchR23Multi,gpu3dmarkTimeSpyScore,gpu3dmarkPortRoyalScore,sourceNote,sourceUrl,updatedAt",
      "gpu-1,GPU,gpu,12.5,,not-a-score,,근거,,"
    ].join("\n"));
    expect(invalid.items).toEqual([]);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      "2행: cinebenchR23Single는 1부터 1,000,000 사이의 정수여야 합니다.",
      "2행: gpu3dmarkTimeSpyScore는 1부터 1,000,000 사이의 정수여야 합니다."
    ]));
  });

  it("rejects missing headers and unclosed quotes", () => {
    expect(parseBenchmarkOverridesCsv("partId,sourceNote\ngpu-1,근거").errors[0]).toContain("필수 CSV 열이 없습니다");
    expect(parseBenchmarkOverridesCsv('partId,partName,category,cinebenchR23Single,cinebenchR23Multi,gpu3dmarkTimeSpyScore,gpu3dmarkPortRoyalScore,sourceNote,sourceUrl,updatedAt\n"gpu-1,GPU,gpu,1,,,,근거,,').errors).toEqual(["CSV 따옴표가 닫히지 않았습니다."]);
  });

  it("creates a blank-source review template without inventing provenance", () => {
    const csv = benchmarkReviewItemsToCsv([{
      partId: "cpu-1",
      partName: "검수 CPU",
      category: "cpu",
      scores: { cinebenchR23Single: 2100 },
      updatedAt: "2026-08-31T00:00:00.000Z"
    }]);
    expect(csv).toContain("cpu-1,검수 CPU,cpu,2100,,,,,,,2026-08-31T00:00:00.000Z");
    expect(parseBenchmarkOverridesCsv(csv)).toMatchObject({
      items: [{ partId: "cpu-1", cinebenchR23Single: 2100, sourceNote: "" }],
      errors: []
    });
  });
});
