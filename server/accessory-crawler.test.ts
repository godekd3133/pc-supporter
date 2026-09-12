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

  it("parses an explicit storage adapter mount count without confusing capacity with device count", () => {
    expect(parseAccessorySpecs("storage_accessory", "변환 컨버터 / M.2→PCIe 카드 / PCIe 3.0x4 / 보관(장착) 개수: 최대 4개")).toMatchObject({
      adapterStorageDeviceCount: 4,
      adapterPcieSlotWidth: 4
    });
    expect(parseAccessorySpecs("storage_accessory", "M.2 to PCI-E 4x / NVMe")).toMatchObject({ adapterPcieSlotWidth: 4 });
    expect(parseAccessorySpecs("storage_accessory", "M.2→PCIe 카드 / NVMe")).not.toHaveProperty("adapterPcieSlotWidth");
    expect(parseAccessorySpecs("storage_accessory", "USB SATA 컨버터 / 최대 14TB 지원")).not.toHaveProperty("adapterStorageDeviceCount");
  });

  it("parses cooling-fan motor current without using RGB LED current", () => {
    expect(parseAccessorySpecs("cooling_fan", "팬 개수: 2개 / 팬 소비전류: 0.18A / RGB LED 소비전류: 1.2A")).toMatchObject({ fanCount: 2, fanCurrentA: 0.18 });
    expect(parseAccessorySpecs("cooling_fan", "LED팬 소비전류: 1.2A")).not.toHaveProperty("fanCurrentA");
  });

  it("parses cooling evidence for GPU and memory cooler categories", () => {
    expect(parseAccessorySpecs("memory_cooler", "DDR5 DIMM용 / 팬 2개 / 팬 소비전류: 0.12A / 5V ARGB")).toMatchObject({
      fanCount: 2,
      fanCurrentA: 0.12,
      rgbDeviceVoltage: "5V"
    });
    expect(parseAccessorySpecs("gpu_cooler", "PCI 슬롯 장착형 / 팬 개수: 1개 / 팬 크기: 92x92x25mm / 12V RGB")).toMatchObject({
      fanCount: 1,
      lengthMm: 92,
      widthMm: 92,
      thicknessMm: 25,
      rgbDeviceVoltage: "12V"
    });
  });
});
