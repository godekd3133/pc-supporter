import { describe, expect, it } from "vitest";
import type { Finding, FindingSeverity } from "./types";
import { filteredFindingsFor, findingFilterCounts, findingMatchesFilter } from "./finding-filters";

function finding(severity: FindingSeverity, id: string = severity): Finding {
  return { id, ruleId: id, severity, title: id, message: id, affectedPartIds: [], facts: [], actions: [] };
}

describe("finding filters", () => {
  it("matches all or one severity without changing the finding", () => {
    const blocker = finding("blocker");
    expect(findingMatchesFilter(blocker, "all")).toBe(true);
    expect(findingMatchesFilter(blocker, "blocker")).toBe(true);
    expect(findingMatchesFilter(blocker, "warning")).toBe(false);
  });

  it("filters findings in their original order", () => {
    const findings = [finding("warning", "w1"), finding("blocker", "b1"), finding("warning", "w2"), finding("unknown", "u1")];
    expect(filteredFindingsFor(findings, "warning").map((item) => item.id)).toEqual(["w1", "w2"]);
    expect(filteredFindingsFor(findings, "all")).toEqual(findings);
    expect(filteredFindingsFor(findings, "all")).not.toBe(findings);
  });

  it("counts every filter bucket including an empty information bucket", () => {
    expect(findingFilterCounts([finding("blocker"), finding("warning", "w2"), finding("unknown", "u2"), finding("warning", "w3")])).toEqual({
      all: 4,
      blocker: 1,
      warning: 2,
      unknown: 1,
      info: 0
    });
  });
});
