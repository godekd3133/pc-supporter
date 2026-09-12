import { describe, expect, it } from "vitest";
import { catalogRefreshReportFromUnknown, catalogRefreshValueText } from "./catalog-refresh-report";

const validReport = {
  inputFingerprint: "build-fingerprint-1",
  status: "success",
  requestedCount: 1,
  successCount: 1,
  failureCount: 0,
  items: [{
    target: { kind: "part", id: "cpu-1" },
    name: "테스트 CPU",
    changedFields: ["가격", "원문 스펙"],
    refreshedAt: "2026-09-04T00:00:00.000Z",
    previousDataQuality: "live",
    nextDataQuality: "live",
    previousMissingCount: 1,
    nextMissingCount: 0,
    previousPriceWon: 300_000,
    nextPriceWon: 280_000,
    valueDiffs: [{ field: "가격", previous: "300,000원", next: "280,000원" }]
  }],
  failures: [],
  completedAt: "2026-09-04T00:00:00.000Z"
};

describe("catalog refresh report validation", () => {
  it("parses a bounded success report with price and data transitions", () => {
    expect(catalogRefreshReportFromUnknown(validReport)).toMatchObject({
      inputFingerprint: "build-fingerprint-1",
      status: "success",
      requestedCount: 1,
      successCount: 1,
      failureCount: 0,
      items: [{ name: "테스트 CPU", previousPriceWon: 300_000, nextPriceWon: 280_000, previousMissingCount: 1, nextMissingCount: 0 }]
    });
  });

  it("preserves bounded before/after values and formats normalized JSON compactly", () => {
    const parsed = catalogRefreshReportFromUnknown(validReport);
    expect(parsed?.items[0]?.valueDiffs).toEqual([{ field: "가격", previous: "300,000원", next: "280,000원" }]);
    expect(catalogRefreshValueText('{"socket":"AM5","cores":8}')).toContain("socket: AM5");
    expect(catalogRefreshValueText(undefined)).toBe("확인 정보 없음");
    expect(catalogRefreshReportFromUnknown({ ...validReport, items: [{ ...validReport.items[0], valueDiffs: [{ field: "가격", previous: "x".repeat(421), next: "280,000원" }] }] })).toBeUndefined();
  });

  it("rejects inconsistent counts, duplicate targets, and invalid dates", () => {
    expect(catalogRefreshReportFromUnknown({ ...validReport, failureCount: 1 })).toBeUndefined();
    expect(catalogRefreshReportFromUnknown({ ...validReport, items: [validReport.items[0], validReport.items[0]], requestedCount: 2, successCount: 2 })).toBeUndefined();
    expect(catalogRefreshReportFromUnknown({ ...validReport, completedAt: "not-a-date" })).toBeUndefined();
  });
});
