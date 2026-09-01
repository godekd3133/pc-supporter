import type { BenchmarkOverride, BenchmarkOverrideOperation, BenchmarkScoreKey, BenchmarkSourceKind, Part, PartSpecs } from "../shared/types";
import { readBenchmarkOverrideRecords, writeBenchmarkOverrideRecords } from "./repository";

export const BENCHMARK_SCORE_KEYS = [
  "cinebenchR23Single",
  "cinebenchR23Multi",
  "gpu3dmarkTimeSpyScore",
  "gpu3dmarkPortRoyalScore"
] as const satisfies readonly BenchmarkScoreKey[];

const CPU_SCORE_KEYS = new Set<BenchmarkScoreKey>(["cinebenchR23Single", "cinebenchR23Multi"]);
const GPU_SCORE_KEYS = new Set<BenchmarkScoreKey>(["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"]);
const BENCHMARK_SOURCE_KINDS = new Set<BenchmarkSourceKind>(["official", "independent_review", "community_measurement", "other"]);
const MAX_BATCH_SIZE = 500;

export type BenchmarkOverrideMap = Record<string, BenchmarkOverride>;

export type BenchmarkOverrideValidationItem = {
  partId: string;
  partName?: string;
  category?: Part["category"];
  valid: boolean;
  errors: string[];
  operation?: BenchmarkOverrideOperation;
  changedFields?: string[];
  override?: BenchmarkOverride;
};

export type BenchmarkOverrideBatchValidation = {
  items: BenchmarkOverrideValidationItem[];
  validOverrides: BenchmarkOverride[];
  errors: string[];
};

export async function readBenchmarkOverrides(): Promise<BenchmarkOverrideMap> {
  return readBenchmarkOverrideRecords();
}

function usableBenchmarkOverride(value: unknown): value is BenchmarkOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<BenchmarkOverride>;
  if (typeof candidate.partId !== "string" || !candidate.partId.trim() || typeof candidate.sourceNote !== "string" || !candidate.sourceNote.trim() || typeof candidate.updatedAt !== "string") return false;
  if (!candidate.scores || typeof candidate.scores !== "object" || Array.isArray(candidate.scores)) return false;
  if (candidate.sourceKind !== undefined && (typeof candidate.sourceKind !== "string" || !BENCHMARK_SOURCE_KINDS.has(candidate.sourceKind as BenchmarkSourceKind))) return false;
  if (candidate.sourceUrl !== undefined && (typeof candidate.sourceUrl !== "string" || sourceUrlErrors(candidate.sourceUrl.trim()).length > 0)) return false;
  const scoreEntries = Object.entries(candidate.scores);
  return scoreEntries.length > 0 && scoreEntries.every(([key, value]) => BENCHMARK_SCORE_KEYS.includes(key as BenchmarkScoreKey) && scoreValue(value) !== undefined);
}

export function benchmarkSourceKindFromUnknown(value: unknown): BenchmarkSourceKind | undefined {
  if (value === undefined || value === null || value === "") return "other";
  return typeof value === "string" && BENCHMARK_SOURCE_KINDS.has(value as BenchmarkSourceKind) ? value as BenchmarkSourceKind : undefined;
}

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function scoreValue(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > 1_000_000) return undefined;
  return value;
}

function sourceUrlErrors(value: string) {
  if (!value) return [];
  if (value.length > 1000) return ["sourceUrl은 1,000자 이하로 입력해야 합니다."];
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? [] : ["sourceUrl은 HTTPS 주소만 사용할 수 있습니다."];
  } catch {
    return ["sourceUrl 형식이 올바르지 않습니다."];
  }
}

function scoreKeysForPart(category: Part["category"]) {
  return category === "cpu" ? CPU_SCORE_KEYS : GPU_SCORE_KEYS;
}

export function validateBenchmarkOverrideBatch(input: unknown, catalog: Part[], existingOverrides: BenchmarkOverrideMap = {}): BenchmarkOverrideBatchValidation {
  const rawItems: unknown[] | undefined = Array.isArray(input)
    ? input
    : input && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as Record<string, unknown>).items)
      ? (input as Record<string, unknown>).items as unknown[]
      : undefined;
  if (!rawItems) return { items: [], validOverrides: [], errors: ["items는 벤치마크 보강 배열이어야 합니다."] };
  if (rawItems.length < 1) return { items: [], validOverrides: [], errors: ["items는 최소 1개가 필요합니다."] };
  if (rawItems.length > MAX_BATCH_SIZE) return { items: [], validOverrides: [], errors: [`한 번에 최대 ${MAX_BATCH_SIZE}개 부품까지 처리할 수 있습니다.`] };

  const errors: string[] = [];
  const items: BenchmarkOverrideValidationItem[] = [];
  const validOverrides: BenchmarkOverride[] = [];
  const seenPartIds = new Set<string>();

  rawItems.forEach((rawItem, index) => {
    const itemErrors: string[] = [];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      items.push({ partId: `items[${index}]`, valid: false, errors: ["항목은 객체여야 합니다."] });
      return;
    }
    const candidate = rawItem as Record<string, unknown>;
    const partId = normalizedString(candidate.partId);
    if (!partId) {
      items.push({ partId: `items[${index}]`, valid: false, errors: ["partId가 필요합니다."] });
      return;
    }
    if (seenPartIds.has(partId)) itemErrors.push("같은 partId가 일괄 입력에서 중복되었습니다.");
    seenPartIds.add(partId);

    const part = catalog.find((item) => item.id === partId);
    if (!part) itemErrors.push("카탈로그에서 부품을 찾을 수 없습니다.");
    if (part && part.category !== "cpu" && part.category !== "gpu") itemErrors.push("CPU 또는 GPU만 벤치마크 보강 대상입니다.");

    const sourceNote = normalizedString(candidate.sourceNote);
    if (!sourceNote) itemErrors.push("검수 근거 sourceNote가 필요합니다.");
    if (sourceNote.length > 500) itemErrors.push("sourceNote는 500자 이하로 입력해야 합니다.");
    const sourceUrl = normalizedString(candidate.sourceUrl);
    itemErrors.push(...sourceUrlErrors(sourceUrl));
    const sourceKind = benchmarkSourceKindFromUnknown(candidate.sourceKind);
    if (sourceKind === undefined) itemErrors.push("sourceKind은 official, independent_review, community_measurement, other 중 하나여야 합니다.");

    const scores: Partial<Record<BenchmarkScoreKey, number>> = {};
    let scoreCount = 0;
    for (const key of BENCHMARK_SCORE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(candidate, key)) continue;
      const value = scoreValue(candidate[key]);
      if (value === undefined) {
        itemErrors.push(`${key}는 1부터 1,000,000 사이의 정수여야 합니다.`);
        continue;
      }
      scoreCount += 1;
      scores[key] = value;
      if (part && !scoreKeysForPart(part.category).has(key)) itemErrors.push(`${part.category === "cpu" ? "CPU" : "GPU"}에 사용할 수 없는 벤치마크 필드입니다: ${key}`);
    }
    if (scoreCount === 0) itemErrors.push("최소 1개의 벤치마크 점수를 입력해야 합니다.");

    const item: BenchmarkOverrideValidationItem = {
      partId,
      ...(part ? { partName: part.name, category: part.category } : {}),
      valid: itemErrors.length === 0,
      errors: itemErrors
    };
    if (itemErrors.length === 0 && part && (part.category === "cpu" || part.category === "gpu")) {
      const override: BenchmarkOverride = {
        partId,
        scores,
        sourceNote,
        sourceKind: sourceKind ?? "other",
        ...(sourceUrl ? { sourceUrl } : {}),
        updatedAt: new Date().toISOString()
      };
      const existing = existingOverrides[partId];
      const changedFields: string[] = BENCHMARK_SCORE_KEYS
        .filter((key) => Object.is(existing?.scores[key], override.scores[key]) === false)
        .map((key) => key);
      if ((existing?.sourceKind ?? "other") !== override.sourceKind) changedFields.push("sourceKind");
      if (existing && existing.sourceNote !== override.sourceNote) changedFields.push("sourceNote");
      if ((existing?.sourceUrl ?? "") !== (override.sourceUrl ?? "")) changedFields.push("sourceUrl");
      item.override = override;
      item.operation = existing ? changedFields.length > 0 ? "update" : "unchanged" : "create";
      item.changedFields = changedFields;
      validOverrides.push(override);
    }
    items.push(item);
  });

  errors.push(...items.flatMap((item) => item.errors.map((error) => `${item.partId}: ${error}`)));
  return { items, validOverrides: errors.length === 0 ? validOverrides : [], errors };
}

export function applyBenchmarkOverrides(parts: Part[], overrides: BenchmarkOverrideMap) {
  return parts.map((part) => {
    const override = overrides[part.id];
    if (!override || !override.scores || typeof override.scores !== "object" || Array.isArray(override.scores) || Object.keys(override.scores).length === 0) return part;
    const specs = { ...part.specs };
    let appliedScoreCount = 0;
    for (const [key, value] of Object.entries(override.scores)) {
      const scoreKey = key as BenchmarkScoreKey;
      const allowedKeys = part.category === "cpu" ? CPU_SCORE_KEYS : part.category === "gpu" ? GPU_SCORE_KEYS : new Set<BenchmarkScoreKey>();
      const validatedValue = scoreValue(value);
      if (BENCHMARK_SCORE_KEYS.includes(scoreKey) && allowedKeys.has(scoreKey) && validatedValue !== undefined) {
        specs[scoreKey as keyof PartSpecs] = validatedValue as never;
        appliedScoreCount += 1;
      }
    }
    const sourceUrl = typeof override.sourceUrl === "string" ? override.sourceUrl.trim() : "";
    const safeSourceUrl = sourceUrl && sourceUrlErrors(sourceUrl).length === 0 ? sourceUrl : undefined;
    if (appliedScoreCount > 0 && typeof override.sourceNote === "string" && override.sourceNote.trim()) {
      const sourceKind = benchmarkSourceKindFromUnknown(override.sourceKind) ?? "other";
      specs.benchmarkProvenance = {
        sourceKind,
        sourceNote: override.sourceNote,
        ...(safeSourceUrl ? { sourceUrl: safeSourceUrl } : {}),
        updatedAt: typeof override.updatedAt === "string" ? override.updatedAt : new Date(0).toISOString()
      };
    }
    return { ...part, specs };
  });
}

export function sortedBenchmarkOverrides(overrides: BenchmarkOverrideMap) {
  return Object.values(overrides).filter(usableBenchmarkOverride).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.partId.localeCompare(right.partId));
}

let writeQueue: Promise<void> = Promise.resolve();

async function withBenchmarkWriteLock<T>(operation: (overrides: BenchmarkOverrideMap) => T | Promise<T>) {
  const current = writeQueue.then(async () => operation(await readBenchmarkOverrides()));
  writeQueue = current.then(() => undefined, () => undefined);
  const value = await current;
  return value;
}

export async function saveBenchmarkOverrides(values: BenchmarkOverride[]) {
  return withBenchmarkWriteLock(async (overrides) => {
    for (const value of values) overrides[value.partId] = value;
    await writeBenchmarkOverrideRecords(overrides);
    return values;
  });
}

export async function deleteBenchmarkOverride(partId: string) {
  return withBenchmarkWriteLock(async (overrides) => {
    if (!overrides[partId]) return false;
    delete overrides[partId];
    await writeBenchmarkOverrideRecords(overrides);
    return true;
  });
}
