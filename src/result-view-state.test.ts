import { describe, expect, it } from "vitest";
import { resultFindingFilterFromSearch, resultFindingRuleFromSearch, resultSectionFromHash, resultViewUrlFor } from "./result-view-state";
import { savedBuildSharePathFor, savedBuildShareUrlFor } from "./saved-build-share-url";

describe("result view URL state", () => {
  it("reads only supported finding filters and falls back to all", () => {
    expect(resultFindingFilterFromSearch("?finding=blocker")).toBe("blocker");
    expect(resultFindingFilterFromSearch("?finding=warning")).toBe("warning");
    expect(resultFindingFilterFromSearch("?finding=invalid")).toBe("all");
    expect(resultFindingFilterFromSearch("")).toBe("all");
  });

  it("reads supported result sections without accepting arbitrary hashes", () => {
    expect(resultSectionFromHash("#findings")).toBe("findings");
    expect(resultSectionFromHash("#purchase-list")).toBe("purchase-list");
    expect(resultSectionFromHash("#unknown")).toBeUndefined();
  });

  it("accepts only bounded rule ids for finding deep links", () => {
    expect(resultFindingRuleFromSearch("?findingRule=gpu-psu-power")).toBe("gpu-psu-power");
    expect(resultFindingRuleFromSearch("?findingRule=connectivity%3Argb-voltage")).toBe("connectivity:rgb-voltage");
    expect(resultFindingRuleFromSearch("?findingRule=bad%20rule")).toBeNull();
    expect(resultFindingRuleFromSearch(`?findingRule=${"a".repeat(121)}`)).toBeNull();
  });

  it("serializes filter and section while preserving unrelated query values", () => {
    expect(resultViewUrlFor("/result", "?source=share&finding=blocker", "warning", "findings")).toBe("/result?source=share&finding=warning#findings");
    expect(resultViewUrlFor("/result", "?finding=warning", "all", "purchase-list")).toBe("/result#purchase-list");
  });

  it("adds only the supported view state to a saved-build share path", () => {
    const viewState = { path: "/result?finding=blocker#findings", findingFilter: "blocker" as const, section: "findings" as const };
    expect(savedBuildSharePathFor("build/with spaces", viewState)).toBe("/share/build%2Fwith%20spaces?finding=blocker#findings");
    expect(savedBuildShareUrlFor("https://pc-supporter.example", "build-1", { path: "/result", findingFilter: "all" })).toBe("https://pc-supporter.example/share/build-1");
  });
});
