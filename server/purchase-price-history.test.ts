import { describe, expect, it } from "vitest";
import { parseSavedBuildPurchasePriceHistory, parseSavedBuildPurchasePriceHistoryExpectedRevision, parseSavedBuildPurchasePriceHistoryRevision, savedBuildPurchasePriceHistoryFromUnknown, savedBuildPurchasePriceHistoryHistoryTargetFor, savedBuildPurchasePriceHistoryRevisionMatchesFor, savedBuildPurchasePriceHistoryWithNextRevisionFor } from "./purchase-price-history";
import type { PurchaseListPriceObservation } from "../shared/purchase-list-price-history";

const rowKeys = ["part:cpu:cpu-a", "part:gpu:gpu-a"];
const priceHistory: Record<string, PurchaseListPriceObservation[]> = {
  "part:cpu:cpu-a": [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 100_000 }],
  "part:gpu:gpu-a": [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 300_000 }]
};
const snapshot = (overrides: Record<string, unknown> = {}) => ({ inputFingerprint: "fingerprint-1", rowKeys, priceHistory, revision: 3, updatedAt: "2026-09-02T01:00:00.000Z", ...overrides });

describe("saved build purchase price history", () => {
  it("accepts a bounded history payload and stamps the server revision", () => {
    const parsed = parseSavedBuildPurchasePriceHistory(snapshot(), "fingerprint-1", "2026-09-02T02:00:00.000Z");
    expect(parsed.errors).toEqual([]);
    expect(parsed.priceHistory).toMatchObject({ inputFingerprint: "fingerprint-1", rowKeys, priceHistory, revision: 1, updatedAt: "2026-09-02T02:00:00.000Z" });
    expect(savedBuildPurchasePriceHistoryFromUnknown(parsed.priceHistory)).toEqual(parsed.priceHistory);
  });

  it("fails closed for a different fingerprint, duplicate rows, and history rows outside the snapshot", () => {
    expect(parseSavedBuildPurchasePriceHistory(snapshot({ inputFingerprint: "other" }), "fingerprint-1")).toMatchObject({ fingerprintMismatch: true, errors: ["현재 저장 견적과 다른 가격 확인 이력입니다."] });
    expect(parseSavedBuildPurchasePriceHistory(snapshot({ rowKeys: [rowKeys[0], rowKeys[0]] }), "fingerprint-1").errors[0]).toContain("중복");
    expect(parseSavedBuildPurchasePriceHistory(snapshot({ priceHistory: { "removed-row": priceHistory[rowKeys[0]] } }), "fingerprint-1").errors[0]).toContain("샘플");
    expect(savedBuildPurchasePriceHistoryFromUnknown(snapshot({ priceHistory: { "removed-row": priceHistory[rowKeys[0]] } }))).toBeUndefined();
  });

  it("requires the current revision and keeps a bounded previous revision history", () => {
    const current = savedBuildPurchasePriceHistoryFromUnknown(snapshot());
    expect(parseSavedBuildPurchasePriceHistoryExpectedRevision(undefined)).toMatchObject({ revision: null, error: undefined });
    expect(parseSavedBuildPurchasePriceHistoryExpectedRevision(3)).toMatchObject({ revision: 3, error: undefined });
    expect(parseSavedBuildPurchasePriceHistoryExpectedRevision(0).error).toContain("expectedRevision");
    expect(parseSavedBuildPurchasePriceHistoryRevision(4)).toMatchObject({ revision: 4, error: undefined });
    expect(parseSavedBuildPurchasePriceHistoryRevision(0).error).toContain("revision");
    expect(savedBuildPurchasePriceHistoryRevisionMatchesFor(current, 3)).toBe(true);
    expect(savedBuildPurchasePriceHistoryRevisionMatchesFor(current, 2)).toBe(false);
    expect(savedBuildPurchasePriceHistoryRevisionMatchesFor(undefined, null)).toBe(true);
    const next = savedBuildPurchasePriceHistoryWithNextRevisionFor({ inputFingerprint: "fingerprint-1", rowKeys, priceHistory, revision: 1, updatedAt: "2026-09-02T03:00:00.000Z" }, current, "2026-09-02T03:00:00.000Z");
    expect(next.revision).toBe(4);
    expect(next.history?.map((entry) => entry.revision)).toEqual([3]);
    expect(savedBuildPurchasePriceHistoryHistoryTargetFor(next, 3)?.priceHistory).toEqual(priceHistory);
    expect(savedBuildPurchasePriceHistoryHistoryTargetFor(next, 1)).toBeUndefined();
  });

  it("rejects persisted histories above the twenty-revision contract before normalizing them", () => {
    const oversizedHistory = Array.from({ length: 21 }, (_, index) => ({
      inputFingerprint: "fingerprint-1",
      rowKeys,
      priceHistory,
      revision: index + 1,
      updatedAt: `2026-09-02T00:${String(index).padStart(2, "0")}:00.000Z`
    }));
    expect(savedBuildPurchasePriceHistoryFromUnknown(snapshot({ history: oversizedHistory }))).toBeUndefined();
  });
});
