import { describe, expect, it } from "vitest";
import { savedBuildCurrentRecheckExportFor, savedBuildCurrentRecheckTextFor } from "./saved-build-current-recheck";
import type { SavedBuildVersionSharePayload } from "./saved-build-version-share";
import type { SavedBuildVersionCurrentRecheckEntry } from "./saved-build-current-recheck";

const payload = { before: { id: "v1-id", label: "v1", versionNumber: 1, name: "원본", updatedAt: "2026-09-07T00:00:00.000Z" }, after: { id: "v2-id", label: "v2", versionNumber: 2, name: "수정", updatedAt: "2026-09-07T01:00:00.000Z" } } as SavedBuildVersionSharePayload;
const entry: SavedBuildVersionCurrentRecheckEntry = {
  label: "v2",
  name: "수정",
  savedCheck: {
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    totalPriceWon: 1_000_000,
    priceComplete: true,
    analysisScore: 80,
    analysisScoreLabel: "상위권",
    analysisConfidence: "high",
    findings: [{ key: "rule-old", title: "기존 finding", severity: "warning" }],
    engineVersion: "2.58.0",
    catalogSnapshotAt: "2026-09-06T00:00:00.000Z",
    checkedAt: "2026-09-06T00:00:00.000Z"
  },
  current: {
    status: "needs_review",
    blockerCount: 0,
    warningCount: 1,
    unknownCount: 1,
    totalPriceWon: 1_050_000,
    priceComplete: true,
    analysisScore: 81,
    analysisScoreLabel: "상위권",
    findings: [{ key: "rule-new", title: "신규 현재 finding", severity: "warning" }],
    resources: { power: "120W 여유", cooling: "80W 여유", state: "여유 있음" },
    benchmark: { status: "완전 자료", presentScoreCount: 2, expectedScoreCount: 2, rows: [{ label: "Cinebench R23 멀티", value: 18_000 }] },
    engineVersion: "2.58.0",
    catalogSnapshotAt: "2026-09-07T02:00:00.000Z",
    checkedAt: "2026-09-07T02:01:00.000Z"
  }
};

describe("saved build current recheck export", () => {
  it("keeps a versioned JSON envelope and explanatory text aligned", () => {
    const exported = savedBuildCurrentRecheckExportFor(payload, [entry], "2026-09-07T03:00:00.000Z");
    expect(exported).toMatchObject({ schemaVersion: 1, kind: "pc-supporter.saved-build-version-current-recheck", generatedAt: "2026-09-07T03:00:00.000Z", source: { before: { id: "v1-id" }, after: { id: "v2-id" } } });
    const text = savedBuildCurrentRecheckTextFor(payload, [entry], "2026-09-07T03:00:00.000Z");
    expect(text).toContain("Cinebench R23 멀티 18000");
    expect(text).toContain("새로 생김 1");
    expect(text).toContain("검사 버전 2.58.0");
    expect(exported.dataBoundary).toBe("현재 부품 정보로 다시 검사한 결과입니다. 저장 견적은 바뀌지 않습니다. 가격·재고와 실제 장착 여부는 구매 전에 확인해 주세요. 게임 성능은 PC와 설정에 따라 달라집니다.");
    expect(text).toContain("부품 정보 확인:");
    expect(text).not.toContain("현재 catalog");
  });
});
