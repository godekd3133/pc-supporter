import { describe, expect, it } from "vitest";
import { entityTagFor, ifNoneMatchMatches } from "./http-cache";

describe("HTTP entity tags", () => {
  it("is stable for the same response and changes when the response changes", () => {
    expect(entityTagFor({ revision: 1, items: ["cpu-1"] })).toBe(entityTagFor({ revision: 1, items: ["cpu-1"] }));
    expect(entityTagFor({ revision: 1, items: ["cpu-1"] })).not.toBe(entityTagFor({ revision: 2, items: ["cpu-1"] }));
  });

  it("matches wildcard and comma-separated conditional headers", () => {
    const tag = entityTagFor({ value: "same" });
    expect(ifNoneMatchMatches(tag, tag)).toBe(true);
    expect(ifNoneMatchMatches(`"other", ${tag}`, tag)).toBe(true);
    expect(ifNoneMatchMatches("*", tag)).toBe(true);
    expect(ifNoneMatchMatches('"other"', tag)).toBe(false);
  });
});
