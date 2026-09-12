import { describe, expect, it } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";
import { recommendAccessories } from "./accessory-recommendations";

function part(overrides: Partial<Part>): Part {
  return {
    id: "part-1",
    category: "cpu",
    name: "테스트 부품",
    source: "seed",
    priceWon: 100000,
    specs: {},
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}

function accessory(overrides: Partial<AccessoryItem>): AccessoryItem {
  return {
    id: "accessory-1",
    category: "m2_heatsink",
    name: "테스트 주변 부품",
    source: "danawa",
    listingType: "accessory",
    priceWon: 10000,
    specs: {},
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}

describe("accessory recommendations", () => {
  it("recommends peripherals from the selected build facts", () => {
    const catalog = [
      part({ id: "cpu", category: "cpu", specs: { tdpW: 100 } }),
      part({ id: "gpu", category: "gpu", specs: { powerW: 450, lengthMm: 340 } }),
      part({ id: "case", category: "case", rawSpecText: "쿨링팬: 총 5개 / 전면: 120mm / 상단: 140mm", specs: {} }),
      part({ id: "ssd", category: "ssd", specs: { formFactor: "M.2 2280" } })
    ];
    const build = {
      cpu: { partId: "cpu", quantity: 1 },
      cooler: { partId: "cooler", quantity: 1 },
      motherboard: { partId: "motherboard", quantity: 1 },
      memory: [],
      gpu: { partId: "gpu", quantity: 1 },
      ssd: [{ partId: "ssd", quantity: 1 }],
      hdd: [],
      case: { partId: "case", quantity: 1 },
      useIntegratedGraphics: false
    };
    const accessories = [
      accessory({ id: "m2", category: "m2_heatsink", name: "M.2 2280 방열판", specs: { formFactor: "M.2 2280" } }),
      accessory({ id: "m2-unknown", category: "m2_heatsink", name: "규격 미확인 방열판", priceWon: 100 }),
      accessory({ id: "support", category: "gpu_support", name: "GPU 지지대" }),
      accessory({ id: "fan", category: "cooling_fan", name: "120mm 쿨링팬", specs: { lengthMm: 120, widthMm: 120 } }),
      accessory({ id: "grease", category: "thermal_grease", name: "고열전도 써멀", specs: { thermalConductivityWmK: 14.3 } }),
      accessory({ id: "liquid", category: "thermal_grease", name: "Conductonaut 액체금속", specs: { thermalConductivityWmK: 73 }, rawSpecText: "전도성 액체금속" }),
      accessory({ id: "ups-small", category: "ups", name: "UPS 600W", specs: { outputW: 600 } }),
      accessory({ id: "ups-large", category: "ups", name: "UPS 1000W", specs: { outputW: 1000 } }),
      accessory({ id: "hub", category: "fan_hub", name: "팬 허브", specs: { fanPortCount: 6 }, rawSpecText: "팬컨트롤러 / 팬분배: 6개 / SATA전원" })
    ];

    const recommendations = recommendAccessories(build, catalog, accessories);

    expect(new Set(recommendations.map((recommendation) => recommendation.category))).toEqual(new Set([
      "m2_heatsink",
      "gpu_support",
      "cooling_fan",
      "thermal_grease",
      "ups",
      "fan_hub"
    ]));
    expect(recommendations.find((recommendation) => recommendation.item.id === "ups-large")).toBeDefined();
    expect(recommendations.find((recommendation) => recommendation.item.id === "ups-small")).toBeUndefined();
    expect(recommendations.find((recommendation) => recommendation.item.id === "m2-unknown")).toBeUndefined();
    expect(recommendations.find((recommendation) => recommendation.item.id === "liquid")).toBeUndefined();
    expect(recommendations.every((recommendation) => recommendation.item.dataQuality === "live")).toBe(true);
  });

  it("does not recommend a fan when the case has no verified fan mounting fact", () => {
    const catalog = [part({ id: "case", category: "case", rawSpecText: "미들타워 케이스", specs: {} })];
    const build = {
      memory: [],
      ssd: [],
      hdd: [],
      case: { partId: "case", quantity: 1 },
      useIntegratedGraphics: true
    };
    const recommendations = recommendAccessories(build, catalog, [accessory({ category: "cooling_fan", specs: { lengthMm: 120 } })]);

    expect(recommendations.some((recommendation) => recommendation.category === "cooling_fan")).toBe(false);
  });

  it("matches M.2 heatsinks to the selected SSD form factor", () => {
    const catalog = [part({ id: "ssd", category: "ssd", specs: { formFactor: "M.2 2242" } })];
    const build = { memory: [], ssd: [{ partId: "ssd", quantity: 1 }], hdd: [], useIntegratedGraphics: true };
    const accessories = [
      accessory({ id: "heat-2242", name: "M.2 2242 방열판", specs: { formFactor: "M.2 2242" } }),
      accessory({ id: "heat-2280", name: "M.2 2280 방열판", specs: { formFactor: "M.2 2280" } }),
      accessory({ id: "heat-generic", name: "범용 M.2 방열판", specs: { formFactor: "M.2" } })
    ];

    const recommendations = recommendAccessories(build, catalog, accessories).filter((recommendation) => recommendation.category === "m2_heatsink");

    expect(recommendations.map((recommendation) => recommendation.item.id)).toEqual(["heat-2242", "heat-generic"]);
    expect(recommendations[0].fitBasis).toContain("M.2 2242");
  });

  it("recommends a memory cooler only for verified high-speed memory with matching evidence", () => {
    const catalog = [
      part({ id: "memory-ddr5-7200", category: "memory", name: "DDR5-7200 DIMM", specs: { memoryType: "DDR5", speedMhz: 7200, formFactor: "DIMM" } })
    ];
    const build = { memory: [{ partId: "memory-ddr5-7200", quantity: 1 }], ssd: [], hdd: [], useIntegratedGraphics: true };
    const accessories = [
      accessory({ id: "ram-good", category: "memory_cooler", name: "DDR5 메모리 모듈 쿨링팬", rawSpecText: "DDR5 DIMM용 · 팬 2개 · 5V ARGB", specs: { fanCount: 2, rgbDeviceVoltage: "5V" } }),
      accessory({ id: "ram-wrong-generation", category: "memory_cooler", name: "DDR4 메모리 쿨링팬", rawSpecText: "DDR4 DIMM용 · 팬 2개", specs: { fanCount: 2 } }),
      accessory({ id: "ram-no-cooling-evidence", category: "memory_cooler", name: "DDR5 메모리 방열판", rawSpecText: "DDR5 DIMM용 방열판", specs: {} })
    ];

    const recommendations = recommendAccessories(build, catalog, accessories).filter((item) => item.category === "memory_cooler");

    expect(recommendations.map((item) => item.item.id)).toEqual(["ram-good"]);
    expect(recommendations[0].reason).toContain("7200MHz");
    expect(recommendations[0].fitBasis).toContain("DIMM");
  });

  it("recommends a storage adapter only when M.2 capacity exceeds verified motherboard slots", () => {
    const catalog = [
      part({ id: "motherboard", category: "motherboard", specs: { m2Slots: 1 } }),
      part({ id: "ssd-nvme", category: "ssd", specs: { interface: "NVMe", formFactor: "M.2 2280" } })
    ];
    const build = { motherboard: { partId: "motherboard", quantity: 1 }, memory: [], ssd: [{ partId: "ssd-nvme", quantity: 3 }], hdd: [], useIntegratedGraphics: true };
    const accessories = [
      accessory({ id: "adapter-too-small", category: "storage_accessory", name: "M.2 1개용 PCIe 어댑터", rawSpecText: "M.2 2280 · NVMe → PCIe x4 · 보관(장착) 개수: 최대 1개", specs: { interface: "NVMe", formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], adapterStorageDeviceCount: 1 }, priceWon: 1000 }),
      accessory({ id: "adapter-good", category: "storage_accessory", name: "M.2 NVMe 2개용 PCIe 어댑터", rawSpecText: "M.2 2280 · NVMe → PCIe x4 · 보관(장착) 개수: 최대 2개", specs: { interface: "NVMe", formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], adapterStorageDeviceCount: 2 } }),
      accessory({ id: "adapter-over", category: "storage_accessory", name: "M.2 NVMe 4개용 PCIe 어댑터", rawSpecText: "M.2 2280 · NVMe → PCIe x4 · 보관(장착) 개수: 최대 4개", specs: { interface: "NVMe", formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], adapterStorageDeviceCount: 4 }, priceWon: 20000 }),
      accessory({ id: "adapter-sata", category: "storage_accessory", name: "M.2 SATA 어댑터", rawSpecText: "M.2 2280 · SATA → SATA 2.5인치 · 보관(장착) 개수: 최대 4개", specs: { interface: "SATA", formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], adapterStorageDeviceCount: 4 } }),
      accessory({ id: "bracket-only", category: "storage_accessory", name: "2.5인치 SSD 브라켓", rawSpecText: "2.5인치 SATA SSD용 브라켓", specs: { formFactor: "2.5인치" } })
    ];

    const recommendations = recommendAccessories(build, catalog, accessories).filter((item) => item.category === "storage_accessory");

    expect(recommendations.map((item) => item.item.id)).toEqual(["adapter-good", "adapter-over"]);
    expect(recommendations[0].priority).toBe("recommended");
    expect(recommendations[0].reason).toContain("2개 확장 경로");
    expect(recommendations[0].fitBasis).toContain("최소 2개");
    expect(recommendations[0].item.specs.adapterStorageDeviceCount).toBe(2);
    expect(recommendations.some((item) => item.item.id === "adapter-too-small")).toBe(false);
    expect(recommendAccessories({ ...build, ssd: [{ partId: "ssd-nvme", quantity: 1 }] }, catalog, accessories).some((item) => item.category === "storage_accessory")).toBe(false);
  });

  it("recommends supplemental GPU cooling only when the GPU is high-load and the candidate has cooling evidence", () => {
    const catalog = [
      part({ id: "gpu", category: "gpu", specs: { powerW: 450, thicknessMm: 60 } })
    ];
    const build = { gpu: { partId: "gpu", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: false };
    const accessories = [
      accessory({ id: "gpu-cooler-good", category: "gpu_cooler", name: "그래픽카드 보조 쿨링 브라켓", rawSpecText: "PCI 슬롯 장착형 · 92mm 팬 장착 지원", specs: { fanCount: 1 } }),
      accessory({ id: "gpu-cover", category: "gpu_cooler", name: "그래픽카드 장식 커버", rawSpecText: "그래픽카드 커버", specs: {} })
    ];

    const recommendations = recommendAccessories(build, catalog, accessories).filter((item) => item.category === "gpu_cooler");

    expect(recommendations.map((item) => item.item.id)).toEqual(["gpu-cooler-good"]);
    expect(recommendations[0].confidence).toBe("medium");
    expect(recommendations[0].fitBasis).toContain("대체하는 추천이 아니며");
  });

  it("recommends a fan hub when verified case fans exceed motherboard headers", () => {
    const catalog = [
      part({ id: "motherboard", category: "motherboard", specs: { fanPortCount: 2 } }),
      part({ id: "case", category: "case", specs: { fanCount: 4 } })
    ];
    const build = { motherboard: { partId: "motherboard", quantity: 1 }, case: { partId: "case", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: true };
    const accessories = [
      accessory({ id: "hub-4", category: "fan_hub", name: "4포트 팬 허브", specs: { fanPortCount: 4 }, rawSpecText: "팬컨트롤러 / 팬분배: 4개 / SATA전원" }),
      accessory({ id: "hub-2", category: "fan_hub", name: "2포트 팬 허브", specs: { fanPortCount: 2 }, rawSpecText: "팬컨트롤러 / 팬분배: 2개 / SATA전원" }),
      accessory({ id: "hub-no-power", category: "fan_hub", name: "전원 미확인 8포트 허브", specs: { fanPortCount: 8 }, rawSpecText: "팬컨트롤러 / 팬분배: 8개" })
    ];

    const recommendation = recommendAccessories(build, catalog, accessories).find((item) => item.item.id === "hub-4");

    expect(recommendation).toMatchObject({ category: "fan_hub", priority: "recommended", confidence: "high" });
    expect(recommendation?.reason).toContain("직접 연결이 2개 부족");
    expect(recommendAccessories(build, catalog, accessories).some((item) => item.item.id === "hub-2")).toBe(false);
    expect(recommendAccessories(build, catalog, accessories).some((item) => item.item.id === "hub-no-power")).toBe(false);
  });

  it("recommends only voltage-matched RGB controllers with enough outputs", () => {
    const catalog = [
      part({ id: "motherboard", category: "motherboard", specs: { rgbPortCount: 1, rgb5vPortCount: 0, rgb12vPortCount: 0 } }),
      part({ id: "case", category: "case", specs: { rgbDeviceCount: 3, rgbDeviceVoltage: "5V", rgbControllerIncluded: false } })
    ];
    const build = { motherboard: { partId: "motherboard", quantity: 1 }, case: { partId: "case", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: true };
    const accessories = [
      accessory({ id: "rgb-good", category: "fan_hub", name: "5V ARGB 4포트 컨트롤러", specs: { rgbPortCount: 4 }, rawSpecText: "RGB컨트롤러 / SATA전원 / 분배단자: ARGB 3핀 / RGB분배: 4개" }),
      accessory({ id: "rgb-wrong-voltage", category: "fan_hub", name: "12V RGB 4포트 컨트롤러", specs: { rgbPortCount: 4 }, rawSpecText: "RGB컨트롤러 / SATA전원 / 12V RGB 4핀 / RGB분배: 4개" }),
      accessory({ id: "rgb-too-small", category: "fan_hub", name: "5V ARGB 2포트 컨트롤러", specs: { rgbPortCount: 2 }, rawSpecText: "RGB컨트롤러 / SATA전원 / 5V ARGB 3핀 / RGB분배: 2개" })
    ];

    const recommendations = recommendAccessories(build, catalog, accessories).filter((item) => item.item.id.startsWith("rgb-"));

    expect(recommendations.map((item) => item.item.id)).toEqual(["rgb-good"]);
    expect(recommendations[0].reason).toContain("5V");
    expect(recommendations[0].fitBasis).toContain("RGB 분배 포트 3개 이상");
  });
});
