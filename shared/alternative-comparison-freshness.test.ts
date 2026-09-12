import { describe, expect, it } from "vitest";
import { alternativeComparisonFreshnessFor } from "./alternative-comparison-freshness";
import type { AlternativeComparisonSnapshot } from "./alternative-comparison-share";
import type { ServiceMeta } from "./types";

const snapshot = (overrides: Partial<AlternativeComparisonSnapshot> = {}): AlternativeComparisonSnapshot => ({
  id: "comparison-1",
  name: "비교",
  candidates: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  catalogSnapshotAt: "2026-09-01T00:00:00.000Z",
  engineVersion: "engine-1",
  ...overrides
});

const meta = (overrides: Partial<ServiceMeta> = {}): ServiceMeta => ({
  engineVersion: "engine-1",
  catalogUpdatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides
} as ServiceMeta);

describe("alternative comparison freshness", () => {
  it("does not overclaim a legacy snapshot without comparison metadata", () => {
    expect(alternativeComparisonFreshnessFor(snapshot({ catalogSnapshotAt: undefined, engineVersion: undefined }), meta())).toMatchObject({ tone: "unknown", label: "공유 기준 기록 없음" });
  });

  it("waits when current metadata has not loaded", () => {
    expect(alternativeComparisonFreshnessFor(snapshot(), null)).toMatchObject({ tone: "unknown", label: "현재 기준 확인 중" });
  });

  it("marks a newer catalog or engine as requiring recheck", () => {
    expect(alternativeComparisonFreshnessFor(snapshot(), meta({ catalogUpdatedAt: "2026-09-02T00:00:00.000Z" }))).toMatchObject({ tone: "stale", label: "현재 기준 재확인 권장" });
    expect(alternativeComparisonFreshnessFor(snapshot(), meta({ engineVersion: "engine-2" }))).toMatchObject({ tone: "stale", detail: expect.stringContaining("엔진 engine-1 → engine-2") });
  });

  it("reports the same current basis and handles malformed legacy dates safely", () => {
    expect(alternativeComparisonFreshnessFor(snapshot(), meta())).toMatchObject({ tone: "current", label: "공유 기준과 현재 기준 동일" });
    expect(alternativeComparisonFreshnessFor(snapshot({ catalogSnapshotAt: "not-a-date" }), meta())).toMatchObject({ tone: "unknown", label: "카탈로그 기준 확인 필요" });
  });
});
