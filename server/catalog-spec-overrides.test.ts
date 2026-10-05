import { describe, expect, it } from "vitest";
import type { CatalogSpecOverride } from "../shared/catalog-spec-overrides";
import type { Part } from "../shared/types";
import { applyCatalogSpecOverrides, stripCatalogSpecOverride, validateCatalogSpecOverrideBatch } from "./catalog-spec-overrides";
import { parseDanawaProductPage } from "./danawa";

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
  it.each([
    { category: "case" as const, name: "보드 규격 누락 케이스", categoryId: "112775", specText: "VGA 길이: 400mm / CPU쿨러 높이: 170mm / HDD 베이: 2개", field: "motherboardFormFactors", value: ["ATX", "mATX"] },
    { category: "cooler" as const, name: "소켓 정보 누락 CPU 쿨러", categoryId: "11347549", specText: "CPU 쿨러 / 공랭 / 높이: 150mm", field: "supportedSockets", value: ["AM5", "LGA1700"] }
  ])("fills an actual parser empty legacy list for $field", ({ category, name, categoryId, specText, field, value }) => {
    const base = parseDanawaProductPage(category, { name, url: `https://prod.danawa.com/info/?pcode=27030&cate=${categoryId}`, sourceProductCode: "27030" }, `<title>${name} : 다나와 가격비교</title><meta name="description" content="${specText}" />`, categoryId);
    expect(base.specs[field as "motherboardFormFactors" | "supportedSockets"]).toEqual([]);
    expect(base.missingFields).toContain(field);
    const validation = validateCatalogSpecOverrideBatch([{ partId: base.id, category, fields: { [field]: value }, ...provenance }], [base]);
    expect(validation.errors).toEqual([]);
    const [applied] = applyCatalogSpecOverrides([base], { [base.id]: validation.validOverrides[0] });
    expect(applied.specs[field as "motherboardFormFactors" | "supportedSockets"]).toEqual(value);
    expect(applied.missingFields).not.toContain(field);
    expect(stripCatalogSpecOverride(JSON.parse(JSON.stringify(applied)) as Part)).toEqual(base);
    expect(validateCatalogSpecOverrideBatch([{ partId: base.id, category, fields: { [field]: ["other"] }, ...provenance }], [{ ...base, specs: { ...base.specs, [field]: value } }]).validOverrides).toEqual([]);
  });

  it("applies and reversibly preserves radiator requirements and selected component geometry", () => {
    const computerCase = part({ id: "case-conditional", category: "case", name: "조건부 라디에이터 케이스", specs: { radiatorSupports: [] }, missingFields: [] });
    const cooler = part({ id: "cooler-geometry", category: "cooler", name: "수랭 쿨러", specs: {}, missingFields: [] });
    const memory = part({ id: "memory-height", category: "memory", name: "데스크톱 메모리", specs: {}, missingFields: [] });
    const supports = [{ position: "psu_shroud" as const, sizesMm: [240], requirements: [{ maxAssemblyThicknessMm: 55.5, maxMemoryHeightMm: 35, exclusiveUpperBound: true, configurationNote: "HDD 케이지 분리 후 장착" }] }];
    const coolerFields = { radiatorThicknessMm: 27.5, radiatorFanThicknessMm: 25, radiatorWidthMm: 120.5, radiatorLengthMm: 277.5 };
    const validation = validateCatalogSpecOverrideBatch([{ partId: computerCase.id, category: "case", fields: { radiatorSupports: supports }, ...provenance }, { partId: cooler.id, category: "cooler", fields: coolerFields, ...provenance }, { partId: memory.id, category: "memory", fields: { memoryHeightMm: 34.5 }, ...provenance }], [computerCase, cooler, memory]);
    expect(validation.errors).toEqual([]);
    const applied = applyCatalogSpecOverrides([computerCase, cooler, memory], Object.fromEntries(validation.validOverrides.map((override) => [override.partId, override])));
    expect(applied[0].specs.radiatorSupports).toEqual(supports);
    expect(applied[1].specs).toMatchObject(coolerFields);
    expect(applied[2].specs.memoryHeightMm).toBe(34.5);
    expect(applied.map((entry) => stripCatalogSpecOverride(JSON.parse(JSON.stringify(entry)) as Part))).toEqual([computerCase, cooler, memory]);
  });
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
      expect.stringContaining("확인 정보 sourceNote가 필요"),
      expect.stringContaining("sourceUrl은 HTTPS")
    ]));

    const memoryCatalog = [part({ id: "memory-domain", category: "memory", name: "도메인 RAM", specs: {}, missingFields: ["memoryProfiles"] })];
    const memoryDomain = validateCatalogSpecOverrideBatch({ items: [{ partId: "memory-domain", category: "memory", fields: { memoryProfiles: ["XMP", "DOCP"] }, ...provenance }] }, memoryCatalog);
    expect(memoryDomain.validOverrides).toEqual([]);
    expect(memoryDomain.errors[0]).toContain("memoryProfiles 값의 형식 또는 범위");

    const nonCore = validateCatalogSpecOverrideBatch({ items: [{ partId: "gpu-non-core", category: "ssd", fields: { interface: "SATA" }, ...provenance }] }, catalog);
    expect(nonCore.validOverrides).toEqual([]);
    expect(nonCore.errors[0]).toContain("핵심 호환 부품이 아닌 항목");
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

  it("accepts an explicitly verified case with no 3.5-inch HDD bays", () => {
    const computerCase = part({ id: "case-zero-hdd-bays", category: "case", name: "검증된 2.5인치 전용 케이스", specs: {}, missingFields: ["hddBays"] });
    const validation = validateCatalogSpecOverrideBatch({ items: [{ partId: computerCase.id, category: "case", fields: { hddBays: 0 }, ...provenance }] }, [computerCase]);

    expect(validation.errors).toEqual([]);
    expect(validation.validOverrides[0].fields).toEqual({ hddBays: 0 });

    const applied = applyCatalogSpecOverrides([computerCase], { [computerCase.id]: validation.validOverrides[0] });
    expect(applied[0]).toMatchObject({ dataQuality: "manual", missingFields: [], specs: { hddBays: 0 } });
    expect(stripCatalogSpecOverride(applied[0])).toEqual(computerCase);

    const fractional = validateCatalogSpecOverrideBatch({ items: [{ partId: computerCase.id, category: "case", fields: { hddBays: 0.5 }, ...provenance }] }, [computerCase]);
    const negative = validateCatalogSpecOverrideBatch({ items: [{ partId: computerCase.id, category: "case", fields: { hddBays: -1 }, ...provenance }] }, [computerCase]);
    expect(fractional.validOverrides).toEqual([]);
    expect(negative.validOverrides).toEqual([]);
  });

  it("fills real parser support gaps without missingFields entries and reversibly updates its own overlay", () => {
    const base = parseDanawaProductPage("case", {
      name: "지원정보 누락 케이스",
      url: "https://prod.danawa.com/info/?pcode=27020&cate=112775",
      sourceProductCode: "27020"
    }, '<title>지원정보 누락 케이스 : 다나와 가격비교</title><meta name="description" content="지원보드규격: ATX / VGA 길이: 400mm / CPU쿨러 높이: 170mm / HDD 베이: 2개" />', "112775");
    expect(base.missingFields).toEqual([]);
    expect(base.specs.radiatorSizesMm).toEqual([]);
    expect(base.specs.radiatorSupports).toEqual([]);
    const fields = { radiatorSizesMm: [240, 360], radiatorSupports: [{ position: "top" as const, sizesMm: [240] }], supportedPsuFormFactors: ["ATX", "SFX-L"], ssdBays: 0 };
    const input = { partId: base.id, category: "case", fields, ...provenance };
    const validation = validateCatalogSpecOverrideBatch([input], [base]);
    expect(validation.errors).toEqual([]);
    const existing = validation.validOverrides[0];
    const [applied] = applyCatalogSpecOverrides([base], { [base.id]: existing });
    expect(applied.specs).toMatchObject(fields);
    expect(applied.specs.catalogSpecProvenance?.baseSpecValues).toMatchObject({ radiatorSizesMm: [], radiatorSupports: [] });
    expect(stripCatalogSpecOverride(applied)).toEqual(base);
    expect(stripCatalogSpecOverride(JSON.parse(JSON.stringify(applied)) as Part)).toEqual(base);

    const unchanged = validateCatalogSpecOverrideBatch([input], [applied], { [base.id]: existing });
    expect(unchanged.items[0]).toMatchObject({ valid: true, operation: "unchanged", changedFields: [] });
    const changedFields = { ...fields, radiatorSupports: [{ position: "front" as const, sizesMm: [240, 360] }], ssdBays: 2 };
    const updated = validateCatalogSpecOverrideBatch([{ ...input, fields: changedFields }], [applied], { [base.id]: existing });
    expect(updated.items[0]).toMatchObject({ valid: true, operation: "update", changedFields: ["radiatorSupports", "ssdBays"] });
    const [reapplied] = applyCatalogSpecOverrides([applied], { [base.id]: updated.validOverrides[0] });
    expect(reapplied.specs).toMatchObject(changedFields);
    expect(stripCatalogSpecOverride(reapplied)).toEqual(base);
  });

  it("protects known base support values and zero bays even when missingFields is stale", () => {
    const fields = { radiatorSizesMm: [240], radiatorSupports: [{ position: "top" as const, sizesMm: [240] }], supportedPsuFormFactors: ["ATX"], ssdBays: 0 };
    const base = part({ id: "case-known-support", name: "지원정보 보유 케이스", category: "case", specs: fields, missingFields: Object.keys(fields) });
    const replacement = { radiatorSizesMm: [360], radiatorSupports: [{ position: "front" as const, sizesMm: [360] }], supportedPsuFormFactors: ["SFX"], ssdBays: 2 };
    const override: CatalogSpecOverride = { partId: base.id, category: "case", fields: replacement, ...provenance };
    expect(validateCatalogSpecOverrideBatch([override], [base]).validOverrides).toEqual([]);
    expect(validateCatalogSpecOverrideBatch([override], [base], { [base.id]: override }).validOverrides).toEqual([]);
    expect(applyCatalogSpecOverrides([base], { [base.id]: override })[0]).toBe(base);
  });

  it.each([
    { radiatorSizesMm: [] },
    { radiatorSizesMm: [240, 240] },
    { radiatorSizesMm: [240.5] },
    { radiatorSizesMm: [Infinity] },
    { radiatorSizesMm: Array(1) },
    { radiatorSizesMm: Array.from({ length: 17 }, (_, index) => index + 1) },
    { radiatorSupports: [] },
    { radiatorSupports: [{ position: "roof", sizesMm: [240] }] },
    { radiatorSupports: [{ position: "top", sizesMm: [240], optional: true }] },
    { radiatorSupports: [{ position: "top", sizesMm: [] }] },
    { radiatorSupports: [{ position: "top", sizesMm: [240, 240] }] },
    { radiatorSupports: [{ position: "top", sizesMm: [240] }, { position: "top", sizesMm: [360] }] },
    { supportedPsuFormFactors: [] },
    { supportedPsuFormFactors: ["ATX", "ATX"] },
    { supportedPsuFormFactors: ["TFX"] },
    { supportedPsuFormFactors: ["atx"] },
    { ssdBays: -1 },
    { ssdBays: 0.5 },
    { ssdBays: 100_001 }
  ])("rejects malformed or ambiguous case support values: %j", (fields) => {
    const base = part({ id: "case-invalid-support", category: "case", name: "지원정보 확인 케이스", specs: { radiatorSizesMm: [], radiatorSupports: [] }, missingFields: [] });
    const validation = validateCatalogSpecOverrideBatch([{ partId: base.id, category: "case", fields, ...provenance }], [base]);
    expect(validation.validOverrides).toEqual([]);
    expect(validation.errors).toEqual([expect.stringContaining("값의 형식 또는 범위")]);
    const override = { partId: base.id, category: "case", fields, ...provenance } as CatalogSpecOverride;
    expect(applyCatalogSpecOverrides([base], { [base.id]: override })[0]).toBe(base);
  });

  it("rejects case support fields in another category", () => {
    const base = part({ id: "psu-cross-category", category: "psu", name: "ATX 파워", specs: {}, missingFields: [] });
    const validation = validateCatalogSpecOverrideBatch([{ partId: base.id, category: "psu", fields: { radiatorSupports: [{ position: "top", sizesMm: [240] }] }, ...provenance }], [base]);
    expect(validation.validOverrides).toEqual([]);
    expect(validation.errors).toEqual([expect.stringContaining("지원하지 않는 보강 필드")]);
  });

  it("rejects an incremental update that would exceed the stored eight-field limit", () => {
    const base = part({ id: "case-merged-limit", category: "case", name: "보완값 누적 케이스", specs: {}, missingFields: [] });
    const existing: CatalogSpecOverride = { partId: base.id, category: "case", fields: { maxGpuLengthMm: 400, maxCoolerHeightMm: 170, maxPsuLengthMm: 200, motherboardFormFactors: ["ATX"], hddBays: 0, fanCount: 1, lowProfileOnly: false }, ...provenance };
    const catalog = applyCatalogSpecOverrides([base], { [base.id]: existing });
    const validation = validateCatalogSpecOverrideBatch([{ partId: base.id, category: "case", fields: { radiatorSizesMm: [240], supportedPsuFormFactors: ["ATX"] }, ...provenance }], catalog, { [base.id]: existing });
    expect(validation.validOverrides).toEqual([]);
    expect(validation.items[0].valid).toBe(false);
    expect(validation.errors).toEqual([expect.stringContaining("기존 보완값을 합쳐 최대 8개")]);
    expect(existing.fields).toHaveProperty("maxGpuLengthMm", 400);
    expect(Object.keys(existing.fields)).toHaveLength(7);
  });
});
