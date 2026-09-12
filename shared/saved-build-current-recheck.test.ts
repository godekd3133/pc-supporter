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
    benchmark: { status: "완전 근거", presentScoreCount: 2, expectedScoreCount: 2, rows: [{ label: "Cinebench R23 멀티", value: 18_000 }] },
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
    expect(text).toContain("신규 1");
    expect(text).toContain("engine: 2.58.0");
  });
});
