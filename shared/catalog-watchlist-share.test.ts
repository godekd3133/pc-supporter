import { describe, expect, it } from "vitest";
import type { CatalogWatchEntry } from "./catalog-watchlist";
import { catalogWatchlistShareHashFor, catalogWatchlistSharePayloadFromHash } from "./catalog-watchlist-share";

const entry = (overrides: Partial<CatalogWatchEntry> = {}): CatalogWatchEntry => ({ itemId: "part-1", itemName: "테스트 CPU", category: "cpu", kind: "part", addedAt: "2026-08-28T00:00:00.000Z", targetPriceWon: 85000, ...overrides });

describe("catalog watchlist share", () => {
  it("round-trips Korean entries, targets, and the near-low threshold through a URL hash", () => {
    const built = catalogWatchlistShareHashFor([entry()], 20);
    const read = catalogWatchlistSharePayloadFromHash(built.hash);

    expect(read.errors).toEqual([]);
    expect(read.entries).toEqual([entry()]);
    expect(read.nearLowThresholdPercent).toBe(20);
  });

  it("caps shared entries at twelve and reports the omitted count", () => {
    const entries = Array.from({ length: 14 }, (_, index) => entry({ itemId: `part-${index}` }));
    const built = catalogWatchlistShareHashFor(entries, 10);

    expect(built.sharedEntries).toHaveLength(12);
    expect(built.truncatedCount).toBe(2);
    expect(catalogWatchlistSharePayloadFromHash(built.hash).entries).toHaveLength(12);
  });

  it("rejects malformed, unsupported, and invalid-entry hashes without returning partial data", () => {
    expect(catalogWatchlistSharePayloadFromHash("#watchlist=%7Bbad")).toMatchObject({ entries: [], errors: ["관심 목록 공유 링크를 읽을 수 없습니다."] });
    const unsupported = `#watchlist=${encodeURIComponent(JSON.stringify({ version: 2, nearLowThresholdPercent: 10, entries: [entry()] }))}`;
    expect(catalogWatchlistSharePayloadFromHash(unsupported)).toMatchObject({ entries: [], errors: ["지원하지 않는 관심 목록 공유 링크 버전입니다."] });
    const invalid = `#watchlist=${encodeURIComponent(JSON.stringify({ version: 1, nearLowThresholdPercent: 10, entries: [entry(), entry({ targetPriceWon: 0 })] }))}`;
    expect(catalogWatchlistSharePayloadFromHash(invalid).entries).toEqual([]);
  });
});
