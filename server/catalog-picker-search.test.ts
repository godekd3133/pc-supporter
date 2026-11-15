import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { comparePartPopularity, filterParts, searchParts } from "./catalog";
import { danawaPopularityRankFor } from "./danawa";

function part(overrides: Partial<Part>): Part {
  return {
    id: "danawa-cpu-1",
    category: "cpu",
    name: "CPU",
    brand: "AMD",
    source: "danawa",
    sourceProductCode: "1",
    priceWon: 100000,
    specs: { socket: "AM5", tdpW: 65 },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

// 현세대 CPU가 2개 이상 있어야 카탈로그 세대 경계가 Ryzen 9000/Core Ultra 200으로 선다.
const cpuCatalog: Part[] = [
  part({ id: "danawa-cpu-9500f", sourceProductCode: "9500", name: "AMD 라이젠5-6세대 9500F (그래니트 릿지) (멀티팩 정품)", priceWon: 250000, popularityRank: 21, specs: { socket: "AM5", cpuSeries: "Ryzen 9000" } }),
  part({ id: "danawa-cpu-9600x", sourceProductCode: "9600", name: "AMD 라이젠5-6세대 9600X (그래니트 릿지) (정품)", priceWon: 300000, popularityRank: 3, specs: { socket: "AM5", cpuSeries: "Ryzen 9000" } }),
  part({ id: "danawa-cpu-9800x3d", sourceProductCode: "9800", name: "AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (정품)", priceWon: 700000, popularityRank: 1, specs: { socket: "AM5", cpuSeries: "Ryzen 9000" } }),
  part({ id: "danawa-cpu-6600", sourceProductCode: "6600", brand: "인텔", name: "인텔 코어i5-6세대 6600 (스카이레이크) (정품)", priceWon: 90000, popularityRank: 178, specs: { socket: "LGA1151", cpuSeries: "Core 6" } }),
  part({ id: "danawa-cpu-1600", sourceProductCode: "1600", name: "AMD 라이젠5-1세대 1600 (서밋 릿지) (정품)", priceWon: 80000, specs: { socket: "AM4", cpuSeries: "Ryzen 1000" } }),
  part({ id: "danawa-cpu-u245k", sourceProductCode: "245", brand: "인텔", name: "인텔 코어 울트라5 시리즈2 245K (애로우레이크) (정품)", priceWon: 400000, popularityRank: 5, specs: { socket: "LGA1851", cpuSeries: "Core Ultra 200" } }),
  part({ id: "danawa-cpu-u265k", sourceProductCode: "265", brand: "인텔", name: "인텔 코어 울트라7 시리즈2 265K (애로우레이크) (정품)", priceWon: 500000, popularityRank: 8, specs: { socket: "LGA1851", cpuSeries: "Core Ultra 200" } })
];

describe("part picker search scope", () => {
  it("keeps the quote pool on the current generation but lets picker search find old CPUs", () => {
    const quotePool = filterParts(cpuCatalog, "cpu", undefined, { quoteBrandRestricted: true, quoteSellableOnly: true }).map(({ id }) => id);
    expect(quotePool).not.toContain("danawa-cpu-6600");
    expect(quotePool).not.toContain("danawa-cpu-1600");

    const pickerPool = filterParts(cpuCatalog, "cpu", undefined, { quoteBrandRestricted: true, quoteSellableOnly: true, searchAllParts: true }).map(({ id }) => id);
    expect(pickerPool).toEqual(expect.arrayContaining(["danawa-cpu-6600", "danawa-cpu-1600", "danawa-cpu-9500f"]));
    expect(searchParts(cpuCatalog, "cpu", "6600", 10, { searchAllParts: true }).map(({ id }) => id)).toEqual(["danawa-cpu-6600"]);
  });

  it("lifts the quote brand restriction (SSD/RAM/PSU) for picker search only", () => {
    const catalog = [
      part({ id: "danawa-ssd-samsung", category: "ssd", brand: "삼성전자", name: "삼성전자 990 PRO 1TB", specs: { capacityGb: 1000 } }),
      part({ id: "danawa-ssd-wd", category: "ssd", brand: "Western Digital", name: "WD_BLACK SN850X 1TB", specs: { capacityGb: 1000 } }),
      part({ id: "danawa-psu-superflower", category: "psu", brand: "SuperFlower", name: "SuperFlower SF-850F14XG", specs: { wattageW: 850 } })
    ];
    expect(filterParts(catalog, "ssd", undefined, { quoteBrandRestricted: true, quoteSellableOnly: true }).map(({ id }) => id)).toEqual(["danawa-ssd-samsung"]);
    expect(filterParts(catalog, "ssd", undefined, { quoteBrandRestricted: true, quoteSellableOnly: true, searchAllParts: true }).map(({ id }) => id).sort()).toEqual(["danawa-ssd-samsung", "danawa-ssd-wd"]);
    expect(filterParts(catalog, "psu", "superflower", { quoteBrandRestricted: true, searchAllParts: true }).map(({ id }) => id)).toEqual(["danawa-psu-superflower"]);
  });

  it("still hides unavailable parts from picker search", () => {
    const catalog = [
      part({ id: "danawa-cpu-delisted", name: "AMD 라이젠5-6세대 9600 (정품)", delistedAt: "2026-08-01T00:00:00.000Z" }),
      part({ id: "danawa-cpu-unpriced", name: "AMD 라이젠5-6세대 9600X (정품)", priceWon: undefined })
    ];
    expect(filterParts(catalog, "cpu", undefined, { searchAllParts: true })).toEqual([]);
  });
});

describe("part search prefix matching", () => {
  it("finds 9500F from a partial 9500 query and ranks exact model tokens first", () => {
    const catalog = [
      ...cpuCatalog,
      part({ id: "danawa-cpu-9500", sourceProductCode: "i9500", brand: "인텔", name: "인텔 코어i5-9세대 9500 (커피레이크-R) (정품)", priceWon: 300000, popularityRank: 219, specs: { socket: "LGA1151", cpuSeries: "Core 9" } }),
      part({ id: "danawa-cpu-19500", sourceProductCode: "19500", name: "가상 19500 CPU", specs: { socket: "AM5" } })
    ];
    const ids = searchParts(catalog, "cpu", "9500", 10, { searchAllParts: true, sort: "popular" }).map(({ id }) => id);
    expect(ids).toEqual(["danawa-cpu-9500", "danawa-cpu-9500f"]);
  });
});

describe("popular sort", () => {
  it("orders by Danawa popularity rank, unranked parts last by price", () => {
    const ids = searchParts(cpuCatalog, "cpu", undefined, 10, { searchAllParts: true, sort: "popular" }).map(({ id }) => id);
    expect(ids).toEqual(["danawa-cpu-9800x3d", "danawa-cpu-9600x", "danawa-cpu-u245k", "danawa-cpu-u265k", "danawa-cpu-9500f", "danawa-cpu-6600", "danawa-cpu-1600"]);
  });

  it("treats invalid ranks as unranked", () => {
    const ranked = part({ id: "a", popularityRank: 10, priceWon: 500000 });
    const invalid = part({ id: "b", popularityRank: 0, priceWon: 1000 });
    expect(comparePartPopularity(ranked, invalid)).toBeLessThan(0);
  });

  it("computes crawler popularity rank from the BEST list position", () => {
    expect(danawaPopularityRankFor(1, 30, 0)).toBe(1);
    expect(danawaPopularityRankFor(2, 30, 4)).toBe(35);
  });
});
