import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  FiArrowLeft,
  FiCheckCircle,
  FiClock,
  FiCopy,
  FiDownload,
  FiExternalLink,
  FiInfo,
  FiLoader,
  FiRefreshCw,
  FiShare2,
  FiXCircle
} from "react-icons/fi";
import { alternativeComparisonCsvFor, alternativeComparisonJsonFor, alternativeComparisonSimilarityEvidenceTextFor, alternativeComparisonTextFor } from "../shared/alternative-comparison-export";
import type { AlternativeComparisonBenchmarkEvidence, AlternativeComparisonCandidate, AlternativeComparisonSimilarityEvidence } from "../shared/alternative-comparison-export";
import type { AlternativeComparisonSnapshot } from "../shared/alternative-comparison-share";
import { alternativeComparisonChecklistCheckedIdsFromJson, alternativeComparisonChecklistCheckedIdsToJson, alternativeComparisonChecklistEntriesFor, alternativeComparisonChecklistJsonFor, alternativeComparisonChecklistProgressFor, alternativeComparisonChecklistToggle, alternativeComparisonChecklistTransferDiffFor, alternativeComparisonChecklistTransferMatchesCurrentFor, parseAlternativeComparisonChecklistJson } from "../shared/alternative-comparison-checklist";
import type { AlternativeComparisonChecklistEntry } from "../shared/alternative-comparison-checklist";
import { alternativeComparisonFreshnessFor } from "../shared/alternative-comparison-freshness";
import { alternativeComparisonBenchmarkDecisionImpactText, alternativeComparisonBenchmarkRecheckRowText, alternativeComparisonBenchmarkRecheckStatusText } from "../shared/alternative-comparison-benchmark-recheck";
import type { AlternativeComparisonBenchmarkRecheck } from "../shared/alternative-comparison-benchmark-recheck";
import { alternativeComparisonLiveCandidateFor, alternativeComparisonLiveSummaryFor } from "../shared/alternative-comparison-live-check";
import type { AlternativeComparisonLiveCandidate } from "../shared/alternative-comparison-live-check";
import { CATALOG_WATCHLIST_STORAGE_KEY, addCatalogWatchEntry, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson } from "../shared/catalog-watchlist";
import { BENCHMARK_SOURCE_KIND_LABELS, DATA_FRESHNESS_LABELS, isKnownPrice, type Part, type PhysicalEvidenceSource, type ServiceMeta } from "../shared/types";
import { benchmarkFreshnessLabelFor, benchmarkSourceCheckLabelFor } from "../shared/benchmark-evidence";
import { valueScoreText } from "../shared/value-score";
import { api } from "./api";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";

function sharedComparisonPhysicalEvidenceSources(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).flatMap((source) => {
    const note = typeof source.note === "string" && source.note.trim() ? source.note.trim() : undefined;
    if (!note || !["gpu", "case", "psu"].includes(source.category)) return [];
    const manufacturerModel = source.manufacturerModel?.trim();
    const manufacturerRevision = source.manufacturerRevision?.trim();
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : undefined;
    const url = safeHttpsUrl(source.url);
    return [{ category: source.category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) } satisfies PhysicalEvidenceSource];
  });
}

function sharedComparisonPhysicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

function sharedComparisonPhysicalEvidenceSourceIdentity(source: PhysicalEvidenceSource) {
  return `${sharedComparisonPhysicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}`;
}

function SharedComparisonPhysicalEvidenceSources({ sources }: { sources: PhysicalEvidenceSource[] | undefined }) {
  const safeSources = sharedComparisonPhysicalEvidenceSources(sources);
  return safeSources.length > 0
    ? <div className="shared-comparison-physical-sources" aria-label="장착 정보 출처">{safeSources.map((source) => <small key={`${source.category}-${source.note}-${source.url ?? ""}`}><b>{sharedComparisonPhysicalEvidenceSourceIdentity(source)}</b> {source.note}{source.updatedAt ? ` · 확인 갱신 ${new Date(source.updatedAt).toLocaleDateString("ko-KR")}` : ""}{source.url && <a href={source.url} target="_blank" rel="noreferrer">제조사 페이지 <FiExternalLink /></a>}</small>)}</div>
    : <small>등록된 출처 메모 없음</small>;
}

function sharedDataFreshnessLabel(value: AlternativeComparisonCandidate["dataFreshness"]) {
  return value ? DATA_FRESHNESS_LABELS[value] : undefined;
}

function SharedComparisonSimilarityEvidence({ evidence }: { evidence: AlternativeComparisonSimilarityEvidence }) {
  const summary = alternativeComparisonSimilarityEvidenceTextFor(evidence);
  return <div className="shared-comparison-similarity-evidence" aria-label="성능 비교 구조화 정보"><strong>{summary ?? "정보 기록 없음"}</strong>{evidence.reference && <small>참조 부품 · {evidence.reference.partName} · {evidence.reference.dataQuality} · 갱신 {evidence.reference.updatedAt}</small>}{evidence.dimensions && evidence.dimensions.length > 0 && <ul>{evidence.dimensions.map((dimension) => <li key={dimension.key}><span>{dimension.label}</span><b>{dimension.currentValue} → {dimension.candidateValue}</b>{dimension.source === "model_reference" && <em>모델 참조</em>}</li>)}</ul>}{evidence.notes?.map((note) => <small key={note}>{note}</small>)}</div>;
}

function sharedBenchmarkEvidenceStatusLabel(status: AlternativeComparisonBenchmarkEvidence["status"]) {
  return status === "complete" ? "완전 자료" : status === "partial" ? "부분 자료" : "점수 없음";
}

function SharedComparisonBenchmarkEvidence({ evidence }: { evidence: AlternativeComparisonBenchmarkEvidence }) {
  const sourceUrl = safeHttpsUrl(evidence.provenance?.sourceUrl);
  return <div className={`shared-comparison-benchmark-evidence ${evidence.status}`} data-testid="shared-comparison-benchmark-evidence" aria-label={`${evidence.name} 원본 성능 정보`}>
    <strong>{sharedBenchmarkEvidenceStatusLabel(evidence.status)} · {evidence.presentCount}/{evidence.totalCount}개</strong>
    <div className="shared-comparison-benchmark-scores">{evidence.rows.map((row) => <span key={row.key}><em>{row.label}</em><b>{row.value === undefined ? "확인 필요" : `${row.value.toLocaleString("ko-KR")}${row.unit}`}</b></span>)}</div>
    <small>출처 · {evidence.provenance ? `${BENCHMARK_SOURCE_KIND_LABELS[evidence.provenance.sourceKind]} · ${evidence.provenance.sourceNote}` : "출처 없음"}</small>
    <small>출처 확인 · {benchmarkSourceCheckLabelFor(evidence.sourceCheck)}{evidence.sourceCheck?.detail ? ` · ${evidence.sourceCheck.detail}` : ""}</small>
    <small>자료 · {benchmarkFreshnessLabelFor(evidence.benchmarkFreshness)} · 데이터 갱신 {evidence.dataUpdatedAt}</small>
    {sourceUrl && <a className="shared-comparison-source" href={sourceUrl} target="_blank" rel="noreferrer">벤치마크 출처 보기 <FiExternalLink /></a>}
  </div>;
}

function sharedBenchmarkRecheckDetail(recheck: AlternativeComparisonBenchmarkRecheck) {
  if (recheck.status === "same") return "공유 당시 점수와 현재 카탈로그 점수가 일치합니다.";
  if (recheck.status === "current_unavailable") return "현재 부품을 확인할 수 없어 공유 저장본과 대조하지 못했습니다.";
  if (recheck.status === "current_missing") return "현재 카탈로그에 벤치마크 점수가 없어 공유 당시 값과 대조가 필요합니다.";
  if (recheck.status === "current_incomplete") return "현재 카탈로그에 일부 점수만 있어 완전한 벤치마크 세트로 확인하지 못했습니다.";
  const facts = [
    recheck.changedRowCount > 0 ? `점수 ${recheck.changedRowCount}개 변경` : undefined,
    recheck.sourceChanged ? "출처 변경" : undefined,
    recheck.benchmarkDateChanged ? "자료 갱신 시각 변경" : undefined,
    recheck.sourceCheckNeedsReview ? "출처 재확인 필요" : undefined,
    recheck.freshnessNeedsReview ? "자료 갱신 권장" : undefined
  ].filter((value): value is string => Boolean(value));
  return facts.length > 0 ? facts.join(" · ") : "현재 벤치마크 정보를 다시 확인해야 합니다.";
}

function SharedComparisonBenchmarkRecheck({ recheck }: { recheck: AlternativeComparisonBenchmarkRecheck }) {
  if (recheck.status === "not_recorded") return null;
  return <div className={`shared-comparison-live-benchmark-recheck ${recheck.status}`} data-testid="shared-comparison-live-benchmark-recheck" aria-label="현재 벤치마크 재확인 결과">
    <div><span>benchmark · {alternativeComparisonBenchmarkRecheckStatusText(recheck.status)}</span>{recheck.needsRecheck && <b>재확인</b>}</div>
    {recheck.rows.length > 0 && <div className="shared-comparison-live-benchmark-rows">{recheck.rows.map((row) => <small className={row.changed ? "changed" : undefined} key={row.key}>{alternativeComparisonBenchmarkRecheckRowText(row)}</small>)}</div>}
    <small>{sharedBenchmarkRecheckDetail(recheck)}</small><small className={`shared-comparison-live-benchmark-impact ${recheck.benchmarkDecisionImpact}`}>판단 영향 · {alternativeComparisonBenchmarkDecisionImpactText(recheck.benchmarkDecisionImpact)}</small>
  </div>;
}

function sharedScenarioStatusLabel(status: NonNullable<AlternativeComparisonCandidate["scenario"]>["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function sharedScenarioRiskText(scenario: AlternativeComparisonCandidate["scenario"]) {
  return scenario ? `차단 ${scenario.blockerCount}개 · 주의 ${scenario.warningCount}개 · 확인 필요 ${scenario.unknownCount}개` : "미리 적용 기록 없음";
}

function sharedScenarioPriceText(scenario: AlternativeComparisonCandidate["scenario"]) {
  if (!scenario || scenario.priceDeltaWon === undefined) return "가격 변화 확인 필요";
  return scenario.priceDeltaWon === 0 ? "현재와 동일" : `${scenario.priceDeltaWon > 0 ? "+" : ""}${scenario.priceDeltaWon.toLocaleString("ko-KR")}원`;
}

function sharedScenarioHistoryText(scenario: AlternativeComparisonCandidate["scenario"]) {
  const history = scenario?.priceHistory;
  if (!history || history.sampleCount === 0) return "가격 이력 없음";
  return `${history.windowDays}일 · ${history.sampleCount}회${history.minPriceWon !== undefined ? ` · 최저 ${history.minPriceWon.toLocaleString("ko-KR")}원` : ""}${history.currentPositionPercent !== undefined ? ` · 현재 위치 ${history.currentPositionPercent.toFixed(1)}%` : ""}`;
}

function sharedScenarioTradeoffStatus(tradeoff: NonNullable<NonNullable<AlternativeComparisonCandidate["scenario"]>["tradeoff"]>) {
  return tradeoff.eligible === false ? "비교 제외" : tradeoff.frontier ? "비교 우위" : "밀림";
}

function sharedScenarioTradeoffFacts(tradeoff: NonNullable<NonNullable<AlternativeComparisonCandidate["scenario"]>["tradeoff"]>) {
  return [
    tradeoff.riskScore !== undefined ? `위험 ${tradeoff.riskScore}점` : "위험 확인 필요",
    tradeoff.priceDeltaWon !== undefined ? `가격 변화 ${tradeoff.priceDeltaWon > 0 ? "+" : ""}${tradeoff.priceDeltaWon.toLocaleString("ko-KR")}원` : "가격 변화 확인 필요",
    tradeoff.analysisScore !== undefined ? `분석 ${tradeoff.analysisScore}점` : "분석 확인 필요",
    tradeoff.evidenceScore !== undefined ? `정보 ${tradeoff.evidenceScore}점` : "정보 확인 필요"
  ].join(" · ");
}

function sharedComparisonValueScoreText(candidate: AlternativeComparisonCandidate) {
  return candidate.valueScore !== undefined && candidate.valueLabel ? `${candidate.valueLabel} ${valueScoreText(candidate.valueScore)}` : "산정 불가";
}

function sharedScenarioCheckStatusLabel(status: AlternativeComparisonChecklistEntry["status"]) {
  return status === "ready" ? "확인됨" : status === "review" ? "확인 필요" : "차단";
}

function sharedScenarioChecklistStorageKey(comparisonId: string) {
  return `pc-supporter-alternative-comparison-checklist:${comparisonId}`;
}

function sharedCatalogCandidateUrl(candidate: AlternativeComparisonCandidate) {
  if (!candidate.category || !candidate.partId) return undefined;
  return `/catalog?category=${encodeURIComponent(candidate.category)}&partId=${encodeURIComponent(candidate.partId)}&q=${encodeURIComponent(candidate.name)}`;
}

function sharedLiveCandidateStatusLabel(status: AlternativeComparisonLiveCandidate["status"]) {
  return status === "loading" ? "현재 기준 확인 중" : status === "available" ? "현재 카탈로그 확인됨" : status === "missing" ? "현재 카탈로그에서 찾지 못함" : status === "mismatch" ? "범주 불일치" : status === "error" ? "확인 실패" : "legacy · 식별자 없음";
}

function sharedLiveCandidateStatusTone(status: AlternativeComparisonLiveCandidate["status"]) {
  return status === "available" ? "available" : status === "loading" ? "loading" : status === "legacy" ? "legacy" : "review";
}

function sharedLivePriceText(row: AlternativeComparisonLiveCandidate) {
  const sharedPrice = row.candidate.priceWon;
  const currentPrice = row.currentPart?.priceWon;
  if (isKnownPrice(sharedPrice) && isKnownPrice(currentPrice) && row.priceDeltaWon !== undefined) {
    return `공유 당시 ${sharedPrice.toLocaleString("ko-KR")}원 → 현재 ${currentPrice.toLocaleString("ko-KR")}원${row.priceDeltaWon === 0 ? " · 동일" : ` · ${row.priceDeltaWon > 0 ? "+" : ""}${row.priceDeltaWon.toLocaleString("ko-KR")}원`}`;
  }
  if (isKnownPrice(currentPrice)) return `현재 카탈로그 ${currentPrice.toLocaleString("ko-KR")}원 · 공유 당시 숫자 가격 없음`;
  if (isKnownPrice(sharedPrice)) return `공유 당시 ${sharedPrice.toLocaleString("ko-KR")}원 · 현재 가격 확인 필요`;
  return "공유·현재 가격 확인 필요";
}

function SharedLiveWatchControl({ part, onToast }: { part: Part; onToast: (message: string) => void }) {
  const [watching, setWatching] = useState(() => catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "part", itemId: part.id }));

  useEffect(() => {
    setWatching(catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "part", itemId: part.id }));
  }, [part.id]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_WATCHLIST_STORAGE_KEY) return;
      setWatching(catalogWatchlistContains(catalogWatchlistFromJson(event.newValue), { kind: "part", itemId: part.id }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [part.id]);

  function register() {
    if (watching) return;
    try {
      const current = catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY));
      if (catalogWatchlistContains(current, { kind: "part", itemId: part.id })) {
        setWatching(true);
        onToast("이미 가격 추적 중인 부품입니다.");
        return;
      }
      const next = addCatalogWatchEntry(current, { itemId: part.id, itemName: part.name, category: part.category, kind: "part", addedAt: new Date().toISOString() });
      window.localStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(next));
      setWatching(true);
      onToast(`${part.name}을(를) 가격 추적에 등록했습니다.`);
    } catch {
      onToast("가격 추적 목록에 부품을 등록하지 못했습니다.");
    }
  }

  return <button className={watching ? "text-button shared-comparison-live-watch watched" : "text-button shared-comparison-live-watch"} type="button" data-item-id={part.id} onClick={register} disabled={watching} aria-label={`${part.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "가격 추적 중" : "가격 추적 추가"}</button>;
}

type SharedChecklistTransferPreview = {
  checkedIds: string[];
  ignoredIds: string[];
  itemKeys: string[];
  exportedAt?: string;
};

function SharedComparisonBaseline({ snapshot }: { snapshot: AlternativeComparisonSnapshot }) {
  const hasBaseline = Boolean(snapshot.currentPartName || snapshot.currentPartSummary || snapshot.currentPartPrice);
  const hasSimilarityEvidence = snapshot.candidates.some((candidate) => candidate.similarityEvidence);
  const hasBenchmarkEvidence = snapshot.candidates.some((candidate) => candidate.benchmarkEvidence);
  if (!hasBaseline && !hasSimilarityEvidence && !hasBenchmarkEvidence) return null;
  return <>
    {hasBaseline && <section className="shared-comparison-baseline" data-testid="shared-comparison-baseline" aria-label="공유 부품 비교 현재 기준선"><div><p className="eyebrow">COMPARISON BASELINE</p><strong>현재 기준선</strong><span>{snapshot.currentPartName ?? "기준 부품 정보 없음"}</span></div><div>{snapshot.currentPartSummary && <small>{snapshot.currentPartSummary}</small>}{snapshot.currentPartPrice && <em>{snapshot.currentPartPrice}</em>}</div></section>}
    {hasSimilarityEvidence && <section className="shared-comparison-similarity-panel" data-testid="shared-comparison-similarity-evidence" aria-label="공유된 성능 비교 정보"><div className="shared-comparison-similarity-panel-heading"><div><p className="eyebrow">EVIDENCE PRESERVED</p><h3>성능 비교 정보 보존</h3><small>공유 당시 유사도에 사용한 공통 지표와 모델 참조를 함께 남깁니다.</small></div><span>{snapshot.candidates.filter((candidate) => candidate.similarityEvidence).length}개 부품</span></div><div className="shared-comparison-similarity-panel-grid">{snapshot.candidates.map((candidate) => <article key={`${candidate.name}-similarity-panel`}><strong>{candidate.name}</strong>{candidate.similarityEvidence ? <SharedComparisonSimilarityEvidence evidence={candidate.similarityEvidence} /> : <small>구조화된 비교 정보 기록 없음</small>}</article>)}</div><p className="shared-comparison-similarity-panel-note"><FiInfo /> 모델 참조가 포함된 지표는 선택 부품의 직접 측정값이 아니라 같은 모델 계열 카탈로그 참조값입니다. 실제 성능·FPS는 보장하지 않습니다.</p></section>}
    {hasBenchmarkEvidence && <section className="shared-comparison-benchmark-panel" data-testid="shared-comparison-benchmark-evidence-panel" aria-label="공유된 원본 성능 정보"><div className="shared-comparison-benchmark-panel-heading"><div><p className="eyebrow">BENCHMARK PRESERVED</p><h3>원본 성능 정보 보존</h3><small>공유 당시 카드와 상세 화면에서 확인한 CPU·GPU 점수, 출처와 확인 상태를 함께 남깁니다.</small></div><span>{snapshot.candidates.filter((candidate) => candidate.benchmarkEvidence).length}개 부품</span></div><div className="shared-comparison-benchmark-panel-grid">{snapshot.candidates.map((candidate) => <article key={`${candidate.name}-benchmark-panel`}><strong>{candidate.name}</strong>{candidate.benchmarkEvidence ? <SharedComparisonBenchmarkEvidence evidence={candidate.benchmarkEvidence} /> : <small>원본 성능 정보 기록 없음</small>}</article>)}</div><p className="shared-comparison-benchmark-panel-note"><FiInfo /> 성능 점수는 측정 설정·드라이버·시스템 조건에 따라 달라지는 참고값입니다. 공유 저장본의 점수와 출처는 생성 당시 기록이며, 현재 카탈로그와 달라질 수 있습니다.</p></section>}
  </>;
}

export function SharedAlternativeComparisonView({ onBack, onToast }: { onBack: () => void; onToast: (message: string) => void }) {
  const comparisonId = window.location.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const [snapshot, setSnapshot] = useState<AlternativeComparisonSnapshot | null>(null);
  const [currentMeta, setCurrentMeta] = useState<ServiceMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const mountedRef = useRef(true);
  const checklistStorageKey = sharedScenarioChecklistStorageKey(comparisonId);
  const [checkedChecklistIds, setCheckedChecklistIds] = useState<string[]>(() => alternativeComparisonChecklistCheckedIdsFromJson(window.localStorage.getItem(checklistStorageKey)));
  const checklistTransferInputRef = useRef<HTMLInputElement>(null);
  const [checklistTransferPreview, setChecklistTransferPreview] = useState<SharedChecklistTransferPreview | null>(null);
  const [checklistActionMessage, setChecklistActionMessage] = useState<string | null>(null);
  const checklistEntries = useMemo(() => alternativeComparisonChecklistEntriesFor(snapshot?.candidates ?? []), [snapshot]);
  const checkedChecklistIdSet = useMemo(() => new Set(checkedChecklistIds), [checkedChecklistIds]);
  const checklistProgress = useMemo(() => alternativeComparisonChecklistProgressFor(checklistEntries, checkedChecklistIdSet), [checklistEntries, checkedChecklistIdSet]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    void api<AlternativeComparisonSnapshot>(`/api/comparisons/${encodeURIComponent(comparisonId)}`, { signal: controller.signal })
      .then((value) => { if (!cancelled) { setSnapshot(value); setError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "공유 부품 비교를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [comparisonId, retryNonce]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void api<ServiceMeta>("/api/meta", { retry: 1, signal: controller.signal })
      .then((value) => { if (!cancelled) setCurrentMeta(value); })
      .catch(() => { if (!cancelled) setCurrentMeta(null); });
    return () => { cancelled = true; controller.abort(); };
  }, []);

  useEffect(() => {
    setCheckedChecklistIds(alternativeComparisonChecklistCheckedIdsFromJson(window.localStorage.getItem(checklistStorageKey)));
    setChecklistTransferPreview(null);
    setChecklistActionMessage(null);
  }, [checklistStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(checklistStorageKey, alternativeComparisonChecklistCheckedIdsToJson(checkedChecklistIds));
    } catch {
      // Local progress is optional and must not prevent the shared snapshot from loading.
    }
  }, [checkedChecklistIds, checklistStorageKey]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === checklistStorageKey) setCheckedChecklistIds(alternativeComparisonChecklistCheckedIdsFromJson(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [checklistStorageKey]);

  function toggleChecklist(entry: AlternativeComparisonChecklistEntry, checked: boolean) {
    setCheckedChecklistIds((current) => alternativeComparisonChecklistToggle(current, entry, checked));
  }

  function downloadChecklist() {
    if (checklistEntries.length === 0) return;
    const content = alternativeComparisonChecklistJsonFor(comparisonId, checklistEntries, checkedChecklistIdSet);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-alternative-comparison-checklist-${comparisonId}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    setChecklistActionMessage("구매 전 확인 체크리스트 JSON을 저장했습니다.");
  }

  async function importChecklistFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > LOCAL_IMPORT_MAX_BYTES) {
      setChecklistActionMessage("부품 비교 체크리스트 JSON은 1MB 이하 파일만 가져올 수 있습니다.");
      setChecklistTransferPreview(null);
      return;
    }
    try {
      const parsed = parseAlternativeComparisonChecklistJson(await file.text(), comparisonId, checklistEntries);
      if (parsed.errors.length > 0) {
        setChecklistActionMessage(parsed.errors[0]);
        setChecklistTransferPreview(null);
        return;
      }
      setChecklistTransferPreview({ checkedIds: parsed.checkedIds, ignoredIds: parsed.ignoredIds, itemKeys: parsed.itemKeys, exportedAt: parsed.exportedAt });
      setChecklistActionMessage(null);
    } catch {
      setChecklistActionMessage("부품 비교 체크리스트 JSON 파일을 읽지 못했습니다.");
      setChecklistTransferPreview(null);
    }
  }

  function applyChecklistTransferPreview() {
    if (!checklistTransferPreview) return;
    if (!alternativeComparisonChecklistTransferMatchesCurrentFor(checklistEntries.map((entry) => entry.key), checklistTransferPreview.itemKeys)) {
      setChecklistTransferPreview(null);
      setChecklistActionMessage("공유 저장본의 확인 항목이 달라져 체크리스트를 가져올 수 없습니다. 같은 공유 링크에서 다시 내보내 주세요.");
      return;
    }
    setCheckedChecklistIds(checklistTransferPreview.checkedIds);
    setChecklistActionMessage(`구매 전 확인 ${checklistTransferPreview.checkedIds.length}개 완료 상태를 가져왔습니다.${checklistTransferPreview.ignoredIds.length > 0 ? ` 차단·현재 없는 항목 ${checklistTransferPreview.ignoredIds.length}개는 무시했습니다.` : ""}`);
    setChecklistTransferPreview(null);
  }

  const checklistTransferDiff = checklistTransferPreview ? alternativeComparisonChecklistTransferDiffFor(checkedChecklistIds, checklistTransferPreview.checkedIds) : null;
  const comparisonFreshness = snapshot ? alternativeComparisonFreshnessFor(snapshot, currentMeta) : null;
  const candidatePartIds = useMemo(() => Array.from(new Set((snapshot?.candidates ?? []).map((candidate) => candidate.partId).filter((partId): partId is string => Boolean(partId)))), [snapshot]);
  const [liveCandidateParts, setLiveCandidateParts] = useState<Record<string, Part>>({});
  const [liveMissingCandidateIds, setLiveMissingCandidateIds] = useState<string[]>([]);
  const [liveCheckLoading, setLiveCheckLoading] = useState(false);
  const [liveCheckError, setLiveCheckError] = useState<string | null>(null);
  const [liveCheckedAt, setLiveCheckedAt] = useState<string | null>(null);
  const [liveCheckNonce, setLiveCheckNonce] = useState(0);
  const liveCandidateRows = useMemo(() => (snapshot?.candidates ?? []).map((candidate) => alternativeComparisonLiveCandidateFor(candidate, liveCandidateParts, liveMissingCandidateIds, liveCheckLoading, liveCheckError)), [liveCandidateParts, liveCheckError, liveCheckLoading, liveMissingCandidateIds, snapshot]);
  const liveCandidateSummary = useMemo(() => alternativeComparisonLiveSummaryFor(liveCandidateRows), [liveCandidateRows]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (candidatePartIds.length === 0) {
      setLiveCandidateParts({});
      setLiveMissingCandidateIds([]);
      setLiveCheckError(null);
      setLiveCheckLoading(false);
      setLiveCheckedAt(null);
      return () => { cancelled = true; };
    }
    setLiveCandidateParts({});
    setLiveMissingCandidateIds([]);
    setLiveCheckLoading(true);
    setLiveCheckError(null);
    setLiveCheckedAt(null);
    void api<{ items: Part[]; missingIds: string[] }>(`/api/parts/batch?ids=${encodeURIComponent(candidatePartIds.join(","))}`, { retry: 1, signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        setLiveCandidateParts(Object.fromEntries((payload.items ?? []).map((part) => [part.id, part])));
        setLiveMissingCandidateIds(Array.isArray(payload.missingIds) ? payload.missingIds : []);
        setLiveCheckedAt(new Date().toISOString());
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLiveCandidateParts({});
          setLiveMissingCandidateIds([]);
          setLiveCheckError(reason instanceof Error ? reason.message : "현재 카탈로그 부품을 확인하지 못했습니다.");
          setLiveCheckedAt(new Date().toISOString());
        }
      })
      .finally(() => { if (!cancelled) setLiveCheckLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [candidatePartIds, liveCheckNonce]);

  async function copySnapshot() {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(alternativeComparisonTextFor(snapshot.candidates, {
        category: snapshot.category,
        currentPartName: snapshot.currentPartName,
        currentPartSummary: snapshot.currentPartSummary,
        currentPartPrice: snapshot.currentPartPrice
      }));
      if (mountedRef.current) onToast("공유 부품 비교표를 클립보드에 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("공유 부품 비교표 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  function downloadSnapshot(format: "csv" | "json") {
    if (!snapshot) return;
    const exportContext = {
      category: snapshot.category,
      currentPartName: snapshot.currentPartName,
      currentPartSummary: snapshot.currentPartSummary,
      currentPartPrice: snapshot.currentPartPrice
    };
    const content = format === "csv" ? alternativeComparisonCsvFor(snapshot.candidates, exportContext) : alternativeComparisonJsonFor(snapshot.candidates, exportContext);
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-shared-comparison-${comparisonId}-${new Date().toISOString().slice(0, 10)}.${format}`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    onToast(`공유 부품 비교표 ${format.toUpperCase()}를 저장했습니다.`);
  }

  return <div className="shared-comparison-page"><div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">SHARED COMPARISON</p><h1>{snapshot?.name ?? (loading ? "공유 부품 비교를 불러오는 중" : "공유 부품 비교")}</h1><p>공유된 대체 부품 비교 결과를 읽기 전용으로 확인합니다.</p></div><span className="admin-badge"><FiShare2 /> 읽기 전용</span></div>{loading ? <div className="shared-comparison-state"><FiLoader className="spin" /> 공유 부품 비교를 불러오는 중...</div> : error ? <div className="shared-comparison-state error" role="alert"><FiXCircle /><span>{error}</span><div className="shared-comparison-error-actions"><button className="button button-light" type="button" data-testid="shared-comparison-retry" onClick={() => setRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 시도</button><button className="text-button" type="button" onClick={onBack}>홈으로</button></div></div> : snapshot && <section className="shared-comparison-card" aria-label="공유 부품 비교"><div className="shared-comparison-card-heading"><div><p className="eyebrow">COMPARISON SNAPSHOT</p><h2>{snapshot.name}</h2><small>{snapshot.category ? `${snapshot.category} · ` : ""}{snapshot.currentPartName ? `현재 기준 ${snapshot.currentPartName} · ` : ""}생성 {new Date(snapshot.createdAt).toLocaleString("ko-KR")} · {snapshot.expiresAt ? `만료 ${new Date(snapshot.expiresAt).toLocaleString("ko-KR")}` : "무기한"}</small></div>{comparisonFreshness && <div className={`shared-comparison-freshness ${comparisonFreshness.tone}`} role="status"><strong>{comparisonFreshness.label}</strong><small>{comparisonFreshness.detail}</small></div>}<div className="shared-comparison-actions"><button className="button button-light" type="button" onClick={() => void copySnapshot()}><FiCopy /> 비교 복사</button><button className="button button-light" type="button" onClick={() => downloadSnapshot("csv")}><FiDownload /> CSV 저장</button><button className="button button-light" type="button" onClick={() => downloadSnapshot("json")}><FiDownload /> JSON 저장</button></div></div><SharedComparisonBaseline snapshot={snapshot} />{candidatePartIds.length > 0 && <section className="shared-comparison-live-check" aria-label="현재 카탈로그 재확인" data-testid="shared-comparison-live-check"><div className="shared-comparison-live-check-heading"><div><div><p className="eyebrow">CURRENT CATALOG CHECK</p><h3>현재 카탈로그 재확인</h3><small>공유 당시 저장된 부품 ID를 현재 카탈로그에서 다시 조회합니다. 실시간 판매가나 재고를 보장하지 않습니다.</small></div><div className="shared-comparison-live-check-heading-actions"><span>{liveCandidateSummary.available} / {liveCandidateSummary.identifiable}개 ID 확인</span>{liveCandidateSummary.priceChanged > 0 && <span className="price-changed">가격 변경 {liveCandidateSummary.priceChanged}개</span>}{liveCandidateSummary.benchmarkChanged > 0 && <span className="benchmark-changed">벤치마크 변경 {liveCandidateSummary.benchmarkChanged}개</span>}{liveCandidateSummary.benchmarkUnavailable + liveCandidateSummary.benchmarkMissing + liveCandidateSummary.benchmarkIncomplete + liveCandidateSummary.benchmarkNeedsReview > 0 && <span className="benchmark-review">벤치마크 재확인 {liveCandidateSummary.benchmarkUnavailable + liveCandidateSummary.benchmarkMissing + liveCandidateSummary.benchmarkIncomplete + liveCandidateSummary.benchmarkNeedsReview}개</span>}{liveCheckedAt && <small>마지막 확인 {new Date(liveCheckedAt).toLocaleString("ko-KR")}</small>}<button className="button button-light" type="button" onClick={() => setLiveCheckNonce((current) => current + 1)} disabled={liveCheckLoading}>{liveCheckLoading ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 현재 기준 다시 확인</>}</button></div></div></div>{liveCandidateSummary.needsRecheck && !liveCheckLoading && <p className="shared-comparison-live-check-warning" role="status"><FiInfo /> 현재 카탈로그·가격·벤치마크 정보 기준이 공유 당시와 다르거나 일부 확인되지 않았습니다. 공유 당시 구매 판단을 그대로 확정하지 말고 부품을 다시 검토하세요.</p>}{liveCheckError && <p className="shared-comparison-live-check-error" role="alert"><FiXCircle /> {liveCheckError}</p>}<div className="shared-comparison-live-check-grid">{liveCandidateRows.map((row) => { const catalogUrl = sharedCatalogCandidateUrl(row.candidate); return <article className={`shared-comparison-live-item ${sharedLiveCandidateStatusTone(row.status)} ${row.priceChange}`} key={`${row.candidate.name}-live-check`}><div><strong>{row.candidate.name}</strong><span>{sharedLiveCandidateStatusLabel(row.status)}</span></div>{row.candidate.partId && <small>부품 ID · {row.candidate.partId}{row.candidate.category ? ` · ${row.candidate.category}` : ""}</small>}<small>{sharedLivePriceText(row)}</small>{row.benchmarkRecheck && <SharedComparisonBenchmarkRecheck recheck={row.benchmarkRecheck} />}{row.currentPart?.dataFreshness && <small>현재 데이터 상태 · {DATA_FRESHNESS_LABELS[row.currentPart.dataFreshness]}</small>}{row.currentPart?.updatedAt && <small>현재 데이터 갱신 · {row.currentPart.updatedAt}</small>}{catalogUrl && <a className="shared-comparison-catalog-link" href={catalogUrl}>현재 카탈로그에서 열기 <FiExternalLink /></a>}{row.status === "available" && row.currentPart && <SharedLiveWatchControl part={row.currentPart} onToast={onToast} />}</article>; })}</div></section>}<div className="shared-comparison-table-wrap"><table><caption>공유 당시 저장된 부품의 가격·성능·호환 정보입니다.</caption><thead><tr><th scope="col">비교 항목</th>{snapshot.candidates.map((candidate) => <th scope="col" key={candidate.name}><span>{candidate.name}</span>{sharedCatalogCandidateUrl(candidate) && <a className="shared-comparison-catalog-link" href={sharedCatalogCandidateUrl(candidate)}>카탈로그 확인 <FiExternalLink /></a>}</th>)}</tr></thead><tbody><tr><th scope="row">핵심 스펙</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-summary`}>{candidate.summary}</td>)}</tr><tr><th scope="row">가격</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-price`}>{candidate.price}{candidate.recommendedQuantity !== undefined && <small>추천 킷 {candidate.recommendedQuantity}개</small>}</td>)}</tr>{snapshot.candidates.some((candidate) => candidate.purchaseCondition) && <tr><th scope="row">구매 조건</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-purchase`}>{candidate.purchaseCondition ?? "확인 필요"}</td>)}</tr>}<tr><th scope="row">성능 유사도</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-similarity`}>{candidate.similarity}</td>)}</tr>{snapshot.candidates.some((candidate) => candidate.valueScore !== undefined && candidate.valueLabel) && <tr><th scope="row">가격 대비 유사도</th>{snapshot.candidates.map((candidate) => <td key={candidate.name + "-value"}>{sharedComparisonValueScoreText(candidate)}</td>)}</tr>}<tr><th scope="row">성능 변화</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-performance`}>{candidate.performance}</td>)}</tr><tr><th scope="row">호환 상태</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-compatibility`}>{candidate.compatibility}</td>)}</tr>{snapshot.candidates.some((candidate) => candidate.decisionSummary) && <tr><th scope="row">판단 요약</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-decision`}>{candidate.decisionSummary ?? "산정 불가"}</td>)}</tr>}{snapshot.candidates.some((candidate) => candidate.physicalEvidence || candidate.physicalEvidenceSources?.length) && <tr><th scope="row">장착 정보</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-physical-evidence`}>{candidate.physicalEvidence ?? "확인 정보 없음"}<SharedComparisonPhysicalEvidenceSources sources={candidate.physicalEvidenceSources} /></td>)}</tr>}<tr><th scope="row">데이터</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-data`}>{candidate.dataQuality}{sharedDataFreshnessLabel(candidate.dataFreshness) ? <small>{sharedDataFreshnessLabel(candidate.dataFreshness)}</small> : null}{candidate.updatedAt ? <small>갱신 {candidate.updatedAt}</small> : null}{safeExternalUrl(candidate.sourceUrl) && <a className="shared-comparison-source" href={safeExternalUrl(candidate.sourceUrl)} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}</td>)}</tr></tbody></table></div>{checklistEntries.length > 0 && <section className="shared-comparison-checklist" aria-label="구매 전 확인 체크리스트"><div className="shared-comparison-checklist-heading"><div><p className="eyebrow">PURCHASE GATE</p><h3>구매 전 확인 체크리스트</h3><small>공유 저장본 기준의 확인 항목입니다. 체크 상태는 이 브라우저에만 저장됩니다.</small></div><strong>{checklistProgress.checked} / {checklistProgress.total}개 완료</strong></div><div className="shared-comparison-checklist-progress" role="progressbar" aria-label={`구매 전 확인 ${checklistProgress.percent}% 완료`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={checklistProgress.percent}><span style={{ width: checklistProgress.percent + "%" }} /></div><div className="shared-comparison-checklist-summary"><span>확인됨 {checklistProgress.ready}</span><span>확인 필요 {checklistProgress.review}</span><span>차단 {checklistProgress.blocked}</span><span>남음 {checklistProgress.remaining}</span></div><div className="shared-comparison-checklist-actions"><button className="text-button" type="button" onClick={downloadChecklist}><FiDownload /> JSON 저장</button><input ref={checklistTransferInputRef} className="shared-comparison-checklist-transfer-input" type="file" accept=".json,application/json" aria-label="부품 비교 체크리스트 JSON 파일 가져오기" onChange={(event) => void importChecklistFile(event)} /><button className="text-button" type="button" onClick={() => checklistTransferInputRef.current?.click()}><FiDownload /> JSON 가져오기</button>{checklistActionMessage && <p role="status">{checklistActionMessage}</p>}</div>{checklistTransferPreview && checklistTransferDiff && <div className="shared-comparison-checklist-transfer-preview" role="region" aria-label="부품 비교 체크리스트 JSON 가져오기 미리보기"><div className="shared-comparison-checklist-transfer-heading"><div><strong>체크리스트 가져오기 미리보기</strong><small>내보낸 시각 {checklistTransferPreview.exportedAt ?? "알 수 없음"} · 파일 항목 {checklistTransferPreview.itemKeys.length}개</small></div><span>확인 필요</span></div><div className="shared-comparison-checklist-transfer-stats"><span>현재 완료 <b>{checklistTransferDiff.currentCheckedCount}개</b></span><span>가져올 완료 <b>{checklistTransferDiff.incomingCheckedCount}개</b></span><span>새로 체크 <b>{checklistTransferDiff.addedCount}개</b></span><span>해제 <b>{checklistTransferDiff.removedCount}개</b></span><span>유지 <b>{checklistTransferDiff.unchangedCount}개</b></span>{checklistTransferPreview.ignoredIds.length > 0 && <span>차단·현재 없는 항목 <b>{checklistTransferPreview.ignoredIds.length}개</b></span>}</div><p>현재 완료 상태를 즉시 바꾸지 않았습니다. 아래 내용을 확인한 뒤 적용하세요.</p><div className="shared-comparison-checklist-transfer-actions"><button className="text-button" type="button" onClick={() => setChecklistTransferPreview(null)}>취소</button><button className="button button-primary" type="button" onClick={applyChecklistTransferPreview}>이 상태로 가져오기</button></div></div>}<div className="shared-comparison-checklist-grid">{snapshot.candidates.map((candidate, candidateIndex) => { const checks = checklistEntries.filter((entry) => entry.candidateIndex === candidateIndex); if (checks.length === 0) return null; return <article key={`${candidate.name}-checklist`}><strong>{candidate.name}</strong><div>{checks.map((entry) => <label className={`shared-comparison-check-item ${entry.status}`} key={entry.key}><input type="checkbox" checked={checkedChecklistIds.includes(entry.key)} disabled={entry.status === "blocked"} aria-label={candidate.name + " " + entry.label + " 완료"} onChange={(event) => toggleChecklist(entry, event.currentTarget.checked)} /><span className="shared-comparison-check-copy"><strong>{entry.label}</strong><small>{entry.detail}</small></span><em>{sharedScenarioCheckStatusLabel(entry.status)}</em></label>)}</div></article>; })}</div><p className="shared-comparison-checklist-note"><FiCheckCircle /> 확인 체크는 이 브라우저와 이 공유 ID에만 저장되며, 원본 저장본이나 다른 사용자의 진행률은 바꾸지 않습니다. 차단 항목은 실제 견적 적용 전에 원인을 해결해야 하므로 체크할 수 없습니다.</p></section>}{snapshot.candidates.some((candidate) => candidate.scenario?.tradeoff) && <section className="shared-comparison-tradeoff" data-testid="shared-comparison-tradeoff" aria-label="공유된 부품 비교 우위"><div className="shared-comparison-tradeoff-heading"><div><p className="eyebrow">SHARED TRADEOFF</p><h3>공유된 부품 비교 우위</h3><small>공유 당시 미리 적용 결과의 비용·위험·분석·정보 비교를 보존합니다.</small></div><span>{snapshot.candidates.filter((candidate) => candidate.scenario?.tradeoff?.frontier && candidate.scenario.tradeoff.eligible !== false).length}개 부품</span></div><div className="shared-comparison-tradeoff-grid">{snapshot.candidates.map((candidate) => { const tradeoff = candidate.scenario?.tradeoff; if (!tradeoff) return null; return <article className={tradeoff.eligible === false ? "excluded" : tradeoff.frontier ? "frontier" : "dominated"} key={candidate.name + "-tradeoff"}><div><span>{sharedScenarioTradeoffStatus(tradeoff)}</span><strong>{candidate.name}</strong></div><small>{sharedScenarioTradeoffFacts(tradeoff)}</small><p>{tradeoff.reason}</p></article>; })}</div><p className="shared-comparison-tradeoff-note"><FiInfo /> 가격·분석 정보가 일부 없는 부품 사이의 우위는 공유 저장본에서도 정하지 않아요. 현재 카탈로그 재확인 결과가 다르면 부품을 다시 검토하세요.</p></section>}{snapshot.candidates.some((candidate) => candidate.scenario) && <section className="shared-comparison-scenario" aria-label="공유된 미리 적용 판단"><div className="shared-comparison-scenario-heading"><div><p className="eyebrow">SHARED WHAT-IF</p><h3>공유된 미리 적용·구매 판단</h3><small>공유 당시의 미리 검사와 가격 이력 요약을 보존한 읽기 전용 정보입니다.</small></div></div><div className="shared-comparison-scenario-grid">{snapshot.candidates.map((candidate) => <article key={`${candidate.name}-scenario`}><div><strong>{candidate.name}</strong><span>{candidate.scenario?.purchaseDecision ?? "판단 기록 없음"}</span></div><p>{candidate.scenario?.purchaseDecisionSummary ?? "미리 적용 판단이 저장되지 않았습니다."}</p><small>가상 결과 · {candidate.scenario ? sharedScenarioStatusLabel(candidate.scenario.status) : "기록 없음"} · {sharedScenarioRiskText(candidate.scenario)}</small><small>가격 변화 · {sharedScenarioPriceText(candidate.scenario)} · 가격 이력 · {sharedScenarioHistoryText(candidate.scenario)}</small></article>)}</div></section>}<p className="shared-comparison-note"><FiInfo /> 이 링크는 부품 비교 저장본을 읽기 전용으로 보여줍니다. 공유받은 사용자는 현재 견적에 부품을 자동 적용할 수 없습니다.</p></section>}</div>;
}
