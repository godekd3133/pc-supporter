import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { countParts, filterParts, searchParts } from "./catalog";

const cpu = (id: string, name: string, priceWon = 120_000): Part => ({ id, name, category: "cpu", brand: "AMD", source: "danawa", dataQuality: "live", priceWon, listingType: "retail", updatedAt: "2026-10-06T00:00:00Z", missingFields: [], specs: { cpuSeries: /9800|9950/.test(name) ? "Ryzen 9000" : /7500/.test(name) ? "Ryzen 7000" : "Ryzen 5000", socket: "AM4", memoryType: "DDR4", tdpW: 65 } });
const oldCpu = cpu("5600", "AMD Ryzen 5600");
const memory: Part = { ...oldCpu, id: "klevv", category: "memory", name: "ESSENCORE KLEVV DDR4-3200 CL22 파인인포 (16GB)", brand: "ESSENCORE", specs: { memoryType: "DDR4", capacityGb: 16, speedMhz: 3200 } };
const catalog = [oldCpu, cpu("7500f", "AMD Ryzen 7500F", 160_000), cpu("9800x3d", "AMD Ryzen 9800X3D", 500_000), cpu("9950x3d", "AMD Ryzen 9950X3D", 800_000), memory];

describe("gaming picker catalog projection", () => {
  it("changes only explicitly scoped lists while preserving the general brand and generation gates", () => {
    const general = { quoteBrandRestricted: true, quoteSellableOnly: true, priceAvailability: "known" as const };
    const scoped = { ...general, quoteContext: "gaming_testbed" as const };
    expect(filterParts(catalog, "cpu", undefined, general).map(({ id }) => id)).not.toContain("5600");
    expect(filterParts(catalog, "cpu", undefined, scoped).map(({ id }) => id)).toContain("5600");
    expect(filterParts(catalog, "memory", undefined, general)).toHaveLength(0);
    expect(filterParts(catalog, "memory", undefined, scoped).map(({ id }) => id)).toEqual(["klevv"]);
    expect(countParts(catalog, "cpu", undefined, scoped)).toBe(4);
    expect(searchParts(catalog, "cpu", undefined, 1, scoped, 1).map(({ id }) => id)).toEqual(["7500f"]);
  });

  it("does not let priceStatus=all, partId or missing-field queries bypass scoped purchasability", () => {
    const bad = { ...oldCpu, id: "delisted", delistedAt: "2026-10-06T00:00:00Z" };
    const unpriced = { ...oldCpu, id: "no-price", priceWon: undefined };
    const incomplete = { ...oldCpu, id: "incomplete", dataQuality: "incomplete" as const, missingFields: ["socket"] };
    for (const target of [bad, unpriced, incomplete]) expect(filterParts([target], "cpu", undefined, { quoteContext: "gaming_testbed", partId: target.id, priceAvailability: "all", quoteSellableOnly: false })).toHaveLength(0);
    expect(filterParts([oldCpu], "cpu", "7500", { quoteContext: "gaming_testbed" })).toHaveLength(0);
  });
});
