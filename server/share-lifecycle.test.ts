import { describe, expect, it } from "vitest";
import { normalizeShareExpiryAt, shareExpired, shareExpiresAtFor, shareExpiryDaysFrom, shareExpiryValueProvided } from "./share-lifecycle";

describe("share lifecycle", () => {
  it("accepts only 7 or 30 day expiry values", () => {
    expect(shareExpiryDaysFrom(7)).toBe(7);
    expect(shareExpiryDaysFrom(30)).toBe(30);
    expect(shareExpiryDaysFrom(undefined)).toBeUndefined();
    expect(shareExpiryDaysFrom("7")).toBeUndefined();
    expect(shareExpiryValueProvided(null)).toBe(false);
    expect(shareExpiryValueProvided(7)).toBe(true);
  });

  it("calculates expiry from a stable creation timestamp", () => {
    const createdAt = "2026-08-28T00:00:00.000Z";
    expect(shareExpiresAtFor(7, Date.parse(createdAt))).toBe("2026-09-04T00:00:00.000Z");
    expect(shareExpiresAtFor(undefined, Date.parse(createdAt))).toBeUndefined();
  });

  it("normalizes persisted timestamps and treats invalid timestamps as unavailable", () => {
    expect(normalizeShareExpiryAt("2026-08-28T01:00:00+09:00")).toEqual({ valid: true, value: "2026-08-27T16:00:00.000Z" });
    expect(normalizeShareExpiryAt(undefined)).toEqual({ valid: true });
    expect(normalizeShareExpiryAt("not-a-date")).toEqual({ valid: false });
  });

  it("expires at the exact boundary and fails closed for malformed expiry", () => {
    expect(shareExpired("2026-08-28T00:00:00.000Z", Date.parse("2026-08-28T00:00:00.000Z"))).toBe(true);
    expect(shareExpired("2026-08-28T00:00:00.000Z", Date.parse("2026-08-27T23:59:59.999Z"))).toBe(false);
    expect(shareExpired("not-a-date", Date.parse("2026-08-27T23:59:59.999Z"))).toBe(true);
  });
});
