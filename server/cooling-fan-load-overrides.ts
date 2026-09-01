import type { AccessoryItem, CoolingFanLoadOverride, FanLoadProvenance } from "../shared/types";
import { COOLING_FAN_LOAD_OVERRIDES_PATH, readJson, writeJson } from "./storage";

export type CoolingFanLoadOverrideMap = Record<string, CoolingFanLoadOverride>;
export type CoolingFanLoadOverrideOperation = "create" | "update" | "unchanged";

export type CoolingFanLoadOverrideValidationItem = {
  accessoryId: string;
  accessoryName?: string;
  category?: AccessoryItem["category"];
  valid: boolean;
  errors: string[];
  operation?: CoolingFanLoadOverrideOperation;
  changedFields?: string[];
  override?: CoolingFanLoadOverride;
};

export type CoolingFanLoadOverrideBatchValidation = {
  items: CoolingFanLoadOverrideValidationItem[];
  validOverrides: CoolingFanLoadOverride[];
  errors: string[];
};

export type CoolingFanLoadOverrideListItem = CoolingFanLoadOverride & {
  accessoryName?: string;
  category?: AccessoryItem["category"];
};

export type CoolingFanLoadCoverage = {
  generatedAt: string;
  totalCoolingFans: number;
  registeredCount: number;
  knownCount: number;
  missingCount: number;
  coveragePercent: number;
};

const MAX_BATCH_SIZE = 500;
const MAX_CURRENT_A = 20;
const MAX_MANUFACTURER_MODEL_LENGTH = 160;
const MAX_SOURCE_NOTE_LENGTH = 500;

let overrideWriteQueue: Promise<void> = Promise.resolve();

export async function readCoolingFanLoadOverrides(): Promise<CoolingFanLoadOverrideMap> {
  return readJson<CoolingFanLoadOverrideMap>(COOLING_FAN_LOAD_OVERRIDES_PATH, {});
}

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalCurrent(value: unknown) {
  if (value === undefined || value === null || value === "") return { value: undefined as number | undefined };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_CURRENT_A) return { error: `팬 소비전류는 0보다 크고 ${MAX_CURRENT_A}A 이하인 숫자여야 합니다.` };
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

function usableOverride(value: unknown): value is CoolingFanLoadOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CoolingFanLoadOverride>;
  return typeof candidate.accessoryId === "string"
    && candidate.accessoryId.trim().length > 0
    && typeof candidate.fanCurrentA === "number"
    && Number.isFinite(candidate.fanCurrentA)
    && candidate.fanCurrentA > 0
    && candidate.fanCurrentA <= MAX_CURRENT_A
    && typeof candidate.manufacturerModel === "string"
    && candidate.manufacturerModel.trim().length > 0
    && typeof candidate.sourceNote === "string"
    && candidate.sourceNote.trim().length > 0
    && typeof candidate.updatedAt === "string"
    && sourceUrlErrors(normalizedString(candidate.sourceUrl)).length === 0;
}

export function validateCoolingFanLoadOverride(item: AccessoryItem, input: unknown): { value?: CoolingFanLoadOverride; errors: string[] } {
  const errors: string[] = [];
  if (item.category !== "cooling_fan") errors.push("팬 소비전류 보강은 쿨링팬만 대상으로 등록할 수 있습니다.");
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["override 본문은 객체여야 합니다.", ...errors] };
  const body = input as Record<string, unknown>;
  const current = optionalCurrent(body.fanCurrentA);
  if (current.error) errors.push(current.error);
  if (current.value === undefined) errors.push("팬 소비전류(fanCurrentA)가 필요합니다.");
  const manufacturerModel = normalizedString(body.manufacturerModel);
  if (!manufacturerModel) errors.push("제조사 모델/SKU(manufacturerModel)가 필요합니다.");
  if (manufacturerModel.length > MAX_MANUFACTURER_MODEL_LENGTH) errors.push(`manufacturerModel은 ${MAX_MANUFACTURER_MODEL_LENGTH}자 이하로 입력해야 합니다.`);
  const sourceNote = normalizedString(body.sourceNote);
  if (!sourceNote) errors.push("검수 근거 sourceNote가 필요합니다.");
  if (sourceNote.length > MAX_SOURCE_NOTE_LENGTH) errors.push(`sourceNote는 ${MAX_SOURCE_NOTE_LENGTH}자 이하로 입력해야 합니다.`);
  const sourceUrl = normalizedString(body.sourceUrl);
  errors.push(...sourceUrlErrors(sourceUrl));
  if (errors.length > 0) return { errors };
  const provenance: FanLoadProvenance = { manufacturerModel, sourceNote, ...(sourceUrl ? { sourceUrl } : {}), updatedAt: new Date().toISOString() };
  return { value: { accessoryId: item.id, fanCurrentA: current.value!, ...provenance }, errors };
}

function rawBatchItems(input: unknown) {
  if (Array.isArray(input)) return input as unknown[];
  if (input && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as Record<string, unknown>).items)) return (input as Record<string, unknown>).items as unknown[];
  return undefined;
}

const OVERRIDE_FIELDS = ["fanCurrentA", "manufacturerModel", "sourceNote", "sourceUrl"] as const;

export function validateCoolingFanLoadOverrideBatch(input: unknown, accessories: AccessoryItem[], existingOverrides: CoolingFanLoadOverrideMap = {}): CoolingFanLoadOverrideBatchValidation {
  const rawItems = rawBatchItems(input);
  if (!rawItems) return { items: [], validOverrides: [], errors: ["items는 쿨링팬 소비전류 보강 배열이어야 합니다."] };
  if (rawItems.length < 1) return { items: [], validOverrides: [], errors: ["items는 최소 1개가 필요합니다."] };
  if (rawItems.length > MAX_BATCH_SIZE) return { items: [], validOverrides: [], errors: [`한 번에 최대 ${MAX_BATCH_SIZE}개 쿨링팬까지 처리할 수 있습니다.`] };
  const items: CoolingFanLoadOverrideValidationItem[] = [];
  const validOverrides: CoolingFanLoadOverride[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();
  rawItems.forEach((rawItem, index) => {
    const itemErrors: string[] = [];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      items.push({ accessoryId: `items[${index}]`, valid: false, errors: ["항목은 객체여야 합니다."] });
      return;
    }
    const candidate = rawItem as Record<string, unknown>;
    const accessoryId = normalizedString(candidate.accessoryId ?? candidate.partId);
    if (!accessoryId) itemErrors.push("accessoryId가 필요합니다.");
    if (seenIds.has(accessoryId)) itemErrors.push("같은 accessoryId가 일괄 입력에서 중복되었습니다.");
    seenIds.add(accessoryId);
    const item = accessories.find((entry) => entry.id === accessoryId);
    if (!item) itemErrors.push("카탈로그에서 주변 부품을 찾을 수 없습니다.");
    const category = normalizedString(candidate.category);
    if (category && category !== "cooling_fan") itemErrors.push("category는 cooling_fan만 사용할 수 있습니다.");
    if (category && item && category !== item.category) itemErrors.push(`category가 카탈로그 범주(${item.category})와 다릅니다.`);
    const validation = item ? validateCoolingFanLoadOverride(item, candidate) : { errors: [] as string[] };
    itemErrors.push(...validation.errors);
    const row: CoolingFanLoadOverrideValidationItem = { accessoryId: accessoryId || `items[${index}]`, ...(item ? { accessoryName: item.name, category: item.category } : {}), valid: itemErrors.length === 0, errors: itemErrors };
    if (itemErrors.length === 0 && item && validation.value) {
      const override = validation.value;
      const existing = existingOverrides[accessoryId];
      const changedFields = OVERRIDE_FIELDS.filter((field) => !Object.is(existing?.[field], override[field])).map((field) => field);
      row.operation = existing ? changedFields.length > 0 ? "update" : "unchanged" : "create";
      row.changedFields = changedFields;
      row.override = override;
      validOverrides.push(override);
    }
    items.push(row);
  });
  errors.push(...items.flatMap((item) => item.errors.map((error) => `${item.accessoryId}: ${error}`)));
  return { items, validOverrides: errors.length === 0 ? validOverrides : [], errors };
}

export function applyCoolingFanLoadOverrides(items: AccessoryItem[], overrides: CoolingFanLoadOverrideMap) {
  return items.map((item) => {
    const override = overrides[item.id];
    if (item.category !== "cooling_fan" || !usableOverride(override)) return item;
    return {
      ...item,
      specs: {
        ...item.specs,
        fanCurrentA: override.fanCurrentA,
        fanLoadProvenance: {
          manufacturerModel: override.manufacturerModel,
          sourceNote: override.sourceNote,
          ...(override.sourceUrl ? { sourceUrl: override.sourceUrl } : {}),
          updatedAt: override.updatedAt
        }
      }
    };
  });
}

export function stripCoolingFanLoadOverride(item: AccessoryItem) {
  // 원문 파서가 저장한 fanCurrentA는 보존하고, provenance가 있는
  // 제조사 override만 accessories.json 저장 전에 제거한다.
  if (item.specs.fanLoadProvenance === undefined) return item;
  const specs = { ...item.specs };
  delete specs.fanCurrentA;
  delete specs.fanLoadProvenance;
  return { ...item, specs };
}

export function sortedCoolingFanLoadOverrides(overrides: CoolingFanLoadOverrideMap) {
  return Object.values(overrides).filter(usableOverride).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.accessoryId.localeCompare(right.accessoryId));
}

export function coolingFanLoadOverrideListItems(accessories: AccessoryItem[], overrides: CoolingFanLoadOverrideMap): CoolingFanLoadOverrideListItem[] {
  return sortedCoolingFanLoadOverrides(overrides).map((override) => {
    const item = accessories.find((entry) => entry.id === override.accessoryId);
    return { ...override, ...(item ? { accessoryName: item.name, category: item.category } : {}) };
  });
}

export function coolingFanLoadCoverageFor(accessories: AccessoryItem[], overrides: CoolingFanLoadOverrideMap): CoolingFanLoadCoverage {
  const fans = accessories.filter((item) => item.category === "cooling_fan");
  const registeredCount = fans.filter((item) => usableOverride(overrides[item.id])).length;
  const knownCount = fans.filter((item) => item.specs.fanCurrentA !== undefined || usableOverride(overrides[item.id])).length;
  return { generatedAt: new Date().toISOString(), totalCoolingFans: fans.length, registeredCount, knownCount, missingCount: Math.max(0, fans.length - knownCount), coveragePercent: fans.length > 0 ? Number(((knownCount / fans.length) * 100).toFixed(1)) : 0 };
}

async function withOverrideWriteLock<T>(operation: (overrides: CoolingFanLoadOverrideMap) => T | Promise<T>) {
  const current = overrideWriteQueue.then(async () => operation(await readCoolingFanLoadOverrides()));
  overrideWriteQueue = current.then(() => undefined, () => undefined);
  return current;
}

export async function saveCoolingFanLoadOverrides(values: CoolingFanLoadOverride[]) {
  return withOverrideWriteLock(async (overrides) => {
    for (const value of values) overrides[value.accessoryId] = value;
    await writeJson(COOLING_FAN_LOAD_OVERRIDES_PATH, overrides);
    return values;
  });
}

export async function deleteCoolingFanLoadOverride(accessoryId: string) {
  return withOverrideWriteLock(async (overrides) => {
    if (!overrides[accessoryId]) return false;
    delete overrides[accessoryId];
    await writeJson(COOLING_FAN_LOAD_OVERRIDES_PATH, overrides);
    return true;
  });
}
