import { DATA_FRESHNESS_LABELS, type DataFreshness, type PhysicalEvidenceSource, type ValueLabel } from "./types";
import { valueScoreText } from "./value-score";

export interface AlternativeComparisonCandidate {
  name: string;
  summary: string;
  price: string;
  purchaseCondition?: string;
  recommendedQuantity?: number;
  similarity: string;
  valueScore?: number;
  valueLabel?: ValueLabel;
  valueScoreScale?: 200;
  recommendationTrust?: string;
  performance: string;
  compatibility: string;
  decisionSummary?: string;
  physicalEvidence?: string;
  physicalEvidenceSources?: PhysicalEvidenceSource[];
  dataQuality: string;
  dataFreshness?: DataFreshness;
  updatedAt?: string;
  sourceUrl?: string;
}

function physicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

export function physicalEvidenceSourceTextFor(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).map((source) => `${physicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}${source.updatedAt ? ` · 검수 ${source.updatedAt}` : ""}: ${source.note}${source.url ? ` (${source.url})` : ""}`).join(" · ");
}

function valueScoreTextFor(candidate: AlternativeComparisonCandidate) {
  if (candidate.valueScore === undefined || !candidate.valueLabel) return undefined;
  return `${candidate.valueLabel} ${valueScoreText(candidate.valueScore)}`;
}

function csvCell(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function comparisonRows(candidates: AlternativeComparisonCandidate[]) {
  return candidates.map((candidate) => [
    candidate.name,
    candidate.summary,
    candidate.price,
    candidate.purchaseCondition,
    candidate.recommendedQuantity,
    candidate.similarity,
    valueScoreTextFor(candidate),
    candidate.recommendationTrust,
    candidate.performance,
    candidate.compatibility,
    candidate.decisionSummary,
    candidate.physicalEvidence,
    physicalEvidenceSourceTextFor(candidate.physicalEvidenceSources),
    candidate.dataQuality,
    candidate.dataFreshness ? DATA_FRESHNESS_LABELS[candidate.dataFreshness] : undefined,
    candidate.updatedAt,
    candidate.sourceUrl
  ]);
}

export function alternativeComparisonTextFor(candidates: AlternativeComparisonCandidate[]) {
  const lines = ["PC Supporter 후보 비교", ""];
  candidates.forEach((candidate, index) => {
    lines.push(`[후보 ${index + 1}] ${candidate.name}`);
    lines.push(`- 핵심 스펙: ${candidate.summary}`);
    lines.push(`- 가격: ${candidate.price}${candidate.recommendedQuantity !== undefined ? ` · 추천 킷 ${candidate.recommendedQuantity}개` : ""}`);
    if (candidate.purchaseCondition) lines.push(`- 구매 조건: ${candidate.purchaseCondition}`);
    lines.push(`- 성능 유사도: ${candidate.similarity}`);
    const valueScore = valueScoreTextFor(candidate);
    if (valueScore) lines.push(`- 가격 대비 유사도: ${valueScore}`);
    if (candidate.recommendationTrust) lines.push(`- 추천 근거 신뢰도: ${candidate.recommendationTrust}`);
    lines.push(`- 성능 변화: ${candidate.performance}`);
    lines.push(`- 호환 상태: ${candidate.compatibility}`);
    if (candidate.decisionSummary) lines.push(`- 판단 요약: ${candidate.decisionSummary}`);
    if (candidate.physicalEvidence) lines.push(`- 물리 근거: ${candidate.physicalEvidence}`);
    const physicalEvidenceSources = physicalEvidenceSourceTextFor(candidate.physicalEvidenceSources);
    if (physicalEvidenceSources) lines.push(`- 물리 근거 출처: ${physicalEvidenceSources}`);
    lines.push(`- 데이터: ${candidate.dataQuality}${candidate.dataFreshness ? ` · ${DATA_FRESHNESS_LABELS[candidate.dataFreshness]}` : ""}${candidate.updatedAt ? ` · 갱신 ${candidate.updatedAt}` : ""}`);
    if (candidate.sourceUrl) lines.push(`- 원문: ${candidate.sourceUrl}`);
    lines.push("");
  });
  return lines.join("\n");
}

export function alternativeComparisonCsvFor(candidates: AlternativeComparisonCandidate[]) {
  const header = ["후보명", "핵심 스펙", "가격", "구매 조건", "추천 킷 수량", "성능 유사도", "가격 대비 유사도", "추천 근거 신뢰도", "성능 변화", "호환 상태", "판단 요약", "물리 근거", "물리 근거 출처", "데이터 품질", "갱신 상태", "갱신일", "원문 링크"];
  return `\uFEFF${[header, ...comparisonRows(candidates)].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function alternativeComparisonJsonFor(candidates: AlternativeComparisonCandidate[]) {
  return JSON.stringify({
    type: "pc-supporter-alternative-comparison",
    version: 1,
    exportedAt: new Date().toISOString(),
    items: candidates
  }, null, 2);
}
