import { describe, expect, it } from "vitest";
import type { PartSpecs } from "./types";
import { buildConnectivitySummaryFor } from "./build-connectivity";

describe("build connectivity summary", () => {
  it("reports fan, RGB header, and voltage capacity when all facts are known", () => {
    const motherboard: PartSpecs = { fanPortCount: 4, rgbPortCount: 3, rgb5vPortCount: 2, rgb12vPortCount: 1 };
    const computerCase: PartSpecs = { fanCount: 3, rgbDeviceCount: 2, rgbDeviceVoltage: "5V" };

    const summary = buildConnectivitySummaryFor(motherboard, computerCase);

    expect(summary.status).toBe("pass");
    expect(summary.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "fan-headers", status: "pass", used: 3, capacity: 4, headroom: 1 }),
      expect.objectContaining({ id: "rgb-headers", status: "pass", used: 2, capacity: 3, headroom: 1 }),
      expect.objectContaining({ id: "rgb-voltage", status: "pass", detail: "필요 전압 5V / 해당 전압 단자 확인됨" })
    ]));
  });

  it("marks overloaded fan headers and absent voltage headers as review", () => {
    const motherboard: PartSpecs = { fanPortCount: 2, rgbPortCount: 2, rgb5vPortCount: 1, rgb12vPortCount: 0 };
    const computerCase: PartSpecs = { fanCount: 5, rgbDeviceCount: 4, rgbDeviceVoltage: "12V" };

    const summary = buildConnectivitySummaryFor(motherboard, computerCase);

    expect(summary.status).toBe("review");
    expect(summary.items.find((item) => item.id === "fan-headers")).toMatchObject({ status: "review", headroom: -3, detail: "5개 사용 / 2개 확인 / 3개 부족" });
    expect(summary.items.find((item) => item.id === "rgb-headers")).toMatchObject({ status: "pass", detail: "4개 장치 / 메인보드 RGB 헤더 2개 / 분배 케이블이나 데이지 체인으로 연결" });
    expect(summary.items.find((item) => item.id === "rgb-voltage")).toMatchObject({ status: "review", detail: "필요 전압 12V / 12V 연결 단자 없음" });
  });

  it("flags RGB devices only when the motherboard has no RGB header", () => {
    const summary = buildConnectivitySummaryFor({ fanPortCount: 4, rgbPortCount: 0 }, { fanCount: 3, rgbDeviceCount: 3 });

    expect(summary.items.find((item) => item.id === "rgb-headers")).toMatchObject({ status: "review", headroom: -3 });
  });

  it("counts the pump header as a fan header only with an air cooler", () => {
    const motherboard: PartSpecs = { fanPortCount: 3, pumpFanHeaderCount: 1 };
    const computerCase: PartSpecs = { fanCount: 4, rgbDeviceCount: 0 };

    expect(buildConnectivitySummaryFor(motherboard, computerCase, "air").items.find((item) => item.id === "fan-headers")).toMatchObject({ status: "pass", capacity: 4 });
    expect(buildConnectivitySummaryFor(motherboard, computerCase, "liquid").items.find((item) => item.id === "fan-headers")).toMatchObject({ status: "review", capacity: 3 });
    expect(buildConnectivitySummaryFor(motherboard, computerCase).items.find((item) => item.id === "fan-headers")).toMatchObject({ status: "review", capacity: 3 });
  });

  it("passes fan and RGB connection when the case includes a hub and controller", () => {
    const summary = buildConnectivitySummaryFor({ fanPortCount: 1 }, { fanCount: 6, fanHubIncluded: true, rgbDeviceCount: 6, rgbDeviceVoltage: "5V", rgbControllerIncluded: true });

    expect(summary.status).toBe("pass");
    expect(summary.items.map((item) => item.status)).toEqual(["pass", "pass", "pass"]);
  });

  it("does not guess a connection status when required facts are missing", () => {
    const summary = buildConnectivitySummaryFor({}, { fanCount: 4, rgbDeviceCount: 2, rgbDeviceVoltage: "mixed" });

    expect(summary.status).toBe("unknown");
    expect(summary.items.find((item) => item.id === "fan-headers")).toMatchObject({ status: "unknown" });
    expect(summary.items.find((item) => item.id === "rgb-headers")).toMatchObject({ status: "unknown" });
    expect(summary.items.find((item) => item.id === "rgb-voltage")).toMatchObject({ status: "unknown", detail: "필요 전압 5V + 12V / 메인보드의 해당 전압 연결 수 확인 필요" });
  });

  it("does not render a summary until both case and motherboard are selected", () => {
    expect(buildConnectivitySummaryFor(undefined, { fanCount: 2 }).status).toBe("not_applicable");
    expect(buildConnectivitySummaryFor({ fanPortCount: 2 }, undefined).items).toEqual([]);
  });
});
