import { describe, expect, it } from "vitest";
import type { BuildSelection, CompatibilityResult, Part } from "./types";
import type { GpuFitSummary } from "./gpu-fit";
import { purchaseChecklistItemsFor, purchaseChecklistProgressFor, purchaseChecklistTextFor } from "./purchase-checklist";

const build = {
  cpu: { partId: "cpu-1", quantity: 1 },
  cooler: { partId: "cooler-1", quantity: 1 },
  motherboard: { partId: "board-1", quantity: 1 },
  memory: [],
  gpu: { partId: "gpu-1", quantity: 1 },
  ssd: [{ partId: "ssd-1", quantity: 1 }],
  hdd: [],
  case: { partId: "case-1", quantity: 1 },
  psu: { partId: "psu-1", quantity: 1 },
  useIntegratedGraphics: false
} as BuildSelection;

const result = {
  status: "incompatible",
  blockerCount: 1,
  warningCount: 1,
  unknownCount: 1,
  findings: [
    { id: "b", ruleId: "socket", severity: "blocker", title: "소켓이 다릅니다.", message: "장착할 수 없습니다.", affectedPartIds: [], facts: [], actions: [] },
    { id: "w", ruleId: "gpu-case", severity: "warning", title: "길이를 확인하세요.", message: "케이스 여유를 확인하세요.", affectedPartIds: [], facts: [], actions: [] },
    { id: "u", ruleId: "connector", severity: "unknown", title: "커넥터를 확인하세요.", message: "원문 확인이 필요합니다.", affectedPartIds: [], facts: [], actions: [] },
    { id: "i", ruleId: "info", severity: "info", title: "참고", message: "참고입니다.", affectedPartIds: [], facts: [], actions: [] }
  ],
  metrics: { gpuLengthMm: 300, maxGpuLengthMm: 320, powerHeadroomW: 100, m2SlotAssignments: [{ slotId: "M2_1", partId: "ssd-1", partName: "SSD" }] },
  analysis: {},
  links: [],
  totalPriceWon: 1,
  priceComplete: true
} as unknown as CompatibilityResult;

describe("purchase checklist", () => {
  it("keeps engine findings and manual checks separate", () => {
    const items = purchaseChecklistItemsFor(build, result);
    expect(items.filter((item) => item.kind === "finding").map((item) => item.severity)).toEqual(["blocker", "unknown", "warning"]);
    expect(items.some((item) => item.id === "finding:info")).toBe(false);
    expect(items.filter((item) => item.kind === "manual").map((item) => item.id)).toEqual([
      "manual:manufacturer-support",
      "manual:physical-clearance",
      "manual:power-cabling",
      "manual:m2-placement",
      "manual:post-build-test",
      "manual:seller-warranty"
    ]);
  });

  it("calculates progress only for current checklist items", () => {
    const items = purchaseChecklistItemsFor(build, result);
    const progress = purchaseChecklistProgressFor(items, new Set(["finding:socket", "manual:manufacturer-support", "not-in-this-build"]));
    expect(progress).toMatchObject({ total: 9, checked: 2, remaining: 7, percent: 22 });
  });

  it("does not claim completion when there are no checked items", () => {
    const progress = purchaseChecklistProgressFor([], new Set(["unused"]));
    expect(progress).toEqual({ total: 0, checked: 0, remaining: 0, percent: 0 });
  });

  it("exports checked and unchecked items without dropping the source detail", () => {
    const items = purchaseChecklistItemsFor(build, result);
    const text = purchaseChecklistTextFor(items.slice(0, 2), new Set([items[0].id]));
    expect(text).toContain(`[x] 엔진 finding · ${items[0].title}`);
    expect(text).toContain(`[ ] 엔진 finding · ${items[1].title}`);
    expect(text).toContain(items[0].detail);
  });

  it("turns missing GPU evidence into targeted checklist actions", () => {
    const gpuFit: GpuFitSummary = {
      status: "compatible",
      length: { status: "compatible", actualMm: 300, limitMm: 320, clearanceMm: 20 },
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
    const items = purchaseChecklistItemsFor(build, { ...result, gpuFit });
    const physical = items.find((item) => item.id === "manual:gpu-physical-evidence");
    const topology = items.find((item) => item.id === "manual:pcie-cable-topology");

    expect(physical).toMatchObject({ targetId: "gpu-fit-summary-panel", actionLabel: "GPU FIT 보기" });
    expect(physical?.detail).toContain("GPU 물리 슬롯 점유");
    expect(topology).toMatchObject({ targetId: "gpu-fit-summary-panel", actionLabel: "GPU FIT 보기" });
    expect(topology?.detail).toContain("독립된 PCIe 케이블 런");
  });

  it("emits stable checklist IDs for accessory, data, price, and physical action tracking", () => {
    const enrichedResult = {
      ...result,
      priceComplete: false,
      dataHealth: {
        selectedCount: 1,
        selectedQuantity: 1,
        freshCount: 0,
        agingCount: 0,
        staleCount: 1,
        unknownFreshnessCount: 0,
        incompleteCount: 1,
        unpricedCount: 1,
        overall: "needs_refresh" as const,
        items: [{ id: "gpu-1", name: "테스트 GPU", category: "gpu" as const, dataQuality: "incomplete" as const, missingFields: ["lengthMm"], priceKnown: false, freshness: "stale" as const }]
      },
      accessoryCompatibility: {
        status: "needs_review" as const,
        blockerCount: 0,
        warningCount: 1,
        unknownCount: 0,
        findings: [{ id: "accessory-finding", ruleId: "accessory-rule", severity: "warning" as const, accessoryId: "accessory-1", accessoryName: "테스트 써멀", relatedPartIds: ["ssd-1"], title: "주변 부품 확인", message: "규격 확인", facts: [], action: "확인" }]
      }
    };
    const ids = purchaseChecklistItemsFor(build, enrichedResult).map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining(["accessory:accessory-finding", "data-freshness:gpu-1", "data-fields:gpu-1", "data-price:gpu-1", "price:total"]));
  });

  it("adds targeted connectivity checks only when the engine did not already record the finding", () => {
    const partMap = new Map<string, Part>([
      ["board-1", { id: "board-1", category: "motherboard", name: "테스트 보드", source: "seed", specs: {}, dataQuality: "seed", missingFields: [], updatedAt: "2026-09-01T00:00:00.000Z" }],
      ["case-1", { id: "case-1", category: "case", name: "테스트 케이스", source: "seed", specs: { fanCount: 4, rgbDeviceCount: 2, rgbDeviceVoltage: "mixed" }, dataQuality: "seed", missingFields: [], updatedAt: "2026-09-01T00:00:00.000Z" }]
    ]);
    const items = purchaseChecklistItemsFor(build, result, partMap);

    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining(["connectivity:fan-headers", "connectivity:rgb-headers", "connectivity:rgb-voltage"]));
    expect(items.find((item) => item.id === "connectivity:fan-headers")).toMatchObject({ severity: "unknown", targetId: "build-connectivity-panel", actionLabel: "연결 자원 보기" });

    const withExistingFinding = { ...result, findings: [...result.findings, { ...result.findings[0], ruleId: "case-fan-headers" }] };
    expect(purchaseChecklistItemsFor(build, withExistingFinding, partMap).some((item) => item.id === "connectivity:fan-headers")).toBe(false);
  });
});
