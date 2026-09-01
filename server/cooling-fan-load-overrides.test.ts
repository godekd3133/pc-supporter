import { describe, expect, it } from "vitest";
import type { AccessoryItem } from "../shared/types";
import { fanCurrentAFromText } from "../shared/fan-connectivity";
import {
  applyCoolingFanLoadOverrides,
  coolingFanLoadCoverageFor,
  stripCoolingFanLoadOverride,
  validateCoolingFanLoadOverride,
  validateCoolingFanLoadOverrideBatch
} from "./cooling-fan-load-overrides";

function accessory(overrides: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "fan-1",
    category: "cooling_fan",
    name: "테스트 120mm PWM 팬",
    brand: "테스트 제조사",
    model: "TEST-FAN-120",
    source: "manual",
    listingType: "accessory",
    specs: { fanCount: 1, lengthMm: 120, widthMm: 120 },
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  };
}

describe("cooling fan motor current evidence", () => {
  it("parses fan motor current without confusing RGB LED current", () => {
    expect(fanCurrentAFromText("팬 소비전류: 0.20A / ARGB LED 소비전류: 1.2A")).toBe(0.2);
    expect(fanCurrentAFromText("LED팬 소비전류: 1.2A / 소비전류: 0.18A")).toBe(0.18);
    expect(fanCurrentAFromText("ARGB LED 소비전류: 1.2A")).toBeUndefined();
    expect(fanCurrentAFromText("정격 전류: 0.25A")).toBe(0.25);
  });

  it("requires a positive current and auditable manufacturer evidence", () => {
    const fan = accessory();
    const valid = validateCoolingFanLoadOverride(fan, { fanCurrentA: "0.2", manufacturerModel: "TEST-FAN-120", sourceNote: "제조사 매뉴얼 정격전류 표", sourceUrl: "https://vendor.example/fan" });
    expect(valid.errors).toEqual([]);
    expect(valid.value).toMatchObject({ accessoryId: fan.id, fanCurrentA: 0.2, manufacturerModel: "TEST-FAN-120", sourceNote: "제조사 매뉴얼 정격전류 표", sourceUrl: "https://vendor.example/fan" });

    const invalid = validateCoolingFanLoadOverride(fan, { fanCurrentA: 0, manufacturerModel: "", sourceNote: "", sourceUrl: "http://vendor.example/fan" });
    expect(invalid.value).toBeUndefined();
    expect(invalid.errors).toEqual(expect.arrayContaining([
      "팬 소비전류(fanCurrentA)가 필요합니다.",
      "제조사 모델/SKU(manufacturerModel)가 필요합니다.",
      "검수 근거 sourceNote가 필요합니다.",
      "sourceUrl은 HTTPS 주소만 사용할 수 있습니다."
    ]));
  });

  it("stops an entire batch when one fan is missing or belongs to another category", () => {
    const fan = accessory();
    const thermalGrease = accessory({ id: "grease-1", category: "thermal_grease", name: "테스트 써멀" });
    const validation = validateCoolingFanLoadOverrideBatch({ items: [
      { accessoryId: fan.id, fanCurrentA: 0.2, manufacturerModel: "TEST-FAN-120", sourceNote: "매뉴얼" },
      { accessoryId: thermalGrease.id, fanCurrentA: 0.2, manufacturerModel: "TEST-GREASE", sourceNote: "매뉴얼" },
      { accessoryId: "missing-fan", fanCurrentA: 0.2, manufacturerModel: "MISSING", sourceNote: "매뉴얼" }
    ] }, [fan, thermalGrease]);

    expect(validation.items).toHaveLength(3);
    expect(validation.items.filter((item) => item.valid)).toHaveLength(1);
    expect(validation.validOverrides).toEqual([]);
    expect(validation.errors.join(" ")).toContain("팬 소비전류 보강은 쿨링팬만 대상으로 등록할 수 있습니다.");
    expect(validation.errors.join(" ")).toContain("카탈로그에서 주변 부품을 찾을 수 없습니다.");
  });

  it("applies override provenance and reports raw-vs-manual coverage separately", () => {
    const rawFan = accessory({ id: "raw-fan", rawSpecText: "팬 소비전류: 0.18A" });
    const missingFan = accessory({ id: "missing-fan", name: "근거 없는 팬" });
    const override = {
      accessoryId: missingFan.id,
      fanCurrentA: 0.22,
      manufacturerModel: "TEST-FAN-120-REV-B",
      sourceNote: "제조사 매뉴얼 정격전류 표",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };
    const applied = applyCoolingFanLoadOverrides([rawFan, missingFan], { [missingFan.id]: override });
    expect(applied[0].specs.fanCurrentA).toBeUndefined();
    expect(applied[1]).toMatchObject({ specs: { fanCurrentA: 0.22, fanLoadProvenance: { manufacturerModel: override.manufacturerModel, sourceNote: override.sourceNote } } });
    expect(coolingFanLoadCoverageFor([rawFan, missingFan], { [missingFan.id]: override })).toMatchObject({ totalCoolingFans: 2, registeredCount: 1, knownCount: 1, missingCount: 1, coveragePercent: 50 });
    expect(stripCoolingFanLoadOverride(applied[1]).specs).not.toHaveProperty("fanLoadProvenance");
  });
});
