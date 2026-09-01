import { describe, expect, it } from "vitest";
import { savedBuildComparisonCsvFor, savedBuildComparisonJsonFor, savedBuildComparisonTextFor, type SavedBuildComparisonExportInput } from "./saved-build-comparison-export";

const input: SavedBuildComparisonExportInput = {
  buildNames: ["현재 견적", "저장 견적"],
  snapshotRows: [{ label: "저장 당시 상태", values: ["호환 가능", "확인 필요"] }],
  currentRows: [{ label: "현재 위험", values: ["차단 0개, 주의 1개", "차단 2개 · 주의 0개"] }]
};

describe("saved build comparison export", () => {
  it("keeps snapshot and current catalog sections in text output", () => {
    const text = savedBuildComparisonTextFor(input);
    expect(text).toContain("[저장 시점 스냅샷]");
    expect(text).toContain("[현재 카탈로그 재검사]");
    expect(text).toContain("저장 당시 상태: 호환 가능 | 확인 필요");
  });

  it("serializes variable comparison columns as quoted CSV", () => {
    const csv = savedBuildComparisonCsvFor(input);
    expect(csv.startsWith("\uFEFF구분,비교 항목,현재 견적,저장 견적")).toBe(true);
    expect(csv).toContain("현재 위험");
    expect(csv).toContain("\"차단 0개, 주의 1개\"");
  });

  it("produces a typed JSON snapshot with both comparison sections", () => {
    const parsed = JSON.parse(savedBuildComparisonJsonFor(input)) as SavedBuildComparisonExportInput & { type: string; version: number };
    expect(parsed).toMatchObject({ type: "pc-supporter-saved-build-comparison", version: 1, buildNames: input.buildNames, snapshotRows: input.snapshotRows, currentRows: input.currentRows });
  });

  it("adds a third comparison column without changing the row sections", () => {
    const csv = savedBuildComparisonCsvFor({ ...input, buildNames: ["현재 견적", "저장 견적 A", "저장 견적 B"] });
    expect(csv.startsWith("\uFEFF구분,비교 항목,현재 견적,저장 견적 A,저장 견적 B")).toBe(true);
    expect(csv).toContain("현재 카탈로그 재검사,현재 위험");
  });
});
