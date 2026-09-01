import { describe, expect, it } from "vitest";
import { parseSavedWatchlistAlertIds, savedWatchlistAlertStateFromUnknown, upsertSavedWatchlistAlertStates } from "./watchlist-alert-state";

describe("watchlist alert state", () => {
  it("normalizes valid state and rejects malformed timestamps", () => {
    expect(savedWatchlistAlertStateFromUnknown({ watchlistId: "watch-1", alertId: "alert-1", updatedAt: "2026-08-28T01:00:00+09:00", readAt: "2026-08-28T02:00:00+09:00" })).toEqual({ watchlistId: "watch-1", alertId: "alert-1", updatedAt: "2026-08-27T16:00:00.000Z", readAt: "2026-08-27T17:00:00.000Z" });
    expect(savedWatchlistAlertStateFromUnknown({ watchlistId: "watch-1", alertId: "alert-1", updatedAt: "bad" })).toBeUndefined();
  });

  it("upserts read and dismissed state without losing the other flag", () => {
    const first = upsertSavedWatchlistAlertStates([], "watch-1", ["alert-1", "alert-1"], "read", "2026-08-28T01:00:00.000Z");
    const second = upsertSavedWatchlistAlertStates(first, "watch-1", ["alert-1", "alert-2"], "dismiss", "2026-08-28T02:00:00.000Z");
    expect(second).toHaveLength(2);
    expect(second.find((state) => state.alertId === "alert-1")).toEqual({ watchlistId: "watch-1", alertId: "alert-1", updatedAt: "2026-08-28T02:00:00.000Z", readAt: "2026-08-28T01:00:00.000Z", dismissedAt: "2026-08-28T02:00:00.000Z" });
  });

  it("caps state history after sorting by update time", () => {
    const oldState = upsertSavedWatchlistAlertStates([], "watch-1", ["old"], "read", "2026-08-28T01:00:00.000Z");
    const states = upsertSavedWatchlistAlertStates(oldState, "watch-1", ["new"], "read", "2026-08-28T02:00:00.000Z", 1);
    expect(states).toHaveLength(1);
    expect(states[0].alertId).toBe("new");
  });

  it("validates alert action payloads and removes duplicate IDs", () => {
    expect(parseSavedWatchlistAlertIds({ alertIds: ["alert-1", "alert-1", "alert-2"] })).toEqual({ alertIds: ["alert-1", "alert-2"] });
    expect(parseSavedWatchlistAlertIds({ alertIds: ["", "alert-1"] }).error).toBe("alertIds에는 비어 있지 않은 문자열만 사용할 수 있습니다.");
    expect(parseSavedWatchlistAlertIds({ alertIds: Array.from({ length: 21 }, (_value, index) => "alert-" + index) }).error).toBe("한 번에 최대 20개 알림만 처리할 수 있습니다.");
  });
});
