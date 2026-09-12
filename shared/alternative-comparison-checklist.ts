import type { AlternativeComparisonScenarioCheck } from "./alternative-comparison-scenario";

export interface AlternativeComparisonChecklistCandidate {
  name: string;
  checks?: AlternativeComparisonScenarioCheck[];
}

export interface AlternativeComparisonChecklistEntry extends AlternativeComparisonScenarioCheck {
  candidateIndex: number;
  candidateName: string;
  key: string;
}

export interface AlternativeComparisonChecklistTransferEnvelope {
  type: "pc-supporter-alternative-comparison-checklist";
  schemaVersion: 1;
  comparisonId: string;
  exportedAt: string;
  itemKeys: string[];
  checkedIds: string[];
}

export interface AlternativeComparisonChecklistTransferParseResult {
  checkedIds: string[];
  ignoredIds: string[];
  itemKeys: string[];
  exportedAt?: string;
  errors: string[];
}

export const ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS = 200;

export interface AlternativeComparisonChecklistTransferDiff {
  currentCheckedCount: number;
  incomingCheckedCount: number;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

export function alternativeComparisonChecklistKey(candidateIndex: number, checkId: string) {
  return `${candidateIndex}:${checkId}`;
}

export function alternativeComparisonChecklistEntriesFor(candidates: ReadonlyArray<AlternativeComparisonChecklistCandidate>) {
  return candidates.flatMap((candidate, candidateIndex) => (candidate.checks ?? []).map((check) => ({
    ...check,
    candidateIndex,
    candidateName: candidate.name,
    key: alternativeComparisonChecklistKey(candidateIndex, check.id)
  })));
}

export function alternativeComparisonChecklistCheckedIdsFromJson(raw: string | null | undefined) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length > ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS) return [] as string[];
    return uniqueIds(parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 240).map((value) => value.trim())).slice(0, ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS);
  } catch {
    return [] as string[];
  }
}

export function alternativeComparisonChecklistCheckedIdsToJson(ids: ReadonlyArray<string>) {
  return JSON.stringify(uniqueIds(ids.filter((id) => typeof id === "string" && id.trim().length > 0 && id.length <= 240).map((id) => id.trim())).slice(0, ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS));
}

export function alternativeComparisonChecklistProgressFor(entries: ReadonlyArray<AlternativeComparisonChecklistEntry>, checkedIds: ReadonlySet<string>) {
  const checked = entries.filter((entry) => entry.status !== "blocked" && checkedIds.has(entry.key)).length;
  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  const review = entries.filter((entry) => entry.status === "review").length;
  const ready = entries.filter((entry) => entry.status === "ready").length;
  return {
    total: entries.length,
    checked,
    remaining: Math.max(0, entries.length - checked),
    blocked,
    review,
    ready,
    percent: entries.length === 0 ? 0 : Math.round((checked / entries.length) * 100)
  };
}

export function alternativeComparisonChecklistToggle(checkedIds: ReadonlyArray<string>, entry: Pick<AlternativeComparisonChecklistEntry, "key" | "status">, checked: boolean) {
  const next = new Set(checkedIds);
  if (checked && entry.status !== "blocked") next.add(entry.key);
  else next.delete(entry.key);
  return Array.from(next).slice(0, ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS);
}

export function alternativeComparisonChecklistJsonFor(comparisonId: string, entries: ReadonlyArray<AlternativeComparisonChecklistEntry>, checkedIds: ReadonlySet<string>, exportedAt = new Date().toISOString()) {
  const itemKeys = entries.map((entry) => entry.key);
  const checkableKeySet = new Set(entries.filter((entry) => entry.status !== "blocked").map((entry) => entry.key));
  const envelope: AlternativeComparisonChecklistTransferEnvelope = {
    type: "pc-supporter-alternative-comparison-checklist",
    schemaVersion: 1,
    comparisonId,
    exportedAt,
    itemKeys: itemKeys.slice(0, ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS),
    checkedIds: Array.from(checkedIds).filter((id) => checkableKeySet.has(id)).slice(0, ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS)
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseAlternativeComparisonChecklistJson(input: string, expectedComparisonId: string, entries: ReadonlyArray<AlternativeComparisonChecklistEntry>): AlternativeComparisonChecklistTransferParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: ["후보 비교 체크리스트 JSON 형식이 올바르지 않습니다."] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: ["후보 비교 체크리스트 JSON은 객체여야 합니다."] };
  const candidate = parsed as Partial<AlternativeComparisonChecklistTransferEnvelope>;
  if (candidate.type !== "pc-supporter-alternative-comparison-checklist" || candidate.schemaVersion !== 1) return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: ["지원하지 않는 후보 비교 체크리스트 JSON 버전입니다."] };
  if (typeof candidate.comparisonId !== "string" || candidate.comparisonId !== expectedComparisonId) return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: ["현재 공유 후보 비교와 다른 체크리스트입니다. 같은 공유 링크에서 내보낸 JSON만 가져올 수 있습니다."] };
  if (typeof candidate.exportedAt !== "string" || candidate.exportedAt.length === 0 || candidate.exportedAt.length > 120 || !Number.isFinite(Date.parse(candidate.exportedAt))) return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: ["후보 비교 체크리스트 JSON의 내보낸 시각이 올바르지 않습니다."] };
  if (!Array.isArray(candidate.itemKeys) || !Array.isArray(candidate.checkedIds)) return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: ["후보 비교 체크리스트 JSON의 항목 목록 형식이 올바르지 않습니다."] };
  if (candidate.itemKeys.length > ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS || candidate.checkedIds.length > ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS) return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: [`후보 비교 체크리스트 JSON은 최대 ${ALTERNATIVE_COMPARISON_CHECKLIST_MAX_ITEMS}개 항목만 가져올 수 있습니다.`] };
  if (!candidate.itemKeys.every((key) => typeof key === "string" && key.length > 0 && key.length <= 240) || !candidate.checkedIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 240)) return { checkedIds: [], ignoredIds: [], itemKeys: [], errors: ["후보 비교 체크리스트 JSON의 항목 목록 형식이 올바르지 않습니다."] };
  const currentKeys = new Set(entries.map((entry) => entry.key));
  const blockedKeys = new Set(entries.filter((entry) => entry.status === "blocked").map((entry) => entry.key));
  const itemKeys = uniqueIds(candidate.itemKeys as string[]);
  const checkedIds = uniqueIds(candidate.checkedIds as string[]);
  return {
    checkedIds: checkedIds.filter((id) => currentKeys.has(id) && !blockedKeys.has(id)),
    ignoredIds: checkedIds.filter((id) => !currentKeys.has(id) || blockedKeys.has(id)),
    itemKeys,
    exportedAt: candidate.exportedAt,
    errors: []
  };
}

export function alternativeComparisonChecklistTransferDiffFor(currentCheckedIds: ReadonlyArray<string>, incomingCheckedIds: ReadonlyArray<string>): AlternativeComparisonChecklistTransferDiff {
  const current = new Set(currentCheckedIds);
  const incoming = new Set(incomingCheckedIds);
  return {
    currentCheckedCount: current.size,
    incomingCheckedCount: incoming.size,
    addedCount: Array.from(incoming).filter((id) => !current.has(id)).length,
    removedCount: Array.from(current).filter((id) => !incoming.has(id)).length,
    unchangedCount: Array.from(incoming).filter((id) => current.has(id)).length
  };
}

export function alternativeComparisonChecklistTransferMatchesCurrentFor(currentItemKeys: ReadonlyArray<string>, incomingItemKeys: ReadonlyArray<string>) {
  const current = new Set(currentItemKeys);
  const incoming = new Set(incomingItemKeys);
  return current.size === incoming.size && Array.from(current).every((key) => incoming.has(key));
}
