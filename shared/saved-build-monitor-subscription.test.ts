import { describe, expect, it } from "vitest";
import type { CompatibilityResult } from "./types";
import { savedBuildCheckSnapshotFor } from "./saved-build-check";
import { completeSavedBuildMonitorRun, configureSavedBuildMonitorSubscription, defaultSavedBuildMonitorSubscription, failSavedBuildMonitorRun, parseSavedBuildMonitorAlertIds, parseSavedBuildMonitorSettings, savedBuildMonitorAlertAllowed, savedBuildMonitorSubscriptionDue, savedBuildMonitorSubscriptionFromUnknown, updateSavedBuildMonitorAlertState } from "./saved-build-monitor-subscription";

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {} as CompatibilityResult["metrics"], analysis: { profile: "general", overallScore: 80, scoreLabel: "상위권", scoreBasis: "테스트", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 1_000_000, priceComplete: true, engineVersion: "2.53.0", catalogSnapshotAt: "2026-08-31T00:00:00.000Z", checkedAt: "2026-08-31T00:01:00.000Z", ...overrides };
}

const build = { id: "build-1", name: "게임 PC" };

describe("saved build server monitor subscription", () => {
  it("validates persisted subscriptions and supported settings", () => {
    const base = defaultSavedBuildMonitorSubscription("2026-08-31T00:00:00.000Z");
    expect(savedBuildMonitorSubscriptionFromUnknown(base)).toEqual(base);
    expect(savedBuildMonitorSubscriptionFromUnknown({ ...base, intervalMinutes: 5 })).toBeUndefined();
    expect(parseSavedBuildMonitorSettings({ enabled: true, intervalMinutes: 60, alertPolicy: "risk" })).toMatchObject({ settings: { enabled: true, intervalMinutes: 60, alertPolicy: "risk" }, errors: [] });
    expect(parseSavedBuildMonitorSettings({ enabled: "yes", intervalMinutes: 5 }).errors).toHaveLength(2);
    expect(parseSavedBuildMonitorSettings({ enabled: true, intervalMinutes: 60, alertPolicy: "noisy" }).errors).toContain("alertPolicy는 critical, risk, all 중 하나여야 합니다.");
  });

  it("makes a newly enabled subscription due immediately and schedules successful runs", () => {
    const enabled = configureSavedBuildMonitorSubscription(undefined, { enabled: true, intervalMinutes: 60, alertPolicy: "all" }, "2026-08-31T00:00:00.000Z");
    expect(savedBuildMonitorSubscriptionDue(enabled, "2026-08-31T00:00:00.000Z")).toBe(true);
    const completed = completeSavedBuildMonitorRun(build, enabled, savedBuildCheckSnapshotFor(result()), "2026-08-31T00:01:00.000Z");
    expect(completed.nextCheckAt).toBe("2026-08-31T01:01:00.000Z");
    expect(savedBuildMonitorSubscriptionDue(completed, "2026-08-31T01:00:59.999Z")).toBe(false);
    expect(savedBuildMonitorSubscriptionDue(completed, "2026-08-31T01:01:00.000Z")).toBe(true);
  });

  it("alerts once for initial critical state and does not repeat an unchanged run", () => {
    const critical = savedBuildCheckSnapshotFor(result({ status: "incompatible", blockerCount: 1 }));
    const first = completeSavedBuildMonitorRun(build, undefined, critical, "2026-08-31T00:00:00.000Z");
    expect(first.alerts).toHaveLength(1);
    expect(first.alerts[0].kind).toBe("critical");
    const second = completeSavedBuildMonitorRun(build, first, { ...critical, checkedAt: "2026-08-31T01:00:00.000Z" }, "2026-08-31T01:00:00.000Z");
    expect(second.alerts).toHaveLength(1);
    const catalogOnly = completeSavedBuildMonitorRun(build, second, { ...critical, catalogSnapshotAt: "2026-09-01T00:00:00.000Z", checkedAt: "2026-08-31T02:00:00.000Z" }, "2026-08-31T02:00:00.000Z");
    expect(catalogOnly.alerts).toHaveLength(1);
  });

  it("records failures without discarding the last successful baseline", () => {
    const completed = completeSavedBuildMonitorRun(build, undefined, savedBuildCheckSnapshotFor(result()), "2026-08-31T00:00:00.000Z");
    const failed = failSavedBuildMonitorRun({ ...completed, enabled: true, intervalMinutes: 360 }, "network failed", "2026-08-31T01:00:00.000Z");
    expect(failed.lastSnapshot).toEqual(completed.lastSnapshot);
    expect(failed.lastError).toBe("network failed");
    expect(failed.nextCheckAt).toBe("2026-08-31T07:00:00.000Z");
  });

  it("validates alert actions and preserves unrelated alert state", () => {
    const critical = savedBuildCheckSnapshotFor(result({ status: "incompatible", blockerCount: 1 }));
    const state = completeSavedBuildMonitorRun(build, undefined, critical, "2026-08-31T00:00:00.000Z");
    expect(parseSavedBuildMonitorAlertIds({ alertIds: [state.alerts[0].id] }).errors).toEqual([]);
    expect(parseSavedBuildMonitorAlertIds({ alertIds: [] }).errors[0]).toContain("처리할");
    const read = updateSavedBuildMonitorAlertState(state, [state.alerts[0].id], "read", "2026-08-31T00:01:00.000Z");
    expect(read.alerts[0].readAt).toBe("2026-08-31T00:01:00.000Z");
    const dismissed = updateSavedBuildMonitorAlertState(read, [read.alerts[0].id], "dismiss", "2026-08-31T00:02:00.000Z");
    expect(dismissed.alerts[0].dismissedAt).toBe("2026-08-31T00:02:00.000Z");
  });

  it("filters baseline, review, and change alerts according to the selected policy", () => {
    expect(savedBuildMonitorAlertAllowed("critical", "critical")).toBe(true);
    expect(savedBuildMonitorAlertAllowed("critical", "failed")).toBe(true);
    expect(savedBuildMonitorAlertAllowed("critical", "changed")).toBe(false);
    expect(savedBuildMonitorAlertAllowed("risk", "review")).toBe(true);
    expect(savedBuildMonitorAlertAllowed("risk", "improved")).toBe(false);

    const baseline = savedBuildCheckSnapshotFor(result());
    const criticalPolicy = configureSavedBuildMonitorSubscription(undefined, { enabled: false, intervalMinutes: 60, alertPolicy: "critical" }, "2026-08-31T00:00:00.000Z");
    const criticalState = completeSavedBuildMonitorRun(build, criticalPolicy, baseline, "2026-08-31T00:01:00.000Z");
    expect(criticalState.alerts).toEqual([]);

    const riskPolicy = configureSavedBuildMonitorSubscription(undefined, { enabled: false, intervalMinutes: 60, alertPolicy: "risk" }, "2026-08-31T00:00:00.000Z");
    const reviewState = completeSavedBuildMonitorRun(build, riskPolicy, savedBuildCheckSnapshotFor(result({ status: "needs_review", unknownCount: 1 })), "2026-08-31T00:01:00.000Z");
    expect(reviewState.alerts[0].kind).toBe("review");

    const allPolicy = configureSavedBuildMonitorSubscription(undefined, { enabled: false, intervalMinutes: 60, alertPolicy: "all" }, "2026-08-31T00:00:00.000Z");
    const baselineState = completeSavedBuildMonitorRun(build, allPolicy, baseline, "2026-08-31T00:01:00.000Z");
    expect(baselineState.alerts[0].kind).toBe("baseline");
  });

  it("creates a review alert when only peripheral compatibility changes", () => {
    const policy = configureSavedBuildMonitorSubscription(undefined, { enabled: false, intervalMinutes: 60, alertPolicy: "risk" }, "2026-08-31T00:00:00.000Z");
    const snapshot = savedBuildCheckSnapshotFor(result({ accessoryCompatibility: { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 0, findings: [] } }));
    const state = completeSavedBuildMonitorRun(build, policy, snapshot, "2026-08-31T00:01:00.000Z");
    expect(state.alerts[0]).toMatchObject({ kind: "review", message: expect.stringContaining("주변 부품") });
  });

  it("creates a policy-filtered failure alert while preserving the error state", () => {
    const policy = configureSavedBuildMonitorSubscription(undefined, { enabled: false, intervalMinutes: 60, alertPolicy: "critical" }, "2026-08-31T00:00:00.000Z");
    const failed = failSavedBuildMonitorRun(policy, "network failed", "2026-08-31T00:01:00.000Z", build);
    expect(failed.lastError).toBe("network failed");
    expect(failed.alerts[0].kind).toBe("failed");
  });
});
