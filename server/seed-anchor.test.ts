import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { seedLiveTwinFor, seedLiveTwinsFor, syncSeedPartPricesFromLive } from "../shared/domain/seed-anchor";
import { isQuotePurchasable, isQuoteSelectable } from "./listing";

const part = (overrides: Partial<Part>): Part => ({
  id: `p-${Math.random().toString(36).slice(2, 8)}`,
  category: "memory",
  name: "테스트 부품",
  source: "danawa",
  priceWon: 100000,
  specs: {},
  dataQuality: "live",
  missingFields: [],
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides
});

const seed = (overrides: Partial<Part>): Part => part({ source: "seed", dataQuality: "seed", ...overrides });

const samsungRamSeed = () => seed({
  id: "memory-ddr5-16-5600",
  category: "memory",
  name: "삼성전자 DDR5-5600 16GB",
  brand: "Samsung",
  priceWon: 58000,
  specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, formFactor: "DIMM" }
});

const samsungRamLive = (priceWon: number, overrides: Partial<Part> = {}) =>
  part({
    category: "memory",
    name: "삼성전자 DDR5-5600 (16GB)",
    brand: "삼성전자",
    priceWon,
    specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, formFactor: "DIMM" },
    ...overrides
  });

describe("seed live twin anchoring", () => {
  it("syncs a seed price from the matching live listing across vendor aliases", () => {
    // seed는 영문 brand, live는 한글 브랜드 — 별칭 정규화로 같은 제품으로 본다.
    const catalog = [samsungRamSeed(), samsungRamLive(349910)];
    const synced = syncSeedPartPricesFromLive(catalog);
    expect(synced.find((p) => p.id === "memory-ddr5-16-5600")?.priceWon).toBe(349910);
    expect(synced.find((p) => p.id !== "memory-ddr5-16-5600")?.priceWon).toBe(349910);
  });

  it("uses the cheapest live listing when several twins exist", () => {
    const catalog = [samsungRamSeed(), samsungRamLive(349910), samsungRamLive(380000), samsungRamLive(339000, { name: "삼성전자 DDR5-5600 벌크 (16GB)", listingType: "bulk" })];
    expect(syncSeedPartPricesFromLive(catalog).find((p) => p.dataQuality === "seed")?.priceWon).toBe(339000);
  });

  it("does not match a different vendor or different spec", () => {
    const catalog = [
      samsungRamSeed(),
      // 다른 벤더 — 같은 시그니처여도 트윈이 아니다.
      part({ category: "memory", name: "SK하이닉스 DDR5-5600 (16GB)", brand: "SK하이닉스", priceWon: 90000, specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, formFactor: "DIMM" } }),
      // 같은 벤더 다른 용량 — 트윈이 아니다.
      part({ category: "memory", name: "삼성전자 DDR5-5600 (32GB)", brand: "삼성전자", priceWon: 60000, specs: { memoryType: "DDR5", capacityGb: 32, speedMhz: 5600, formFactor: "DIMM" } }),
      // 같은 벤더 다른 타입(DDR4) — 트윈이 아니다.
      part({ category: "memory", name: "삼성전자 DDR4-3200 (16GB)", brand: "삼성전자", priceWon: 40000, specs: { memoryType: "DDR4", capacityGb: 16, speedMhz: 3200, formFactor: "DIMM" } })
    ];
    const synced = syncSeedPartPricesFromLive(catalog);
    expect(synced.find((p) => p.dataQuality === "seed")?.priceWon).toBe(58000);
    expect(seedLiveTwinsFor(catalog[0], catalog)).toHaveLength(0);
  });

  it("matches a cpu seed to live listings by model number and socket", () => {
    const cpuSeed = seed({ category: "cpu", name: "AMD 라이젠5-6세대 9600", brand: "AMD", model: "9600", priceWon: 235000, specs: { socket: "AM5", cpuSeries: "Ryzen 9000", cores: 6 } });
    const live = part({ category: "cpu", name: "AMD 라이젠5-6세대 9600 (그래니트 릿지) (멀티팩 정품)", brand: "AMD", priceWon: 289000, specs: { socket: "AM5", cpuSeries: "Ryzen 9000" } });
    const otherSocket = part({ category: "cpu", name: "AMD 라이젠5-4세대 5600 (버미어)", brand: "AMD", priceWon: 99000, specs: { socket: "AM4" } });
    const synced = syncSeedPartPricesFromLive([cpuSeed, live, otherSocket]);
    expect(synced.find((p) => p.dataQuality === "seed")?.priceWon).toBe(289000);
  });

  it("matches a gpu seed to partner listings by chip model", () => {
    const gpuSeed = seed({ category: "gpu", name: "ZOTAC GeForce RTX 5060 Twin Edge", brand: "ZOTAC", model: "RTX 5060 Twin Edge", priceWon: 439000, specs: {} });
    const live = part({ category: "gpu", name: "ZOTAC GAMING 지포스 RTX 5060 Twin Edge OC D7 8GB", brand: "ZOTAC", priceWon: 449000, specs: { vramGb: 8 } });
    const otherPartner = part({ category: "gpu", name: "MSI 지포스 RTX 5060 벤투스 2X OC D7 8GB", brand: "MSI", priceWon: 300000, specs: { vramGb: 8 } });
    const tiVariant = part({ category: "gpu", name: "ZOTAC GAMING 지포스 RTX 5060 Ti Twin Edge OC D7 16GB", brand: "ZOTAC", priceWon: 200000, specs: { vramGb: 16 } });
    const synced = syncSeedPartPricesFromLive([gpuSeed, live, otherPartner, tiVariant]);
    // 다른 파트너의 더 싼 5060과 Ti 변형은 트윈이 아니다 — ZOTAC 5060만 앵커.
    expect(synced.find((p) => p.dataQuality === "seed")?.priceWon).toBe(449000);
  });

  it("ignores delisted, unpriced, and accessory twins", () => {
    const catalog = [
      samsungRamSeed(),
      samsungRamLive(200000, { delistedAt: "2026-09-01T00:00:00.000Z" }),
      samsungRamLive(180000, { priceWon: 0 }),
      samsungRamLive(170000, { listingType: "accessory" })
    ];
    expect(syncSeedPartPricesFromLive(catalog).find((p) => p.dataQuality === "seed")?.priceWon).toBe(58000);
  });

  it("leaves generic placeholder seeds untouched", () => {
    const genericSeed = seed({ category: "memory", name: "DDR5-5600 32GB 기준 메모리", brand: "PC Supporter", priceWon: 119000, specs: { memoryType: "DDR5", capacityGb: 32, speedMhz: 5600, formFactor: "DIMM" } });
    const live = part({ category: "memory", name: "ESSENCORE KLEVV DDR5-5600 CL46 파인인포 (32GB)", brand: "ESSENCORE", priceWon: 150000, specs: { memoryType: "DDR5", capacityGb: 32, speedMhz: 5600, formFactor: "DIMM" } });
    expect(syncSeedPartPricesFromLive([genericSeed, live]).find((p) => p.dataQuality === "seed")?.priceWon).toBe(119000);
  });

  it("suppresses a seed from quote selection when a purchasable live twin exists", () => {
    const catalog = [samsungRamSeed(), samsungRamLive(349910)];
    expect(isQuotePurchasable(catalog[0], catalog)).toBe(false);
    expect(isQuoteSelectable(catalog[0], catalog)).toBe(false);
    // 카탈로그 없는 단건 판별은 기존 동작을 유지한다.
    expect(isQuotePurchasable(catalog[0])).toBe(true);
    expect(isQuoteSelectable(catalog[0])).toBe(true);
  });

  it("keeps the seed selectable when its twins are not purchasable", () => {
    const catalog = [samsungRamSeed(), samsungRamLive(0)];
    expect(isQuotePurchasable(catalog[0], catalog)).toBe(true);
  });
});
