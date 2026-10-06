import { describe, expect, it } from "vitest";
import { seedCatalog } from "../server/seed-catalog";
import type { BuildSelection, Part } from "./types";
import { suggestPartAdjustment } from "./part-adjustment";

const gpuBase = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;

const gpuVariant = (id: string, priceWon: number, overrides: Partial<Part["specs"]> = {}): Part => ({
  ...gpuBase,
  id,
  priceWon,
  dataQuality: "live",
  listingType: "retail",
  specs: { ...gpuBase.specs, ...overrides }
});

const catalog = [
  ...seedCatalog,
  gpuVariant("gpu-adjust-stronger", 599000),
  gpuVariant("gpu-adjust-cheaper", 299000)
];

const baseSelection = (): BuildSelection => ({
  cpu: { partId: "cpu-7500f", quantity: 1 },
  cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
  motherboard: { partId: "mb-b650-4x3", quantity: 1 },
  memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
  gpu: { partId: "gpu-rtx-4060", quantity: 1 },
  ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
  hdd: [],
  case: { partId: "case-full-airflow", quantity: 1 },
  psu: { partId: "psu-650w", quantity: 1 },
  accessories: [],
  useIntegratedGraphics: false
});

describe("suggestPartAdjustment", () => {
  it("GPU 상향 시 더 비싼 호환 그래픽카드와 새 견적을 제안한다", () => {
    const result = suggestPartAdjustment(catalog, baseSelection(), "gpu", "upgrade");
    const suggestion = result.suggestion;
    expect(suggestion).toBeDefined();
    expect(suggestion?.part.id).toBe("gpu-adjust-stronger");
    expect(suggestion?.afterPriceWon ?? 0).toBeGreaterThan(suggestion?.beforePriceWon ?? 0);
    expect(suggestion?.selection.gpu?.partId).toBe("gpu-adjust-stronger");
    expect(suggestion?.status).not.toBe("incompatible");
  });

  it("GPU 하향 시 더 저렴한 부품을 제안한다", () => {
    const result = suggestPartAdjustment(catalog, baseSelection(), "gpu", "downgrade");
    expect(result.suggestion?.part.id).toBe("gpu-adjust-cheaper");
    expect(result.suggestion?.afterPriceWon ?? 0).toBeLessThan(result.suggestion?.beforePriceWon ?? 0);
  });

  it("메모리 상향 시 수량을 유지한 채 배열 슬롯의 첫 항목을 교체한다", () => {
    const result = suggestPartAdjustment(catalog, baseSelection(), "memory", "upgrade");
    const suggestion = result.suggestion;
    expect(suggestion).toBeDefined();
    expect(suggestion?.entry.partId).toBe(suggestion?.part.id);
    expect(suggestion?.selection.memory[0]?.partId).toBe(suggestion?.part.id);
    expect(suggestion?.selection.memory[0]?.quantity).toBe(2);
  });

  it("호환 가능한 후보가 없으면 suggestion 없이 사유를 반환한다", () => {
    const sparse = catalog.filter((part) => part.category !== "gpu");
    const result = suggestPartAdjustment(sparse, baseSelection(), "gpu", "upgrade");
    expect(result.suggestion).toBeUndefined();
    expect(result.reason).toBe("no-candidates");
  });
});
