import { describe, expect, it } from "vitest";
import type { AccessoryItem } from "../shared/types";
import { accessoryPowerRailsFor, fanCurrentAFor, fanHubConnectionPlanFor } from "./accessory-connectivity";
import { rgbFanDeviceCountFor, rgbFanVoltageFor } from "../shared/rgb-connectivity";

function accessory(rawSpecText: string): AccessoryItem {
  return {
    id: "hub",
    category: "fan_hub",
    name: "테스트 팬·RGB 허브",
    source: "manual",
    listingType: "accessory",
    rawSpecText,
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-08-31T00:00:00.000Z"
  };
}

describe("accessory power rails", () => {
  it("keeps voltage-scoped fan and RGB capacities separate", () => {
    const rails = accessoryPowerRailsFor(accessory("작동전압: 팬 12V , LED 5V / 최대 허용전력: 4.5A, (12V)54W, (5V)22.5W"));

    expect(rails).toEqual([
      { voltage: "5V", maxPowerW: 22.5, maxCurrentA: 4.5, role: "rgb" },
      { voltage: "12V", maxPowerW: 54, maxCurrentA: 4.5, role: "fan" }
    ]);
  });

  it("identifies only explicit RGB/ARGB cooling fans and preserves their voltage evidence", () => {
    const rgbFan = { ...accessory("팬 개수: 3개 / ARGB / 작동전압: 팬 12V , LED 5V"), category: "cooling_fan" as const };
    const nonRgbFan = { ...accessory("팬 개수: 3개 / non-LED / 작동전압: 팬 12V"), category: "cooling_fan" as const };
    expect(rgbFanDeviceCountFor(rgbFan)).toBe(3);
    expect(rgbFanVoltageFor(rgbFan)).toBe("5V");
    expect(rgbFanDeviceCountFor(nonRgbFan)).toBe(0);
    expect(rgbFanVoltageFor(nonRgbFan)).toBeUndefined();
  });

  it("supports power-before-voltage notation without assigning generic limits", () => {
    expect(accessoryPowerRailsFor(accessory("작동전압: 팬 12V / 최대 허용전력: 2A, 24W(12V)"))).toEqual([
      { voltage: "12V", maxPowerW: 24, maxCurrentA: 2, role: "fan" }
    ]);
    expect(accessoryPowerRailsFor(accessory("작동전압: 팬 12V / 최대 허용전력: 7A, 84W"))).toEqual([]);
  });

  it("keeps slash-separated rail limits from the same maximum-power field", () => {
    expect(accessoryPowerRailsFor(accessory("작동전압: 팬 12V , LED 5V / 최대 허용전력: 2A, 24W(12V) / 4.5A, 22.5W(5V) / LED시스템: 제조사 소프트웨어"))).toEqual([
      { voltage: "5V", maxPowerW: 22.5, maxCurrentA: 4.5, role: "rgb" },
      { voltage: "12V", maxPowerW: 24, maxCurrentA: 2, role: "fan" }
    ]);
  });

  it("uses structured fan motor current and keeps its manufacturer provenance in the plan", () => {
    const fan = {
      ...accessory("RGB LED 소비전류: 1.2A / 팬 소비전류: 0.18A"),
      id: "structured-fan",
      category: "cooling_fan" as const,
      specs: {
        fanCount: 2,
        fanCurrentA: 0.24,
        fanLoadProvenance: {
          manufacturerModel: "STRUCTURED-FAN-REV-A",
          sourceNote: "제조사 매뉴얼 정격전류 표",
          updatedAt: "2026-09-01T00:00:00.000Z"
        }
      }
    };
    const hub = {
      ...accessory("팬분배: 4개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 1A"),
      id: "structured-hub"
    };

    expect(fanCurrentAFor(fan)).toBe(0.24);
    const plan = fanHubConnectionPlanFor(hub, [{ selection: { accessoryId: fan.id, quantity: 1 }, item: fan }]);
    expect(plan).toMatchObject({ totalCurrentA: 0.48, currentHeadroomA: 0.52, currentStatus: "pass", fans: [{ currentA: 0.24, currentProvenance: { manufacturerModel: "STRUCTURED-FAN-REV-A" } }] });
  });
});
