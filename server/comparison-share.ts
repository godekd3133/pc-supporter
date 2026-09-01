import type { AlternativeComparisonCandidate } from "../shared/alternative-comparison-export";
import type { DataFreshness, PhysicalEvidenceSource, ValueLabel } from "../shared/types";
import { VALUE_SCORE_MAX } from "../shared/value-score";
import type { AlternativeComparisonCreateInput, AlternativeComparisonSnapshot } from "../shared/alternative-comparison-share";
import { safeExternalUrl, safeHttpsUrl } from "../shared/safe-source-url";
import { normalizeShareExpiryAt, shareExpiryDaysFrom, shareExpiryValueProvided, shareExpired, shareExpiresAtFor } from "./share-lifecycle";

export type SavedAlternativeComparisonRecord = AlternativeComparisonSnapshot & {
  ownerTokenHash?: string;
};

export interface AlternativeComparisonInputResult {
  name?: string;
  category?: string;
  currentPartName?: string;
  candidates: AlternativeComparisonCandidate[];
  expiresInDays?: 7 | 30;
  errors: string[];
}

const MAX_CANDIDATES = 3;

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function dataFreshnessFromUnknown(value: unknown): DataFreshness | undefined {
  return value === "fresh" || value === "aging" || value === "stale" || value === "unknown" ? value : undefined;
}

function valueLabelFromUnknown(value: unknown): ValueLabel | undefined {
  return value === "가성비 우수" || value === "가성비 균형" || value === "가격 대비 낮음" ? value : undefined;
}

function physicalEvidenceSourcesFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const sources = value.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const category: PhysicalEvidenceSource["category"] | undefined = source.category === "gpu" || source.category === "case" || source.category === "psu" ? source.category : undefined;
    const note = textValue(source.note, 500);
    if (!category || !note) return [];
    const manufacturerModel = textValue(source.manufacturerModel, 160);
    const manufacturerRevision = textValue(source.manufacturerRevision, 120);
    const updatedAt = textValue(source.updatedAt, 80);
    const url = typeof source.url === "string" ? safeHttpsUrl(source.url) : undefined;
    return [{ category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) }];
  });
  return sources.length > 0 ? sources : undefined;
}

function candidateFromUnknown(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `${index + 1}번째 후보 형식이 올바르지 않습니다.` };
  const candidate = value as Record<string, unknown>;
  const name = textValue(candidate.name, 240);
  const summary = textValue(candidate.summary, 500);
  const price = textValue(candidate.price, 120);
  const purchaseCondition = textValue(candidate.purchaseCondition, 240);
  const similarity = textValue(candidate.similarity, 240);
  const rawValueScore = candidate.valueScore;
  const valueScore = rawValueScore === undefined ? undefined : Number(rawValueScore);
  const valueLabel = valueLabelFromUnknown(candidate.valueLabel);
  const rawValueScoreScale = candidate.valueScoreScale;
  const valueScoreScale = rawValueScoreScale === undefined ? undefined : Number(rawValueScoreScale);
  const recommendationTrust = textValue(candidate.recommendationTrust, 120);
  const performance = textValue(candidate.performance, 1_000);
  const compatibility = textValue(candidate.compatibility, 240);
  const decisionSummary = textValue(candidate.decisionSummary, 500);
  const physicalEvidence = textValue(candidate.physicalEvidence, 500);
  const physicalEvidenceSources = physicalEvidenceSourcesFromUnknown(candidate.physicalEvidenceSources);
  const dataQuality = textValue(candidate.dataQuality, 80);
  if (!name || !summary || !price || !similarity || !performance || !compatibility || !dataQuality) return { error: `${index + 1}번째 후보의 비교 정보가 부족합니다.` };
  if (valueScore !== undefined && (!Number.isInteger(valueScore) || valueScore < 0 || valueScore > VALUE_SCORE_MAX || !valueLabel)) return { error: `${index + 1}번째 후보의 가격 대비 유사도 점수가 올바르지 않습니다.` };
  if (valueLabel && valueScore === undefined) return { error: `${index + 1}번째 후보의 가격 대비 유사도 점수가 필요합니다.` };
  if (valueScoreScale !== undefined && valueScoreScale !== VALUE_SCORE_MAX) return { error: `${index + 1}번째 후보의 가격 대비 유사도 점수 스케일이 올바르지 않습니다.` };
  const recommendedQuantity = candidate.recommendedQuantity === undefined ? undefined : Number(candidate.recommendedQuantity);
  if (recommendedQuantity !== undefined && (!Number.isInteger(recommendedQuantity) || recommendedQuantity <= 0 || recommendedQuantity > 99)) return { error: `${index + 1}번째 후보의 추천 수량이 올바르지 않습니다.` };
  const updatedAt = textValue(candidate.updatedAt, 80);
  const dataFreshness = dataFreshnessFromUnknown(candidate.dataFreshness);
  const sourceUrl = typeof candidate.sourceUrl === "string" ? safeExternalUrl(candidate.sourceUrl) : undefined;
  return {
    candidate: {
      name,
      summary,
      price,
      ...(purchaseCondition ? { purchaseCondition } : {}),
      ...(recommendedQuantity !== undefined ? { recommendedQuantity } : {}),
      similarity,
      ...(valueScore !== undefined && valueLabel ? { valueScore, valueLabel, valueScoreScale: VALUE_SCORE_MAX as 200 } : {}),
      ...(recommendationTrust ? { recommendationTrust } : {}),
      performance,
      compatibility,
      ...(decisionSummary ? { decisionSummary } : {}),
      ...(physicalEvidence ? { physicalEvidence } : {}),
      ...(physicalEvidenceSources ? { physicalEvidenceSources } : {}),
      dataQuality,
      ...(dataFreshness ? { dataFreshness } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    } satisfies AlternativeComparisonCandidate
  };
}

export function parseAlternativeComparisonInput(input: unknown): AlternativeComparisonInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { candidates: [], errors: ["후보 비교 저장 형식이 올바르지 않습니다."] };
  const candidate = input as AlternativeComparisonCreateInput;
  const name = textValue(candidate.name, 60) ?? "대체 후보 비교";
  const category = textValue(candidate.category, 80);
  const currentPartName = textValue(candidate.currentPartName, 240);
  const expiresInDays = shareExpiryDaysFrom(candidate.expiresInDays);
  if (shareExpiryValueProvided(candidate.expiresInDays) && expiresInDays === undefined) return { name, ...(category ? { category } : {}), ...(currentPartName ? { currentPartName } : {}), candidates: [], errors: ["비교 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다."] };
  if (!Array.isArray(candidate.candidates) || candidate.candidates.length < 2 || candidate.candidates.length > MAX_CANDIDATES) return { name, ...(category ? { category } : {}), ...(currentPartName ? { currentPartName } : {}), candidates: [], errors: [`후보 비교는 2개 이상 ${MAX_CANDIDATES}개 이하로 저장할 수 있습니다.`] };
  const parsed = candidate.candidates.map(candidateFromUnknown);
  const errors = parsed.flatMap((value) => value.error ? [value.error] : []);
  if (errors.length > 0) return { name, ...(category ? { category } : {}), ...(currentPartName ? { currentPartName } : {}), candidates: [], errors };
  return {
    name,
    ...(category ? { category } : {}),
    ...(currentPartName ? { currentPartName } : {}),
    candidates: parsed.map((value) => value.candidate!).filter((value): value is AlternativeComparisonCandidate => Boolean(value)),
    ...(expiresInDays !== undefined ? { expiresInDays } : {}),
    errors: []
  };
}

export function alternativeComparisonExpired(comparison: Pick<AlternativeComparisonSnapshot, "expiresAt">, now = Date.now()) {
  return shareExpired(comparison.expiresAt, now);
}

export function savedAlternativeComparisonFromUnknown(value: unknown): SavedAlternativeComparisonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const parsed = parseAlternativeComparisonInput(candidate);
  const expiresAt = normalizeShareExpiryAt(candidate.expiresAt);
  const ownerTokenHash = typeof candidate.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(candidate.ownerTokenHash) ? candidate.ownerTokenHash : undefined;
  if (parsed.errors.length > 0 || typeof candidate.id !== "string" || !candidate.id || typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string" || !expiresAt.valid) return undefined;
  return {
    id: candidate.id,
    name: parsed.name ?? "대체 후보 비교",
    ...(parsed.category ? { category: parsed.category } : {}),
    ...(parsed.currentPartName ? { currentPartName: parsed.currentPartName } : {}),
    candidates: parsed.candidates,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    ...(expiresAt.value ? { expiresAt: expiresAt.value } : {}),
    ...(ownerTokenHash ? { ownerTokenHash } : {})
  };
}

export function publicAlternativeComparison(record: SavedAlternativeComparisonRecord): AlternativeComparisonSnapshot {
  const { ownerTokenHash: _ownerTokenHash, ...comparison } = record;
  return comparison;
}

export function alternativeComparisonExpiresAtFor(expiresInDays: 7 | 30 | undefined, now: number | Date = Date.now()) {
  return shareExpiresAtFor(expiresInDays, now);
}
