import { useEffect, useRef, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLoader, FiPlus, FiSave, FiSearch, FiTrash2 } from "react-icons/fi";
import type { BenchmarkOverride, BenchmarkOverrideOperation, BenchmarkReviewQueue, BenchmarkScoreKey, BenchmarkSourceKind, Part, PartCategory, ServiceMeta } from "../shared/types";
import { BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS } from "../shared/types";
import { benchmarkOverridesToCsv, benchmarkReviewItemsToCsv, parseBenchmarkOverridesCsv } from "../shared/benchmark-csv";
import { api } from "./api";
import { partSummary } from "./admin-panel-shared";
import { safeExternalUrl } from "./safe-source-url";

type BenchmarkOverrideValidationItem = {
  partId: string;
  partName?: string;
  category?: PartCategory;
  valid: boolean;
  errors: string[];
  operation?: BenchmarkOverrideOperation;
  changedFields?: string[];
};

type BenchmarkOverrideValidationResponse = {
  validCount: number;
  invalidCount: number;
  items: BenchmarkOverrideValidationItem[];
};

type BenchmarkOverrideListItem = BenchmarkOverride & {
  partName?: string;
  category?: PartCategory;
};

const BENCHMARK_SCORE_LABELS: Record<BenchmarkScoreKey, string> = {
  cinebenchR23Single: "Cinebench R23 싱글",
  cinebenchR23Multi: "Cinebench R23 멀티",
  gpu3dmarkTimeSpyScore: "3DMark Time Spy",
  gpu3dmarkPortRoyalScore: "3DMark Port Royal"
};

const BENCHMARK_SOURCE_COVERAGE_LABELS = [
  ["official", "제조사·공식"],
  ["independent_review", "독립 리뷰"],
  ["community_measurement", "사용자 실측"],
  ["other", "기타 분류"],
  ["unclassified", "출처 미분류"]
] as const;

function benchmarkOverrideScoreText(override: BenchmarkOverride) {
  return Object.entries(override.scores)
    .map(([key, value]) => `${BENCHMARK_SCORE_LABELS[key as BenchmarkScoreKey] ?? key} ${value.toLocaleString("ko-KR")}`)
    .join(" · ");
}

function benchmarkSourceKindLabel(kind: BenchmarkSourceKind | undefined) {
  return kind ? BENCHMARK_SOURCE_KIND_LABELS[kind] : "출처 유형 미분류";
}

export function BenchmarkOverridePanel({ onToast, onMetaRefresh, storageMode }: { onToast: (message: string) => void; onMetaRefresh: () => void; storageMode?: ServiceMeta["storageMode"] }) {
  const [overrides, setOverrides] = useState<BenchmarkOverrideListItem[]>([]);
  const [json, setJson] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvOpen, setCsvOpen] = useState(false);
  const [validation, setValidation] = useState<BenchmarkOverrideValidationResponse | null>(null);
  const [validatedInput, setValidatedInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideQuery, setOverrideQuery] = useState("");
  const [overrideCategoryFilter, setOverrideCategoryFilter] = useState<"all" | "cpu" | "gpu">("all");
  const [overrideSourceFilter, setOverrideSourceFilter] = useState<BenchmarkSourceKind | "unclassified" | "all">("all");
  const [composerCategory, setComposerCategory] = useState<"cpu" | "gpu">("gpu");
  const [composerQuery, setComposerQuery] = useState("");
  const [composerParts, setComposerParts] = useState<Part[]>([]);
  const [composerPartsLoading, setComposerPartsLoading] = useState(false);
  const [composerSelectedPartId, setComposerSelectedPartId] = useState("");
  const [composerScores, setComposerScores] = useState<Partial<Record<BenchmarkScoreKey, string>>>({});
  const [composerSourceNote, setComposerSourceNote] = useState("");
  const [composerSourceKind, setComposerSourceKind] = useState<BenchmarkSourceKind>("independent_review");
  const [composerSourceUrl, setComposerSourceUrl] = useState("");
  const [reviewQueue, setReviewQueue] = useState<BenchmarkReviewQueue | null>(null);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(true);
  const [reviewQueueError, setReviewQueueError] = useState<string | null>(null);
  const [reviewQueueCategoryFilter, setReviewQueueCategoryFilter] = useState<"all" | "cpu" | "gpu">("all");
  const [reviewQueueStatusFilter, setReviewQueueStatusFilter] = useState<"all" | "missing" | "partial" | "stale">("all");
  const benchmarkCsvInputRef = useRef<HTMLInputElement>(null);
  const composerRequestVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<{ items: BenchmarkOverrideListItem[] }>("/api/admin/benchmark-overrides")
      .then((payload) => { if (!cancelled) { setOverrides(payload.items); setError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "벤치마크 보강 데이터를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReviewQueueLoading(true);
    void api<BenchmarkReviewQueue>("/api/admin/benchmark-review?limit=100")
      .then((payload) => { if (!cancelled) { setReviewQueue(payload); setReviewQueueError(null); } })
      .catch((reason: unknown) => { if (!cancelled) setReviewQueueError(reason instanceof Error ? reason.message : "벤치마크 검수 큐를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setReviewQueueLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++composerRequestVersionRef.current;
    const timer = window.setTimeout(() => {
      setComposerPartsLoading(true);
      void api<{ items: Part[] }>(`/api/parts?category=${composerCategory}&q=${encodeURIComponent(composerQuery)}&quality=all&sort=name&listingPolicy=all&limit=12`)
        .then((payload) => {
          if (cancelled || composerRequestVersionRef.current !== requestVersion) return;
          setComposerParts(payload.items);
          setComposerSelectedPartId((current) => payload.items.some((part) => part.id === current) ? current : "");
        })
        .catch(() => {
          if (!cancelled && composerRequestVersionRef.current === requestVersion) setComposerParts([]);
        })
        .finally(() => {
          if (!cancelled && composerRequestVersionRef.current === requestVersion) setComposerPartsLoading(false);
        });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [composerCategory, composerQuery]);

  function handleJsonChange(value: string) {
    setJson(value);
    setValidation(null);
    setValidatedInput("");
  }

  function importCsv() {
    if (!csvText.trim()) {
      onToast("반영할 벤치마크 CSV를 붙여 넣어 주세요.");
      return;
    }
    const parsed = parseBenchmarkOverridesCsv(csvText);
    if (parsed.errors.length > 0) {
      onToast(`CSV를 반영하지 못했습니다: ${parsed.errors.slice(0, 3).join(" · ")}`);
      return;
    }
    handleJsonChange(JSON.stringify({ items: parsed.items }, null, 2));
    setCsvOpen(false);
    onToast(`${parsed.items.length}개 벤치마크 행을 JSON에 반영했습니다. 서버 검증을 실행해 주세요.`);
  }

  async function importCsvFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseBenchmarkOverridesCsv(await file.text());
      if (parsed.errors.length > 0) {
        onToast(`CSV 파일을 반영하지 못했습니다: ${parsed.errors.slice(0, 3).join(" · ")}`);
        return;
      }
      handleJsonChange(JSON.stringify({ items: parsed.items }, null, 2));
      setCsvOpen(false);
      onToast(`${parsed.items.length}개 CSV 파일 행을 JSON에 반영했습니다. 서버 검증을 실행해 주세요.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "CSV 파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const blob = new Blob([benchmarkOverridesToCsv(overrides)], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `benchmark-overrides-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`${overrides.length}개 벤치마크 보강 데이터를 CSV로 내보냈습니다.`);
  }

  function exportReviewTemplate(kind: "scores" | "sources" = "scores") {
    const items = kind === "sources" ? reviewQueue?.sourceItems ?? [] : reviewQueue?.items ?? [];
    if (items.length === 0) {
      onToast(kind === "sources" ? "출처를 확인할 벤치마크 대상이 없습니다." : "내보낼 벤치마크 검수 대상이 없습니다.");
      return;
    }
    const blob = new Blob([benchmarkReviewItemsToCsv(items.map((item) => ({ partId: item.partId, partName: item.partName, category: item.category, scores: item.presentScores, ...(item.benchmarkSourceKind ? { benchmarkSourceKind: item.benchmarkSourceKind } : {}), updatedAt: item.updatedAt })))], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${kind === "sources" ? "benchmark-source-review-template" : "benchmark-review-template"}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`${items.length}개 ${kind === "sources" ? "출처 분류 검수" : "벤치마크 검수"} 대상의 CSV 템플릿을 저장했습니다.`);
  }

  function addReviewItemToJson(item: { partId: string; partName: string; presentScores: Partial<Record<BenchmarkScoreKey, number>>; benchmarkSourceKind?: BenchmarkSourceKind }) {
    try {
      const parsed: unknown = json.trim() ? JSON.parse(json) : { items: [] };
      const existingItems: unknown[] = !json.trim()
        ? []
        : Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).items)
            ? (parsed as Record<string, unknown>).items as unknown[]
            : (() => { throw new Error("invalid benchmark batch shape"); })();
      const existing = existingItems.find((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).partId === item.partId);
      const nextItem: Record<string, unknown> = {
        ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
        partId: item.partId,
        ...item.presentScores,
        ...(item.benchmarkSourceKind ? { sourceKind: item.benchmarkSourceKind } : {}),
        sourceNote: existing && typeof existing === "object" && !Array.isArray(existing) && typeof (existing as Record<string, unknown>).sourceNote === "string" ? (existing as Record<string, unknown>).sourceNote : ""
      };
      const nextItems = [...existingItems.filter((value) => !value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).partId !== item.partId), nextItem];
      handleJsonChange(JSON.stringify({ items: nextItems }, null, 2));
      onToast(`${item.partName}을 입력 JSON에 추가했습니다. 미확인 점수·근거 메모·출처 URL을 채운 뒤 검증해 주세요.`);
    } catch {
      onToast("기존 JSON 형식이 올바르지 않아 검수 행을 추가하지 못했습니다. JSON을 먼저 수정해 주세요.");
    }
  }

  async function validate() {
    if (!json.trim()) {
      onToast("검증할 벤치마크 보강 JSON을 입력해 주세요.");
      return;
    }
    try {
      JSON.parse(json);
    } catch {
      onToast("JSON 형식이 올바르지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<BenchmarkOverrideValidationResponse>("/api/admin/benchmark-overrides/validate", { method: "POST", body: json });
      setValidation(result);
      setValidatedInput(json);
      onToast(result.invalidCount > 0 ? `검증 완료: ${result.validCount}개 저장 가능, ${result.invalidCount}개 수정 필요` : `${result.validCount}개 벤치마크 보강 데이터를 저장할 수 있습니다.`);
    } catch (reason: unknown) {
      setValidation(null);
      setValidatedInput("");
      onToast(reason instanceof Error ? reason.message : "벤치마크 보강 JSON 검증에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!validation || validatedInput !== json) {
      onToast("입력 내용을 바꿨다면 먼저 벤치마크 JSON 검증을 다시 실행해 주세요.");
      return;
    }
    if (validation.invalidCount > 0) {
      onToast("수정이 필요한 항목이 있어 저장하지 않았습니다.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ saved: boolean; count: number; items: BenchmarkOverrideListItem[] }>("/api/admin/benchmark-overrides", { method: "PUT", body: json });
      setOverrides(result.items);
      onMetaRefresh();
      onToast(`${result.count}개 부품의 벤치마크 보강 데이터를 저장했습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "벤치마크 보강 데이터를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportOverrides() {
    setBusy(true);
    try {
      const result = await api<{ exportedAt: string; items: BenchmarkOverrideListItem[] }>("/api/admin/benchmark-overrides/export");
      const blob = new Blob([JSON.stringify({ items: result.items }, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `benchmark-overrides-${new Date(result.exportedAt).toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      onToast(`${result.items.length}개 벤치마크 보강 데이터를 JSON으로 내보냈습니다.`);
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "벤치마크 보강 데이터를 내보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(partId: string) {
    if (!window.confirm("이 부품의 수동 벤치마크 보강을 삭제할까요?")) return;
    setBusy(true);
    try {
      await api(`/api/admin/benchmark-overrides/${encodeURIComponent(partId)}`, { method: "DELETE" });
      setOverrides((current) => current.filter((override) => override.partId !== partId));
      onMetaRefresh();
      onToast("벤치마크 보강 데이터를 삭제했습니다.");
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : "벤치마크 보강 데이터를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function addComposerRow() {
    const selectedPart = composerParts.find((part) => part.id === composerSelectedPartId);
    if (!selectedPart) {
      onToast("먼저 성능 데이터를 보강할 CPU 또는 GPU를 검색해 선택해 주세요.");
      return;
    }
    const scoreEntries = Object.entries(composerScores).filter(([, value]) => value?.trim());
    if (scoreEntries.length === 0) {
      onToast("최소 1개의 벤치마크 점수를 입력해 주세요.");
      return;
    }
    if (!composerSourceNote.trim()) {
      onToast("검수 근거 메모를 입력해 주세요.");
      return;
    }
    try {
      const parsed: unknown = json.trim() ? JSON.parse(json) : { items: [] };
      const existingItems: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).items)
          ? (parsed as Record<string, unknown>).items as unknown[]
          : [];
      const nextItem: Record<string, unknown> = {
        partId: selectedPart.id,
        ...Object.fromEntries(scoreEntries.map(([key, value]) => [key, Number(value)])),
        sourceNote: composerSourceNote.trim(),
        sourceKind: composerSourceKind,
        ...(composerSourceUrl.trim() ? { sourceUrl: composerSourceUrl.trim() } : {})
      };
      const nextItems = [...existingItems.filter((item) => !item || typeof item !== "object" || Array.isArray(item) || (item as Record<string, unknown>).partId !== selectedPart.id), nextItem];
      handleJsonChange(JSON.stringify({ items: nextItems }, null, 2));
      onToast(`${selectedPart.name}의 벤치마크 행을 입력 JSON에 추가했습니다. JSON 검증 후 저장해 주세요.`);
    } catch {
      onToast("기존 JSON 형식이 올바르지 않아 행을 추가하지 못했습니다. JSON을 먼저 수정해 주세요.");
    }
  }

  const canSave = Boolean(validation && validation.invalidCount === 0 && validatedInput === json);
  const invalidItems = validation?.items.filter((item) => !item.valid) ?? [];
  const createCount = validation?.items.filter((item) => item.valid && item.operation === "create").length ?? 0;
  const updateCount = validation?.items.filter((item) => item.valid && item.operation === "update").length ?? 0;
  const unchangedCount = validation?.items.filter((item) => item.valid && item.operation === "unchanged").length ?? 0;
  const changePreviewItems = validation?.items.filter((item) => item.valid && item.operation !== "unchanged") ?? [];
  const normalizedOverrideQuery = overrideQuery.trim().toLocaleLowerCase("ko-KR");
  const visibleOverrides = overrides.filter((override) => {
    if (overrideCategoryFilter !== "all" && override.category !== overrideCategoryFilter) return false;
    if (overrideSourceFilter !== "all" && (override.sourceKind ?? "unclassified") !== overrideSourceFilter) return false;
    if (!normalizedOverrideQuery) return true;
    return [override.partName, override.partId, override.sourceNote, override.sourceUrl]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("ko-KR").includes(normalizedOverrideQuery));
  });
  const composerSelectedPart = composerParts.find((part) => part.id === composerSelectedPartId);
  const composerScoreFields: BenchmarkScoreKey[] = composerCategory === "cpu"
    ? ["cinebenchR23Single", "cinebenchR23Multi"]
    : ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"];
  const benchmarkFreshnessLabels = { fresh: "최근 확인", aging: "갱신 권장", stale: "갱신 필요", unknown: "시점 불명" } as const;
  const visibleReviewItems = reviewQueue?.items.filter((item) => (reviewQueueCategoryFilter === "all" || item.category === reviewQueueCategoryFilter) && (reviewQueueStatusFilter === "all" || item.status === reviewQueueStatusFilter)) ?? [];
  const visibleSourceReviewItems = reviewQueue?.sourceItems.filter((item) => reviewQueueCategoryFilter === "all" || item.category === reviewQueueCategoryFilter) ?? [];
  return <section className="admin-card benchmark-override-admin-card" aria-label="벤치마크 보강 관리">
    <div className="admin-card-heading"><div><p className="eyebrow">BENCHMARK OVERRIDES</p><h3>검수된 성능 데이터 보강</h3></div><FiActivity /></div>
    <p className="admin-card-description">원문에 없거나 별도로 검수한 Cinebench·3DMark 점수를 부품 ID에 연결합니다. 모든 값은 서버에서 부품 종류·양수 정수·근거 메모·HTTPS URL을 검증한 뒤 원자적으로 저장합니다.</p>
    <div className="benchmark-override-summary"><span>저장된 보강 <strong>{overrides.length}개</strong></span><span>대상: CPU·GPU</span><span>저장소: {storageMode === "postgres" ? "PostgreSQL" : storageMode === "file" ? "JSON fallback" : "확인 중"}</span>{loading && <span>불러오는 중...</span>}{error && <span className="benchmark-override-error">{error}</span>}</div>
    {reviewQueueLoading ? <p className="benchmark-review-state"><FiLoader className="spin" /> 벤치마크 검수 우선순위를 계산하는 중...</p> : reviewQueueError ? <div className="benchmark-review-state error" role="alert"><span>{reviewQueueError}</span></div> : reviewQueue && <div className="benchmark-review-queue" aria-label="벤치마크 검수 우선순위"><div className="benchmark-review-heading"><div><span>REVIEW QUEUE</span><strong>먼저 채울 벤치마크 데이터</strong><small>미입력·부분 입력뿐 아니라 오래된 완전 세트와 확인 시점이 없는 점수도 다시 검수합니다.</small></div><button className="button button-light" type="button" onClick={() => exportReviewTemplate()} disabled={busy || reviewQueue.items.length === 0}><FiDownload /> 검수 CSV 템플릿</button><div className="benchmark-review-filters"><label><span>범주</span><select aria-label="벤치마크 검수 큐 범주" value={reviewQueueCategoryFilter} onChange={(event) => setReviewQueueCategoryFilter(event.target.value as "all" | "cpu" | "gpu")} disabled={busy}><option value="all">CPU·GPU 전체</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label><label><span>상태</span><select aria-label="벤치마크 검수 큐 상태" value={reviewQueueStatusFilter} onChange={(event) => setReviewQueueStatusFilter(event.target.value as "all" | "missing" | "partial" | "stale")} disabled={busy}><option value="all">전체 상태</option><option value="missing">점수 없음</option><option value="partial">일부 점수</option><option value="stale">갱신 필요</option></select></label></div></div><div className="benchmark-review-summary"><span>CPU <strong>{reviewQueue.totals.cpu.complete}개 완전</strong> · {reviewQueue.totals.cpu.partial + reviewQueue.totals.cpu.missing + reviewQueue.totals.cpu.stale}개 검수 필요</span><span>GPU <strong>{reviewQueue.totals.gpu.complete}개 완전</strong> · {reviewQueue.totals.gpu.partial + reviewQueue.totals.gpu.missing + reviewQueue.totals.gpu.stale}개 검수 필요</span><span>표시 {visibleReviewItems.length} / {reviewQueue.items.length}개</span></div><div className="benchmark-review-list">{visibleReviewItems.slice(0, 10).map((item) => { const sourceUrl = safeExternalUrl(item.sourceUrl); const benchmarkDate = item.benchmarkUpdatedAt && Number.isFinite(Date.parse(item.benchmarkUpdatedAt)) ? new Date(item.benchmarkUpdatedAt).toLocaleDateString("ko-KR") : "시점 없음"; return <article className="benchmark-review-item" key={item.partId}><div className="benchmark-review-item-main"><div className="benchmark-review-item-top"><span className="category-badge">{item.category === "cpu" ? "CPU" : "GPU"}</span><span className={`benchmark-review-status ${item.status}`}>{item.status === "missing" ? "점수 없음" : item.status === "partial" ? "일부 점수" : "갱신 필요"}</span><strong>{item.reviewPriorityScore}점</strong></div><strong>{item.partName}</strong><small>{item.partId} · {item.reviewReason}{item.benchmarkSourceKind ? ` · ${BENCHMARK_SOURCE_KIND_LABELS[item.benchmarkSourceKind]}` : " · 출처 유형 미분류"}</small><small>벤치마크 {benchmarkFreshnessLabels[item.benchmarkFreshness]} · {benchmarkDate} · 미확인: {item.missingScores.length > 0 ? item.missingScores.map((key) => BENCHMARK_SCORE_LABELS[key]).join(" · ") : "없음"}{Object.keys(item.presentScores).length > 0 ? ` · 확인: ${Object.entries(item.presentScores).map(([key, value]) => `${BENCHMARK_SCORE_LABELS[key as BenchmarkScoreKey]} ${value.toLocaleString("ko-KR")}`).join(" · ")}` : ""}</small></div><div className="benchmark-review-item-side"><span>{item.dataQuality === "live" ? "다나와 최신" : item.dataQuality === "manual" ? "수동 검수" : item.dataQuality === "seed" ? "프로젝트 기준" : "일부 스펙 부족"}</span><small>{item.priceKnown && item.priceWon !== undefined ? `${item.priceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}</small>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 원문 <FiExternalLink /></a>}<button className="text-button benchmark-review-add" type="button" onClick={() => addReviewItemToJson(item)} disabled={busy}>JSON에 추가</button></div></article>; })}</div><p className="benchmark-review-note"><FiInfo /> CSV 템플릿은 기존 점수만 채워 내보내고, 검수 근거 메모와 출처 URL은 비워 둡니다. 점수를 채운 뒤 다시 가져오고 서버 검증을 통과해야 저장됩니다.</p></div>}
    {reviewQueue && (reviewQueue.sourceTotals.cpu.unclassified + reviewQueue.sourceTotals.gpu.unclassified > 0) && <div className="benchmark-review-queue benchmark-source-review-queue" aria-label="벤치마크 출처 분류 검수"><div className="benchmark-review-heading"><div><span>SOURCE REVIEW</span><strong>출처 분류가 필요한 벤치마크</strong><small>점수는 있지만 출처 provenance가 없는 항목입니다. 기존 점수는 보존하고 공식·독립 리뷰·사용자 실측 근거를 입력하세요.</small></div><button className="button button-light" type="button" onClick={() => exportReviewTemplate("sources")} disabled={busy || reviewQueue.sourceItems.length === 0}><FiDownload /> 출처 검수 CSV</button></div><div className="benchmark-review-summary"><span>CPU <strong>{reviewQueue.sourceTotals.cpu.unclassified}개</strong></span><span>GPU <strong>{reviewQueue.sourceTotals.gpu.unclassified}개</strong></span><span>표시 {visibleSourceReviewItems.length} / {reviewQueue.sourceItems.length}개</span></div><div className="benchmark-review-list">{visibleSourceReviewItems.slice(0, 10).map((item) => { const sourceUrl = safeExternalUrl(item.sourceUrl); const benchmarkDate = item.benchmarkUpdatedAt && Number.isFinite(Date.parse(item.benchmarkUpdatedAt)) ? new Date(item.benchmarkUpdatedAt).toLocaleDateString("ko-KR") : "시점 없음"; return <article className="benchmark-review-item" key={item.partId}><div className="benchmark-review-item-main"><div className="benchmark-review-item-top"><span className="category-badge">{item.category === "cpu" ? "CPU" : "GPU"}</span><span className="benchmark-review-status source-unclassified">출처 확인</span><strong>{item.reviewPriorityScore}점</strong></div><strong>{item.partName}</strong><small>{item.partId} · {item.reviewReason}</small><small>벤치마크 {benchmarkFreshnessLabels[item.benchmarkFreshness]} · {benchmarkDate} · 확인: {Object.entries(item.presentScores).map(([key, value]) => BENCHMARK_SCORE_LABELS[key as BenchmarkScoreKey] + " " + value.toLocaleString("ko-KR")).join(" · ")}</small></div><div className="benchmark-review-item-side"><span>{item.dataQuality === "live" ? "다나와 최신" : item.dataQuality === "manual" ? "수동 검수" : item.dataQuality === "seed" ? "프로젝트 기준" : "일부 스펙 부족"}</span><small>{item.priceKnown && item.priceWon !== undefined ? item.priceWon.toLocaleString("ko-KR") + "원" : "가격 확인 필요"}</small>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 원문 <FiExternalLink /></a>}<button className="text-button benchmark-review-add" type="button" onClick={() => addReviewItemToJson(item)} disabled={busy}>JSON에 추가</button></div></article>; })}</div><p className="benchmark-review-note"><FiInfo /> CSV 템플릿은 확인된 점수를 유지하고 sourceNote·출처 URL을 비워 둡니다. JSON에 추가한 뒤 출처 유형·근거 메모·HTTPS URL을 입력하고 서버 검증을 통과해야 저장됩니다.</p></div>}
    <div className="benchmark-override-composer">
      <div className="benchmark-override-composer-heading"><div><span>ROW BUILDER</span><strong>부품을 검색해 벤치마크 행 만들기</strong><small>partId를 직접 입력하지 않고 CPU·GPU를 검색해 JSON에 추가합니다. 추가 후 반드시 서버 검증을 실행해야 합니다.</small></div><FiSearch /></div>
      <div className="benchmark-override-composer-search"><label><span>범주</span><select aria-label="벤치마크 보강 행 범주" value={composerCategory} onChange={(event) => { setComposerCategory(event.target.value as "cpu" | "gpu"); setComposerSelectedPartId(""); setComposerScores({}); }} disabled={busy}><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label><label><span>부품 검색</span><input value={composerQuery} onChange={(event) => setComposerQuery(event.target.value)} placeholder="모델명·브랜드 검색" disabled={busy} /></label></div>
      {composerPartsLoading ? <p className="benchmark-override-composer-state"><FiLoader className="spin" /> 부품 검색 중...</p> : composerParts.length > 0 ? <div className="benchmark-override-composer-results">{composerParts.map((part) => <button className={part.id === composerSelectedPartId ? "selected" : ""} type="button" onClick={() => setComposerSelectedPartId(part.id)} key={part.id}><strong>{part.name}</strong><small>{part.id} · {part.dataQuality === "live" ? "다나와 최신" : part.dataQuality === "manual" ? "수동 검수" : part.dataQuality === "incomplete" ? "일부 스펙 부족" : "프로젝트 데이터"}</small></button>)}</div> : <p className="benchmark-override-composer-state">검색 결과가 없습니다.</p>}
      {composerSelectedPart && <div className="benchmark-override-composer-form"><div className="benchmark-override-selected"><span>선택한 부품</span><strong>{composerSelectedPart.name}</strong><small>{composerSelectedPart.id}</small></div><div className="benchmark-override-score-fields">{composerScoreFields.map((key) => <label key={key}><span>{BENCHMARK_SCORE_LABELS[key]}</span><input type="number" min="1" max="1000000" step="1" value={composerScores[key] ?? ""} onChange={(event) => setComposerScores((current) => ({ ...current, [key]: event.target.value }))} placeholder="점수" disabled={busy} /></label>)}</div><div className="benchmark-override-source-fields"><label><span>벤치마크 출처 유형</span><select aria-label="벤치마크 보강 출처 유형" value={composerSourceKind} onChange={(event) => setComposerSourceKind(event.target.value as BenchmarkSourceKind)} disabled={busy}>{Object.entries(BENCHMARK_SOURCE_KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>검수 근거 메모</span><input value={composerSourceNote} onChange={(event) => setComposerSourceNote(event.target.value)} maxLength={500} placeholder="예: 공식 측정표·측정 조건" disabled={busy} /></label><label><span>근거 URL (HTTPS)</span><input value={composerSourceUrl} onChange={(event) => setComposerSourceUrl(event.target.value)} placeholder="https://..." disabled={busy} /></label></div><button className="button button-light" type="button" onClick={addComposerRow} disabled={busy}><FiPlus /> 입력 JSON에 추가</button></div>}
    </div>
    <div className={csvOpen ? "benchmark-override-csv expanded" : "benchmark-override-csv"}><button className="benchmark-override-csv-toggle" type="button" aria-expanded={csvOpen} onClick={() => setCsvOpen((current) => !current)}><span><FiDatabase /> CSV 직접 붙여넣기</span><small>{csvOpen ? "닫기" : "스프레드시트에서 가져오기"}</small><FiChevronDown /></button>{csvOpen && <div className="benchmark-override-csv-body"><textarea aria-label="벤치마크 보강 CSV" value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="partId,partName,category,cinebenchR23Single,cinebenchR23Multi,gpu3dmarkTimeSpyScore,gpu3dmarkPortRoyalScore,sourceNote,sourceKind,sourceUrl,updatedAt\ngpu-...,그래픽카드,gpu,,,15000,11000,측정 조건,independent_review,https://...,2026-08-28" disabled={busy} /><button className="button button-secondary" type="button" onClick={importCsv} disabled={busy || !csvText.trim()}><FiDatabase /> CSV를 JSON으로 변환</button></div>}</div>
    <textarea aria-label="벤치마크 보강 JSON" value={json} onChange={(event) => handleJsonChange(event.target.value)} placeholder={'{"items":[{"partId":"cpu-...","cinebenchR23Single":2100,"sourceKind":"official","sourceNote":"공식 측정표·측정 조건","sourceUrl":"https://..."}]}' } disabled={busy} />
    <div className="benchmark-override-actions"><input ref={benchmarkCsvInputRef} className="benchmark-override-csv-input" type="file" accept=".csv,text/csv" aria-label="벤치마크 보강 CSV 파일 가져오기" onChange={(event) => void importCsvFile(event)} disabled={busy} /><button className="button button-light" type="button" onClick={() => benchmarkCsvInputRef.current?.click()} disabled={busy}><FiDownload /> CSV 파일 가져오기</button><button className="button button-secondary" type="button" onClick={() => void validate()} disabled={busy || !json.trim()}><FiCheckCircle /> JSON 검증</button><button className="button button-primary" type="button" onClick={() => void save()} disabled={busy || !canSave}><FiSave /> 벤치마크 저장</button><button className="button button-light" type="button" onClick={() => void exportOverrides()} disabled={busy}><FiExternalLink /> JSON 내보내기</button><button className="button button-light" type="button" onClick={exportCsv} disabled={busy || overrides.length === 0}><FiExternalLink /> CSV 내보내기</button></div>
    {validation && <div className={validation.invalidCount === 0 ? "benchmark-override-validation valid" : "benchmark-override-validation invalid"} role="status"><strong>{validation.invalidCount === 0 ? <><FiCheckCircle /> 저장 가능</> : <><FiAlertTriangle /> 저장 차단</>} · {validation.validCount}개 저장 가능 · {validation.invalidCount}개 수정 필요</strong>{validation.invalidCount === 0 && <small>신규 {createCount}개 · 수정 {updateCount}개 · 변경 없음 {unchangedCount}개</small>}{changePreviewItems.slice(0, 5).map((item) => <p key={`preview-${item.partId}`}><b>{item.partName ?? item.partId}</b> · {item.operation === "create" ? "신규 등록" : "기존 값 수정"}{item.changedFields && item.changedFields.length > 0 ? ` · 변경: ${item.changedFields.join(", ")}` : ""}</p>)}{invalidItems.slice(0, 5).map((item) => <p key={item.partId}><b>{item.partName ?? item.partId}</b> · {item.errors.join(" · ")}</p>)}{invalidItems.length > 5 && <small>그 외 {invalidItems.length - 5}개 오류도 서버 응답에 포함되어 있습니다.</small>}</div>}
    <div className="benchmark-override-list-heading"><strong>저장된 보강 목록</strong><span>{visibleOverrides.length} / {overrides.length}개</span></div>
    <div className="benchmark-override-list-controls"><label><span>목록 검색</span><input aria-label="저장된 보강 목록 검색" value={overrideQuery} onChange={(event) => setOverrideQuery(event.target.value)} placeholder="부품명·ID·근거 검색" disabled={busy} /></label><label><span>범주</span><select aria-label="저장된 보강 범주 필터" value={overrideCategoryFilter} onChange={(event) => setOverrideCategoryFilter(event.target.value as "all" | "cpu" | "gpu")} disabled={busy}><option value="all">CPU·GPU 전체</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label><label><span>출처</span><select aria-label="저장된 보강 출처 필터" value={overrideSourceFilter} onChange={(event) => setOverrideSourceFilter(event.target.value as BenchmarkSourceKind | "unclassified" | "all")} disabled={busy}><option value="all">전체 출처</option>{Object.entries(BENCHMARK_SOURCE_KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}<option value="unclassified">출처 유형 미분류</option></select></label></div>
    <div className="benchmark-override-list">{overrides.length === 0 ? <p className="benchmark-override-empty">아직 수동으로 보강한 벤치마크 데이터가 없습니다.</p> : visibleOverrides.length === 0 ? <p className="benchmark-override-empty">검색·범주 조건에 맞는 보강 데이터가 없습니다.</p> : visibleOverrides.map((override) => <article className="benchmark-override-item" key={override.partId}><div><strong>{override.partName ?? override.partId}</strong><span>{override.category ? `${CATEGORY_LABELS[override.category]} · ` : ""}{benchmarkOverrideScoreText(override)}</span><small>{override.partId} · {benchmarkSourceKindLabel(override.sourceKind)} · {override.sourceNote}{override.sourceUrl ? ` · ${override.sourceUrl}` : ""}</small></div><div><small>{new Date(override.updatedAt).toLocaleDateString("ko-KR")}</small><button className="text-button danger-text-button" type="button" onClick={() => void removeOverride(override.partId)} disabled={busy}><FiTrash2 /> 삭제</button></div></article>)}</div>
    <p className="benchmark-override-note"><FiInfo /> JSON 항목 예시: CPU는 <code>cinebenchR23Single</code>·<code>cinebenchR23Multi</code>, GPU는 <code>gpu3dmarkTimeSpyScore</code>·<code>gpu3dmarkPortRoyalScore</code>를 사용합니다. 원문과 다른 값을 입력할 때는 측정 조건을 sourceNote에 남겨 주세요.</p>
  </section>;
}
