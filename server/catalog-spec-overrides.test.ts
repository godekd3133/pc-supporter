import { describe, expect, it } from "vitest";
import type { CatalogSpecOverride } from "../shared/catalog-spec-overrides";
import type { Part } from "../shared/types";
import { applyCatalogSpecOverrides, stripCatalogSpecOverride, validateCatalogSpecOverrideBatch } from "./catalog-spec-overrides";

function part(overrides: Partial<Part>): Part {
  return {
    id: "gpu-override-test",
    category: "gpu",
    name: "override 테스트 GPU",
    source: "danawa",
    sourceProductCode: "override-test",
    danawaUrl: "https://prod.danawa.com/info/?pcode=override-test",
    specs: { vramGb: 16 },
    dataQuality: "incomplete",
    missingFields: ["powerW", "lengthMm"],
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

const provenance = { manufacturerModel: "TEST-GPU-16", sourceNote: "제조사 설치 가이드 4쪽", sourceUrl: "https://vendor.example/test-gpu", updatedAt: "2026-09-03T00:00:00.000Z" };

describe("catalog spec overrides", () => {
  it("validates only missing supported fields with explicit provenance", () => {
    const catalog = [part({ id: "gpu-valid" }), part({ id: "gpu-non-core", category: "ssd", name: "USB SATA 어댑터", sourceProductCode: "non-core", specs: {}, missingFields: ["interface"] })];
    const validation = validateCatalogSpecOverrideBatch({ items: [{ partId: "gpu-valid", category: "gpu", fields: { powerW: 320, lengthMm: 330 }, ...provenance }] }, catalog);

    expect(validation.errors).toEqual([]);
    expect(validation.items[0]).toMatchObject({ valid: true, operation: "create", changedFields: expect.arrayContaining(["powerW", "lengthMm"]) });
    expect(validation.validOverrides[0]).toMatchObject({ partId: "gpu-valid", fields: { powerW: 320, lengthMm: 330 }, sourceUrl: provenance.sourceUrl });

    const invalid = validateCatalogSpecOverrideBatch({ items: [{ partId: "gpu-valid", category: "gpu", fields: { vramGb: 24, powerW: 0 }, manufacturerModel: "", sourceNote: "", sourceUrl: "http://vendor.example/test" }] }, catalog);
    expect(invalid.validOverrides).toEqual([]);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("vramGb은 현재 누락 필드가 아니므로"),
      expect.stringContaining("powerW 값의 형식 또는 범위"),
      expect.stringContaining("제조사 모델/SKU가 필요"),
      expect.stringContaining("검수 근거 sourceNote가 필요"),
      expect.stringContaining("sourceUrl은 HTTPS")
    ]));

    const memoryCatalog = [part({ id: "memory-domain", category: "memory", name: "도메인 RAM", specs: {}, missingFields: ["memoryProfiles"] })];
    const memoryDomain = validateCatalogSpecOverrideBatch({ items: [{ partId: "memory-domain", category: "memory", fields: { memoryProfiles: ["XMP", "DOCP"] }, ...provenance }] }, memoryCatalog);
    expect(memoryDomain.validOverrides).toEqual([]);
    expect(memoryDomain.errors[0]).toContain("memoryProfiles 값의 형식 또는 범위");

    const nonCore = validateCatalogSpecOverrideBatch({ items: [{ partId: "gpu-non-core", category: "ssd", fields: { interface: "SATA" }, ...provenance }] }, catalog);
    expect(nonCore.validOverrides).toEqual([]);
    expect(nonCore.errors[0]).toContain("핵심 호환 후보가 아닌 항목");
  });

  it("applies an override only to missing fields and restores the original record when stripped", () => {
    const base = part({ id: "gpu-partial", missingFields: ["powerW", "lengthMm"] });
    const override: CatalogSpecOverride = { partId: base.id, category: "gpu", fields: { powerW: 320 }, ...provenance };
    const applied = applyCatalogSpecOverrides([base], { [base.id]: override });

    expect(applied[0]).toMatchObject({ id: base.id, dataQuality: "incomplete", missingFields: ["lengthMm"], specs: { vramGb: 16, powerW: 320, catalogSpecProvenance: { fields: ["powerW"], baseDataQuality: "incomplete", baseMissingFields: ["powerW", "lengthMm"] } } });
    expect(stripCatalogSpecOverride(applied[0])).toEqual(base);

    const completeOverride: CatalogSpecOverride = { ...override, fields: { powerW: 320, lengthMm: 330 } };
    const complete = applyCatalogSpecOverrides([base], { [base.id]: completeOverride });
    expect(complete[0]).toMatchObject({ dataQuality: "manual", missingFields: [], specs: { powerW: 320, lengthMm: 330 } });
    expect(stripCatalogSpecOverride(complete[0])).toEqual(base);
  });

  it("marks an existing override as unchanged and allows replacing its own fields", () => {
    const base = part({ id: "gpu-existing" });
    const existing: CatalogSpecOverride = { partId: base.id, category: "gpu", fields: { powerW: 300 }, ...provenance };
    const unchanged = validateCatalogSpecOverrideBatch({ items: [{ partId: base.id, category: "gpu", fields: { powerW: 300 }, ...provenance }] }, applyCatalogSpecOverrides([base], { [base.id]: existing }), { [base.id]: existing });
    expect(unchanged.items[0]).toMatchObject({ valid: true, operation: "unchanged", changedFields: [] });

    const updated = validateCatalogSpecOverrideBatch({ items: [{ partId: base.id, category: "gpu", fields: { powerW: 350 }, ...provenance }] }, applyCatalogSpecOverrides([base], { [base.id]: existing }), { [base.id]: existing });
    expect(updated.items[0]).toMatchObject({ valid: true, operation: "update", changedFields: ["powerW"] });

    const completed = validateCatalogSpecOverrideBatch({ items: [{ partId: base.id, category: "gpu", fields: { lengthMm: 330 }, ...provenance }] }, applyCatalogSpecOverrides([base], { [base.id]: existing }), { [base.id]: existing });
    expect(completed.items[0]).toMatchObject({ valid: true, operation: "update", changedFields: ["lengthMm"] });
    expect(completed.validOverrides[0].fields).toEqual({ powerW: 300, lengthMm: 330 });
  });
});
