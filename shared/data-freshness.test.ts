import { describe, expect, it } from "vitest";
import { classifyDataFreshness, nextDataFreshnessChangeAt } from "./data-freshness";

const NOW = "2026-08-27T00:00:00.000Z";

describe("data freshness boundaries", () => {
  it("returns the first timestamp at which a known freshness class changes", () => {
    expect(classifyDataFreshness("2026-08-24T00:00:00.000Z", NOW)).toBe("fresh");
    expect(nextDataFreshnessChangeAt("2026-08-24T00:00:00.000Z", NOW)).toBe(Date.parse("2026-08-27T00:00:00.001Z"));

    expect(classifyDataFreshness("2026-08-20T00:00:00.000Z", NOW)).toBe("aging");
    expect(nextDataFreshnessChangeAt("2026-08-20T00:00:00.000Z", NOW)).toBe(Date.parse("2026-09-03T00:00:00.001Z"));
  });

  it("does not schedule a future transition for stale or invalid timestamps", () => {
    expect(nextDataFreshnessChangeAt("2026-07-01T00:00:00.000Z", NOW)).toBeUndefined();
    expect(nextDataFreshnessChangeAt(undefined, NOW)).toBeUndefined();
    expect(nextDataFreshnessChangeAt("not-a-date", NOW)).toBeUndefined();
  });
});
