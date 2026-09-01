import { describe, expect, it } from "vitest";
import type { AccessoryConnectivityPlan, AccessoryItem, AccessoryRgbConnectionPlan, BuildSelection, CompatibilityResult, Part } from "./types";
import type { GpuFitSummary } from "./gpu-fit";
import { compatibilityReportJsonFor, compatibilityReportTextFor } from "./compatibility-report";

const cpu: Part = {
  id: "cpu-1", category: "cpu", name: "테스트 CPU", priceWon: 100000, source: "seed", specs: {}, dataQuality: "seed", missingFields: [], updatedAt: "2026-08-28T00:00:00.000Z", danawaUrl: "https://prod.danawa.com/info/?pcode=1"
};
const accessory: AccessoryItem = {
  id: "accessory-1", category: "thermal_grease", name: "테스트 써멀", priceWon: 5000, source: "danawa", listingType: "accessory", specs: {}, dataQuality: "live", missingFields: [], updatedAt: "2026-08-28T00:00:00.000Z"
};
const build: BuildSelection = { cpu: { partId: cpu.id, quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [{ accessoryId: accessory.id, quantity: 2, targetPartId: "ssd-target" }], useIntegratedGraphics: true };
const result = {
  status: "incompatible",
  blockerCount: 1,
  warningCount: 0,
  unknownCount: 0,
  findings: [{ id: "finding-1", ruleId: "cpu-motherboard-socket", severity: "blocker", title: "소켓이 맞지 않습니다.", message: "CPU와 메인보드 소켓이 다릅니다.", affectedPartIds: [cpu.id], facts: [{ label: "CPU 소켓", actual: "AM5", expected: "LGA1700" }], actions: [], suggestions: [{ part: { ...cpu, id: "cpu-2", name: "대체 CPU", priceWon: 120000 }, score: 1, reason: "소켓 호환", remainingBlockers: 0, remainingWarnings: 0, fixesCurrentIssue: true, similarityScore: 82, similarityLabel: "유사", similarityEvidence: { comparedDimensions: 2, totalDimensions: 2, confidence: "high" }, performanceSummary: "비교 스펙 +5%", profileSummary: "일반형 기준", valueScore: 120, valueLabel: "가성비 균형", valueEvidence: { scoreScale: 200, currentPriceWon: 200000, candidatePriceWon: 120000, priceDeltaWon: -80000, priceChangePercent: -40, similarityScore: 82 }, remainingUnknown: 0 }] }],
  repairPlans: [],
  recommendationPreferences: { profile: "gaming", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1440p", gamingRefreshRate: 144 },
  metrics: {},
  analysis: { profile: "general", scoreLabel: "계산 불가", scoreBasis: "테스트", confidence: "unknown", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: ["메인보드 소켓을 확인하세요."] },
  links: [],
  totalPriceWon: 110000,
  priceComplete: true,
  coreTotalPriceWon: 100000,
  corePriceComplete: true,
  accessoryTotalPriceWon: 10000,
  accessoryPriceComplete: true,
  accessoryCompatibility: {
    status: "needs_review",
    blockerCount: 0,
    warningCount: 1,
    unknownCount: 0,
    findings: [{
      id: "accessory-finding-1",
      ruleId: "accessory-m2-heatsink-quantity",
      severity: "warning",
      accessoryId: accessory.id,
      accessoryName: accessory.name,
      relatedPartIds: [cpu.id],
      title: "방열판 수량이 적습니다.",
      message: "일부 SSD에 방열판이 없습니다.",
      facts: [{ label: "M.2 SSD 수", actual: "2개" }, { label: "방열판 수량", actual: "1개" }],
      action: "방열판 수량을 조정하세요."
    }]
  },
  engineVersion: "2.50.0",
  catalogSnapshotAt: "2026-08-28T00:00:00.000Z",
  checkedAt: "2026-08-28T00:00:00.000Z"
} as CompatibilityResult;

describe("compatibility report export", () => {
  it("includes status, facts, accessory quantities, suggestions, and price summary", () => {
    const report = compatibilityReportTextFor(result, build, new Map([[cpu.id, cpu]]), new Map([[accessory.id, accessory]]));

    expect(report).toContain("판정: 호환 불가");
    expect(report).toContain("CPU 소켓: AM5 · 기대값 LGA1700");
    expect(report).toContain("테스트 써멀 ×2");
    expect(report).toContain("대상 SSD ssd-target");
    expect(report).toContain("대체 CPU · 유사 82점");
    expect(report).toContain("[주변 부품 호환 점검]");
    expect(report).toContain("방열판 수량이 적습니다.");
    expect(report).toContain("다음 행동: 방열판 수량을 조정하세요.");
    expect(report).toContain("전체 합계: 110,000원");
    expect(report).toContain("가성비 균형 120/200점");
    expect(report).toContain("게임 주사율: 144Hz");
    expect(report).toContain("[우선 조치]");
    expect(report).toContain("[구매·조립 실행 순서]");
    expect(report).toContain("해결해야 할 충돌 제거");
    expect(report).toContain("소켓이 맞지 않습니다.");
    expect(report).toContain("실제 FPS·벤치마크 순위");
  });

  it("does not turn an unknown price into a numeric zero", () => {
    const unknownPrice = { ...cpu, priceWon: undefined };
    const report = compatibilityReportTextFor(result, build, new Map([[cpu.id, unknownPrice]]), new Map([[accessory.id, accessory]]));

    expect(report).toContain("CPU: 테스트 CPU · 가격 확인 필요");
  });

  it("includes structured GPU fit evidence when the engine provides it", () => {
    const gpuFit: GpuFitSummary = {
      status: "needs_review",
      length: { status: "compatible", actualMm: 300, limitMm: 330, clearanceMm: 30 },
      thickness: { status: "needs_review", actualMm: 60, warningThresholdMm: 55 },
      power: { status: "compatible", gpuPowerW: 250, recommendedPsuW: 750, psuWattageW: 850, headroomW: 100 },
      physical: { status: "needs_review", gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40, caseSidePanelClearanceMm: 30, cableClearanceMm: -10, evidenceSources: [{ category: "gpu", manufacturerModel: "GPU-TEST-1", note: "GPU 설치 가이드", url: "https://vendor.example/gpu" }] },
      connector: {
        status: "compatible",
        options: [[{ kind: "12v2x6", count: 1 }]],
        requirementsKnown: true,
        adapterOptionIndices: [],
        connectors: { "12v2x6": 1 },
        psuCableType: "fully_modular",
        psuRailType: "single",
        psuIndependentPcieCableRuns: 1,
        psuPcieCableTopology: "shared",
        psuCableTopologyStatus: "needs_review",
        matchedOptionIndex: 0,
        optionFits: []
      }
    };
    const report = compatibilityReportTextFor({ ...result, gpuFit }, build, new Map([[cpu.id, cpu]]), new Map([[accessory.id, accessory]]));

    expect(report).toContain("[GPU 실장·전원 요약]");
    expect(report).toContain("케이스 장착 길이: 300mm / 330mm · 30mm 여유");
    expect(report).toContain("GPU 두께: 60mm · 55mm 이상");
    expect(report).toContain("GPU 물리 슬롯·케이블: GPU 물리 슬롯 3 · 케이블 요구 40mm · 케이스 측면 30mm · 차이 -10mm");
    expect(report).toContain("원문 경로 1 충족");
    expect(report).toContain("구조 풀모듈러 · 12V 싱글레일");
    expect(report).toContain("PCIe 케이블 분배: 독립 런 1개 · 분배·공유 케이블 · 확인 필요");
    expect(report).toContain("물리 근거 출처: GPU · GPU-TEST-1: GPU 설치 가이드 (https://vendor.example/gpu)");
  });

  it("includes fan and RGB connectivity evidence in the text report", () => {
    const report = compatibilityReportTextFor(result, {
      ...build,
      motherboard: { partId: "board-report", quantity: 1 },
      case: { partId: "case-report", quantity: 1 }
    }, new Map([
      [cpu.id, cpu],
      ["board-report", { id: "board-report", category: "motherboard", name: "리포트 보드", source: "seed", specs: { fanPortCount: 2, rgbPortCount: 1, rgb5vPortCount: 1, rgb12vPortCount: 0 }, dataQuality: "seed", missingFields: [], updatedAt: "2026-08-28T00:00:00.000Z" }],
      ["case-report", { id: "case-report", category: "case", name: "리포트 케이스", source: "seed", specs: { fanCount: 4, rgbDeviceCount: 2, rgbDeviceVoltage: "12V" }, dataQuality: "seed", missingFields: [], updatedAt: "2026-08-28T00:00:00.000Z" }]
    ]), new Map([[accessory.id, accessory]]));

    expect(report).toContain("[팬·RGB 연결 자원]");
    expect(report).toContain("케이스 기본 팬 연결: 4개 사용 · 2개 확인 · 2개 부족 · 주의");
    expect(report).toContain("RGB 전압 연결: 필요 전압 12V · 12V 헤더 없음 · 주의");
  });

  it("includes the calculated accessory connection plan in text and JSON reports", () => {
    const plan: AccessoryConnectivityPlan = {
      id: "fan-hub-plan:hub-report",
      hubId: "hub-report",
      hubName: "테스트 팬 허브",
      hubFanOutputs: ["4핀 PWM"],
      hubFanPortCount: 4,
      externalPower: "SATA",
      maxFanCurrentA: 1,
      powerRails: [{ voltage: "12V", maxPowerW: 12, maxCurrentA: 1, role: "fan" }],
      fanCount: 1,
      assignedFanCount: 1,
      unassignedFanCount: 0,
      portAssignments: [{ accessoryId: "fan-report", name: "테스트 PWM 팬", portStart: 1, portEnd: 1, fanCount: 1 }],
      portStatus: "pass",
      portIssue: "none",
      totalCurrentA: 0.2,
      currentHeadroomA: 0.8,
      connectorStatus: "pass",
      currentStatus: "pass",
      status: "pass",
      connectorIssue: "none",
      currentIssue: "none",
      fans: [{ accessoryId: "fan-report", name: "테스트 PWM 팬", quantity: 1, unitCount: 1, totalFanCount: 1, connectorTypes: ["4핀 PWM"], currentA: 0.2 }],
      summary: "선택한 팬을 허브 출력에 연결할 수 있으며 확인된 전류 범위 안입니다."
    };
    const rgbPlan: AccessoryRgbConnectionPlan = {
      id: "rgb-controller-plan:controller-report",
      controllerId: "controller-report",
      controllerName: "테스트 RGB 컨트롤러",
      controllerOutputs: ["5V RGB"],
      externalPower: "SATA",
      deviceCount: 2,
      deviceVoltage: "5V",
      requiredVoltages: ["5V"],
      outputCount: 4,
      powerRails: [{ voltage: "5V", maxPowerW: 22.5, maxCurrentA: 4.5, role: "rgb" }],
      rgbLoadStatus: "known",
      rgbPerDeviceCurrentA: 0.5,
      rgbTotalCurrentA: 1,
      rgbTotalPowerW: 5,
      rgbCurrentHeadroomA: 3.5,
      rgbPowerHeadroomW: 17.5,
      status: "pass",
      issue: "none",
      summary: "케이스 RGB 장치를 컨트롤러 출력에 연결할 수 있는 기준을 확인했습니다."
    };
    const withPlan = { ...result, accessoryCompatibility: { ...result.accessoryCompatibility!, fanHubTargetRecommendations: [{ fanId: "fan-report", fanName: "추가 팬", fanCount: 1, recommendedHubId: "hub-report", candidates: [{ hubId: "hub-report", hubName: "테스트 팬 허브", status: "pass" as const, score: 9, portHeadroom: 3, connectorStatus: "pass" as const, currentStatus: "pass" as const, externalPower: "SATA", reason: "포트 여유 3개 · 커넥터 일치 · 전류 범위 확인 · 외부 전원 SATA" }], summary: "테스트 팬 허브를 우선 연결 후보로 제안합니다." }], connectionPlans: [plan], rgbConnectionPlans: [rgbPlan] } };
    const report = compatibilityReportTextFor(withPlan, build, new Map([[cpu.id, cpu]]), new Map([[accessory.id, accessory]]));
    const payload = JSON.parse(compatibilityReportJsonFor(withPlan, build, result.recommendationPreferences));

    expect(report).toContain("[주변 부품 연결 계획]");
    expect(report).toContain("[팬 허브 연결 대상 추천]");
    expect(report).toContain("테스트 팬 허브: 추천 · 포트 여유 3개 · 커넥터 일치 · 전류 범위 확인 · 외부 전원 SATA");
    expect(report).toContain("테스트 팬 허브: 확인됨 · 팬 1개 · 허브 출력 4핀 PWM · 팬 입력 4핀 PWM");
    expect(report).toContain("포트 배치 P1 테스트 PWM 팬");
    expect(report).toContain("전원 SATA · 0.20A / 1.00A · 여유 0.80A · 레일 12V 팬 · 12.00W · 1.00A");
    expect(report).toContain("[RGB 연결 계획]");
    expect(report).toContain("테스트 RGB 컨트롤러: 확인됨 · 케이스 RGB 2개 · 필요한 전압 5V · 컨트롤러 출력 5V RGB · 4포트 · 전원 SATA · 레일 5V RGB · 22.50W · 4.50A · 부하 5.00W · 17.50W 여유");
    expect(payload.result.accessoryCompatibility.connectionPlans[0]).toMatchObject({ id: plan.id, status: "pass", currentHeadroomA: 0.8 });
    expect(payload.result.accessoryCompatibility.rgbConnectionPlans[0]).toMatchObject({ id: rgbPlan.id, status: "pass", outputCount: 4 });
  });

  it("does not hide missing physical purchase evidence in the report", () => {
    const gpuFit: GpuFitSummary = {
      status: "compatible",
      length: { status: "compatible", actualMm: 340, limitMm: 360, clearanceMm: 20 },
      thickness: { status: "compatible", actualMm: 40, warningThresholdMm: 55 },
      power: { status: "compatible", gpuPowerW: 320, recommendedPsuW: 850, psuWattageW: 1000, headroomW: 150 },
      physical: { status: "not_applicable" },
      connector: {
        status: "compatible",
        options: [[{ kind: "pcie_8pin_6plus2", count: 2 }]],
        requirementsKnown: true,
        adapterOptionIndices: [],
        connectors: { pcie_8pin_6plus2: 2 },
        psuCableTopologyStatus: "not_applicable",
        matchedOptionIndex: 0,
        optionFits: [{ status: "compatible", missing: [], unknown: [] }]
      }
    };
    const report = compatibilityReportTextFor({ ...result, gpuFit }, build, new Map([[cpu.id, cpu]]), new Map([[accessory.id, accessory]]));

    expect(report).toContain("GPU 물리 슬롯·케이블: 제조사 물리 검수 근거 미등록 · 확인 필요");
    expect(report).toContain("PCIe 케이블 분배: 다중 8핀 경로의 독립 케이블 근거 미등록 · 확인 필요");
  });

  it("exports a parseable JSON envelope with the build and result", () => {
    const payload = JSON.parse(compatibilityReportJsonFor(result, build, result.recommendationPreferences));

    expect(payload.reportVersion).toBe(1);
    expect(payload.build.cpu.partId).toBe("cpu-1");
    expect(payload.result.status).toBe("incompatible");
    expect(payload.recommendationPreferences.priority).toBe("balanced");
    expect(payload.actionCenter.state).toBe("blocked");
    expect(payload.actionCenter.actions[0].id).toBe("finding:cpu-motherboard-socket");
    expect(payload.assemblyPlan.steps[0]).toMatchObject({ id: "resolve-conflicts", status: "blocked" });
  });

  it("exports structured connectivity evidence when catalog parts are supplied", () => {
    const reportBuild = { ...build, motherboard: { partId: "board-json", quantity: 1 }, case: { partId: "case-json", quantity: 1 } };
    const partMap = new Map<string, Part>([
      [cpu.id, cpu],
      ["board-json", { id: "board-json", category: "motherboard", name: "JSON 보드", source: "seed", specs: { fanPortCount: 2, rgbPortCount: 1, rgb5vPortCount: 1, rgb12vPortCount: 0 }, dataQuality: "seed", missingFields: [], updatedAt: "2026-08-28T00:00:00.000Z" }],
      ["case-json", { id: "case-json", category: "case", name: "JSON 케이스", source: "seed", specs: { fanCount: 4, rgbDeviceCount: 2, rgbDeviceVoltage: "12V" }, dataQuality: "seed", missingFields: [], updatedAt: "2026-08-28T00:00:00.000Z" }]
    ]);
    const payload = JSON.parse(compatibilityReportJsonFor(result, reportBuild, result.recommendationPreferences, partMap));

    expect(payload.connectivity.status).toBe("review");
    expect(payload.connectivity.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "fan-headers", status: "review", headroom: -2 }),
      expect.objectContaining({ id: "rgb-voltage", status: "review" })
    ]));
    expect(payload.actionCenter.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "connectivity:fan-headers", targetId: "build-connectivity-panel" }),
      expect.objectContaining({ id: "connectivity:rgb-voltage", targetId: "build-connectivity-panel" })
    ]));
  });
});
