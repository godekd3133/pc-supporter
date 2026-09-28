import { describe, expect, it } from "vitest";
import { savedBuildMonitorSummaryForDisplay, savedBuildMonitorTitleForDisplay } from "./saved-build-monitor-copy";

describe("saved build monitor display copy", () => {
  it("translates legacy alert titles without changing current titles", () => {
    expect(savedBuildMonitorTitleForDisplay("차단 위험 악화")).toBe("호환 문제 증가");
    expect(savedBuildMonitorTitleForDisplay("현재 상태 안정")).toBe("현재 상태 안정");
  });

  it("normalizes legacy blocker counts and preserves detail", () => {
    expect(savedBuildMonitorSummaryForDisplay("차단 +1 · 2개 차단 · 전력·냉각 예산 기준 미달"))
      .toBe("호환 불가 +1 · 호환 불가 2개 · 전력·냉각 여유 부족");
  });

  it("does not rewrite the current blocker and resource wording twice", () => {
    const message = "호환 불가 +1 · 전력·냉각 여유 부족";
    expect(savedBuildMonitorSummaryForDisplay(message)).toBe(message);
  });
});
