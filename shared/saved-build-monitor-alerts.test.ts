import { describe, expect, it } from "vitest";
import { savedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";
import { dismissSavedBuildMonitorAlerts, markSavedBuildMonitorAlertsRead, mergeSavedBuildMonitorAlerts, removeSavedBuildMonitorAlert, savedBuildMonitorAlertFor, savedBuildMonitorAlertMatches } from "./saved-build-monitor-alerts";
import type { SavedBuildMonitorItem } from "./saved-build-monitor";
import type { CompatibilityResult } from "./types";

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    findings: [],
    metrics: {} as CompatibilityResult["metrics"],
    analysis: { profile: "general", overallScore: 80, scoreLabel: "상위권", scoreBasis: "테스트", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] },
    links: [],
    totalPriceWon: 1_000_000,
    priceComplete: true,
    engineVersion: "2.53.0",
    catalogSnapshotAt: "2026-08-31T00:00:00.000Z",
    checkedAt: "2026-08-31T00:01:00.000Z",
    ...overrides
  };
}

const build = { id: "build-1", name: "게임 PC" };

function readyItem(before: CompatibilityResult | undefined, after: CompatibilityResult): SavedBuildMonitorItem {
  const snapshot = savedBuildCheckSnapshotFor(after);
  return {
    id: build.id,
    status: "ready",
    snapshot,
    ...(before ? { transition: savedBuildCheckTransitionSummaryFor(savedBuildCheckSnapshotFor(before), snapshot) } : {})
  };
}

describe("saved build monitor alerts", () => {
  it("does not create an alert for a stable repeated check", () => {
    const current = result();
    expect(savedBuildMonitorAlertFor(build, readyItem(current, current), "2026-08-31T01:00:00.000Z")).toBeUndefined();
  });

  it("creates one deterministic critical alert across repeated check timestamps", () => {
    const first = readyItem(undefined, result({ status: "incompatible", blockerCount: 2, checkedAt: "2026-08-31T01:00:00.000Z" }));
    const second = readyItem(undefined, result({ status: "incompatible", blockerCount: 2, checkedAt: "2026-08-31T01:05:00.000Z" }));
    const firstAlert = savedBuildMonitorAlertFor(build, first, "2026-08-31T01:00:00.000Z");
    const secondAlert = savedBuildMonitorAlertFor(build, second, "2026-08-31T01:05:00.000Z");
    expect(firstAlert).toMatchObject({ kind: "critical", title: "구매 전 수정 필요" });
    expect(secondAlert?.id).toBe(firstAlert?.id);
    expect(mergeSavedBuildMonitorAlerts([firstAlert!], [secondAlert!])).toHaveLength(1);
  });

  it("creates a new signal when the monitored price changes", () => {
    const first = savedBuildMonitorAlertFor(build, readyItem(undefined, result({ totalPriceWon: 1_000_000 })), "2026-08-31T01:00:00.000Z");
    const second = savedBuildMonitorAlertFor(build, readyItem(undefined, result({ totalPriceWon: 950_000 })), "2026-08-31T01:05:00.000Z");
    expect(first?.kind).toBe("baseline");
    expect(second?.id).not.toBe(first?.id);
  });

  it("keeps isolated failures actionable and supports read and remove actions", () => {
    const failed = savedBuildMonitorAlertFor(build, { id: build.id, status: "not_found", message: "공유 링크가 만료되었습니다." }, "2026-08-31T01:00:00.000Z");
    expect(failed).toMatchObject({ kind: "failed", title: "견적 확인 불가" });
    const read = markSavedBuildMonitorAlertsRead([failed!], "2026-08-31T01:01:00.000Z");
    expect(read[0].readAt).toBe("2026-08-31T01:01:00.000Z");
    const dismissed = dismissSavedBuildMonitorAlerts(read, [failed!.id], "2026-08-31T01:02:00.000Z");
    expect(dismissed[0].dismissedAt).toBe("2026-08-31T01:02:00.000Z");
    expect(mergeSavedBuildMonitorAlerts(dismissed, [failed!])[0].dismissedAt).toBe("2026-08-31T01:02:00.000Z");
    expect(removeSavedBuildMonitorAlert(read, failed!.id)).toEqual([]);
  });

  it("preserves existing read state while merging and bounds retained alerts", () => {
    const existing = Array.from({ length: 55 }, (_, index) => ({
      id: `alert-${index}`,
      buildId: `build-${index}`,
      buildName: `견적 ${index}`,
      kind: "changed" as const,
      title: "정보 변화 감지",
      message: "가격 변화가 있습니다.",
      createdAt: `2026-08-31T01:${String(index).padStart(2, "0")}:00.000Z`,
      ...(index === 54 ? { readAt: "2026-08-31T02:00:00.000Z" } : {})
    }));
    const duplicate = { ...existing[54], readAt: undefined };
    const merged = mergeSavedBuildMonitorAlerts(existing, [duplicate]);
    expect(merged).toHaveLength(50);
    expect(merged.find((alert) => alert.id === existing[54].id)?.readAt).toBe(existing[54].readAt);
  });

  it("filters visible alerts by unread, actionable risk, and non-risk changes", () => {
    const base = { id: "alert", buildId: "build", buildName: "견적", title: "변화", message: "변화가 있습니다.", createdAt: "2026-08-31T01:00:00.000Z" };
    const critical = { ...base, id: "critical", kind: "critical" as const };
    const changed = { ...base, id: "changed", kind: "changed" as const, readAt: "2026-08-31T02:00:00.000Z" };
    const dismissed = { ...base, id: "failed", kind: "failed" as const, dismissedAt: "2026-08-31T03:00:00.000Z" };
    expect(savedBuildMonitorAlertMatches(critical, "unread")).toBe(true);
    expect(savedBuildMonitorAlertMatches(changed, "unread")).toBe(false);
    expect(savedBuildMonitorAlertMatches(critical, "attention")).toBe(true);
    expect(savedBuildMonitorAlertMatches(changed, "changes")).toBe(true);
    expect(savedBuildMonitorAlertMatches(dismissed, "all")).toBe(false);
  });
});
