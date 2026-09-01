import { describe, expect, it } from "vitest";
import type { AccessoryItem, BuildSelection, Part } from "./types";
import { buildPreflightFor } from "./build-preflight";

function build(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true, ...overrides };
}

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "cpu-1",
    category: "cpu",
    name: "테스트 CPU",
    source: "manual",
    priceWon: 100000,
    specs: { coolerIncluded: false },
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  };
}

function accessory(overrides: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "fan-1",
    category: "cooling_fan",
    name: "테스트 팬",
    source: "manual",
    listingType: "accessory",
    priceWon: 10000,
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  };
}

describe("build preflight", () => {
  it("requires an external GPU when integrated graphics is disabled and a cooler unless boxed", () => {
    const result = buildPreflightFor(build({ useIntegratedGraphics: false }), new Map([["cpu-1", part()]]), new Map());
    expect(result.status).toBe("needs_selection");
    expect(result.missingRequired).toEqual(["cpu", "motherboard", "memory", "case", "psu", "cooler", "gpu"]);
    expect(result.requiredSelectedCount).toBe(0);
    expect(result.issues.find((issue) => issue.label === "CPU")?.message).toBe("CPU를 선택해야 검사 준비가 완료됩니다.");
  });

  it("does not require a separate cooler for a CPU with a boxed cooler", () => {
    const result = buildPreflightFor(build({ cpu: { partId: "cpu-boxed", quantity: 1 } }), new Map([["cpu-boxed", part({ id: "cpu-boxed", specs: { coolerIncluded: true } })]]), new Map());
    expect(result.missingRequired).not.toContain("cooler");
  });

  it("separates missing catalog details, incomplete specs, and unknown prices", () => {
    const result = buildPreflightFor(build({
      cpu: { partId: "cpu-1", quantity: 1 },
      motherboard: { partId: "missing-board", quantity: 1 },
      memory: [{ partId: "memory-1", quantity: 1 }],
      case: { partId: "case-1", quantity: 1 },
      psu: { partId: "psu-1", quantity: 1 },
      cooler: { partId: "cooler-1", quantity: 1 },
      accessories: [{ accessoryId: "fan-1", quantity: 1 }]
    }), new Map([
      ["cpu-1", part()],
      ["memory-1", part({ id: "memory-1", category: "memory", name: "불완전 RAM", source: "danawa", danawaUrl: "https://prod.danawa.com/info/?pcode=memory-1", priceWon: undefined, missingFields: ["memoryType"] })],
      ["case-1", part({ id: "case-1", category: "case", name: "케이스" })],
      ["psu-1", part({ id: "psu-1", category: "psu", name: "파워" })],
      ["cooler-1", part({ id: "cooler-1", category: "cooler", name: "쿨러" })]
    ]), new Map([["fan-1", accessory()]]));
    expect(result.status).toBe("needs_data_review");
    expect(result.unknownCatalogCount).toBe(1);
    expect(result.unpricedCount).toBe(1);
    expect(result.dataReviewCount).toBe(2);
    expect(result.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(["catalog", "data", "price"]));
    expect(result.issues.find((issue) => issue.kind === "data" && issue.label === "불완전 RAM")?.target).toEqual({ kind: "part", id: "memory-1" });
    expect(result.issues.find((issue) => issue.kind === "price")?.target).toBeUndefined();
    expect(result.refreshTargets).toEqual([{ kind: "part", id: "memory-1" }]);
  });

  it("reports ready only when required selections and selected data are available", () => {
    const result = buildPreflightFor(build({
      cpu: { partId: "cpu-1", quantity: 1 },
      motherboard: { partId: "board-1", quantity: 1 },
      memory: [{ partId: "memory-1", quantity: 1 }],
      case: { partId: "case-1", quantity: 1 },
      psu: { partId: "psu-1", quantity: 1 },
      cooler: { partId: "cooler-1", quantity: 1 }
    }), new Map([
      ["cpu-1", part()],
      ["board-1", part({ id: "board-1", category: "motherboard", name: "보드" })],
      ["memory-1", part({ id: "memory-1", category: "memory", name: "RAM" })],
      ["case-1", part({ id: "case-1", category: "case", name: "케이스" })],
      ["psu-1", part({ id: "psu-1", category: "psu", name: "파워" })],
      ["cooler-1", part({ id: "cooler-1", category: "cooler", name: "쿨러" })]
    ]), new Map());
    expect(result).toMatchObject({ status: "ready", requiredSelectedCount: 6, requiredTotal: 6, dataReviewCount: 0, unpricedCount: 0 });
  });

  it("surfaces a missing accessory target SSD before the compatibility request", () => {
    const result = buildPreflightFor(build({
      cpu: { partId: "cpu-1", quantity: 1 },
      motherboard: { partId: "board-1", quantity: 1 },
      memory: [{ partId: "memory-1", quantity: 1 }],
      ssd: [{ partId: "ssd-1", quantity: 1 }],
      case: { partId: "case-1", quantity: 1 },
      psu: { partId: "psu-1", quantity: 1 },
      cooler: { partId: "cooler-1", quantity: 1 },
      accessories: [{ accessoryId: "adapter-1", quantity: 1, targetPartId: "missing-ssd" }]
    }), new Map([
      ["cpu-1", part()],
      ["board-1", part({ id: "board-1", category: "motherboard" })],
      ["memory-1", part({ id: "memory-1", category: "memory" })],
      ["ssd-1", part({ id: "ssd-1", category: "ssd", specs: { interface: "NVMe", formFactor: "M.2 2280" } })],
      ["case-1", part({ id: "case-1", category: "case" })],
      ["psu-1", part({ id: "psu-1", category: "psu" })],
      ["cooler-1", part({ id: "cooler-1", category: "cooler" })]
    ]), new Map([["adapter-1", accessory({ id: "adapter-1", category: "storage_accessory", name: "M.2 어댑터" })]]));

    expect(result.status).toBe("needs_data_review");
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "catalog", label: "M.2 어댑터", message: "연결 대상 SSD missing-ssd가 현재 선택한 SSD 목록에 없습니다." }));
  });

  it("surfaces a fan target hub that is not selected in the build", () => {
    const result = buildPreflightFor(build({
      cpu: { partId: "cpu-1", quantity: 1 },
      motherboard: { partId: "board-1", quantity: 1 },
      memory: [{ partId: "memory-1", quantity: 1 }],
      case: { partId: "case-1", quantity: 1 },
      psu: { partId: "psu-1", quantity: 1 },
      cooler: { partId: "cooler-1", quantity: 1 },
      accessories: [{ accessoryId: "fan-1", quantity: 1, targetAccessoryId: "missing-hub" }],
      rgbControllerAccessoryId: "missing-rgb-hub"
    }), new Map([
      ["cpu-1", part()],
      ["board-1", part({ id: "board-1", category: "motherboard" })],
      ["memory-1", part({ id: "memory-1", category: "memory" })],
      ["case-1", part({ id: "case-1", category: "case" })],
      ["psu-1", part({ id: "psu-1", category: "psu" })],
      ["cooler-1", part({ id: "cooler-1", category: "cooler" })]
    ]), new Map([
      ["fan-1", accessory({ id: "fan-1", category: "cooling_fan", name: "쿨링팬" })]
    ]));

    expect(result.status).toBe("needs_data_review");
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "catalog", label: "쿨링팬", message: "연결 대상 팬 허브 missing-hub가 현재 선택한 팬 허브 목록에 없거나 대상 부품이 쿨링팬이 아닙니다." }));
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: "catalog", label: "RGB 연결 컨트롤러", message: "RGB 연결 컨트롤러 missing-rgb-hub가 현재 선택한 팬 허브 목록에 없습니다." }));
  });
});
