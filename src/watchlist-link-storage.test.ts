import { describe, expect, it } from "vitest";
import { savedWatchlistLinksFromJson, savedWatchlistLinksToJson } from "./watchlist-link-storage";

describe("watchlist link storage", () => {
  it("migrates the old single-link object to an array", () => {
    expect(savedWatchlistLinksFromJson(JSON.stringify({ id: "watch-old", expiresAt: "2026-09-01T00:00:00.000Z" }))).toEqual([{ id: "watch-old", expiresAt: "2026-09-01T00:00:00.000Z" }]);
  });

  it("deduplicates IDs and caps stored links", () => {
    const links = Array.from({ length: 22 }, (_value, index) => ({ id: "watch-" + index, name: "목록 " + index }));
    const restored = savedWatchlistLinksFromJson(JSON.stringify([links[0], links[0], ...links.slice(1)]));
    expect(restored).toHaveLength(20);
    expect(restored[0]).toEqual(links[0]);
    expect(savedWatchlistLinksFromJson(savedWatchlistLinksToJson(restored))).toEqual(restored);
  });

  it("ignores malformed records and invalid JSON", () => {
    expect(savedWatchlistLinksFromJson(JSON.stringify([null, {}, { id: "" }, { id: "watch-valid", name: "  이름  " }]))).toEqual([{ id: "watch-valid", name: "이름" }]);
    expect(savedWatchlistLinksFromJson("not-json")).toEqual([]);
  });
});
