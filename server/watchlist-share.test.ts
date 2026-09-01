import { describe, expect, it } from "vitest";
import { createShareOwnerCredential } from "./build-share";
import { publicSavedCatalogWatchlist } from "./watchlist-share";

describe("saved watchlist public response", () => {
  it("removes the owner token hash from shared watchlist data", () => {
    const credential = createShareOwnerCredential();
    const watchlist = {
      id: "watch-1",
      name: "내 가격 추적",
      entries: [{ itemId: "part-1", itemName: "테스트 CPU", category: "cpu" as const, kind: "part" as const, addedAt: "2026-08-28T00:00:00.000Z" }],
      nearLowThresholdPercent: 10 as const,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
      ownerTokenHash: credential.hash
    };

    expect(publicSavedCatalogWatchlist(watchlist)).toEqual({
      id: "watch-1",
      name: "내 가격 추적",
      entries: watchlist.entries,
      nearLowThresholdPercent: 10,
      createdAt: watchlist.createdAt,
      updatedAt: watchlist.updatedAt
    });
  });
});
