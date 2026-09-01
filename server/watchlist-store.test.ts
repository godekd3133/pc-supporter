import { describe, expect, it } from "vitest";
import { parseSavedCatalogWatchlistInput, parseSavedCatalogWatchlistUpdateInput, savedCatalogWatchlistExpired, savedCatalogWatchlistFromUnknown, savedWatchlistAlertPreferencesFromUnknown } from "./watchlist-store";
import type { SavedCatalogWatchlist } from "./watchlist-store";

const entry = (overrides: Record<string, unknown> = {}) => ({ itemId: "part-1", itemName: "테스트 CPU", category: "cpu", kind: "part", addedAt: "2026-08-28T00:00:00.000Z", targetPriceWon: 85000, ...overrides });

describe("saved catalog watchlist", () => {
  it("normalizes a valid named snapshot and preserves target prices", () => {
    const result = parseSavedCatalogWatchlistInput({ name: "  내 가격 목록  ", entries: [entry()], nearLowThresholdPercent: 20 });

    expect(result).toEqual({ name: "내 가격 목록", entries: [entry()], nearLowThresholdPercent: 20, errors: [] });
  });

  it("rejects invalid thresholds and entries before persistence", () => {
    expect(parseSavedCatalogWatchlistInput({ entries: [entry()], nearLowThresholdPercent: 15 }).errors).toEqual(["최저가 근접 기준은 5, 10, 20 중 하나여야 합니다."]);
    expect(parseSavedCatalogWatchlistInput({ entries: [entry({ targetPriceWon: 0 })], nearLowThresholdPercent: 10 }).entries).toEqual([]);
  });

  it("normalizes persisted records and ignores malformed storage rows", () => {
    const saved = savedCatalogWatchlistFromUnknown({ id: "watch-1", name: "목록", entries: [entry()], nearLowThresholdPercent: 10, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T01:00:00.000Z" });

    expect(saved).toMatchObject({ id: "watch-1", name: "목록", nearLowThresholdPercent: 10, entries: [entry()] });
    expect(savedCatalogWatchlistFromUnknown({ id: "bad", entries: [], nearLowThresholdPercent: 10 })).toBeUndefined();
  });

  it("accepts only supported share expiries and expires persisted snapshots by timestamp", () => {
    const sevenDay = parseSavedCatalogWatchlistInput({ entries: [entry()], nearLowThresholdPercent: 10, expiresInDays: 7 });
    expect(sevenDay).toMatchObject({ expiresInDays: 7, errors: [] });
    expect(parseSavedCatalogWatchlistInput({ entries: [entry()], nearLowThresholdPercent: 10, expiresInDays: 14 }).errors).toEqual(["공유 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다."]);

    const saved = savedCatalogWatchlistFromUnknown({ id: "watch-expiring", name: "기간 목록", entries: [entry()], nearLowThresholdPercent: 10, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T01:00:00.000Z", expiresAt: "2026-08-28T02:00:00.000Z" });
    expect(saved?.expiresAt).toBe("2026-08-28T02:00:00.000Z");
    expect(savedCatalogWatchlistExpired(saved!, Date.parse("2026-08-28T02:00:00.000Z"))).toBe(true);
    expect(savedCatalogWatchlistExpired(saved!, Date.parse("2026-08-28T01:59:59.999Z"))).toBe(false);
    expect(savedCatalogWatchlistFromUnknown({ id: "bad-expiry", name: "목록", entries: [entry()], nearLowThresholdPercent: 10, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T01:00:00.000Z", expiresAt: "not-a-date" })).toBeUndefined();
  });

  it("normalizes per-watchlist alert preferences and rejects unsupported policies", () => {
    expect(parseSavedCatalogWatchlistInput({ entries: [entry()], nearLowThresholdPercent: 10, alertPreferences: { targetReached: false, priceDrop: true, priceAvailability: false, minimumDropPercent: 5 } })).toMatchObject({ alertPreferences: { targetReached: false, priceDrop: true, priceAvailability: false, minimumDropPercent: 5 }, errors: [] });
    expect(parseSavedCatalogWatchlistInput({ entries: [entry()], nearLowThresholdPercent: 10, alertPreferences: { targetReached: true, priceDrop: true, minimumDropPercent: 2 } }).errors).toEqual(["가격 알림 설정 형식이 올바르지 않습니다."]);
    expect(savedWatchlistAlertPreferencesFromUnknown({ targetReached: true, priceDrop: false, minimumDropPercent: 5 })).toMatchObject({ targetReached: true, priceDrop: false, priceAvailability: true, minimumDropPercent: 5 });
  });

  it("merges partial updates while preserving expiry unless it is explicitly changed", () => {
    const current: SavedCatalogWatchlist = { id: "watch-update", name: "기존 목록", entries: [entry() as SavedCatalogWatchlist["entries"][number]], nearLowThresholdPercent: 10, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T01:00:00.000Z", expiresAt: "2026-09-04T01:00:00.000Z" };
    const partial = parseSavedCatalogWatchlistUpdateInput(current, { alertPreferences: { targetReached: false, priceDrop: true, priceAvailability: false, minimumDropPercent: 5 } });
    expect(partial).toMatchObject({ alertPreferences: { targetReached: false, priceDrop: true, priceAvailability: false, minimumDropPercent: 5 }, nearLowThresholdPercent: 10, expiresInDaysProvided: false, errors: [] });
    expect(parseSavedCatalogWatchlistUpdateInput(current, { expiresInDays: null })).toMatchObject({ expiresInDaysProvided: true, errors: [] });
    expect(parseSavedCatalogWatchlistUpdateInput(current, { nearLowThresholdPercent: 15 }).errors).toEqual(["최저가 근접 기준은 5, 10, 20 중 하나여야 합니다."]);
  });
});
