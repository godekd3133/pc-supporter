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
import { api } from "./api";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";
import { eul } from "../shared/josa";

function SharedComparisonBenchmarkEvidence({ evidence }: { evidence: AlternativeComparisonBenchmarkEvidence }) {
  return <div className="shared-comparison-benchmark-evidence" data-testid="shared-comparison-benchmark-evidence" aria-label={evidence.name + " 성능 점수"}>
    <strong>성능 점수</strong>
    <div className="shared-comparison-benchmark-scores">{evidence.rows.map((row) => <span key={row.key}><em>{row.label}</em><b>{row.value === undefined ? "미등록" : row.value.toLocaleString("ko-KR") + row.unit}</b></span>)}</div>
  </div>;
}

function SharedComparisonSimilarityEvidence({ evidence }: { evidence: AlternativeComparisonSimilarityEvidence }) {
  return <div className="shared-comparison-similarity-evidence" aria-label="주요 사양 비교">
    {evidence.dimensions && evidence.dimensions.length > 0 ? <ul>{evidence.dimensions.map((dimension) => <li key={dimension.key}><span>{dimension.label}</span><b>{dimension.currentValue} → {dimension.candidateValue}</b></li>)}</ul> : <small>비교할 사양이 없어요.</small>}
  </div>;
}

function sharedScenarioStatusLabel(status: NonNullable<AlternativeComparisonCandidate["scenario"]>["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "정보 부족" : "호환 불가";
}

function sharedScenarioRiskText(scenario: AlternativeComparisonCandidate["scenario"]) {
  return scenario ? `차단 ${scenario.blockerCount}개 · 주의 ${scenario.warningCount}개 · 정보 부족 ${scenario.unknownCount}개` : "미리 적용 기록 없음";
}

function sharedScenarioPriceText(scenario: AlternativeComparisonCandidate["scenario"]) {
  if (!scenario || scenario.priceDeltaWon === undefined) return "가격 변화 정보 부족";
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

function sharedScenarioChecklistStorageKey(comparisonId: string) {
  return `pc-supporter-alternative-comparison-checklist:${comparisonId}`;
}

function sharedCatalogCandidateUrl(candidate: AlternativeComparisonCandidate) {
  if (!candidate.category || !candidate.partId) return undefined;
  return `/catalog?category=${encodeURIComponent(candidate.category)}&partId=${encodeURIComponent(candidate.partId)}&q=${encodeURIComponent(candidate.name)}`;
}

function sharedLiveCandidateStatusLabel(status: AlternativeComparisonLiveCandidate["status"]) {
  return status === "loading" ? "불러오는 중" : status === "available" ? "부품 정보 있음" : status === "missing" ? "현재 목록에 없음" : status === "mismatch" ? "부품 종류가 다름" : status === "error" ? "불러오지 못했어요" : "부품 정보 없음";
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
  if (isKnownPrice(currentPrice)) return `현재 가격 ${currentPrice.toLocaleString("ko-KR")}원 · 공유 당시 가격 정보 없음`;
  if (isKnownPrice(sharedPrice)) return `공유 당시 ${sharedPrice.toLocaleString("ko-KR")}원 · 현재 가격 정보 없음`;
  return "공유 당시와 현재 가격 정보가 없어요.";
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
      onToast(`${eul(part.name)} 가격 추적에 등록했습니다.`);
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
    {hasBaseline && <section className="shared-comparison-baseline" data-testid="shared-comparison-baseline" aria-label="공유 부품 비교 기준"><div><strong>비교 기준 부품</strong><span>{snapshot.currentPartName ?? "비교 기준 부품 정보 없음"}</span></div><div>{snapshot.currentPartSummary && <small>{snapshot.currentPartSummary}</small>}{snapshot.currentPartPrice && <em>{snapshot.currentPartPrice}</em>}</div></section>}
    {hasSimilarityEvidence && <section className="shared-comparison-similarity-panel" data-testid="shared-comparison-similarity-evidence" aria-label="공유된 성능 비교 정보"><div className="shared-comparison-similarity-panel-heading"><div><h3>주요 사양 비교</h3><small>공유 당시 비교한 주요 사양이에요.</small></div><span>{snapshot.candidates.filter((candidate) => candidate.similarityEvidence).length}개 부품</span></div><div className="shared-comparison-similarity-panel-grid">{snapshot.candidates.map((candidate) => <article key={`${candidate.name}-similarity-panel`}><strong>{candidate.name}</strong>{candidate.similarityEvidence ? <SharedComparisonSimilarityEvidence evidence={candidate.similarityEvidence} /> : <small>비교 정보 없음</small>}</article>)}</div></section>}
    {hasBenchmarkEvidence && <section className="shared-comparison-benchmark-panel" data-testid="shared-comparison-benchmark-evidence-panel" aria-label="공유된 원본 성능 정보"><div className="shared-comparison-benchmark-panel-heading"><div><h3>CPU·GPU 성능 점수</h3><small>공유 당시 비교한 CPU·GPU 점수예요.</small></div><span>{snapshot.candidates.filter((candidate) => candidate.benchmarkEvidence).length}개 부품</span></div><div className="shared-comparison-benchmark-panel-grid">{snapshot.candidates.map((candidate) => <article key={`${candidate.name}-benchmark-panel`}><strong>{candidate.name}</strong>{candidate.benchmarkEvidence ? <SharedComparisonBenchmarkEvidence evidence={candidate.benchmarkEvidence} /> : <small>성능 점수 기록 없음</small>}</article>)}</div></section>}
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

  return <div className="shared-comparison-page"><div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><h1>{snapshot?.name ?? (loading ? "공유 부품 비교를 불러오는 중" : "공유 부품 비교")}</h1><p>대체 부품의 가격·성능·호환 정보를 비교합니다.</p></div></div>{loading ? <div className="shared-comparison-state"><FiLoader className="spin" /> 공유 부품 비교를 불러오는 중...</div> : error ? <div className="shared-comparison-state error" role="alert"><FiXCircle /><span>{error}</span><div className="shared-comparison-error-actions"><button className="button button-light" type="button" data-testid="shared-comparison-retry" onClick={() => setRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 시도</button><button className="text-button" type="button" onClick={onBack}>홈으로</button></div></div> : snapshot && <section className="shared-comparison-card" aria-label="공유 부품 비교"><div className="shared-comparison-card-heading"><div><p className="eyebrow">비교 결과</p><h2>{snapshot.name}</h2><small>{snapshot.category ? `${snapshot.category} · ` : ""}{snapshot.currentPartName ? `현재 기준 ${snapshot.currentPartName} · ` : ""}생성 {new Date(snapshot.createdAt).toLocaleString("ko-KR")} · {snapshot.expiresAt ? `만료 ${new Date(snapshot.expiresAt).toLocaleString("ko-KR")}` : "무기한"}</small></div><div className="shared-comparison-actions"><button className="button button-light" type="button" onClick={() => void copySnapshot()}><FiCopy /> 비교 복사</button><button className="button button-light" type="button" onClick={() => downloadSnapshot("csv")}><FiDownload /> CSV 저장</button><button className="button button-light" type="button" onClick={() => downloadSnapshot("json")}><FiDownload /> JSON 저장</button></div></div><SharedComparisonBaseline snapshot={snapshot} />{candidatePartIds.length > 0 && <section className="shared-comparison-live-check" aria-label="최신 가격·성능" data-testid="shared-comparison-live-check"><div className="shared-comparison-live-check-heading"><div><div><h3>최신 가격·성능</h3><small>공유한 부품의 현재 가격과 성능 점수를 불러와요.</small></div><div className="shared-comparison-live-check-heading-actions">{liveCandidateSummary.priceChanged > 0 && <span className="price-changed">가격 변경 {liveCandidateSummary.priceChanged}개</span>}<button className="button button-light" type="button" onClick={() => setLiveCheckNonce((current) => current + 1)} disabled={liveCheckLoading}>{liveCheckLoading ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 최신 가격 불러오기</>}</button></div></div></div>{liveCandidateSummary.needsRecheck && !liveCheckLoading && <p className="shared-comparison-live-check-warning" role="status"><FiInfo /> 공유 당시와 가격이 달라졌어요. 아래 최신 가격을 기준으로 비교해 주세요.</p>}{liveCheckError && <p className="shared-comparison-live-check-error" role="alert"><FiXCircle /> {liveCheckError}</p>}<div className="shared-comparison-live-check-grid">{liveCandidateRows.map((row) => { const catalogUrl = sharedCatalogCandidateUrl(row.candidate); return <article className={`shared-comparison-live-item ${sharedLiveCandidateStatusTone(row.status)} ${row.priceChange}`} key={`${row.candidate.name}-live-check`}><div><strong>{row.candidate.name}</strong><span>{sharedLiveCandidateStatusLabel(row.status)}</span></div><small>{sharedLivePriceText(row)}</small>{catalogUrl && <a className="shared-comparison-catalog-link" href={catalogUrl}>현재 부품 보기 <FiExternalLink /></a>}{row.status === "available" && row.currentPart && <SharedLiveWatchControl part={row.currentPart} onToast={onToast} />}</article>; })}</div></section>}<div className="shared-comparison-table-wrap"><table><caption>공유 당시 저장된 부품의 가격·성능·호환 정보입니다.</caption><thead><tr><th scope="col">비교 항목</th>{snapshot.candidates.map((candidate) => <th scope="col" key={candidate.name}><span>{candidate.name}</span>{sharedCatalogCandidateUrl(candidate) && <a className="shared-comparison-catalog-link" href={sharedCatalogCandidateUrl(candidate)}>상품 페이지 <FiExternalLink /></a>}</th>)}</tr></thead><tbody><tr><th scope="row">핵심 스펙</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-summary`}>{candidate.summary}</td>)}</tr><tr><th scope="row">가격</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-price`}>{candidate.price}{candidate.recommendedQuantity !== undefined && <small>추천 킷 {candidate.recommendedQuantity}개</small>}</td>)}</tr><tr><th scope="row">성능 변화</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-performance`}>{candidate.performance}</td>)}</tr><tr><th scope="row">호환 상태</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-compatibility`}>{candidate.compatibility}</td>)}</tr>{snapshot.candidates.some((candidate) => candidate.physicalEvidence || candidate.physicalEvidenceSources?.length) && <tr><th scope="row">장착 정보</th>{snapshot.candidates.map((candidate) => <td key={`${candidate.name}-physical-evidence`}>{candidate.physicalEvidence ?? "확인 정보 없음"}</td>)}</tr>}</tbody></table></div></section>}</div>;
}
