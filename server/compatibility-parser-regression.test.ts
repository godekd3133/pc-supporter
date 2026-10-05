import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { reparseDanawaPart } from "./danawa";
import { evaluateBuild } from "./engine";
import { seedCatalog } from "./seed-catalog";
import { applyCatalogSpecOverrides, validateCatalogSpecOverrideBatch } from "./catalog-spec-overrides";

const board = (rawSpecText: string): Part => ({
  id: "actual-m2-board", category: "motherboard", name: "저장장치 인터페이스 보드",
  source: "danawa", sourceProductCode: "test-m2", rawSpecText,
  specs: {}, dataQuality: "incomplete", missingFields: [], updatedAt: "2026-10-04T00:00:00Z"
});

describe("raw catalog compatibility regressions", () => {
  it.each([
    ["M-ATX(SFX)", ["SFX"]],
    ["M-ATX(SFX, SFX-L)", ["SFX-L", "SFX"]],
    ["SFX-L", ["SFX-L"]],
    ["표준-ATX", ["ATX"]],
    ["ATX, SFX", ["SFX", "ATX"]]
  ])("reads case PSU form factor %s without confusing M-ATX with ATX", (raw, expected) => {
    const parsed = reparseDanawaPart({ ...board(`지원보드규격: ITX / 지원파워규격: ${raw} / VGA 길이: 330mm`), category: "case", name: "소형 케이스" });
    expect(parsed.specs.supportedPsuFormFactors).toEqual(expected);
  });
  it.each([
    ["ASRock Z890 Taichi OCF", "M.2: 6개 / M.2 연결: PCIe5.0, PCIe4.0, SATA"],
    ["ASUS ROG ZENITH EXTREME ALPHA", "M.2: 2개 / M.2 연결: SATA , PCIe"],
    ["PCIe-only board", "M.2: 1개 / M.2 연결: PCIe"]
  ])("does not block an NVMe SSD on %s after reparsing", (_name, raw) => {
    const parsed = reparseDanawaPart(board(raw));
    const result = evaluateBuild({ motherboard: { partId: parsed.id, quantity: 1 }, ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }], memory: [], hdd: [], useIntegratedGraphics: false }, [...seedCatalog, parsed], { includeSuggestions: false });
    expect(parsed.specs.m2Interfaces).toContain("NVMe");
    expect(result.findings.filter((finding) => finding.ruleId === "m2-interface" && finding.severity === "blocker")).toEqual([]);
  });

  it("still blocks an M.2 SATA SSD on a PCIe-only M.2 connection", () => {
    const parsed = reparseDanawaPart(board("M.2: 1개 / M.2 연결: PCIe4.0"));
    const sata: Part = { id: "m2-sata-test", category: "ssd", name: "M.2 SATA SSD", source: "manual", specs: { interface: "SATA", formFactor: "M.2", capacityGb: 1000 }, dataQuality: "manual", missingFields: [], updatedAt: "2026-10-04T00:00:00Z" };
    const result = evaluateBuild({ motherboard: { partId: parsed.id, quantity: 1 }, ssd: [{ partId: sata.id, quantity: 1 }], memory: [], hdd: [], useIntegratedGraphics: false }, [...seedCatalog, parsed, sata], { includeSuggestions: false });
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: "m2-interface", severity: "blocker" })]));
  });

  it("uses a complete manufacturer radiator position list and retains unknown cooler position", () => {
    const computerCase: Part = { id: "case-reviewed", category: "case", name: "DS500 위치 사양 회귀", source: "manual", rawSpecText: "", specs: { radiatorSupports: [], radiatorSizesMm: [], maxCoolerHeightMm: 165 }, dataQuality: "manual", missingFields: [], updatedAt: "2026-10-04T00:00:00Z" };
    const validation = validateCatalogSpecOverrideBatch([{ partId: computerCase.id, category: "case", fields: { radiatorSupports: [{ position: "top", sizesMm: [120, 140, 240, 280, 360] }, { position: "rear", sizesMm: [120] }] }, manufacturerModel: "DS500 RGB", sourceNote: "국내 공식 제품 SPECIFICATION 위치별 크기", sourceUrl: "https://darkflash.co.kr/product/ds500-rgb-%EB%B8%94%EB%9E%99/796/" }], [computerCase]);
    expect(validation.errors).toEqual([]);
    const reviewed = applyCatalogSpecOverrides([computerCase], { [computerCase.id]: validation.validOverrides[0] })[0];
    const check = (position?: "top" | "front") => {
      const cooler: Part = { id: "aio-review", category: "cooler", name: "360mm 수랭", source: "manual", specs: { coolerType: "liquid", radiatorSizeMm: 360, ...(position ? { radiatorPosition: position } : {}) }, dataQuality: "manual", missingFields: [], updatedAt: "2026-10-04T00:00:00Z" };
      return evaluateBuild({ cpu: { partId: "cpu-7800x3d", quantity: 1 }, cooler: { partId: cooler.id, quantity: 1 }, case: { partId: reviewed.id, quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: false }, [...seedCatalog, reviewed, cooler], { includeSuggestions: false }).findings.filter((finding) => finding.ruleId === "case-radiator-support");
    };
    expect(check("top")).toEqual([]);
    expect(check("front")).toEqual([expect.objectContaining({ severity: "blocker" })]);
    expect(check()).toEqual([expect.objectContaining({ severity: "unknown" })]);
  });
});
