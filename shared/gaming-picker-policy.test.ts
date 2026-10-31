import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { gamingPickerPartAllowed } from "./gaming-picker-policy";

const part = (overrides: Partial<Part>): Part => ({ id: "part", name: "AMD Ryzen 5600", category: "cpu", brand: "AMD", source: "danawa", dataQuality: "live", priceWon: 120_000, listingType: "retail", updatedAt: "2026-10-06T00:00:00Z", missingFields: [], specs: { socket: "AM4", memoryType: "DDR4", tdpW: 65 }, ...overrides });

describe("manual gaming picker scope", () => {
  it("keeps specified old CPUs and both CPU platforms available for a rebuild", () => {
    for (const name of ["AMD Ryzen 5600", "AMD Ryzen 7500F", "AMD Ryzen 9800X3D", "인텔 코어 i5-14600KF"]) expect(gamingPickerPartAllowed(part({ name, ...(name.includes("인텔") ? {specs:{socket:"LGA1700",memoryType:"DDR5",tdpW:125}} : {}) }))).toBe(true);
    expect(gamingPickerPartAllowed(part({ name: "AMD Ryzen 3600" }))).toBe(false);
    for (const name of ["인텔 Core 2 Duo E7500", "인텔 Pentium G630", "인텔 Core Ultra 265K"]) expect(gamingPickerPartAllowed(part({name,specs:{socket:"LGA1851",memoryType:"DDR5",tdpW:125}}))).toBe(false);
    expect(gamingPickerPartAllowed(part({category:"motherboard",name:"Unreviewed B760",specs:{socket:"LGA1700"}}))).toBe(false);
    expect(gamingPickerPartAllowed(part({ category: "motherboard", name: "ASRock B760M", specs: { socket: "LGA1700", vrmCapacityW: 200 } }))).toBe(true);
    expect(gamingPickerPartAllowed(part({ category: "motherboard", name: "ASRock A520M-HVS 대원씨티에스", specs: { socket: "AM4" } }))).toBe(true);
    expect(gamingPickerPartAllowed(part({ category: "motherboard", name: "Other AM5 board", specs: { socket: "AM5" } }))).toBe(false);
  });

  it("admits exact KLEVV memory and nominated old GPUs without widening the family", () => {
    expect(gamingPickerPartAllowed(part({ category: "memory", name: "ESSENCORE KLEVV DDR4-3200 CL22 파인인포 (16GB)", brand: "ESSENCORE", specs: { memoryType: "DDR4", capacityGb: 16 } }))).toBe(true);
    expect(gamingPickerPartAllowed(part({ category: "memory", name: "ESSENCORE KLEVV DDR4-3600 CL18", brand: "ESSENCORE" }))).toBe(false);
    const specs = { recommendedPsuW: 500, lengthMm: 180, thicknessMm: 40, powerW: 70 };
    for (const name of ["MSI 지포스 RTX 3050 벤투스 2X E OC D6 6GB", "MSI 지포스 RTX 5060", "XFX 라데온 RX 9070 XT"]) expect(gamingPickerPartAllowed(part({ category: "gpu", name, specs }))).toBe(true);
    expect(gamingPickerPartAllowed(part({ category: "gpu", name: "MSI 지포스 RTX 2060", specs }))).toBe(false);
  });

  it("retains price, domestic new, delisting and required physical metadata protections", () => {
    for (const overrides of [{ priceWon: undefined }, { delistedAt: "2026-10-06T00:00:00Z" }, { listingType: "overseas" as const }, { listingType: "used" as const }, { listingType: "accessory" as const }, { dataQuality: "seed" as const }, { dataQuality: "incomplete" as const }]) expect(gamingPickerPartAllowed(part(overrides))).toBe(false);
    expect(gamingPickerPartAllowed(part({ listingType: "bulk" }))).toBe(true);
    const gpu = part({ category: "gpu", name: "MSI 지포스 RTX 5060", dataQuality: "incomplete", specs: { recommendedPsuW: 500, lengthMm: 180, thicknessMm: 40, powerW: 145 } });
    expect(gamingPickerPartAllowed(gpu)).toBe(true);
    expect(gamingPickerPartAllowed({ ...gpu, specs: { ...gpu.specs, lengthMm: undefined } })).toBe(false);
  });

  it("admits C910G and domestic Samsung/Hynix M.2 NVMe without allowing every ESSENCORE drive", () => {
    const ssd = part({ category: "ssd", brand: "ESSENCORE", name: "ESSENCORE KLEVV CRAS C910G M.2 NVMe (1TB)", specs: { interface: "NVMe", formFactor: "M.2", capacityGb: 1000 } });
    expect(gamingPickerPartAllowed(ssd)).toBe(true);
    expect(gamingPickerPartAllowed({ ...ssd, name: "ESSENCORE KLEVV CRAS C910 M.2 NVMe (1TB)" })).toBe(false);
    expect(gamingPickerPartAllowed({ ...ssd, brand: "Samsung", name: "Samsung 990 EVO M.2 NVMe" })).toBe(true);
    expect(gamingPickerPartAllowed({ ...ssd, brand: "SK하이닉스", name: "SK하이닉스 Gold P31 M.2 NVMe" })).toBe(true);
    expect(gamingPickerPartAllowed({ ...ssd, brand: "Samsung", name: "Samsung 870 EVO", specs: { interface: "SATA", formFactor: "2.5inch", capacityGb: 1000 } })).toBe(false);
  });
});
