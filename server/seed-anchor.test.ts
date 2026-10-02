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

  it("matches an ssd seed to a live listing with naming drift (870 EVO)", () => {
    const ssdSeed = seed({ category: "ssd", name: "Samsung 870 EVO SATA 1TB", brand: "Samsung", model: "870 EVO 1TB", priceWon: 99000, specs: { capacityGb: 1024, interface: "SATA", formFactor: "2.5인치" } });
    const live = part({ category: "ssd", name: "삼성전자 870 EVO (1TB)", brand: "삼성전자", priceWon: 423200, specs: { capacityGb: 1000, interface: "SATA", formFactor: "2.5인치" } });
    // 용량 표기 차이(1024 vs 1000)는 버킷으로 흡수하고 이름 토큰 {870,evo}로 묶인다.
    const synced = syncSeedPartPricesFromLive([ssdSeed, live]);
    expect(synced.find((p) => p.dataQuality === "seed")?.priceWon).toBe(423200);
  });

  it("rejects discriminating variants even when one name contains the other", () => {
    const ssdSeed = seed({ category: "ssd", name: "WD_BLACK SN770 1TB", brand: "Western Digital", priceWon: 99000, specs: { capacityGb: 1000 } });
    const mVariant = part({ category: "ssd", name: "Western Digital WD BLACK SN770M M.2 2230 (1TB)", brand: "Western Digital", priceWon: 180000, specs: { capacityGb: 1000 } });
    const proVariant = part({ category: "ssd", name: "Western Digital WD BLACK SN770 PRO (1TB)", brand: "Western Digital", priceWon: 180000, specs: { capacityGb: 1000 } });
    expect(seedLiveTwinsFor(ssdSeed, [mVariant])).toHaveLength(0);
    expect(seedLiveTwinsFor(ssdSeed, [proVariant])).toHaveLength(0);
  });

  it("matches a psu seed by series tokens while rejecting a different wattage", () => {
    const psuSeed = seed({ category: "psu", name: "Seasonic FOCUS GX-1000", brand: "Seasonic", priceWon: 229000, specs: { wattageW: 1000 } });
    const same = part({ category: "psu", name: "시소닉 NEW FOCUS GX-1000 GOLD 풀모듈러 ATX3.0", brand: "시소닉", priceWon: 279000, specs: { wattageW: 1000 } });
    const lowerWatt = part({ category: "psu", name: "시소닉 NEW FOCUS GX-850 GOLD 풀모듈러 ATX3.0", brand: "시소닉", priceWon: 150000, specs: { wattageW: 850 } });
    const synced = syncSeedPartPricesFromLive([psuSeed, same, lowerWatt]);
    expect(synced.find((p) => p.dataQuality === "seed")?.priceWon).toBe(279000);
  });

  it("matches a motherboard seed through distributor suffixes", () => {
    const mbSeed = seed({ category: "motherboard", name: "ASUS TUF Gaming B650M-PLUS WIFI", brand: "ASUS", model: "B650M-PLUS WIFI", priceWon: 219000, specs: { socket: "AM5", memoryType: "DDR5", formFactor: "M-ATX" } });
    const live = part({ category: "motherboard", name: "ASUS TUF Gaming B650M-PLUS WIFI STCOM", brand: "ASUS", priceWon: 234560, specs: { socket: "AM5", memoryType: "DDR5", formFactor: "M-ATX" } });
    const synced = syncSeedPartPricesFromLive([mbSeed, live]);
    expect(synced.find((p) => p.dataQuality === "seed")?.priceWon).toBe(234560);
  });

  it("excludes a twinless seed from quotes when its category is well covered by live listings", () => {
    const twinless = seed({ category: "memory", name: "PATRIOT VIPER VENOM DDR5-5600 CL36 16GB", brand: "PATRIOT", priceWon: 49900, specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, formFactor: "DIMM" } });
    // 같은 범주에 구매 가능한 live 매물이 충분하면 트윈이 없는 seed는
    // 다나와에서 빠진(단종 추정) 제품으로 보고 견적에서 제외한다.
    const liveParts = Array.from({ length: 20 }, (_value, index) =>
      part({ id: `live-mem-${index}`, category: "memory", name: `브랜드${index} DDR5-5600 (16GB)`, priceWon: 50000 + index, dataQuality: "live", specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, formFactor: "DIMM" } }));
    const catalog = [twinless, ...liveParts];
    expect(isQuotePurchasable(twinless, catalog)).toBe(false);
    expect(isQuoteSelectable(twinless, catalog)).toBe(false);
    // 범위 밖 호출(카탈로그 없음)은 기존 동작을 유지한다.
    expect(isQuotePurchasable(twinless)).toBe(true);
  });

  it("keeps a twinless seed purchasable while its category coverage is thin", () => {
    const twinless = seed({ category: "memory", name: "PATRIOT VIPER VENOM DDR5-5600 CL36 16GB", brand: "PATRIOT", priceWon: 49900, specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, formFactor: "DIMM" } });
    const fewLive = Array.from({ length: 5 }, (_value, index) =>
      part({ id: `live-mem-${index}`, category: "memory", name: `브랜드${index} DDR5-5600 (16GB)`, priceWon: 50000, dataQuality: "live", specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, formFactor: "DIMM" } }));
    // 크롤이 아직 이 범주를 못 채웠다면 seed 부재=단종으로 단정할 수 없다 → 폴백 유지.
    expect(isQuotePurchasable(twinless, [twinless, ...fewLive])).toBe(true);
  });

  it("keeps a seed purchasable when only non-retail twins exist", () => {
    // 병행수입·벌크 매물만 남은 실제품은 시장에 존재하므로 seed가
    // sync된 최저가로 계속 견적에 선다(구매 링크는 트윈이 제공).
    const catalog = [samsungRamSeed(), samsungRamLive(349910, { listingType: "parallel_import" })];
    expect(isQuotePurchasable(catalog[0], catalog)).toBe(true);
    expect(catalog[0].priceWon).toBe(58000); // sync는 호출자가 적용
  });

  it("does not let a generic seed absorb an unrelated live price", () => {
    const generic = seed({ category: "psu", name: "650W 기준 파워", brand: "PC Supporter", priceWon: 72000, specs: { wattageW: 650 } });
    const live = part({ category: "psu", name: "마이크로닉스 Classic II 650W", brand: "마이크로닉스", priceWon: 40000, specs: { wattageW: 650 } });
    expect(syncSeedPartPricesFromLive([generic, live]).find((p) => p.dataQuality === "seed")?.priceWon).toBe(72000);
  });
});
