import { describe, expect, it } from "vitest";
import type { BuildSelection, Part } from "./types";
import { compatibilityFilterPresetFor } from "./compatibility-filter-preset";

function part(id: string, category: Part["category"], specs: Part["specs"]): Part {
  return { id, category, name: id, source: "seed", dataQuality: "seed", missingFields: [], updatedAt: "2026-09-01T00:00:00.000Z", specs };
}

const build: BuildSelection = {
  cpu: { partId: "cpu", quantity: 1 },
  cooler: { partId: "cooler", quantity: 1 },
  motherboard: { partId: "motherboard", quantity: 1 },
  memory: [{ partId: "memory", quantity: 2 }],
  gpu: { partId: "gpu", quantity: 1 },
  ssd: [{ partId: "ssd", quantity: 2 }],
  hdd: [{ partId: "hdd", quantity: 2 }],
  case: { partId: "case", quantity: 1 },
  psu: { partId: "psu", quantity: 1 },
  accessories: [],
  useIntegratedGraphics: false
};

const parts = [
  part("cpu", "cpu", { socket: "AM5", memoryType: "DDR5", pptW: 105 }),
  part("cooler", "cooler", { supportedSockets: ["AM5"], maxCoolingW: 220, maxCoolerHeightMm: 160 }),
  part("motherboard", "motherboard", { socket: "AM5", memoryType: "DDR5", formFactor: "mATX", memorySlots: 4, m2Slots: 4, sataPorts: 6 }),
  part("memory", "memory", { memoryType: "DDR5", formFactor: "DIMM", capacityGb: 32, speedMhz: 6000, memoryModuleCountPerKit: 2 }),
  part("gpu", "gpu", { lengthMm: 359, vramGb: 32, recommendedPsuW: 1000 }),
  part("ssd", "ssd", { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 1000 }),
  part("hdd", "hdd", { interface: "SATA", formFactor: "3.5인치", capacityGb: 4000 }),
  part("case", "case", { maxGpuLengthMm: 400, maxCoolerHeightMm: 180, maxPsuLengthMm: 200, hddBays: 4, motherboardFormFactors: ["mATX"] }),
  part("psu", "psu", { wattageW: 1200, psuDepthMm: 170, psuFormFactor: "ATX" })
];
const partMap = new Map(parts.map((item) => [item.id, item]));

describe("compatibility filter presets", () => {
  it("derives motherboard expansion requirements from the current build", () => {
    const preset = compatibilityFilterPresetFor("motherboard", build, partMap);

    expect(preset.values).toMatchObject({ socket: "AM5", memoryType: "DDR5", minMemorySlots: "4", minM2Slots: "2", minSataPorts: "2" });
    expect(preset.labels).toEqual(expect.arrayContaining(["소켓 AM5", "메모리 세대 DDR5", "RAM 슬롯 ≥ 4개", "M.2 슬롯 ≥ 2개", "SATA 포트 ≥ 2개"]));
  });

  it("derives case, GPU, cooler, and PSU physical constraints with safe rounding", () => {
    expect(compatibilityFilterPresetFor("case", build, partMap).values).toMatchObject({ formFactor: "mATX", minMaxGpuLengthMm: "359", minMaxCoolerHeightMm: "160", minHddBays: "2", minMaxPsuLengthMm: "170" });
    expect(compatibilityFilterPresetFor("gpu", build, partMap).values).toMatchObject({ maxLengthMm: "400", minVramGb: "32" });
    expect(compatibilityFilterPresetFor("cooler", build, partMap).values).toMatchObject({ socket: "AM5", minCoolingW: "105" });
    expect(compatibilityFilterPresetFor("psu", build, partMap).values).toMatchObject({ minWattageW: "1000", maxPsuDepthMm: "200" });
  });

  it("does not invent an M.2 requirement when the selected SSD form factor is missing", () => {
    const incompleteMap = new Map(partMap);
    incompleteMap.set("ssd", part("ssd", "ssd", { interface: "NVMe", capacityGb: 1000 }));

    const preset = compatibilityFilterPresetFor("motherboard", build, incompleteMap);

    expect(preset.values.minM2Slots).toBeUndefined();
    expect(preset.omitted).toContain("M.2 SSD 연결 방식 확인 필요");
  });
});
