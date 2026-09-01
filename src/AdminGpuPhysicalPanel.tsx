import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { FiAlertTriangle, FiCheckCircle, FiChevronDown, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLoader, FiSave, FiSearch, FiShield, FiTrash2 } from "react-icons/fi";
import type { GpuPhysicalOverride, Part, PhysicalReviewCoverage, PhysicalReviewPriority, PhysicalReviewQueue, PhysicalReviewQueueItem, PhysicalReviewWorkPackage, PhysicalSourceCheck, PhysicalSourceCheckBatchResponse, PhysicalSourceCheckHistoryEntry } from "../shared/types";
import { CATEGORY_LABELS, DATA_FRESHNESS_LABELS } from "../shared/types";
import { physicalSourceCheckFreshness } from "../shared/physical-source-check";
import { gpuPhysicalOverridesToCsv, parseGpuPhysicalOverridesCsv, type GpuPhysicalOverrideCsvItem } from "../shared/gpu-physical-csv";
import { api } from "./api";
import { safeHttpsUrl } from "./safe-source-url";

type PhysicalCategory = "gpu" | "case" | "psu";

type GpuPhysicalOverrideListItem = GpuPhysicalOverride & {
  partName: string;
  category: PhysicalCategory;
};

type GpuPhysicalOverrideValidationItem = {
  partId: string;
  partName?: string;
  category?: PhysicalCategory;
  valid: boolean;
  errors: string[];
  operation?: "create" | "update" | "unchanged";
  changedFields?: string[];
};

type GpuPhysicalOverrideValidationResponse = {
  validCount: number;
  invalidCount: number;
  items: GpuPhysicalOverrideValidationItem[];
};

const REVIEW_PRIORITY_LABELS = { high: "우선 검수", medium: "검수 권장", low: "일반 검수" } as const;
const REVIEW_STATUS_LABELS = { pending: "미검수", partial: "부분 검수", stale: "근거 재확인", reviewed: "검수 완료" } as const;
const SOURCE_CHECK_STATUS_LABELS: Record<PhysicalSourceCheck["status"], string> = { reachable: "URL 접근 가능", redirected: "리다이렉트 후 접근 가능", http_error: "HTTP 오류", unreachable: "접근 실패", blocked: "점검 차단", identity_mismatch: "모델 식별 불일치" };
const SOURCE_CHECK_IDENTITY_LABELS: Record<PhysicalSourceCheck["identityStatus"], string> = { matched: "모델 확인", not_found: "모델 미확인", manual_required: "문서 수동 확인", not_checked: "모델 점검 안 함" };
const REVIEW_QUEUE_PAGE_SIZE = 8;

function overrideValueText(item: GpuPhysicalOverrideListItem) {
  const values = [
    `제조사 ${item.manufacturerModel}${item.manufacturerRevision ? ` · ${item.manufacturerRevision}` : ""}`,
    item.gpuSlotOccupancy !== undefined ? `물리 슬롯 ${item.gpuSlotOccupancy}` : undefined,
    item.gpuCableBendClearanceMm !== undefined ? `케이블 요구 ${item.gpuCableBendClearanceMm}mm` : undefined,
    item.caseSidePanelClearanceMm !== undefined ? `측면 여유 ${item.caseSidePanelClearanceMm}mm` : undefined,
    item.psuIndependentPcieCableRuns !== undefined ? `독립 PCIe 런 ${item.psuIndependentPcieCableRuns}개` : undefined,
    item.psuPcieCableTopology === "independent" ? "분배 없음" : item.psuPcieCableTopology === "shared" ? "분배 구조" : undefined
  ].filter((value): value is string => Boolean(value));
  return values.join(" · ");
}

function sourceUrlFor(value: string) {
  return safeHttpsUrl(value);
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function physicalSourceCheckText(check: PhysicalSourceCheck | undefined) {
  if (!check) return "URL 점검 전";
  const checkedAt = Number.isFinite(Date.parse(check.checkedAt)) ? ` · ${new Date(check.checkedAt).toLocaleDateString("ko-KR")}` : "";
  const httpStatus = check.httpStatus ? ` · HTTP ${check.httpStatus}` : "";
  const freshness = physicalSourceCheckFreshness(check);
  const freshnessText = freshness === "fresh" ? "" : ` · ${DATA_FRESHNESS_LABELS[freshness]}`;
  return `${SOURCE_CHECK_STATUS_LABELS[check.status]} · ${SOURCE_CHECK_IDENTITY_LABELS[check.identityStatus]}${httpStatus}${freshnessText}${checkedAt}`;
}

function PhysicalSourceHistoryPanel({ entries, loading, error }: { entries: PhysicalSourceCheckHistoryEntry[]; loading: boolean; error: string | null }) {
  return <div className="gpu-physical-source-history" aria-label="근거 URL 점검 이력">{loading ? <span><FiLoader className="spin" /> 점검 이력을 불러오는 중...</span> : error ? <span className="error"><FiAlertTriangle /> {error}</span> : entries.length === 0 ? <span><FiInfo /> 저장된 URL 점검 이력이 없습니다.</span> : <>{entries.slice(0, 5).map((entry) => <div key={entry.id}><div><span className={`gpu-physical-history-transition ${entry.transition}`}>{entry.transition === "initial" ? "최초 점검" : entry.transition === "changed" ? "상태 변경" : "상태 유지"}</span><small>{Number.isFinite(Date.parse(entry.recordedAt)) ? new Date(entry.recordedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : entry.recordedAt}</small></div><strong>{physicalSourceCheckText(entry.sourceCheck)}</strong><small>{entry.sourceCheck.detail ?? "점검 상세 없음"}</small></div>)}</> }</div>;
}

function PhysicalReviewCoveragePanel({ coverage }: { coverage: PhysicalReviewCoverage }) {
  return <div className="gpu-physical-coverage-panel" aria-label="물리 근거 coverage"><div className="gpu-physical-coverage-heading"><div><span>PHYSICAL COVERAGE</span><strong>물리 근거 건강도</strong><small>카테고리별 검수 완료율과 제조사 근거의 갱신 상태를 같은 기준으로 보여줍니다.</small></div><span className="gpu-physical-coverage-badge">완료 {coverage.coveragePercent}%</span></div><div className="gpu-physical-coverage-stats"><span>전체 대상 <strong>{coverage.total}개</strong></span><span>검수 완료 <strong>{coverage.reviewedCount}개</strong></span><span>검수 큐 <strong>{coverage.queueCount}개</strong></span><span>근거 재확인 <strong>{coverage.staleCount}개</strong></span><span>시점 확인 필요 <strong>{coverage.unknownFreshnessCount}개</strong></span></div><div className="gpu-physical-coverage-grid">{coverage.categories.map((bucket) => <article key={bucket.category}><div className="gpu-physical-coverage-category-heading"><strong>{CATEGORY_LABELS[bucket.category]}</strong><span>{bucket.coveragePercent}%</span></div><div className="gpu-physical-coverage-track" aria-hidden="true"><span style={{ width: `${Math.min(100, bucket.coveragePercent)}%` }} /></div><small>완료 {bucket.reviewedCount} · 부분 {bucket.partialCount} · 재확인 {bucket.staleCount} · 미검수 {bucket.pendingCount}</small><small>근거 {DATA_FRESHNESS_LABELS.fresh} {bucket.freshCount} · {DATA_FRESHNESS_LABELS.aging} {bucket.agingCount} · {DATA_FRESHNESS_LABELS.stale} {bucket.staleFreshnessCount} · {DATA_FRESHNESS_LABELS.unknown} {bucket.unknownFreshnessCount}</small></article>)}</div><p className="gpu-physical-coverage-note"><FiInfo /> `검수 완료`는 필수 물리 필드가 채워지고 근거가 최근 확인 또는 갱신 권장 범위인 항목입니다. 부분 검수·오래된 근거·미등록 항목은 구매·호환 판정에서 자동 확정하지 않습니다.</p></div>;
}

export function AdminGpuPhysicalPanel({ onToast, onMetaRefresh }: { onToast: (message: string) => void; onMetaRefresh: () => void }) {
  const [items, setItems] = useState<GpuPhysicalOverrideListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<PhysicalCategory>("gpu");
  const [query, setQuery] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [slotOccupancy, setSlotOccupancy] = useState("");
  const [gpuCableClearance, setGpuCableClearance] = useState("");
  const [caseSideClearance, setCaseSideClearance] = useState("");
  const [psuCableRuns, setPsuCableRuns] = useState("");
  const [psuCableTopology, setPsuCableTopology] = useState<"" | "independent" | "shared">("");
  const [sourceNote, setSourceNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [manufacturerModel, setManufacturerModel] = useState("");
  const [manufacturerRevision, setManufacturerRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [bulkJson, setBulkJson] = useState("");
  const [bulkValidation, setBulkValidation] = useState<GpuPhysicalOverrideValidationResponse | null>(null);
  const [validatedBulkInput, setValidatedBulkInput] = useState("");
  const bulkCsvInputRef = useRef<HTMLInputElement>(null);
  const bulkJsonInputRef = useRef<HTMLInputElement>(null);
  const [reviewQueue, setReviewQueue] = useState<PhysicalReviewQueue | null>(null);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(true);
  const [reviewQueueError, setReviewQueueError] = useState<string | null>(null);
  const [reviewQueueRefreshNonce, setReviewQueueRefreshNonce] = useState(0);
  const [physicalCoverage, setPhysicalCoverage] = useState<PhysicalReviewCoverage | null>(null);
  const [physicalCoverageLoading, setPhysicalCoverageLoading] = useState(true);
  const [physicalCoverageError, setPhysicalCoverageError] = useState<string | null>(null);
  const [reviewQueueQuery, setReviewQueueQuery] = useState("");
  const [reviewQueuePriority, setReviewQueuePriority] = useState<"all" | PhysicalReviewPriority>("all");
  const [reviewQueuePage, setReviewQueuePage] = useState(0);
  const [reviewPackageOffset, setReviewPackageOffset] = useState(0);
  const [sourceCheckingPartId, setSourceCheckingPartId] = useState<string | null>(null);
  const [sourceHistoryPartId, setSourceHistoryPartId] = useState<string | null>(null);
  const [sourceHistory, setSourceHistory] = useState<PhysicalSourceCheckHistoryEntry[]>([]);
  const [sourceHistoryLoading, setSourceHistoryLoading] = useState(false);
  const [sourceHistoryError, setSourceHistoryError] = useState<string | null>(null);

  async function loadOverrides() {
    setLoading(true);
    try {
      const payload = await api<{ items: GpuPhysicalOverrideListItem[] }>("/api/admin/gpu-physical-overrides");
      setItems(payload.items);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "GPU 물리 호환 검수 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadOverrides(); }, []);

  useEffect(() => {
    let cancelled = false;
    setReviewQueueLoading(true);
    const params = new URLSearchParams({ category, limit: String(REVIEW_QUEUE_PAGE_SIZE), offset: String(reviewQueuePage * REVIEW_QUEUE_PAGE_SIZE) });
    if (reviewQueueQuery.trim()) params.set("q", reviewQueueQuery.trim());
    if (reviewQueuePriority !== "all") params.set("priority", reviewQueuePriority);
    void api<PhysicalReviewQueue>(`/api/admin/gpu-physical-overrides/review-queue?${params.toString()}`)
      .then((payload) => { if (!cancelled) { setReviewQueue(payload); setReviewQueueError(null); if (payload.items.length === 0 && reviewQueuePage > 0) setReviewQueuePage((current) => Math.max(0, current - 1)); } })
      .catch((reason: unknown) => { if (!cancelled) setReviewQueueError(reason instanceof Error ? reason.message : "물리 검수 우선순위를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setReviewQueueLoading(false); });
    return () => { cancelled = true; };
  }, [category, reviewQueuePage, reviewQueuePriority, reviewQueueQuery, reviewQueueRefreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setPhysicalCoverageLoading(true);
    void api<PhysicalReviewCoverage>("/api/admin/gpu-physical-overrides/coverage")
      .then((payload) => { if (!cancelled) { setPhysicalCoverage(payload); setPhysicalCoverageError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setPhysicalCoverageError(reason instanceof Error ? reason.message : "물리 근거 coverage를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setPhysicalCoverageLoading(false); });
    return () => { cancelled = true; };
  }, [reviewQueueRefreshNonce]);

  async function searchParts(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    try {
      const payload = await api<{ items: Part[] }>(`/api/parts?category=${category}&q=${encodeURIComponent(query.trim())}&limit=12&sort=name`);
      setParts(payload.items);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "검수 대상 부품을 찾지 못했습니다.");
    } finally {
      setSearching(false);
    }
  }

  function selectPart(part: Part) {
    const saved = items.find((item) => item.partId === part.id);
    setSelectedPart(part);
    setSlotOccupancy(saved?.gpuSlotOccupancy === undefined ? "" : String(saved.gpuSlotOccupancy));
    setGpuCableClearance(saved?.gpuCableBendClearanceMm === undefined ? "" : String(saved.gpuCableBendClearanceMm));
    setCaseSideClearance(saved?.caseSidePanelClearanceMm === undefined ? "" : String(saved.caseSidePanelClearanceMm));
    setPsuCableRuns(saved?.psuIndependentPcieCableRuns === undefined ? "" : String(saved.psuIndependentPcieCableRuns));
    setPsuCableTopology(saved?.psuPcieCableTopology ?? "");
    setSourceNote(saved?.sourceNote ?? "");
    setSourceUrl(saved?.sourceUrl ?? "");
    setManufacturerModel(saved?.manufacturerModel ?? "");
    setManufacturerRevision(saved?.manufacturerRevision ?? "");
  }

  async function save() {
    if (!selectedPart) return;
    setBusy(true);
    const payload: Record<string, unknown> = { manufacturerModel: manufacturerModel.trim(), ...(manufacturerRevision.trim() ? { manufacturerRevision: manufacturerRevision.trim() } : {}), sourceNote: sourceNote.trim(), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) };
    if (selectedPart.category === "gpu") {
      if (slotOccupancy.trim()) payload.gpuSlotOccupancy = Number(slotOccupancy);
      if (gpuCableClearance.trim()) payload.gpuCableBendClearanceMm = Number(gpuCableClearance);
    } else if (selectedPart.category === "case" && caseSideClearance.trim()) {
      payload.caseSidePanelClearanceMm = Number(caseSideClearance);
    } else if (selectedPart.category === "psu") {
      if (psuCableRuns.trim()) payload.psuIndependentPcieCableRuns = Number(psuCableRuns);
      if (psuCableTopology) payload.psuPcieCableTopology = psuCableTopology;
    }
    try {
      await api(`/api/admin/gpu-physical-overrides/${encodeURIComponent(selectedPart.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      await loadOverrides();
      setReviewQueueRefreshNonce((current) => current + 1);
      onMetaRefresh();
      onToast(`${selectedPart.name}의 물리 호환 검수값을 저장했습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 호환 검수값을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(partId: string) {
    setBusy(true);
    try {
      await api(`/api/admin/gpu-physical-overrides/${encodeURIComponent(partId)}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.partId !== partId));
      setReviewQueueRefreshNonce((current) => current + 1);
      if (selectedPart?.id === partId) setSelectedPart(null);
      onMetaRefresh();
      onToast("물리 호환 검수값을 삭제했습니다. 원문 파싱값만 다시 사용합니다.");
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 호환 검수값을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function checkSource(partId: string) {
    setBusy(true);
    setSourceCheckingPartId(partId);
    try {
      const result = await api<{ sourceCheck: PhysicalSourceCheck; override: GpuPhysicalOverride }>(`/api/admin/gpu-physical-overrides/${encodeURIComponent(partId)}/source-check`, { method: "POST" });
      setItems((current) => current.map((item) => item.partId === partId ? { ...item, ...result.override } : item));
      setReviewQueueRefreshNonce((current) => current + 1);
      onMetaRefresh();
      onToast(`근거 URL 점검 완료: ${physicalSourceCheckText(result.sourceCheck)}`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "근거 URL을 점검하지 못했습니다.");
    } finally {
      setSourceCheckingPartId(null);
      setBusy(false);
    }
  }

  async function checkSourcesBatch() {
    setBusy(true);
    try {
      const result = await api<PhysicalSourceCheckBatchResponse>("/api/admin/gpu-physical-overrides/source-check/batch", { method: "POST", body: JSON.stringify({ category, limit: 50 }) });
      await loadOverrides();
      setReviewQueueRefreshNonce((current) => current + 1);
      onMetaRefresh();
      onToast(`${result.checkedCount}개 ${CATEGORY_LABELS[category]} 근거 URL을 점검했습니다. 통과 ${result.passedCount}개 · 재확인 ${result.reviewCount}개 · ${result.persisted ? `저장 ${result.persistedCount}개${result.persistFailureCount > 0 ? ` · 저장 실패 ${result.persistFailureCount}개` : ""}` : "미리보기(저장 안 함)"}${result.totalCandidates > result.checkedCount ? ` · 남은 URL ${result.totalCandidates - result.checkedCount}개` : ""}`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "근거 URL 일괄 점검에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSourceHistory(partId: string) {
    if (sourceHistoryPartId === partId) {
      setSourceHistoryPartId(null);
      return;
    }
    setSourceHistoryPartId(partId);
    setSourceHistoryLoading(true);
    setSourceHistoryError(null);
    try {
      const result = await api<{ partId: string; entries: PhysicalSourceCheckHistoryEntry[] }>(`/api/admin/gpu-physical-overrides/${encodeURIComponent(partId)}/source-check/history?limit=8`);
      setSourceHistory(result.entries);
    } catch (reason: unknown) {
      setSourceHistory([]);
      setSourceHistoryError(reason instanceof Error ? reason.message : "근거 URL 점검 이력을 불러오지 못했습니다.");
    } finally {
      setSourceHistoryLoading(false);
    }
  }

  function updateBulkJson(value: string) {
    setBulkJson(value);
    setBulkValidation(null);
    setValidatedBulkInput("");
  }

  function importBulkCsvText(value: string) {
    const parsed = parseGpuPhysicalOverridesCsv(value);
    if (parsed.errors.length > 0) {
      onToast(`물리 검수 CSV를 반영하지 못했습니다: ${parsed.errors.slice(0, 3).join(" · ")}`);
      return;
    }
    updateBulkJson(JSON.stringify({ items: parsed.items }, null, 2));
    setBulkOpen(true);
    onToast(`${parsed.items.length}개 물리 검수 CSV 행을 JSON에 반영했습니다. 서버 검증 후 저장해 주세요.`);
  }

  function importBulkCsv() {
    if (!bulkCsvText.trim()) {
      onToast("반영할 물리 검수 CSV를 붙여 넣어 주세요.");
      return;
    }
    importBulkCsvText(bulkCsvText);
  }

  async function importBulkCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      importBulkCsvText(await file.text());
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 검수 CSV 파일을 읽지 못했습니다.");
    }
  }

  async function importBulkJsonFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : undefined;
      if (!items || items.length === 0) throw new Error("items 배열이 없는 JSON입니다.");
      updateBulkJson(JSON.stringify({ items }, null, 2));
      setBulkOpen(true);
      onToast(`${items.length}개 JSON 검수 행을 반영했습니다. 서버 검증 후 저장해 주세요.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 검수 JSON 파일을 읽지 못했습니다.");
    }
  }

  async function validateBulk() {
    if (!bulkJson.trim()) {
      onToast("검증할 물리 검수 JSON을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<GpuPhysicalOverrideValidationResponse>("/api/admin/gpu-physical-overrides/batch/validate", { method: "POST", body: bulkJson });
      setBulkValidation(result);
      setValidatedBulkInput(bulkJson);
      onToast(result.invalidCount === 0 ? `${result.validCount}개 물리 검수값을 저장할 수 있습니다.` : `${result.invalidCount}개 물리 검수 행을 수정해야 합니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 검수 일괄 검증에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBulk() {
    if (!bulkValidation || bulkValidation.invalidCount > 0 || validatedBulkInput !== bulkJson) {
      onToast("입력 내용을 바꿨다면 먼저 물리 검수 JSON 검증을 다시 실행해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ saved: boolean; count: number; items: GpuPhysicalOverrideListItem[] }>("/api/admin/gpu-physical-overrides/batch", { method: "PUT", body: bulkJson });
      setItems(result.items);
      setReviewQueueRefreshNonce((current) => current + 1);
      onMetaRefresh();
      setBulkValidation(null);
      setValidatedBulkInput("");
      onToast(`${result.count}개 GPU·케이스·PSU 물리 검수값을 원자적으로 저장했습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 검수 일괄 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBulkCsv() {
    setBusy(true);
    try {
      const result = await api<{ exportedAt: string; items: GpuPhysicalOverrideListItem[] }>("/api/admin/gpu-physical-overrides/export");
      downloadText(`gpu-physical-overrides-${new Date(result.exportedAt).toISOString().slice(0, 10)}.csv`, gpuPhysicalOverridesToCsv(result.items), "text/csv;charset=utf-8");
      onToast(`${result.items.length}개 저장된 물리 검수값을 CSV로 내보냈습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 검수값을 내보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportReviewPackage() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ category, limit: "100", offset: String(reviewPackageOffset) });
      const result = await api<PhysicalReviewWorkPackage>(`/api/admin/gpu-physical-overrides/review-package?${params.toString()}`);
      downloadText(`gpu-physical-review-package-${category}-${new Date(result.generatedAt).toISOString().slice(0, 10)}.json`, `${JSON.stringify(result, null, 2)}\n`, "application/json;charset=utf-8");
      setReviewPackageOffset(result.nextOffset ?? 0);
      onToast(`${result.items.length}개 ${CATEGORY_LABELS[category]} 우선 검수 작업 패키지를 저장했습니다. ${result.nextOffset !== undefined ? `다음 묶음은 ${result.nextOffset}번부터 재개합니다.` : "현재 큐를 모두 담았습니다."}`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 검수 작업 패키지를 내보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBulkTemplate() {
    setBusy(true);
    try {
      const result = await api<{ generatedAt: string; total: number; items: GpuPhysicalOverrideCsvItem[] }>(`/api/admin/gpu-physical-overrides/review-template?category=${category}&limit=500&offset=0`);
      downloadText(`gpu-physical-review-template-${category}-${new Date(result.generatedAt).toISOString().slice(0, 10)}.csv`, gpuPhysicalOverridesToCsv(result.items), "text/csv;charset=utf-8");
      onToast(`${result.items.length}개 ${CATEGORY_LABELS[category]} 검수 템플릿을 저장했습니다. 전체 ${result.total}개 중 첫 500개입니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "물리 검수 템플릿을 내보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openReviewItem(item: PhysicalReviewQueueItem) {
    setBusy(true);
    try {
      const part = await api<Part>(`/api/parts/${encodeURIComponent(item.partId)}`);
      setParts([part]);
      setQuery(part.name);
      selectPart(part);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "검수 대상 부품을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const categoryItems = useMemo(() => items.filter((item) => item.category === category), [items, category]);
  const savedForSelected = selectedPart ? items.find((item) => item.partId === selectedPart.id) : undefined;
  const canSaveBulk = Boolean(bulkValidation && bulkValidation.invalidCount === 0 && validatedBulkInput === bulkJson);
  return <section className="admin-card gpu-physical-admin-card" data-testid="admin-gpu-physical-panel">
    <div className="admin-card-heading"><div><p className="eyebrow">PHYSICAL FIT REVIEW</p><h3>GPU·케이스·PSU 물리 호환 검수</h3><p className="admin-card-description">판매 목록만으로 확정하기 어려운 GPU 물리 슬롯·케이블 굽힘·케이스 측면 여유·PSU PCIe 케이블 분배 구조를 제조사 매뉴얼 근거로 별도 저장합니다.</p></div><FiShield /></div>
    <div className="gpu-physical-admin-summary"><span>GPU 검수 <strong>{items.filter((item) => item.category === "gpu").length}개</strong></span><span>케이스 검수 <strong>{items.filter((item) => item.category === "case").length}개</strong></span><span>PSU 검수 <strong>{items.filter((item) => item.category === "psu").length}개</strong></span>{loading && <span>불러오는 중...</span>}{error && <span className="gpu-physical-admin-error">{error}</span>}</div>
    {physicalCoverageLoading ? <div className="gpu-physical-coverage-state" role="status"><FiLoader className="spin" /> 전체 물리 근거 coverage를 계산하는 중...</div> : physicalCoverageError ? <div className="gpu-physical-coverage-state error" role="alert"><FiAlertTriangle /> {physicalCoverageError}</div> : physicalCoverage && <PhysicalReviewCoveragePanel coverage={physicalCoverage} />}
    {reviewQueueLoading ? <div className="gpu-physical-review-queue loading" role="status"><FiLoader className="spin" /> {CATEGORY_LABELS[category]} 물리 검수 우선순위를 계산하는 중...</div> : reviewQueueError ? <div className="gpu-physical-review-queue error" role="alert"><FiAlertTriangle /> {reviewQueueError}</div> : reviewQueue && <div className="gpu-physical-review-queue" aria-label="물리 호환 검수 우선순위"><div className="gpu-physical-review-queue-heading"><div><span>REVIEW QUEUE</span><strong>{CATEGORY_LABELS[category]} 물리 검수 우선순위</strong><small>우선순위 점수는 호환 판정이 아니라, 실제 간섭 가능성이 큰 부품의 제조사 근거를 먼저 채우기 위한 운영용 신호입니다.</small></div><span className="gpu-physical-review-coverage">완료 {reviewQueue.coveragePercent}%</span></div><div className="gpu-physical-review-controls"><label><span>큐 검색</span><input aria-label="물리 검수 큐 검색" value={reviewQueueQuery} onChange={(event) => { setReviewQueueQuery(event.target.value); setReviewQueuePage(0); }} placeholder="부품명·ID 검색" disabled={busy} /></label><label><span>우선순위</span><select aria-label="물리 검수 큐 우선순위" value={reviewQueuePriority} onChange={(event) => { setReviewQueuePriority(event.target.value as "all" | PhysicalReviewPriority); setReviewQueuePage(0); }} disabled={busy}><option value="all">전체 우선순위</option><option value="high">우선 검수</option><option value="medium">검수 권장</option><option value="low">일반 검수</option></select></label></div><div className="gpu-physical-review-stats"><span>검수 완료 <strong>{reviewQueue.reviewedCount}개</strong></span><span>부분 검수 <strong>{reviewQueue.partialCount}개</strong></span><span>근거 재확인 <strong>{reviewQueue.staleCount}개</strong></span><span>미검수 <strong>{reviewQueue.pendingCount}개</strong></span><span>대기 목록 <strong>{reviewQueue.queueTotal}{reviewQueue.queueTotal !== reviewQueue.allQueueTotal ? ` / ${reviewQueue.allQueueTotal}` : ""}개</strong></span></div>{reviewQueue.items.length === 0 ? <p className="gpu-physical-review-empty"><FiCheckCircle /> 현재 조건에 맞는 미완료 물리 검수 항목이 없습니다.</p> : <div className="gpu-physical-review-list">{reviewQueue.items.map((item) => <article key={item.partId}><div className="gpu-physical-review-main"><div className="gpu-physical-review-top"><span className={`gpu-physical-review-priority ${item.priority}`}>{REVIEW_PRIORITY_LABELS[item.priority]}</span><span className={`gpu-physical-review-status ${item.reviewStatus}`}>{REVIEW_STATUS_LABELS[item.reviewStatus]}</span><strong>{item.priorityScore}점</strong></div><strong>{item.partName}</strong><small>{item.partId} · {item.dataQuality === "live" ? "다나와 최신" : item.dataQuality === "manual" ? "수동 검수" : item.dataQuality === "seed" ? "프로젝트 기준" : "일부 스펙 부족"}{item.priceWon !== undefined ? ` · ${item.priceWon.toLocaleString("ko-KR")}원` : " · 가격 확인 필요"}</small><small>{item.reviewReason}</small><small className={item.freshness === "stale" || item.freshness === "unknown" ? "gpu-physical-review-freshness stale" : "gpu-physical-review-freshness"}>근거 {DATA_FRESHNESS_LABELS[item.freshness]}{item.evidenceUpdatedAt ? ` · 갱신 ${new Date(item.evidenceUpdatedAt).toLocaleDateString("ko-KR")}` : ""}</small></div><div className="gpu-physical-review-side"><span>{item.focusFields.join(" · ")}</span><button className="button button-small button-secondary" type="button" onClick={() => void openReviewItem(item)} disabled={busy}><FiSearch /> 검수 열기</button></div></article>)}</div>}{reviewQueue.queueTotal > 0 && <div className="gpu-physical-review-pagination"><button className="button button-small button-light" type="button" onClick={() => setReviewQueuePage((current) => Math.max(0, current - 1))} disabled={busy || reviewQueuePage === 0}>이전</button><span>{reviewQueuePage + 1} / {Math.max(1, Math.ceil(reviewQueue.queueTotal / REVIEW_QUEUE_PAGE_SIZE))}</span><button className="button button-small button-light" type="button" onClick={() => setReviewQueuePage((current) => current + 1)} disabled={busy || (reviewQueuePage + 1) * REVIEW_QUEUE_PAGE_SIZE >= reviewQueue.queueTotal}>다음</button></div>}</div>}
    <form className="gpu-physical-search" onSubmit={searchParts}><label><span>대상</span><select aria-label="물리 호환 검수 대상" value={category} onChange={(event) => { setCategory(event.target.value as PhysicalCategory); setParts([]); setSelectedPart(null); setReviewQueuePage(0); setReviewPackageOffset(0); }} disabled={busy}><option value="gpu">GPU</option><option value="case">케이스</option><option value="psu">PSU</option></select></label><label className="gpu-physical-search-query"><span>부품 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={category === "gpu" ? "GPU 모델명·브랜드" : category === "case" ? "케이스 모델명·브랜드" : "PSU 모델명·브랜드"} disabled={busy} /></label><button className="button button-secondary" type="submit" disabled={busy || searching}>{searching ? <><FiLoader className="spin" /> 검색 중...</> : <><FiSearch /> 부품 찾기</>}</button></form>
    {parts.length > 0 && <div className="gpu-physical-search-results">{parts.map((part) => <button className={selectedPart?.id === part.id ? "selected" : ""} type="button" key={part.id} onClick={() => selectPart(part)} disabled={busy}><strong>{part.name}</strong><small>{CATEGORY_LABELS[part.category]} · {part.id} · {part.dataQuality === "live" ? "다나와 최신" : part.dataQuality === "manual" ? "수동 검수" : "프로젝트 데이터"}</small></button>)}</div>}
    {selectedPart && <div className="gpu-physical-editor"><div className="gpu-physical-selected"><div><span>선택한 검수 대상</span><strong>{selectedPart.name}</strong><small>{selectedPart.id} · {CATEGORY_LABELS[selectedPart.category]}</small></div><span>{savedForSelected ? "저장된 검수값" : "새 검수값"}</span></div><div className="gpu-physical-fields">{selectedPart.category === "gpu" ? <><label><span>GPU 물리 슬롯 점유</span><input type="number" min="1" max="6" step="0.5" value={slotOccupancy} onChange={(event) => setSlotOccupancy(event.target.value)} placeholder="예: 3.5" disabled={busy} /><small>제조사 표기의 2-slot·2.5-slot·3-slot 등을 숫자로 입력합니다.</small></label><label><span>GPU 케이블 굽힘 최소 여유 (mm)</span><input type="number" min="0" max="500" step="1" value={gpuCableClearance} onChange={(event) => setGpuCableClearance(event.target.value)} placeholder="예: 40" disabled={busy} /><small>제조사 설치 가이드에서 확인한 측면 케이블 공간입니다.</small></label></> : selectedPart.category === "case" ? <label><span>케이스 측면 케이블 여유 (mm)</span><input type="number" min="0" max="500" step="1" value={caseSideClearance} onChange={(event) => setCaseSideClearance(event.target.value)} placeholder="예: 45" disabled={busy} /><small>GPU 전원 케이블과 측판 사이에 확인된 실제 여유입니다.</small></label> : <><label><span>독립 PCIe 케이블 런 수</span><input type="number" min="1" max="8" step="1" value={psuCableRuns} onChange={(event) => setPsuCableRuns(event.target.value)} placeholder="예: 2" disabled={busy} /><small>제조사 케이블 표에서 서로 독립된 PCIe 케이블 가닥 수를 입력합니다.</small></label><label><span>PCIe 케이블 분배 구조</span><select aria-label="PSU PCIe 케이블 분배 구조" value={psuCableTopology} onChange={(event) => setPsuCableTopology(event.target.value as "" | "independent" | "shared")} disabled={busy}><option value="">확인 필요</option><option value="independent">독립 케이블</option><option value="shared">분배·공유 케이블</option></select><small>커넥터 개수와 독립 케이블 수가 다르면 공유 구조로 확인합니다.</small></label></>}</div><div className="gpu-physical-source-fields"><label><span>검수 근거 메모</span><textarea value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={500} placeholder="예: 제조사 설치 가이드 12페이지, 측면 패널 장착 기준" disabled={busy} /></label><label><span>근거 URL (HTTPS)</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." disabled={busy} /></label></div><div className="gpu-physical-actions"><button className="button button-primary" type="button" onClick={() => void save()} disabled={busy}><FiCheckCircle /> {busy ? "저장 중..." : "검수값 저장"}</button>{savedForSelected?.sourceUrl && <button className="button button-secondary" type="button" onClick={() => void checkSource(selectedPart.id)} disabled={busy}><FiSearch /> {sourceCheckingPartId === selectedPart.id ? "URL 점검 중..." : "근거 URL 점검"}</button>}{savedForSelected && <button className="button button-light" type="button" onClick={() => void remove(selectedPart.id)} disabled={busy}><FiTrash2 /> 검수값 삭제</button>}</div></div>}
    <div className="gpu-physical-bulk-tools" aria-label="물리 호환 일괄 검수"><div className="gpu-physical-bulk-heading"><div><strong>대량 검수 도구</strong><small>스프레드시트에서 여러 GPU·케이스·PSU의 제조사 근거를 채운 뒤 한 번에 검증합니다. 오류가 하나라도 있으면 전체 저장을 중단합니다.</small></div><FiDatabase /></div><div className="gpu-physical-bulk-actions"><button className="button button-light" type="button" onClick={() => void checkSourcesBatch()} disabled={busy || !categoryItems.some((item) => Boolean(item.sourceUrl))}><FiSearch /> 저장 URL 일괄 점검</button><button className="button button-light" type="button" onClick={() => void exportReviewPackage()} disabled={busy}><FiDownload /> {reviewPackageOffset > 0 ? `다음 작업 패키지 (${reviewPackageOffset}번부터)` : "우선 검수 작업 패키지"}</button><button className="button button-light" type="button" onClick={() => void exportBulkTemplate()} disabled={busy}><FiDownload /> {CATEGORY_LABELS[category]} 검수 템플릿</button><button className="button button-light" type="button" onClick={() => void exportBulkCsv()} disabled={busy}><FiDownload /> 저장값 CSV</button><button className="button button-secondary" type="button" aria-expanded={bulkOpen} onClick={() => setBulkOpen((current) => !current)}><FiChevronDown /> {bulkOpen ? "일괄 검수 닫기" : "CSV·JSON 일괄 검수"}</button></div>{bulkOpen && <div className="gpu-physical-bulk-body"><div className="gpu-physical-bulk-csv"><label><span>CSV 직접 붙여넣기</span><textarea aria-label="물리 호환 검수 CSV" value={bulkCsvText} onChange={(event) => setBulkCsvText(event.target.value)} placeholder="partId,partName,category,gpuSlotOccupancy,gpuCableBendClearanceMm,caseSidePanelClearanceMm,psuIndependentPcieCableRuns,psuPcieCableTopology,sourceNote,sourceUrl,updatedAt&#10;psu-...,테스트 PSU,psu,,,,2,independent,제조사 케이블 구성표,https://...," disabled={busy} /></label><input ref={bulkCsvInputRef} className="gpu-physical-csv-input" type="file" accept=".csv,text/csv" aria-label="물리 호환 검수 CSV 파일 가져오기" onChange={(event) => void importBulkCsvFile(event)} disabled={busy} /><div><button className="button button-secondary" type="button" onClick={importBulkCsv} disabled={busy || !bulkCsvText.trim()}><FiDatabase /> CSV를 JSON으로 변환</button><button className="button button-light" type="button" onClick={() => bulkCsvInputRef.current?.click()} disabled={busy}><FiDownload /> CSV 파일 가져오기</button></div></div><label><span>일괄 검수 JSON</span><textarea aria-label="물리 호환 검수 JSON" value={bulkJson} onChange={(event) => updateBulkJson(event.target.value)} placeholder='{"items":[{"partId":"psu-...","psuIndependentPcieCableRuns":2,"psuPcieCableTopology":"independent","sourceNote":"제조사 케이블 구성표"}]}' disabled={busy} /></label><input ref={bulkJsonInputRef} className="gpu-physical-csv-input" type="file" accept=".json,application/json" aria-label="물리 호환 검수 JSON 파일 가져오기" onChange={(event) => void importBulkJsonFile(event)} disabled={busy} /><div className="gpu-physical-bulk-actions"><button className="button button-secondary" type="button" onClick={() => bulkJsonInputRef.current?.click()} disabled={busy}><FiDownload /> 작업 패키지·JSON 가져오기</button><button className="button button-secondary" type="button" onClick={() => void validateBulk()} disabled={busy || !bulkJson.trim()}><FiCheckCircle /> JSON 검증</button><button className="button button-primary" type="button" onClick={() => void saveBulk()} disabled={busy || !canSaveBulk}><FiSave /> 일괄 저장</button></div>{bulkValidation && <div className={bulkValidation.invalidCount === 0 ? "gpu-physical-bulk-validation valid" : "gpu-physical-bulk-validation invalid"} role="status"><strong>{bulkValidation.invalidCount === 0 ? <><FiCheckCircle /> 저장 가능</> : <><FiAlertTriangle /> 저장 차단</>} · {bulkValidation.validCount}개 저장 가능 · {bulkValidation.invalidCount}개 수정 필요</strong>{bulkValidation.items.filter((item) => !item.valid).slice(0, 5).map((item) => <p key={`bulk-error-${item.partId}`}><b>{item.partName ?? item.partId}</b> · {item.errors.join(" · ")}</p>)}{bulkValidation.invalidCount > 5 && <small>그 외 {bulkValidation.invalidCount - 5}개 오류도 서버 응답에 포함되어 있습니다.</small>}</div>}</div>}</div>
    {selectedPart && <div className="gpu-physical-identity-editor"><div><strong>출처 식별자</strong><small>문서가 어느 제조사 모델·변형에 적용되는지 반드시 함께 기록합니다.</small></div><label><span>제조사 모델/SKU</span><input value={manufacturerModel} onChange={(event) => setManufacturerModel(event.target.value)} maxLength={160} placeholder="예: ZT-B50900J-10P" disabled={busy} /></label><label><span>문서 revision (선택)</span><input value={manufacturerRevision} onChange={(event) => setManufacturerRevision(event.target.value)} maxLength={120} placeholder="예: 2025-09 rev.A" disabled={busy} /></label><p>단건 저장은 위 식별자와 기존 검수값을 함께 서버에 보냅니다. revision이 문서에 없으면 비워 두되 모델/SKU는 필수입니다.</p></div>}
    {selectedPart && <button className="button button-primary gpu-physical-identity-save" type="button" onClick={() => void save()} disabled={busy}><FiSave /> 모델/SKU 식별자 포함 저장</button>}
    {bulkOpen && <p className="gpu-physical-bulk-schema-note">일괄 CSV는 <code>manufacturerModel</code>(필수)과 <code>manufacturerRevision</code>(선택)을 포함해야 합니다. 제조사 모델/SKU가 현재 카탈로그 제품과 일치하는지 확인한 뒤 저장하세요.</p>}
    <div className="gpu-physical-list-heading"><strong>저장된 물리 검수 목록</strong><span>{categoryItems.length}개</span></div>
    {categoryItems.length === 0 ? <p className="gpu-physical-empty"><FiInfo /> 아직 {category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU"} 물리 검수값이 없습니다.</p> : <div className="gpu-physical-list">{categoryItems.map((item) => <article key={item.partId}><div><strong>{item.partName}</strong><small>{overrideValueText(item)} · {new Date(item.updatedAt).toLocaleDateString("ko-KR")}</small><small>{item.sourceNote}</small><small className={`gpu-physical-source-check ${item.sourceCheck?.status ?? "not_checked"}`}>{physicalSourceCheckText(item.sourceCheck)}</small></div><div>{sourceUrlFor(item.sourceUrl ?? "") && <a href={sourceUrlFor(item.sourceUrl ?? "")} target="_blank" rel="noreferrer" aria-label={`${item.partName} 물리 검수 근거 원문`}><FiExternalLink /></a>}{item.sourceUrl && <button className="text-button" type="button" onClick={() => void checkSource(item.partId)} disabled={busy}>{sourceCheckingPartId === item.partId ? <><FiLoader className="spin" /> 점검 중...</> : <><FiSearch /> 근거 점검</>}</button>}{item.sourceUrl && <button className="text-button" type="button" onClick={() => void toggleSourceHistory(item.partId)} disabled={busy}>{sourceHistoryPartId === item.partId ? "이력 닫기" : "이력 보기"}</button>}<button className="text-button danger-text-button" type="button" onClick={() => void remove(item.partId)} disabled={busy}><FiTrash2 /> 삭제</button></div>{sourceHistoryPartId === item.partId && <PhysicalSourceHistoryPanel entries={sourceHistory} loading={sourceHistoryLoading} error={sourceHistoryError} />}</article>)}</div>}
    <p className="gpu-physical-note"><FiDatabase /> 저장된 override는 원본 카탈로그를 덮어쓰지 않고 런타임에만 적용됩니다. GPU 물리 슬롯 점유만 입력된 경우 케이블 간섭을 통과시키지 않으며, PSU 커넥터 개수만으로 독립 케이블을 추정하지 않습니다. 모델·URL·물리값을 다시 저장하면 이전 URL 점검 결과는 초기화되므로 다시 점검해야 합니다.</p>
  </section>;
}
