import { describe, expect, it } from "vitest";
import { accessoryFitReviewNoticeFor } from "./accessory-fit-review";

describe("accessoryFitReviewNoticeFor", () => {
  it.each([
    ["gpu_support", "지지대 장착 방식"],
    ["gpu_cooler", "그래픽카드 모델별 장착"],
    ["memory_cooler", "DIMM 높이"],
    ["thermal_pad", "두께·면적"]
  ] as const)("asks buyers to check the unassessed fit details for %s", (category, expectedText) => {
    expect(accessoryFitReviewNoticeFor(category)).toContain(expectedText);
  });

  it("does not warn categories that already have a supported fit or connection profile", () => {
    expect(accessoryFitReviewNoticeFor("cooling_fan")).toBeUndefined();
    expect(accessoryFitReviewNoticeFor("m2_heatsink")).toBeUndefined();
    expect(accessoryFitReviewNoticeFor("ups")).toBeUndefined();
  });
});
