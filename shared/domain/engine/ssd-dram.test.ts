import { describe, expect, it } from "vitest";
import type { Part } from "../../types";
import { ssdDramCacheFor } from "./evaluate";

const ssd = (rawSpecText: string): Part => ({ id: "ssd", category: "ssd", name: "SSD", source: "danawa", dataQuality: "live", specs: {}, missingFields: [], updatedAt: "2026-11-01T00:00:00.000Z", rawSpecText });

describe("SSD DRAM cache detection", () => {
  it("reads Danawa DRAM/HMB markers", () => {
    expect(ssdDramCacheFor(ssd("M.2 (2280) / PCIe4.0x4 / TLC(토글) / DRAM 탑재 / 컨트롤러: 삼성"))).toBe(true);
    expect(ssdDramCacheFor(ssd("M.2 (2280) / PCIe4.0x4 / TLC / [지원기능] TRIM / SLC캐싱 / HMB / ECC"))).toBe(false);
    expect(ssdDramCacheFor(ssd("M.2 (2280) / DRAM 미탑재 / QLC"))).toBe(false);
    expect(ssdDramCacheFor(ssd("M.2 (2280) / PCIe4.0x4 / TLC"))).toBeUndefined();
  });
});
