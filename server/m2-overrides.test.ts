import { describe, expect, it } from "vitest";
import type { M2SlotOverride, Part } from "../shared/types";
import { applyM2SlotOverrides, normalizeM2SlotId, stripM2SlotOverride, validateM2SlotOverride } from "./m2-overrides";

const board = (): Part => ({
  id: "mb-manual-test",
  category: "motherboard",
  name: "매뉴얼 테스트 메인보드",
  source: "seed",
  listingType: "retail",
  specs: { m2Slots: 2 },
  dataQuality: "seed",
  missingFields: [],
  updatedAt: "2026-08-28T00:00:00.000Z"
});

describe("M.2 slot overrides", () => {
  it("normalizes supported M.2 slot identifiers", () => {
    expect(normalizeM2SlotId("m.2-1")).toBe("M2_1");
    expect(normalizeM2SlotId("M2_8")).toBe("M2_8");
    expect(normalizeM2SlotId("M.2 2280")).toBeUndefined();
  });

  it("validates and normalizes a structured manual mapping", () => {
    const result = validateM2SlotOverride("mb-manual-test", {
      slots: [
        { slotId: "M.2_1", interfaces: ["NVMe"], pcieGeneration: "5", connection: "cpu", sharedWith: [] },
        { slotId: "M2_2", interfaces: "NVMe, SATA", pcieGeneration: 4, connection: "chipset", sharedWith: "SATA_3, SATA_4" }
      ],
      sourceNote: "제조사 매뉴얼 12페이지",
      sourceUrl: "https://www.example.com/manual.pdf"
    });

    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({
      partId: "mb-manual-test",
      slots: [
        { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 5, connection: "cpu", sharedWith: [] },
        { slotId: "M2_2", interfaces: ["NVMe", "SATA"], pcieGeneration: 4, connection: "chipset", sharedWith: ["SATA_3", "SATA_4"] }
      ],
      sourceNote: "제조사 매뉴얼 12페이지",
      sourceUrl: "https://www.example.com/manual.pdf"
    });
  });

  it("rejects duplicate slots, invalid generations, and non-HTTPS sources", () => {
    const result = validateM2SlotOverride("mb-manual-test", {
      slots: [
        { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 1, connection: "cpu" },
        { slotId: "M2_1", interfaces: ["SATA"], pcieGeneration: 7, connection: "bad" }
      ],
      sourceUrl: "javascript:alert(1)"
    });

    expect(result.value).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      "M2_1 슬롯이 중복되었습니다.",
      "M2_1: PCIe 세대는 2부터 6 사이의 숫자여야 합니다.",
      "sourceUrl은 HTTPS 주소만 사용할 수 있습니다."
    ]));
  });

  it("applies overrides at runtime and strips them before catalog persistence", () => {
    const value: M2SlotOverride = {
      partId: "mb-manual-test",
      slots: [
        { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 5, connection: "cpu", sharedWith: [] },
        { slotId: "M2_2", interfaces: ["NVMe"], pcieGeneration: 4, connection: "chipset", sharedWith: [] }
      ],
      updatedAt: "2026-08-28T00:00:00.000Z"
    };
    const applied = applyM2SlotOverrides([board()], { [value.partId]: value });

    expect(applied[0].specs.m2SlotProfiles).toEqual(value.slots);
    expect(stripM2SlotOverride(applied[0]).specs.m2SlotProfiles).toBeUndefined();
  });
});
