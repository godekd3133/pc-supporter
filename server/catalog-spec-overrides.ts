import type { CatalogSpecOverride, CatalogSpecOverrideFieldKey, CatalogSpecOverrideOperation, CatalogSpecOverrideValue, CatalogSpecOverrideValueType } from "../shared/catalog-spec-overrides";
import { catalogSpecOverrideFieldTypeFor } from "../shared/catalog-spec-overrides";
import type { Part, PartSpecs } from "../shared/types";
import { CATEGORY_LABELS, PART_CATEGORIES, isKnownPrice } from "../shared/types";
import { CATALOG_SPEC_OVERRIDES_PATH, readJson, withSerializedFileMutation, writeJson } from "./storage";
import { isListingAllowed } from "./listing";
import { physicalSourceCheckFromUnknown } from "./physical-source-check-history";

const MAX_BATCH_SIZE = 500;
const MAX_FIELDS_PER_OVERRIDE = 8;
const MAX_LIST_VALUES = 16;

export type CatalogSpecOverrideMap = Record<string, CatalogSpecOverride>;

export type CatalogSpecOverrideValidationItem = {
  partId: string;
  partName?: string;
  category?: Part["category"];
  valid: boolean;
  errors: string[];
  operation?: CatalogSpecOverrideOperation;
  changedFields?: string[];
  override?: CatalogSpecOverride;
};

export type CatalogSpecOverrideBatchValidation = {
  items: CatalogSpecOverrideValidationItem[];
  validOverrides: CatalogSpecOverride[];
  errors: string[];
};

export type CatalogSpecOverrideListItem = CatalogSpecOverride & {
  partName?: string;
  remainingMissingFields?: string[];
  priceWon?: number;
};

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sourceUrlErrors(value: string) {
  if (!value) return ["sourceUrl은 필수입니다."];
  if (value.length > 1_000) return ["sourceUrl은 1,000자 이하로 입력해야 합니다."];
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? [] : ["sourceUrl은 HTTPS 주소만 사용할 수 있습니다."];
  } catch {
    return ["sourceUrl 형식이 올바르지 않습니다."];
  }
}

function scalarValueFor(type: CatalogSpecOverrideValueType, value: unknown): CatalogSpecOverrideValue | undefined {
  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100_000) return undefined;
    return value;
  }
  if (type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (type === "string_list") {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LIST_VALUES || !value.every((item) => typeof item === "string" && item.trim().length > 0 && item.trim().length <= 80)) return undefined;
    const values = value.map((item) => item.trim());
    return new Set(values).size === values.length ? values : undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 160 ? normalized : undefined;
}

function fieldValueFor(category: Part["category"], field: string, value: unknown) {
  const type = catalogSpecOverrideFieldTypeFor(category, field);
  const normalized = type ? scalarValueFor(type, value) : undefined;
  if (normalized === undefined) return undefined;
  if (field === "coolerType" && normalized !== "air" && normalized !== "liquid") return undefined;
  if (field === "memoryFormFactor" && normalized !== "DIMM" && normalized !== "SO-DIMM") return undefined;
  if (field === "interface" && normalized !== "NVMe" && normalized !== "SATA") return undefined;
  if (field === "memoryProfiles" && (!Array.isArray(normalized) || normalized.some((profile) => profile !== "XMP" && profile !== "EXPO"))) return undefined;
  return normalized;
}

function fieldsEqual(left: CatalogSpecOverride["fields"], right: CatalogSpecOverride["fields"]) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => JSON.stringify(left[key as CatalogSpecOverrideFieldKey] ?? null) === JSON.stringify(right[key as CatalogSpecOverrideFieldKey] ?? null));
}

function usableCatalogSpecOverride(value: unknown): value is CatalogSpecOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CatalogSpecOverride>;
  if (typeof candidate.partId !== "string" || !candidate.partId.trim() || !PART_CATEGORIES.includes(candidate.category as Part["category"])) return false;
  if (typeof candidate.manufacturerModel !== "string" || candidate.manufacturerModel.trim().length === 0 || candidate.manufacturerModel.length > 160) return false;
  if (typeof candidate.sourceNote !== "string" || candidate.sourceNote.trim().length === 0 || candidate.sourceNote.length > 500) return false;
  if (typeof candidate.sourceUrl !== "string" || sourceUrlErrors(candidate.sourceUrl.trim()).length > 0 || typeof candidate.updatedAt !== "string") return false;
  if (candidate.sourceCheck !== undefined && !physicalSourceCheckFromUnknown(candidate.sourceCheck)) return false;
  if (!candidate.fields || typeof candidate.fields !== "object" || Array.isArray(candidate.fields)) return false;
  const fields = candidate.fields as Record<string, unknown>;
  if (Object.keys(fields).length < 1 || Object.keys(fields).length > MAX_FIELDS_PER_OVERRIDE) return false;
  return Object.entries(fields).every(([field, value]) => {
    const type = catalogSpecOverrideFieldTypeFor(candidate.category as Part["category"], field);
    return type !== undefined && fieldValueFor(candidate.category as Part["category"], field, value) !== undefined;
  });
}

export async function readCatalogSpecOverrides(): Promise<CatalogSpecOverrideMap> {
  const raw = await readJson<unknown>(CATALOG_SPEC_OVERRIDES_PATH, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([partId, value]) => usableCatalogSpecOverride(value) && value.partId === partId ? [[partId, value]] : []));
}

export function validateCatalogSpecOverrideBatch(input: unknown, catalog: Part[], existingOverrides: CatalogSpecOverrideMap = {}): CatalogSpecOverrideBatchValidation {
  const rawItems: unknown[] | undefined = Array.isArray(input)
    ? input
    : input && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as Record<string, unknown>).items)
      ? (input as Record<string, unknown>).items as unknown[]
      : undefined;
  if (!rawItems) return { items: [], validOverrides: [], errors: ["items는 카탈로그 스펙 override 배열이어야 합니다."] };
  if (rawItems.length < 1) return { items: [], validOverrides: [], errors: ["items는 최소 1개가 필요합니다."] };
  if (rawItems.length > MAX_BATCH_SIZE) return { items: [], validOverrides: [], errors: [`한 번에 최대 ${MAX_BATCH_SIZE}개 부품까지 처리할 수 있습니다.`] };

  const seenPartIds = new Set<string>();
  const items: CatalogSpecOverrideValidationItem[] = [];
  const validOverrides: CatalogSpecOverride[] = [];
  for (const [index, rawItem] of rawItems.entries()) {
    const itemErrors: string[] = [];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      items.push({ partId: `items[${index}]`, valid: false, errors: ["항목은 객체여야 합니다."] });
      continue;
    }
    const candidate = rawItem as Record<string, unknown>;
    const partId = normalizedString(candidate.partId);
    if (!partId) {
      items.push({ partId: `items[${index}]`, valid: false, errors: ["partId가 필요합니다."] });
      continue;
    }
    if (seenPartIds.has(partId)) itemErrors.push("같은 partId가 일괄 입력에서 중복되었습니다.");
    seenPartIds.add(partId);
    const part = catalog.find((item) => item.id === partId);
    if (!part) itemErrors.push("카탈로그에서 부품을 찾을 수 없습니다.");
    if (part && !isListingAllowed(part, "all")) itemErrors.push("핵심 호환 후보가 아닌 항목은 스펙 override 대상이 아닙니다.");
    const category = candidate.category;
    if (!PART_CATEGORIES.includes(category as Part["category"])) itemErrors.push("category가 올바르지 않습니다.");
    if (part && category !== part.category) itemErrors.push(`category가 실제 부품 범주(${CATEGORY_LABELS[part.category]})와 다릅니다.`);
    const manufacturerModel = normalizedString(candidate.manufacturerModel);
    if (!manufacturerModel) itemErrors.push("제조사 모델/SKU가 필요합니다.");
    else if (manufacturerModel.length > 160) itemErrors.push("제조사 모델/SKU는 160자 이하로 입력해야 합니다.");
    const sourceNote = normalizedString(candidate.sourceNote);
    if (!sourceNote) itemErrors.push("검수 근거 sourceNote가 필요합니다.");
    else if (sourceNote.length > 500) itemErrors.push("sourceNote는 500자 이하로 입력해야 합니다.");
    const sourceUrl = normalizedString(candidate.sourceUrl);
    itemErrors.push(...sourceUrlErrors(sourceUrl));
    const rawFields = candidate.fields;
    if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) itemErrors.push("fields는 객체여야 합니다.");
    else if (Object.keys(rawFields).length < 1 || Object.keys(rawFields).length > MAX_FIELDS_PER_OVERRIDE) itemErrors.push(`fields는 1개 이상 ${MAX_FIELDS_PER_OVERRIDE}개 이하로 입력해야 합니다.`);
    const fields: Partial<Record<CatalogSpecOverrideFieldKey, CatalogSpecOverrideValue>> = {};
    const existing = part ? existingOverrides[partId] : undefined;
    const allowedMissingFields = new Set([...(part?.missingFields ?? []), ...Object.keys(existing?.fields ?? {})]);
    if (rawFields && typeof rawFields === "object" && !Array.isArray(rawFields) && part && PART_CATEGORIES.includes(category as Part["category"])) {
      for (const [field, rawValue] of Object.entries(rawFields)) {
        const fieldType = catalogSpecOverrideFieldTypeFor(part.category, field);
        if (!fieldType) {
          itemErrors.push(`${field}은 ${CATEGORY_LABELS[part.category]}에서 지원하지 않는 보강 필드입니다.`);
          continue;
        }
        if (!allowedMissingFields.has(field)) {
          itemErrors.push(`${field}은 현재 누락 필드가 아니므로 override로 덮어쓸 수 없습니다.`);
          continue;
        }
        const value = fieldValueFor(part.category, field, rawValue);
        if (value === undefined) itemErrors.push(`${field} 값의 형식 또는 범위를 확인해 주세요.`);
        else fields[field as CatalogSpecOverrideFieldKey] = value;
      }
    }
    const item: CatalogSpecOverrideValidationItem = { partId, ...(part ? { partName: part.name, category: part.category } : {}), valid: itemErrors.length === 0, errors: itemErrors };
    if (itemErrors.length === 0 && part && PART_CATEGORIES.includes(category as Part["category"])) {
      const nextFields = { ...(existing?.fields ?? {}), ...fields };
      const sourceUnchanged = Boolean(existing && existing.manufacturerModel === manufacturerModel && existing.sourceUrl === sourceUrl);
      const nextOverride: CatalogSpecOverride = { partId, category: part.category, fields: nextFields, manufacturerModel, sourceNote, sourceUrl, ...(sourceUnchanged && existing?.sourceCheck ? { sourceCheck: existing.sourceCheck } : {}), updatedAt: existing && fieldsEqual(existing.fields, nextFields) && existing.manufacturerModel === manufacturerModel && existing.sourceNote === sourceNote && existing.sourceUrl === sourceUrl ? existing.updatedAt : new Date().toISOString() };
      const changedFields = [
        ...Object.keys({ ...existing?.fields, ...nextFields }).filter((field) => JSON.stringify(existing?.fields[field as CatalogSpecOverrideFieldKey] ?? null) !== JSON.stringify(nextFields[field as CatalogSpecOverrideFieldKey] ?? null)),
        ...(existing && existing.manufacturerModel !== manufacturerModel ? ["manufacturerModel"] : []),
        ...(existing && existing.sourceNote !== sourceNote ? ["sourceNote"] : []),
        ...(existing && existing.sourceUrl !== sourceUrl ? ["sourceUrl"] : [])
      ];
      item.override = nextOverride;
      item.changedFields = changedFields;
      item.operation = existing ? changedFields.length > 0 ? "update" : "unchanged" : "create";
      validOverrides.push(nextOverride);
    }
    items.push(item);
  }
  const errors = items.flatMap((item) => item.errors.map((error) => `${item.partId}: ${error}`));
  return { items, validOverrides: errors.length === 0 ? validOverrides : [], errors };
}

export function applyCatalogSpecOverrides(parts: Part[], overrides: CatalogSpecOverrideMap) {
  return parts.map((part) => {
    const override = overrides[part.id];
    if (!override || override.category !== part.category || !isListingAllowed(part, "all")) return part;
    const specs = { ...part.specs };
    const appliedFields: string[] = [];
    const baseSpecValues: Record<string, unknown> = {};
    for (const [field, rawValue] of Object.entries(override.fields)) {
      const fieldType = catalogSpecOverrideFieldTypeFor(part.category, field);
      if (!fieldType || !part.missingFields.includes(field)) continue;
      const value = fieldValueFor(part.category, field, rawValue);
      if (value === undefined) continue;
      const specKey = field as keyof typeof specs;
      baseSpecValues[field] = specs[specKey];
      specs[specKey] = (fieldType === "string_list" ? value : value) as never;
      appliedFields.push(field);
    }
    if (appliedFields.length === 0) return part;
    const remainingMissingFields = part.missingFields.filter((field) => !appliedFields.includes(field));
    specs.catalogSpecProvenance = {
      manufacturerModel: override.manufacturerModel,
      sourceNote: override.sourceNote,
      sourceUrl: override.sourceUrl,
      updatedAt: override.updatedAt,
      ...(override.sourceCheck ? { sourceCheck: override.sourceCheck } : {}),
      fields: appliedFields,
      baseSpecValues,
      baseDataQuality: part.dataQuality,
      baseMissingFields: [...part.missingFields],
      baseUpdatedAt: part.updatedAt
    };
    return { ...part, specs, missingFields: remainingMissingFields, dataQuality: (remainingMissingFields.length === 0 ? "manual" : "incomplete") as Part["dataQuality"], updatedAt: override.updatedAt };
  });
}

export function stripCatalogSpecOverride(part: Part) {
  const provenance = part.specs.catalogSpecProvenance;
  if (!provenance) return part;
  const { catalogSpecProvenance: _catalogSpecProvenance, ...specs } = part.specs;
  for (const [field, value] of Object.entries(provenance.baseSpecValues)) {
    const specKey = field as keyof typeof specs;
    if (value === undefined) delete specs[specKey];
    else specs[specKey] = value as never;
  }
  return { ...part, specs, dataQuality: provenance.baseDataQuality, missingFields: [...provenance.baseMissingFields], updatedAt: provenance.baseUpdatedAt };
}

export function sortedCatalogSpecOverrides(overrides: CatalogSpecOverrideMap) {
  return Object.values(overrides).filter(usableCatalogSpecOverride).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.partId.localeCompare(right.partId));
}

export function catalogSpecOverrideListItems(catalog: Part[], overrides: CatalogSpecOverrideMap): CatalogSpecOverrideListItem[] {
  const byId = new Map(catalog.map((part) => [part.id, part]));
  return sortedCatalogSpecOverrides(overrides).map((override) => {
    const part = byId.get(override.partId);
    return { ...override, ...(part ? { partName: part.name, remainingMissingFields: part.missingFields, ...(isKnownPrice(part.priceWon) ? { priceWon: part.priceWon } : {}) } : {}) };
  });
}

let writeQueue: Promise<void> = Promise.resolve();

async function withOverrideWriteLock<T>(operation: (overrides: CatalogSpecOverrideMap) => T | Promise<T>) {
  const current = writeQueue.then(async () => operation(await readCatalogSpecOverrides()));
  writeQueue = current.then(() => undefined, () => undefined);
  return current;
}

export async function saveCatalogSpecOverrides(values: CatalogSpecOverride[]) {
  return withOverrideWriteLock(async (overrides) => {
    for (const value of values) overrides[value.partId] = value;
    await writeJson(CATALOG_SPEC_OVERRIDES_PATH, overrides);
    return values;
  });
}

export async function deleteCatalogSpecOverride(partId: string) {
  return withOverrideWriteLock(async (overrides) => {
    if (!overrides[partId]) return false;
    delete overrides[partId];
    await writeJson(CATALOG_SPEC_OVERRIDES_PATH, overrides);
    return true;
  });
}

export async function saveCatalogSpecOverrideSourceCheck(partId: string, sourceCheck: import("../shared/types").PhysicalSourceCheck) {
  return withOverrideWriteLock(async (overrides) => {
    if (!physicalSourceCheckFromUnknown(sourceCheck)) return undefined;
    const existing = overrides[partId];
    if (!existing) return undefined;
    const updated = { ...existing, sourceCheck };
    overrides[partId] = updated;
    await writeJson(CATALOG_SPEC_OVERRIDES_PATH, overrides);
    return updated;
  });
}
