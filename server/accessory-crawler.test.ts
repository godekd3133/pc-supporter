import { describe, expect, it } from "vitest";
import type { DanawaListItem } from "./danawa";
import { parseAccessorySpecs, selectAccessoryListWindow } from "./accessory-crawler";

function listItem(sourceProductCode: string, name = sourceProductCode): DanawaListItem {
  return { sourceProductCode, name, url: `https://prod.danawa.com/info/?pcode=${sourceProductCode}&cate=11324022` };
}

describe("accessory crawl page selection", () => {
  it("skips a requested offset across pages and ignores repeated product codes", () => {
    const pages = [
      [listItem("1"), listItem("2"), listItem("3")],
      [listItem("3"), listItem("4"), listItem("5")],
      [listItem("6")]
    ];

    expect(selectAccessoryListWindow(pages, 3, 2).map((item) => item.sourceProductCode)).toEqual(["4", "5"]);
    expect(selectAccessoryListWindow(pages, 5, 2).map((item) => item.sourceProductCode)).toEqual(["6"]);
  });

  it("returns the complete unique list when the crawl is not windowed", () => {
    const pages = [[listItem("1"), listItem("2")], [listItem("2"), listItem("3")]];

    expect(selectAccessoryListWindow(pages, 0, Number.MAX_SAFE_INTEGER).map((item) => item.sourceProductCode)).toEqual(["1", "2", "3"]);
  });

  it("can skip already-live products for an automatic incomplete-only batch", () => {
    const pages = [[listItem("1"), listItem("2")], [listItem("3"), listItem("4")]];

    expect(selectAccessoryListWindow(pages, 0, 2, new Set(["1", "2"])).map((item) => item.sourceProductCode)).toEqual(["3", "4"]);
  });

  it("preserves the M.2 heatsink form factor dimension", () => {
    expect(parseAccessorySpecs("m2_heatsink", "M.2 (2242) SSD 방열판").formFactor).toBe("M.2 2242");
  });

  it("parses cooling-fan motor current without using RGB LED current", () => {
    expect(parseAccessorySpecs("cooling_fan", "팬 개수: 2개 / 팬 소비전류: 0.18A / RGB LED 소비전류: 1.2A")).toMatchObject({ fanCount: 2, fanCurrentA: 0.18 });
    expect(parseAccessorySpecs("cooling_fan", "LED팬 소비전류: 1.2A")).not.toHaveProperty("fanCurrentA");
  });
});
