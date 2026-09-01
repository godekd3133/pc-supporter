import { describe, expect, it } from "vitest";
import type { AccessoryItem, AccessorySelection, BuildSelection, Part, PartCategory, PartSpecs } from "../shared/types";
import { accessoryCompatibilityFor } from "./accessory-compatibility";

function part(id: string, category: PartCategory, specs: PartSpecs = {}, rawSpecText = ""): Part {
  return {
    id,
    category,
    name: id,
    source: "manual",
    rawSpecText,
    specs,
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-08-31T00:00:00.000Z"
  };
}

function accessory(id: string, category: AccessoryItem["category"], specs: PartSpecs = {}, rawSpecText = ""): AccessoryItem {
  return {
    id,
    category,
    name: id,
    source: "manual",
    listingType: "accessory",
    rawSpecText,
    specs,
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-08-31T00:00:00.000Z"
  };
}

function build(accessories: AccessorySelection[], ssdQuantity = 1): BuildSelection {
  return {
    motherboard: { partId: "board", quantity: 1 },
    case: { partId: "case", quantity: 1 },
    ssd: [{ partId: "ssd", quantity: ssdQuantity }],
    memory: [],
    hdd: [],
    accessories,
    useIntegratedGraphics: true
  };
}

const casePart = part("case", "case", { fanCount: 2 }, "전면 120mm / 후면 140mm / 쿨링팬: 총 2개");
const motherboardPart = part("board", "motherboard", { fanPortCount: 3 });
const ssdPart = part("ssd", "ssd", { formFactor: "M.2 2280" });

describe("accessory compatibility", () => {
  it("accepts matching M.2 heatsink, case fan, and fan hub selections", () => {
    const selections = [
      { accessoryId: "heatsink", quantity: 1 },
      { accessoryId: "fan", quantity: 1 },
      { accessoryId: "hub", quantity: 1 }
    ];
    const result = accessoryCompatibilityFor(build(selections), [casePart, motherboardPart, ssdPart], [
      accessory("heatsink", "m2_heatsink", { formFactor: "M.2 2280" }),
      accessory("fan", "cooling_fan", { lengthMm: 120, widthMm: 120 }, "팬 크기: 120mm / 4핀 / 소비전류: 0.20A"),
      accessory("hub", "fan_hub", { fanPortCount: 4 }, "팬분배: 4개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 1A")
    ]);

    expect(result).toMatchObject({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 });
    expect(result.findings).toHaveLength(0);
    expect(result.connectionPlans).toEqual([
      expect.objectContaining({
        status: "pass",
        connectorStatus: "pass",
        currentStatus: "pass",
        hubFanOutputs: ["4핀 PWM"],
        externalPower: "SATA",
        fanCount: 1,
        totalCurrentA: 0.2,
        maxFanCurrentA: 1,
        currentHeadroomA: 0.8,
        fans: [expect.objectContaining({ name: "fan", totalFanCount: 1, connectorTypes: ["4핀 PWM"], currentA: 0.2 })]
      })
    ]);
  });

  it("exposes separate 12V fan and 5V RGB rails in both connection plans", () => {
    const rgbCase = part("rgb-case", "case", { fanCount: 2, rgbDeviceCount: 3, rgbDeviceVoltage: "5V", rgbDeviceCurrentA: 0.5 }, "전면 120mm / 쿨링팬: 총 2개");
    const fan = accessory("plain-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 4핀 / 소비전류: 0.20A");
    const hub = accessory("rgb-hub", "fan_hub", { fanPortCount: 6, rgbPortCount: 6 }, "팬컨트롤러 / 입력단자: PWM, ARGB 3핀, SATA전원 / 분배단자: PWM 4핀, ARGB 3핀 / 팬분배: 6개 / RGB분배: 6개 / 작동전압: 팬 12V , LED 5V / 최대 허용전력: 4.5A, (12V)54W, (5V)22.5W");

    const result = accessoryCompatibilityFor({
      ...build([
        { accessoryId: fan.id, quantity: 1 },
        { accessoryId: hub.id, quantity: 1 }
      ]),
      case: { partId: rgbCase.id, quantity: 1 }
    }, [rgbCase, motherboardPart, ssdPart], [fan, hub]);

    expect(result).toMatchObject({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 });
    expect(result.connectionPlans?.[0].powerRails).toEqual([
      { voltage: "5V", maxPowerW: 22.5, maxCurrentA: 4.5, role: "rgb" },
      { voltage: "12V", maxPowerW: 54, maxCurrentA: 4.5, role: "fan" }
    ]);
    expect(result.rgbConnectionPlans?.[0]).toMatchObject({
      controllerId: hub.id,
      status: "pass",
      rgbLoadStatus: "known",
      rgbPerDeviceCurrentA: 0.5,
      rgbTotalCurrentA: 1.5,
      rgbTotalPowerW: 7.5,
      rgbCurrentHeadroomA: 3,
      rgbPowerHeadroomW: 15,
      powerRails: [
        { voltage: "5V", maxPowerW: 22.5, maxCurrentA: 4.5, role: "rgb" },
        { voltage: "12V", maxPowerW: 54, maxCurrentA: 4.5, role: "fan" }
      ]
    });
  });

  it("blocks an additional-fan plan when the selected hub has too few output ports", () => {
    const fan = accessory("multi-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 팬 개수: 1개 / 4핀 / 소비전류: 0.20A");
    const hub = accessory("small-output-hub", "fan_hub", { fanPortCount: 2 }, "팬분배: 2개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 5A, 60W");

    const result = accessoryCompatibilityFor(build([
      { accessoryId: fan.id, quantity: 3 },
      { accessoryId: hub.id, quantity: 1 }
    ]), [casePart, motherboardPart, ssdPart], [fan, hub]);

    expect(result).toMatchObject({ status: "incompatible", blockerCount: 1, warningCount: 0, unknownCount: 0 });
    expect(result.findings[0]).toMatchObject({ ruleId: "accessory-fan-hub-output-ports", severity: "blocker" });
    expect(result.connectionPlans?.[0]).toMatchObject({
      status: "blocked",
      hubFanPortCount: 2,
      fanCount: 3,
      assignedFanCount: 2,
      unassignedFanCount: 1,
      portStatus: "blocked",
      portIssue: "over_limit",
      portAssignments: [{ accessoryId: fan.id, portStart: 1, portEnd: 2, fanCount: 2 }]
    });
  });

  it("calculates RGB rail load when case evidence exists and blocks an over-limit load", () => {
    const rgbCase = part("case", "case", { fanCount: 0, rgbDeviceCount: 3, rgbDeviceVoltage: "5V", rgbDevicePowerW: 8 }, "LED팬: 3개");
    const controller = accessory("over-rgb-controller", "fan_hub", { rgbPortCount: 6 }, "RGB컨트롤러 / 입력단자: ARGB 3핀, SATA전원 / 분배단자: ARGB 3핀 / RGB분배: 6개 / 작동전압: LED 5V / 최대 허용전력: (5V)22.5W");
    const result = accessoryCompatibilityFor(build([{ accessoryId: controller.id, quantity: 1 }]), [rgbCase, motherboardPart, ssdPart], [controller]);

    expect(result).toMatchObject({ status: "incompatible", blockerCount: 1, warningCount: 0, unknownCount: 0 });
    expect(result.findings[0]).toMatchObject({ ruleId: "accessory-rgb-controller-power", severity: "blocker" });
    const plan = result.rgbConnectionPlans?.[0];
    expect(plan).toMatchObject({
      issue: "rgb_power_over_limit",
      status: "blocked",
      rgbLoadStatus: "over_limit",
      rgbPerDevicePowerW: 8,
      rgbTotalPowerW: 24,
      rgbTotalCurrentA: 4.8
    });
    expect(plan?.rgbPowerHeadroomW).toBeCloseTo(-1.5, 8);
    expect(plan?.rgbCurrentHeadroomA).toBeCloseTo(-0.3, 8);
  });

  it("keeps RGB load reviewable when the controller rail capacity is missing", () => {
    const rgbCase = part("case", "case", { fanCount: 0, rgbDeviceCount: 2, rgbDeviceVoltage: "5V", rgbDeviceCurrentA: 0.5 }, "LED팬: 2개");
    const controller = accessory("unknown-rgb-capacity", "fan_hub", { rgbPortCount: 4 }, "RGB컨트롤러 / 입력단자: ARGB 3핀, SATA전원 / 분배단자: ARGB 3핀 / RGB분배: 4개 / 작동전압: LED 5V");
    const result = accessoryCompatibilityFor(build([{ accessoryId: controller.id, quantity: 1 }]), [rgbCase, motherboardPart, ssdPart], [controller]);

    expect(result).toMatchObject({ status: "needs_review", blockerCount: 0, warningCount: 0, unknownCount: 1 });
    expect(result.findings[0]).toMatchObject({ ruleId: "accessory-rgb-controller-power", severity: "unknown" });
    expect(result.rgbConnectionPlans?.[0]).toMatchObject({ issue: "rgb_capacity_unknown", rgbLoadStatus: "unknown", rgbTotalPowerW: 5, rgbTotalCurrentA: 1, status: "review" });
  });

  it("counts selected RGB cooling fans in the controller plan", () => {
    const rgbCase = part("case", "case", { fanCount: 0, rgbDeviceCount: 3, rgbDeviceVoltage: "5V" }, "LED팬: 3개");
    const rgbFan = accessory("selected-rgb-fan", "cooling_fan", { lengthMm: 120, fanCount: 2 }, "팬 크기: 120mm / 팬 개수: 2개 / 3-4핀 / ARGB / 작동전압: 팬 12V , LED 5V");
    const controller = accessory("rgb-fan-controller", "fan_hub", { fanPortCount: 6, rgbPortCount: 6 }, "팬컨트롤러 / 입력단자: PWM, ARGB 3핀, SATA전원 / 분배단자: PWM 4핀, ARGB 3핀 / 팬분배: 6개 / RGB분배: 6개 / 작동전압: 팬 12V , LED 5V / 최대 허용전력: (12V)54W, (5V)22.5W");
    const result = accessoryCompatibilityFor({
      ...build([{ accessoryId: rgbFan.id, quantity: 1 }, { accessoryId: controller.id, quantity: 1 }]),
      case: { partId: rgbCase.id, quantity: 1 }
    }, [rgbCase, motherboardPart, ssdPart], [rgbFan, controller]);

    expect(result.rgbConnectionPlans?.[0]).toMatchObject({
      deviceCount: 5,
      caseDeviceCount: 3,
      additionalFanDeviceCount: 2,
      requiredVoltages: ["5V"],
      issue: "rgb_load_unknown",
      status: "review",
      devices: [
        { id: rgbCase.id, kind: "case", count: 3, voltage: "5V" },
        { id: rgbFan.id, kind: "cooling_fan", count: 2, voltage: "5V" }
      ]
    });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "accessory-rgb-controller-power", severity: "unknown" })
    ]));
  });

  it("blocks a fan or M.2 heatsink when its physical format does not match", () => {
    const result = accessoryCompatibilityFor(build([
      { accessoryId: "wrong-heatsink", quantity: 1 },
      { accessoryId: "wrong-fan", quantity: 1 }
    ]), [casePart, motherboardPart, ssdPart], [
      accessory("wrong-heatsink", "m2_heatsink", { formFactor: "M.2 2242" }),
      accessory("wrong-fan", "cooling_fan", { lengthMm: 200, widthMm: 200 })
    ]);

    expect(result.status).toBe("incompatible");
    expect(result.blockerCount).toBe(2);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "accessory-m2-heatsink-form-factor",
      "accessory-cooling-fan-size"
    ]);
    expect(result.findings[0].facts).toEqual(expect.arrayContaining([
      { label: "선택한 SSD 규격", actual: "M.2 2280" },
      { label: "방열판 지원 규격", expected: "M.2 2242" }
    ]));
  });

  it("keeps incomplete accessory facts as review and reports quantity or port shortages", () => {
    const result = accessoryCompatibilityFor(build([
      { accessoryId: "heatsink", quantity: 1 },
      { accessoryId: "unknown-fan", quantity: 1 },
      { accessoryId: "small-hub", quantity: 1 }
    ], 2), [casePart, motherboardPart, ssdPart], [
      accessory("heatsink", "m2_heatsink", { formFactor: "M.2 2280" }),
      accessory("unknown-fan", "cooling_fan"),
      accessory("small-hub", "fan_hub", { fanPortCount: 1 }, "팬분배: 1개 / SATA전원")
    ]);

    expect(result.status).toBe("needs_review");
    expect(result.blockerCount).toBe(0);
    expect(result.warningCount).toBe(2);
    expect(result.unknownCount).toBe(3);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "accessory-m2-heatsink-quantity",
      "accessory-cooling-fan-size",
      "accessory-fan-hub-ports",
      "accessory-fan-hub-topology",
      "accessory-fan-hub-current"
    ]);
    expect(result.connectionPlans).toEqual([
      expect.objectContaining({ status: "review", connectorStatus: "review", currentStatus: "review", connectorIssue: "unknown", currentIssue: "unknown", fanCount: 1, summary: expect.stringContaining("전류 근거 확인 필요") })
    ]);
  });

  it("reports a missing saved accessory as an unknown check instead of silently ignoring it", () => {
    const result = accessoryCompatibilityFor(build([{ accessoryId: "missing", quantity: 1 }]), [casePart, motherboardPart, ssdPart], []);

    expect(result).toMatchObject({ status: "needs_review", unknownCount: 1 });
    expect(result.findings[0]).toMatchObject({ ruleId: "accessory-selection", accessoryId: "missing" });
  });

  it("does not mark peripherals compatible when their host parts are not selected yet", () => {
    const partialBuild = { ...build([
      { accessoryId: "heatsink", quantity: 1 },
      { accessoryId: "fan", quantity: 1 },
      { accessoryId: "hub", quantity: 1 }
    ]), case: undefined, motherboard: undefined, ssd: [] };
    const result = accessoryCompatibilityFor(partialBuild, [], [
      accessory("heatsink", "m2_heatsink", { formFactor: "M.2 2280" }),
      accessory("fan", "cooling_fan", { lengthMm: 120 }),
      accessory("hub", "fan_hub", { fanPortCount: 4 }, "팬분배: 4개 / SATA전원")
    ]);

    expect(result).toMatchObject({ status: "needs_review", blockerCount: 0, warningCount: 0, unknownCount: 5 });
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "accessory-m2-heatsink-form-factor",
      "accessory-cooling-fan-size",
      "accessory-fan-hub-ports",
      "accessory-fan-hub-topology",
      "accessory-fan-hub-current"
    ]);
  });

  it("checks UPS output against confirmed CPU and GPU power without converting VA implicitly", () => {
    const cpu = part("cpu", "cpu", { tdpW: 120 });
    const gpu = part("gpu", "gpu", { powerW: 260 });
    const safe = accessoryCompatibilityFor({ ...build([{ accessoryId: "ups-safe", quantity: 1 }]), cpu: { partId: cpu.id, quantity: 1 }, gpu: { partId: gpu.id, quantity: 1 } }, [casePart, motherboardPart, ssdPart, cpu, gpu], [accessory("ups-safe", "ups", { outputW: 500, capacityVa: 700 })]);
    expect(safe).toMatchObject({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 });

    const low = accessoryCompatibilityFor({ ...build([{ accessoryId: "ups-low", quantity: 1 }]), cpu: { partId: cpu.id, quantity: 1 }, gpu: { partId: gpu.id, quantity: 1 } }, [casePart, motherboardPart, ssdPart, cpu, gpu], [accessory("ups-low", "ups", { outputW: 350, capacityVa: 700 })]);
    expect(low).toMatchObject({ status: "needs_review", warningCount: 1 });
    expect(low.findings[0].ruleId).toBe("accessory-ups-capacity");
    expect(low.findings[0].facts).toEqual(expect.arrayContaining([
      { label: "확인된 CPU·GPU 전력", actual: "380W" },
      { label: "UPS 출력", actual: "350W" }
    ]));

    const unknown = accessoryCompatibilityFor({ ...build([{ accessoryId: "ups-va", quantity: 1 }]), cpu: { partId: cpu.id, quantity: 1 }, gpu: { partId: gpu.id, quantity: 1 } }, [casePart, motherboardPart, ssdPart, cpu, gpu], [accessory("ups-va", "ups", { capacityVa: 700 })]);
    expect(unknown).toMatchObject({ status: "needs_review", unknownCount: 1 });
    expect(unknown.findings[0].facts).toContainEqual({ label: "UPS 용량", actual: "700VA" });
  });

  it("checks M.2 storage adapter form factor and signal support without treating missing targets as compatible", () => {
    const nvmeSsd = part("ssd", "ssd", { formFactor: "M.2 2280", interface: "NVMe" });
    const pcieAdapter = accessory("pcie-adapter", "storage_accessory", { interface: "NVMe", formFactor: "M.2 2280" }, "변환 컨버터 / 크기 변환: M.2→PCIe 카드 / 인터페이스 변환: PCIe→PCIe(NVMe)");
    const compatible = accessoryCompatibilityFor(build([{ accessoryId: pcieAdapter.id, quantity: 1 }]), [casePart, motherboardPart, nvmeSsd], [pcieAdapter]);
    expect(compatible).toMatchObject({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 });

    const sataAdapter = accessory("sata-adapter", "storage_accessory", { interface: "SATA", formFactor: "M.2 2280" }, "변환 컨버터 / 크기 변환: M.2→2.5형 / 인터페이스 변환: SATA3→SATA3");
    const mismatched = accessoryCompatibilityFor(build([{ accessoryId: sataAdapter.id, quantity: 1 }]), [casePart, motherboardPart, nvmeSsd], [sataAdapter]);
    expect(mismatched).toMatchObject({ status: "needs_review", warningCount: 1 });
    expect(mismatched.findings[0]).toMatchObject({ ruleId: "accessory-storage-adapter", severity: "warning" });
    expect(mismatched.findings[0].facts).toEqual(expect.arrayContaining([
      { label: "선택한 SSD 인터페이스", actual: "NVMe" },
      { label: "어댑터 지원 인터페이스", expected: "SATA" }
    ]));

    const noTarget = accessoryCompatibilityFor({ ...build([{ accessoryId: pcieAdapter.id, quantity: 1 }]), ssd: [] }, [casePart, motherboardPart], [pcieAdapter]);
    expect(noTarget).toMatchObject({ status: "needs_review", unknownCount: 1 });
    expect(noTarget.findings[0].title).toContain("대상 SSD");
  });

  it("validates raw fan hub ports and RGB controller voltage/output after adding a recommendation", () => {
    const rgbCase = part("case", "case", { fanCount: 2, rgbDeviceCount: 3, rgbDeviceVoltage: "5V" }, "전면: 120mm / 쿨링팬: 총 2개");
    const rgbMotherboard = part("board", "motherboard", { fanPortCount: 3, rgbPortCount: 1, rgb5vPortCount: 0, rgb12vPortCount: 1 });
    const rawFanHub = accessory("raw-fan-hub", "fan_hub", {}, "팬컨트롤러 / 팬분배: 6개 / SATA전원");
    const goodRgbController = accessory("good-rgb", "fan_hub", { rgbPortCount: 4 }, "RGB컨트롤러 / SATA전원 / 분배단자: ARGB 3핀 / RGB분배: 4개");
    const wrongVoltageController = accessory("wrong-rgb", "fan_hub", { rgbPortCount: 4 }, "RGB컨트롤러 / SATA전원 / 12V RGB 4핀 / RGB분배: 4개");
    const smallRgbController = accessory("small-rgb", "fan_hub", { rgbPortCount: 2 }, "RGB컨트롤러 / SATA전원 / 5V ARGB 3핀 / RGB분배: 2개");
    const unknownPowerController = accessory("unknown-power", "fan_hub", { rgbPortCount: 4 }, "RGB컨트롤러 / 5V ARGB 3핀 / RGB분배: 4개");
    const molexFan = accessory("molex-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 4핀(IDE) / 소비전류: 0.20A");
    const dcFan = accessory("dc-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 3핀 / 소비전류: 0.20A");
    const overCurrentHub = accessory("over-current-hub", "fan_hub", { fanPortCount: 4 }, "팬분배: 4개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 1A");
    const overCurrentFan = accessory("over-current-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 4핀 / 소비전류: 2A");

    const fanHubResult = accessoryCompatibilityFor(build([{ accessoryId: rawFanHub.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [rawFanHub]);
    const goodRgbResult = accessoryCompatibilityFor(build([{ accessoryId: goodRgbController.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [goodRgbController]);
    const wrongVoltageResult = accessoryCompatibilityFor(build([{ accessoryId: wrongVoltageController.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [wrongVoltageController]);
    const smallRgbResult = accessoryCompatibilityFor(build([{ accessoryId: smallRgbController.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [smallRgbController]);
    const unknownPowerResult = accessoryCompatibilityFor(build([{ accessoryId: unknownPowerController.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [unknownPowerController]);
    const overCurrentResult = accessoryCompatibilityFor(build([{ accessoryId: overCurrentFan.id, quantity: 1 }, { accessoryId: overCurrentHub.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [overCurrentFan, overCurrentHub]);

    expect(fanHubResult).toMatchObject({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 });
    expect(goodRgbResult).toMatchObject({ status: "needs_review", blockerCount: 0, warningCount: 0, unknownCount: 1 });
    expect(goodRgbResult.findings[0]).toMatchObject({ ruleId: "accessory-rgb-controller-power", severity: "unknown" });
    expect(wrongVoltageResult).toMatchObject({ status: "incompatible", blockerCount: 1 });
    expect(wrongVoltageResult.findings[0]).toMatchObject({ ruleId: "accessory-rgb-controller-voltage", severity: "blocker" });
    expect(smallRgbResult).toMatchObject({ status: "needs_review", warningCount: 1 });
    expect(smallRgbResult.findings[0].ruleId).toBe("accessory-rgb-controller-ports");
    expect(unknownPowerResult).toMatchObject({ status: "needs_review", unknownCount: 1 });
    expect(unknownPowerResult.findings[0].ruleId).toBe("accessory-fan-hub-power");
    const connectorMismatchWithFan = accessoryCompatibilityFor(build([{ accessoryId: molexFan.id, quantity: 1 }, { accessoryId: overCurrentHub.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [molexFan, overCurrentHub]);
    expect(connectorMismatchWithFan).toMatchObject({ status: "incompatible", blockerCount: 1 });
    expect(connectorMismatchWithFan.findings[0]).toMatchObject({ ruleId: "accessory-fan-hub-connector", severity: "blocker" });
    expect(connectorMismatchWithFan.connectionPlans?.[0]).toMatchObject({ status: "blocked", connectorStatus: "blocked", connectorIssue: "molex_mismatch" });
    const controlModeMismatchResult = accessoryCompatibilityFor(build([{ accessoryId: dcFan.id, quantity: 1 }, { accessoryId: overCurrentHub.id, quantity: 1 }]), [rgbCase, rgbMotherboard, ssdPart], [dcFan, overCurrentHub]);
    expect(controlModeMismatchResult).toMatchObject({ status: "needs_review", warningCount: 1, unknownCount: 0 });
    expect(controlModeMismatchResult.findings[0]).toMatchObject({ ruleId: "accessory-fan-hub-connector", severity: "warning" });
    expect(controlModeMismatchResult.connectionPlans?.[0]).toMatchObject({ status: "review", connectorStatus: "review", connectorIssue: "control_mode", currentStatus: "pass" });
    expect(overCurrentResult).toMatchObject({ status: "incompatible", blockerCount: 1 });
    expect(overCurrentResult.findings[0]).toMatchObject({ ruleId: "accessory-fan-hub-current", severity: "blocker" });
    expect(overCurrentResult.connectionPlans?.[0]).toMatchObject({ status: "blocked", currentStatus: "blocked", currentIssue: "over_limit", totalCurrentA: 2, maxFanCurrentA: 1, currentHeadroomA: -1 });
  });

  it("separates fans by an explicit hub target and asks for a target when multiple hubs are selected", () => {
    const fan = accessory("targeted-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 4핀 / 소비전류: 0.20A");
    const firstHub = accessory("hub-a", "fan_hub", { fanPortCount: 4 }, "팬분배: 4개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 1A");
    const secondHub = accessory("hub-b", "fan_hub", { fanPortCount: 4 }, "팬분배: 4개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 1A");
    const unassigned = accessoryCompatibilityFor(build([
      { accessoryId: fan.id, quantity: 1 },
      { accessoryId: firstHub.id, quantity: 1 },
      { accessoryId: secondHub.id, quantity: 1 }
    ]), [casePart, motherboardPart, ssdPart], [fan, firstHub, secondHub]);
    const targeted = accessoryCompatibilityFor(build([
      { accessoryId: fan.id, quantity: 1, targetAccessoryId: firstHub.id },
      { accessoryId: firstHub.id, quantity: 1 },
      { accessoryId: secondHub.id, quantity: 1 }
    ]), [casePart, motherboardPart, ssdPart], [fan, firstHub, secondHub]);

    expect(unassigned.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: "accessory-fan-hub-target", accessoryId: fan.id, severity: "unknown" })]));
    expect(unassigned.connectionPlans ?? []).toHaveLength(0);
    expect(unassigned.fanHubTargetRecommendations?.[0]).toMatchObject({
      fanId: fan.id,
      fanCount: 1,
      candidates: [
        { hubId: firstHub.id, status: "pass", portHeadroom: 3, connectorStatus: "pass", currentStatus: "pass" },
        { hubId: secondHub.id, status: "pass", portHeadroom: 3, connectorStatus: "pass", currentStatus: "pass" }
      ]
    });
    expect(unassigned.fanHubTargetRecommendations?.[0].recommendedHubId).toBeUndefined();
    expect(targeted.findings.some((finding) => finding.ruleId === "accessory-fan-hub-target")).toBe(false);
    expect(targeted.connectionPlans).toEqual([expect.objectContaining({ hubId: firstHub.id, fanCount: 1, status: "pass" })]);
  });

  it("scores an unassigned fan against the other fans already occupying each hub", () => {
    const assignedFan = accessory("assigned-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 4핀 / 소비전류: 0.20A");
    const unassignedFan = accessory("unassigned-fan", "cooling_fan", { lengthMm: 120 }, "팬 크기: 120mm / 4핀 / 소비전류: 0.20A");
    const smallHub = accessory("small-hub-for-recommendation", "fan_hub", { fanPortCount: 1 }, "팬분배: 1개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 1A");
    const largeHub = accessory("large-hub-for-recommendation", "fan_hub", { fanPortCount: 4 }, "팬분배: 4개 / 분배단자: PWM 4핀 / SATA전원 / 최대 허용전력: 1A");
    const result = accessoryCompatibilityFor(build([
      { accessoryId: assignedFan.id, quantity: 1, targetAccessoryId: smallHub.id },
      { accessoryId: unassignedFan.id, quantity: 1 },
      { accessoryId: smallHub.id, quantity: 1 },
      { accessoryId: largeHub.id, quantity: 1 }
    ]), [casePart, motherboardPart, ssdPart], [assignedFan, unassignedFan, smallHub, largeHub]);

    expect(result.fanHubTargetRecommendations?.[0]).toMatchObject({
      fanId: unassignedFan.id,
      suggestedHubId: largeHub.id,
      recommendedHubId: largeHub.id,
      candidates: [
        { hubId: largeHub.id, status: "pass", portHeadroom: 3 },
        { hubId: smallHub.id, status: "blocked", portHeadroom: -1 }
      ]
    });
  });

  it("requires an RGB controller target when multiple RGB hubs are selected", () => {
    const rgbCase = part("case", "case", { fanCount: 2, rgbDeviceCount: 3, rgbDeviceVoltage: "5V" }, "전면: 120mm / 쿨링팬: 총 2개");
    const firstController = accessory("rgb-controller-a", "fan_hub", { rgbPortCount: 4 }, "RGB컨트롤러 / SATA전원 / 분배단자: ARGB 3핀 / RGB분배: 4개 / 작동전압: 팬 12V, LED 5V");
    const secondController = accessory("rgb-controller-b", "fan_hub", { rgbPortCount: 4 }, "RGB컨트롤러 / SATA전원 / 분배단자: ARGB 3핀 / RGB분배: 4개 / 작동전압: 팬 12V, LED 5V");
    const unassigned = accessoryCompatibilityFor(build([
      { accessoryId: firstController.id, quantity: 1 },
      { accessoryId: secondController.id, quantity: 1 }
    ]), [rgbCase, motherboardPart, ssdPart], [firstController, secondController]);
    const targeted = accessoryCompatibilityFor({
      ...build([
        { accessoryId: firstController.id, quantity: 1 },
        { accessoryId: secondController.id, quantity: 1 }
      ]),
      rgbControllerAccessoryId: firstController.id
    }, [rgbCase, motherboardPart, ssdPart], [firstController, secondController]);

    expect(unassigned.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: "accessory-rgb-controller-target", severity: "unknown" })]));
    expect(unassigned.rgbConnectionPlans ?? []).toHaveLength(0);
    expect(targeted.findings.some((finding) => finding.ruleId === "accessory-rgb-controller-target")).toBe(false);
    expect(targeted.rgbConnectionPlans).toEqual([expect.objectContaining({ controllerId: firstController.id, deviceCount: 3, requiredVoltages: ["5V"], controllerOutputs: ["5V RGB"], outputCount: 4, issue: "rgb_load_unknown", rgbLoadStatus: "unknown", status: "review" })]);
  });

  it("limits M.2 accessory checks to the explicitly selected target SSD", () => {
    const wideSsd = part("ssd-wide", "ssd", { formFactor: "M.2 2280", interface: "NVMe" });
    const shortSsd = part("ssd-short", "ssd", { formFactor: "M.2 2242", interface: "NVMe" });
    const buildWithTwoSsds = { ...build([{ accessoryId: "heatsink", quantity: 1, targetPartId: shortSsd.id }]), ssd: [{ partId: wideSsd.id, quantity: 1 }, { partId: shortSsd.id, quantity: 1 }] };
    const heatsink = accessory("heatsink", "m2_heatsink", { formFactor: "M.2 2242" });

    const targeted = accessoryCompatibilityFor(buildWithTwoSsds, [casePart, motherboardPart, wideSsd, shortSsd], [heatsink]);
    expect(targeted).toMatchObject({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 });

    const retargeted = accessoryCompatibilityFor({ ...buildWithTwoSsds, accessories: [{ accessoryId: heatsink.id, quantity: 1, targetPartId: wideSsd.id }] }, [casePart, motherboardPart, wideSsd, shortSsd], [heatsink]);
    expect(retargeted).toMatchObject({ status: "incompatible", blockerCount: 1 });
    expect(retargeted.findings[0].facts).toEqual(expect.arrayContaining([
      { label: "선택한 SSD 규격", actual: "M.2 2280" },
      { label: "방열판 지원 규격", expected: "M.2 2242" }
    ]));
  });
});
