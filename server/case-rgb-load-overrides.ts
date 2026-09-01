import type { CaseRgbLoadOverride, Part, RgbDeviceLoadProvenance } from "../shared/types";
import { CASE_RGB_LOAD_OVERRIDES_PATH, readJson, writeJson } from "./storage";

export type CaseRgbLoadOverrideMap = Record<string, CaseRgbLoadOverride>;
export type CaseRgbLoadOverrideOperation = "create" | "update" | "unchanged";

export type CaseRgbLoadOverrideValidationItem = {
  partId: string;
  partName?: string;
  category?: Part["category"];
  valid: boolean;
  errors: string[];
  operation?: CaseRgbLoadOverrideOperation;
  changedFields?: string[];
  override?: CaseRgbLoadOverride;
};

export type CaseRgbLoadOverrideBatchValidation = {
  items: CaseRgbLoadOverrideValidationItem[];
  validOverrides: CaseRgbLoadOverride[];
  errors: string[];
};

export type CaseRgbLoadOverrideListItem = CaseRgbLoadOverride & {
  partName?: string;
  category?: Part["category"];
};

export type CaseRgbLoadCoverage = {
  generatedAt: string;
  totalRgbCases: number;
  registeredCount: number;
  missingCount: number;
  coveragePercent: number;
};

const MAX_BATCH_SIZE = 500;
const MAX_CURRENT_A = 20;
const MAX_POWER_W = 250;
const MAX_MANUFACTURER_MODEL_LENGTH = 160;
const MAX_SOURCE_NOTE_LENGTH = 500;

let overrideWriteQueue: Promise<void> = Promise.resolve();

export async function readCaseRgbLoadOverrides(): Promise<CaseRgbLoadOverrideMap> {
  return readJson<CaseRgbLoadOverrideMap>(CASE_RGB_LOAD_OVERRIDES_PATH, {});
}

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown, label: string, min: number, max: number) {
  if (value === undefined || value === null || value === "") return { value: undefined as number | undefined };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= min || parsed > max) {
    return { error: `${label}은 ${min}보다 크고 ${max} 이하인 숫자여야 합니다.` };
  }
  return { value: parsed };
}

function sourceUrlErrors(value: string) {
  if (!value) return [];
  if (value.length > 1000) return ["sourceUrl은 1,000자 이하로 입력해야 합니다."];
  try {
    return new URL(value).protocol === "https:" ? [] : ["sourceUrl은 HTTPS 주소만 사용할 수 있습니다."];
  } catch {
    return ["sourceUrl 형식이 올바르지 않습니다."];
  }
}

function usableOverride(value: unknown): value is CaseRgbLoadOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CaseRgbLoadOverride>;
  const hasCurrent = typeof candidate.rgbDeviceCurrentA === "number" && Number.isFinite(candidate.rgbDeviceCurrentA) && candidate.rgbDeviceCurrentA > 0 && candidate.rgbDeviceCurrentA <= MAX_CURRENT_A;
  const hasPower = typeof candidate.rgbDevicePowerW === "number" && Number.isFinite(candidate.rgbDevicePowerW) && candidate.rgbDevicePowerW > 0 && candidate.rgbDevicePowerW <= MAX_POWER_W;
  return typeof candidate.partId === "string"
    && candidate.partId.trim().length > 0
    && (hasCurrent || hasPower)
    && typeof candidate.manufacturerModel === "string"
    && candidate.manufacturerModel.trim().length > 0
    && typeof candidate.sourceNote === "string"
    && candidate.sourceNote.trim().length > 0
    && typeof candidate.updatedAt === "string"
    && sourceUrlErrors(normalizedString(candidate.sourceUrl)).length === 0;
}

export function validateCaseRgbLoadOverride(part: Part, input: unknown): { value?: CaseRgbLoadOverride; errors: string[] } {
  const errors: string[] = [];
  if (part.category !== "case") errors.push("RGB 부하 보강은 케이스만 대상으로 등록할 수 있습니다.");
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["override 본문은 객체여야 합니다.", ...errors] };
  const body = input as Record<string, unknown>;
  const current = optionalNumber(body.rgbDeviceCurrentA, "RGB 장치당 소비전류", 0, MAX_CURRENT_A);
  const power = optionalNumber(body.rgbDevicePowerW, "RGB 장치당 소비전력", 0, MAX_POWER_W);
  if (current.error) errors.push(current.error);
  if (power.error) errors.push(power.error);
  if (current.value === undefined && power.value === undefined) errors.push("RGB 장치당 소비전류 또는 소비전력 중 하나 이상이 필요합니다.");

  const manufacturerModel = normalizedString(body.manufacturerModel);
  if (!manufacturerModel) errors.push("제조사 모델/SKU(manufacturerModel)가 필요합니다.");
  if (manufacturerModel.length > MAX_MANUFACTURER_MODEL_LENGTH) errors.push(`manufacturerModel은 ${MAX_MANUFACTURER_MODEL_LENGTH}자 이하로 입력해야 합니다.`);
  const sourceNote = normalizedString(body.sourceNote);
  if (!sourceNote) errors.push("검수 근거 sourceNote가 필요합니다.");
  if (sourceNote.length > MAX_SOURCE_NOTE_LENGTH) errors.push(`sourceNote는 ${MAX_SOURCE_NOTE_LENGTH}자 이하로 입력해야 합니다.`);
  const sourceUrl = normalizedString(body.sourceUrl);
  errors.push(...sourceUrlErrors(sourceUrl));
  if (errors.length > 0) return { errors };

  const provenance: RgbDeviceLoadProvenance = {
    manufacturerModel,
    sourceNote,
    ...(sourceUrl ? { sourceUrl } : {}),
    updatedAt: new Date().toISOString()
  };
  return {
    value: {
      partId: part.id,
      ...(current.value !== undefined ? { rgbDeviceCurrentA: current.value } : {}),
      ...(power.value !== undefined ? { rgbDevicePowerW: power.value } : {}),
      ...provenance
    },
    errors
  };
}

function rawBatchItems(input: unknown) {
  if (Array.isArray(input)) return input as unknown[];
  if (input && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as Record<string, unknown>).items)) return (input as Record<string, unknown>).items as unknown[];
  return undefined;
}

const OVERRIDE_FIELDS = ["rgbDeviceCurrentA", "rgbDevicePowerW", "manufacturerModel", "sourceNote", "sourceUrl"] as const;

export function validateCaseRgbLoadOverrideBatch(input: unknown, catalog: Part[], existingOverrides: CaseRgbLoadOverrideMap = {}): CaseRgbLoadOverrideBatchValidation {
  const rawItems = rawBatchItems(input);
  if (!rawItems) return { items: [], validOverrides: [], errors: ["items는 케이스 RGB 부하 보강 배열이어야 합니다."] };
  if (rawItems.length < 1) return { items: [], validOverrides: [], errors: ["items는 최소 1개가 필요합니다."] };
  if (rawItems.length > MAX_BATCH_SIZE) return { items: [], validOverrides: [], errors: [`한 번에 최대 ${MAX_BATCH_SIZE}개 케이스까지 처리할 수 있습니다.`] };

  const items: CaseRgbLoadOverrideValidationItem[] = [];
  const validOverrides: CaseRgbLoadOverride[] = [];
  const errors: string[] = [];
  const seenPartIds = new Set<string>();
  rawItems.forEach((rawItem, index) => {
    const itemErrors: string[] = [];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      items.push({ partId: `items[${index}]`, valid: false, errors: ["항목은 객체여야 합니다."] });
      return;
    }
    const candidate = rawItem as Record<string, unknown>;
    const partId = normalizedString(candidate.partId);
    if (!partId) itemErrors.push("partId가 필요합니다.");
    if (seenPartIds.has(partId)) itemErrors.push("같은 partId가 일괄 입력에서 중복되었습니다.");
    seenPartIds.add(partId);
    const part = catalog.find((entry) => entry.id === partId);
    if (!part) itemErrors.push("카탈로그에서 부품을 찾을 수 없습니다.");
    const category = normalizedString(candidate.category);
    if (category && category !== "case") itemErrors.push("category는 case만 사용할 수 있습니다.");
    if (category && part && category !== part.category) itemErrors.push(`category가 카탈로그 범주(${part.category})와 다릅니다.`);
    const validation = part ? validateCaseRgbLoadOverride(part, candidate) : { errors: [] as string[] };
    itemErrors.push(...validation.errors);
    const item: CaseRgbLoadOverrideValidationItem = {
      partId: partId || `items[${index}]`,
      ...(part ? { partName: part.name, category: part.category } : {}),
      valid: itemErrors.length === 0,
      errors: itemErrors
    };
    if (itemErrors.length === 0 && part && validation.value) {
      const override = validation.value;
      const existing = existingOverrides[partId];
      const changedFields = OVERRIDE_FIELDS.filter((field) => !Object.is(existing?.[field], override[field])).map((field) => field);
      item.operation = existing ? changedFields.length > 0 ? "update" : "unchanged" : "create";
      item.changedFields = changedFields;
      item.override = override;
      validOverrides.push(override);
    }
    items.push(item);
  });
  errors.push(...items.flatMap((item) => item.errors.map((error) => `${item.partId}: ${error}`)));
  return { items, validOverrides: errors.length === 0 ? validOverrides : [], errors };
}

export function applyCaseRgbLoadOverrides(parts: Part[], overrides: CaseRgbLoadOverrideMap) {
  return parts.map((part) => {
    const override = overrides[part.id];
    if (part.category !== "case" || !usableOverride(override)) return part;
    return {
      ...part,
      specs: {
        ...part.specs,
        ...(override.rgbDeviceCurrentA !== undefined ? { rgbDeviceCurrentA: override.rgbDeviceCurrentA } : {}),
        ...(override.rgbDevicePowerW !== undefined ? { rgbDevicePowerW: override.rgbDevicePowerW } : {}),
        rgbDeviceLoadProvenance: {
          manufacturerModel: override.manufacturerModel,
          sourceNote: override.sourceNote,
          ...(override.sourceUrl ? { sourceUrl: override.sourceUrl } : {}),
          updatedAt: override.updatedAt
        }
      }
    };
  });
}

export function stripCaseRgbLoadOverride(part: Part): Part {
  if (part.specs.rgbDeviceLoadProvenance === undefined && part.specs.rgbDeviceCurrentA === undefined && part.specs.rgbDevicePowerW === undefined) return part;
  const specs = { ...part.specs };
  delete specs.rgbDeviceCurrentA;
  delete specs.rgbDevicePowerW;
  delete specs.rgbDeviceLoadProvenance;
  return { ...part, specs };
}

export function sortedCaseRgbLoadOverrides(overrides: CaseRgbLoadOverrideMap) {
  return Object.values(overrides).filter(usableOverride).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.partId.localeCompare(right.partId));
}

export function caseRgbLoadOverrideListItems(catalog: Part[], overrides: CaseRgbLoadOverrideMap): CaseRgbLoadOverrideListItem[] {
  return sortedCaseRgbLoadOverrides(overrides).map((override) => {
    const part = catalog.find((entry) => entry.id === override.partId);
    return { ...override, ...(part ? { partName: part.name, category: part.category } : {}) };
  });
}

export function caseRgbLoadCoverageFor(catalog: Part[], overrides: CaseRgbLoadOverrideMap): CaseRgbLoadCoverage {
  const rgbCases = catalog.filter((part) => part.category === "case" && part.specs.rgbDeviceCount !== undefined && part.specs.rgbDeviceCount > 0);
  const registeredCount = rgbCases.filter((part) => usableOverride(overrides[part.id])).length;
  return {
    generatedAt: new Date().toISOString(),
    totalRgbCases: rgbCases.length,
    registeredCount,
    missingCount: Math.max(0, rgbCases.length - registeredCount),
    coveragePercent: rgbCases.length > 0 ? Number(((registeredCount / rgbCases.length) * 100).toFixed(1)) : 0
  };
}

async function withOverrideWriteLock<T>(operation: (overrides: CaseRgbLoadOverrideMap) => T | Promise<T>) {
  const current = overrideWriteQueue.then(async () => operation(await readCaseRgbLoadOverrides()));
  overrideWriteQueue = current.then(() => undefined, () => undefined);
  return current;
}

export async function saveCaseRgbLoadOverrides(values: CaseRgbLoadOverride[]) {
  return withOverrideWriteLock(async (overrides) => {
    for (const value of values) overrides[value.partId] = value;
    await writeJson(CASE_RGB_LOAD_OVERRIDES_PATH, overrides);
    return values;
  });
}

export async function deleteCaseRgbLoadOverride(partId: string) {
  return withOverrideWriteLock(async (overrides) => {
    if (!overrides[partId]) return false;
    delete overrides[partId];
    await writeJson(CASE_RGB_LOAD_OVERRIDES_PATH, overrides);
    return true;
  });
}
