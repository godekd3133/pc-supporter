import { describe, expect, it } from "vitest";
import type { CatalogChangeRecord } from "./types";
import { catalogChangeImpactsFor } from "./catalog-change-impact";

const record = (overrides: Partial<CatalogChangeRecord> = {}): CatalogChangeRecord => ({
  id: "change-1",
  kind: "part",
  itemId: "cpu-1",
  itemName: "테스트 부품",
  category: "cpu",
  changedAt: "2026-08-31T00:00:00.000Z",
  changedFields: ["정규화 스펙"],
  previousDataQuality: "live",
  nextDataQuality: "live",
  previousMissingFields: [],
  nextMissingFields: [],
  ...overrides
});

describe("catalog change impact mapping", () => {
  it("maps confirmed CPU power consumers to their engine rules", () => {
    const impacts = catalogChangeImpactsFor(record(), { field: "정규화 스펙 · PPT", previous: "120W", next: "150W" });
    expect(impacts[0]).toMatchObject({ kind: "compatibility", label: "CPU 전력·냉각", ruleIds: ["cpu-motherboard-power", "cpu-cooler-capacity", "gpu-psu-power"] });
  });

  it("maps category-specific storage and board fields", () => {
    expect(catalogChangeImpactsFor(record({ category: "motherboard" }), { field: "정규화 스펙 · M.2 슬롯", previous: "2개", next: "3개" })[0].ruleIds).toEqual(["m2-slots"]);
    expect(catalogChangeImpactsFor(record({ category: "psu" }), { field: "정규화 스펙 · PSU 보조전원 커넥터", previous: "8핀 2개", next: "16핀 1개" })[0].ruleIds).toEqual(["gpu-psu-connector"]);
    expect(catalogChangeImpactsFor(record({ category: "gpu" }), { field: "정규화 스펙 · GPU 어댑터 전원 경로", previous: "8핀 2개", next: "8핀 3개" })[0].ruleIds).toEqual(["gpu-psu-connector"]);
    expect(catalogChangeImpactsFor(record({ category: "gpu" }), { field: "정규화 스펙 · GPU 케이블 굽힘 여유", previous: "30mm", next: "40mm" })[0].ruleIds).toEqual(["gpu-cable-clearance"]);
    expect(catalogChangeImpactsFor(record({ category: "case" }), { field: "정규화 스펙 · 케이스 측면 케이블 여유", previous: "45mm", next: "30mm" })[0].ruleIds).toEqual(["gpu-cable-clearance"]);
    expect(catalogChangeImpactsFor(record({ category: "psu" }), { field: "정규화 스펙 · PSU 독립 PCIe 케이블 런", previous: "2개", next: "1개" })[0].ruleIds).toEqual(["gpu-psu-cable-topology"]);
    expect(catalogChangeImpactsFor(record({ category: "psu" }), { field: "정규화 스펙 · PSU 케이블 구조", previous: "케이블 일체형", next: "풀모듈러" })[0]).toMatchObject({ kind: "data", ruleIds: [] });
  });

  it("separates purchase/data impacts and leaves unknown fields without invented rules", () => {
    expect(catalogChangeImpactsFor(record(), { field: "가격", previous: "100,000원", next: "110,000원" })[0]).toMatchObject({ kind: "purchase", ruleIds: [] });
    expect(catalogChangeImpactsFor(record(), { field: "누락 필드", previous: "socket", next: "없음" })[0]).toMatchObject({ kind: "data", ruleIds: [] });
    expect(catalogChangeImpactsFor(record(), { field: "정규화 스펙 · 알 수 없는 키", previous: "a", next: "b" })).toEqual([]);
  });
});
