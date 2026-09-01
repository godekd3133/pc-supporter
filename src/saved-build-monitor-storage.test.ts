import { describe, expect, it } from "vitest";
import { savedBuildMonitorAlertsFromJson, savedBuildMonitorAlertsToJson, savedBuildMonitorAutoRefreshEnabledFromStorage, savedBuildMonitorAutoRefreshMinutesFromStorage } from "./saved-build-monitor-storage";

const alert = {
  id: "alert-1",
  buildId: "build-1",
  buildName: "게임 PC",
  kind: "critical" as const,
  title: "구매 전 수정 필요",
  message: "차단 오류 1개",
  createdAt: "2026-08-31T01:00:00.000Z"
};

describe("saved build monitor storage", () => {
  it("round-trips valid alerts and ignores malformed entries", () => {
    expect(savedBuildMonitorAlertsFromJson(savedBuildMonitorAlertsToJson([alert]))).toEqual([alert]);
    expect(savedBuildMonitorAlertsFromJson(JSON.stringify([alert, { ...alert, id: "" }, { ...alert, kind: "unknown" }]))).toEqual([alert]);
    expect(savedBuildMonitorAlertsFromJson("not-json")).toEqual([]);
  });

  it("parses only supported automatic refresh settings", () => {
    expect(savedBuildMonitorAutoRefreshEnabledFromStorage("true")).toBe(true);
    expect(savedBuildMonitorAutoRefreshEnabledFromStorage("false")).toBe(false);
    expect(savedBuildMonitorAutoRefreshMinutesFromStorage("5")).toBe(5);
    expect(savedBuildMonitorAutoRefreshMinutesFromStorage("30")).toBe(30);
    expect(savedBuildMonitorAutoRefreshMinutesFromStorage("2")).toBe(15);
  });
});
