import { useEffect, useRef, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLoader, FiPlus, FiSave, FiSearch, FiTrash2 } from "react-icons/fi";
import type { Benchmark3DMarkBatchItem, Benchmark3DMarkBatchRequestItem, Benchmark3DMarkBatchResponse, Benchmark3DMarkImportPreview, Benchmark3DMarkReviewWorkItem, Benchmark3DMarkReviewWorkPackage, BenchmarkOverride, BenchmarkOverrideOperation, BenchmarkReviewQueue, BenchmarkScoreKey, BenchmarkSourceCheckBatchResponse, BenchmarkSourceCheckHistoryEntry, BenchmarkSourceKind, Part, PartCategory, ServiceMeta } from "../shared/types";
import { BENCHMARK_3DMARK_BATCH_MAX_ITEMS, BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS } from "../shared/types";
import { benchmarkSourceCheckLabelFor } from "../shared/benchmark-evidence";
import { benchmarkOverridesToCsv, benchmarkReviewItemsToCsv, parseBenchmarkOverridesCsv } from "../shared/benchmark-csv";
import { api } from "./api";
import { partSummary } from "./admin-panel-shared";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";

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

type Benchmark3DMarkImportResponse = Benchmark3DMarkImportPreview & {
  partId: string;
  partName: string;
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
  ["unclassified", "출처 확인 필요"]
] as const;

function benchmarkOverrideScoreText(override: BenchmarkOverride) {
  return Object.entries(override.scores)
    .map(([key, value]) => `${BENCHMARK_SCORE_LABELS[key as BenchmarkScoreKey] ?? key} ${value.toLocaleString("ko-KR")}`)
    .join(" · ");
}

function benchmarkSourceKindLabel(kind: BenchmarkSourceKind | undefined) {
  return kind ? BENCHMARK_SOURCE_KIND_LABELS[kind] : "출처 확인 필요";
}

function benchmarkSourceCheckText(sourceCheck: BenchmarkOverride["sourceCheck"]) {
  return benchmarkSourceCheckLabelFor(sourceCheck);
}

function benchmarkSourceCheckTransitionText(transition: BenchmarkSourceCheckHistoryEntry["transition"]) {
  return transition === "initial" ? "최초 점검" : transition === "changed" ? "상태 변경" : "상태 유지";
}

function csvCellsForBenchmark3DMarkBatchLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  cells.push(cell.trim());
  return cells;
}

function parseBenchmark3DMarkBatchInput(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("3DMark 일괄 입력을 먼저 붙여 넣어 주세요.");
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("3DMark 일괄 입력 JSON 형식이 올바르지 않습니다.");
    }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).items)) return (parsed as Record<string, unknown>).items as unknown[];
    throw new Error("JSON은 배열 또는 {\"items\": [...]} 형식이어야 합니다.");
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("처리할 3DMark 일괄 입력 행이 없습니다.");
  const firstCells = csvCellsForBenchmark3DMarkBatchLine(lines[0]).map((cell) => cell.toLocaleLowerCase("en-US"));
  const hasHeader = firstCells[0] === "partid" && firstCells[1] === "sourceurl";
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line, index) => {
    const cells = csvCellsForBenchmark3DMarkBatchLine(line);
    if (cells.length !== 2) throw new Error(`CSV ${hasHeader ? index + 2 : index + 1}행은 partId,sourceUrl 두 열만 사용해야 합니다.`);
    return { partId: cells[0], sourceUrl: cells[1] } satisfies Benchmark3DMarkBatchRequestItem;
  });
}

function benchmark3DMarkBatchStatusLabel(status: Benchmark3DMarkBatchItem["status"]) {
  return status === "matched" ? "GPU 식별 일치" : status === "manual_required" ? "수동 대조" : status === "not_found" ? "식별 불일치" : "처리 실패";
}

function benchmark3DMarkBatchStatusDescription(item: Benchmark3DMarkBatchItem) {
  if (item.status === "failed") return item.error ?? "결과를 읽지 못했습니다.";
  const preview = item.preview;
  if (!preview) return "결과 미리보기 정보가 없습니다.";
  return `${preview.benchmarkLabel} ${preview.score.toLocaleString("ko-KR")}점${preview.gpuName ? ` · 결과 GPU ${preview.gpuName}` : ""}`;
}

function BenchmarkSourceCheckHistoryPanel({ entries, loading, error }: { entries: BenchmarkSourceCheckHistoryEntry[]; loading: boolean; error: string | null }) {
  return <div className="benchmark-source-check-history" data-testid="benchmark-source-check-history" aria-label="벤치마크 출처 확인 이력">{loading ? <span><FiLoader className="spin" /> 점검 이력 불러오는 중...</span> : error ? <span className="error"><FiAlertTriangle /> {error}</span> : entries.length === 0 ? <span><FiInfo /> 저장된 점검 이력이 없습니다.</span> : entries.slice(0, 6).map((entry) => <article key={entry.id}><div><span className={`benchmark-source-check-history-transition ${entry.transition}`}>{benchmarkSourceCheckTransitionText(entry.transition)}</span><small>{new Date(entry.recordedAt).toLocaleString("ko-KR")}</small></div><strong>{benchmarkSourceCheckText(entry.sourceCheck)}</strong><small>HTTP {entry.sourceCheck.httpStatus ?? "확인 필요"} · 모델 {entry.sourceCheck.identityStatus === "matched" ? "식별됨" : "확인 필요"} · {entry.sourceCheck.detail ?? "상세 없음"}</small></article>)}</div>;
}

function BenchmarkSourceCheckTools({ overrides, busy, sourceCheckingPartId, sourceHistoryPartId, sourceHistory, sourceHistoryLoading, sourceHistoryError, onCheck, onCheckBatch, onToggleHistory }: { overrides: BenchmarkOverrideListItem[]; busy: boolean; sourceCheckingPartId: string | null; sourceHistoryPartId: string | null; sourceHistory: BenchmarkSourceCheckHistoryEntry[]; sourceHistoryLoading: boolean; sourceHistoryError: string | null; onCheck: (partId: string) => void; onCheckBatch: () => void; onToggleHistory: (partId: string) => void }) {
  const targets = overrides.filter((override) => Boolean(override.sourceUrl));
  if (targets.length === 0) return null;
  return <section className="benchmark-source-check-tools" aria-label="벤치마크 출처 확인" data-testid="benchmark-source-check-tools"><div className="benchmark-source-check-heading"><div><strong>벤치마크 출처 확인</strong><small>저장된 HTTPS 페이지에 실제 접근하고 부품 모델명/SKU가 본문에 있는지 확인합니다. 확인 결과는 추천 점수에 반영됩니다.</small></div><FiSearch /></div><div className="benchmark-source-check-batch-actions"><button className="button button-light" type="button" data-testid="benchmark-source-check-batch" onClick={onCheckBatch} disabled={busy}>{sourceCheckingPartId === "__batch__" ? <><FiLoader className="spin" /> 일괄 점검 중...</> : <><FiSearch /> 저장 URL 일괄 점검</>}</button><span>최대 50개 · 현재 필터 기준</span></div><div className="benchmark-source-check-list">{targets.slice(0, 12).map((override) => { const sourceUrl = safeHttpsUrl(override.sourceUrl); return <article key={override.partId}><div><strong>{override.partName ?? override.partId}</strong><small>{override.partId} · {benchmarkSourceCheckText(override.sourceCheck)}{override.sourceCheck?.checkedAt ? ` · ${new Date(override.sourceCheck.checkedAt).toLocaleDateString("ko-KR")}` : ""}</small></div><div>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 페이지</a>}<button className="text-button" type="button" onClick={() => onCheck(override.partId)} disabled={busy}>{sourceCheckingPartId === override.partId ? <><FiLoader className="spin" /> 점검 중...</> : <><FiSearch /> {override.sourceCheck ? "다시 점검" : "페이지 점검"}</>}</button><button className="text-button" type="button" onClick={() => onToggleHistory(override.partId)} disabled={busy}>{sourceHistoryPartId === override.partId ? "이력 닫기" : "이력 보기"}</button></div></article>; })}</div>{sourceHistoryPartId && <BenchmarkSourceCheckHistoryPanel entries={sourceHistory} loading={sourceHistoryLoading} error={sourceHistoryError} />}{targets.length > 12 && <small className="benchmark-source-check-more">그 외 {targets.length - 12}개는 저장된 보강 목록에서 확인하세요.</small>}</section>;
}

const BENCHMARK_3DMARK_WORK_PROGRESS_KEY = "pc-supporter-3dmark-review-work-progress-v1";
const BENCHMARK_3DMARK_WORK_PACKAGE_SIZE = 24;

type Benchmark3DMarkWorkProgress = {
  offset: number;
  queueFingerprint: string | null;
  completedIds: string[];
};

function readBenchmark3DMarkWorkProgress(): Benchmark3DMarkWorkProgress {
  const empty: Benchmark3DMarkWorkProgress = { offset: 0, queueFingerprint: null, completedIds: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(BENCHMARK_3DMARK_WORK_PROGRESS_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const value = parsed as Record<string, unknown>;
    const offset = typeof value.offset === "number" && Number.isInteger(value.offset) && value.offset >= 0 ? value.offset : 0;
    const queueFingerprint = typeof value.queueFingerprint === "string" && value.queueFingerprint.trim() ? value.queueFingerprint.trim() : null;
    const completedIds = Array.isArray(value.completedIds) ? [...new Set(value.completedIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))] : [];
    return { offset, queueFingerprint, completedIds };
  } catch {
    return empty;
  }
}

function writeBenchmark3DMarkWorkProgress(progress: Benchmark3DMarkWorkProgress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BENCHMARK_3DMARK_WORK_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Local progress is best effort; the read-only server package remains authoritative.
  }
}

function Benchmark3DMarkWorkPackagePanel({ busy, onToast, onOpenItem, onPrepareBatchInput, refreshToken }: { busy: boolean; onToast: (message: string) => void; onOpenItem: (item: Benchmark3DMarkReviewWorkItem) => void; onPrepareBatchInput: (items: Benchmark3DMarkReviewWorkItem[]) => void; refreshToken: number }) {
  const initialProgress = readBenchmark3DMarkWorkProgress();
  const [offset, setOffset] = useState(initialProgress.offset);
  const [workPackage, setWorkPackage] = useState<Benchmark3DMarkReviewWorkPackage | null>(null);
  const [completedIds, setCompletedIds] = useState(initialProgress.completedIds);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const queueFingerprintRef = useRef<string | null>(initialProgress.queueFingerprint);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== BENCHMARK_3DMARK_WORK_PROGRESS_KEY) return;
      const next = readBenchmark3DMarkWorkProgress();
      queueFingerprintRef.current = next.queueFingerprint;
      setWorkPackage(null);
      setError(null);
      setCompletedIds(next.completedIds);
      setOffset(next.offset);
      setRetryNonce((current) => current + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ offset: String(offset), limit: String(BENCHMARK_3DMARK_WORK_PACKAGE_SIZE) });
    if (offset > 0 && queueFingerprintRef.current) params.set("queueFingerprint", queueFingerprintRef.current);
    setLoading(true);
    setError(null);
    setWorkPackage(null);
    void api<Benchmark3DMarkReviewWorkPackage>(`/api/admin/benchmark-review/work-package?${params.toString()}`)
      .then((value) => {
        if (cancelled) return;
        if (value.queueChanged && offset > 0) {
          queueFingerprintRef.current = value.queueFingerprint;
          setOffset(0);
          setWorkPackage(null);
          setCompletedIds([]);
          writeBenchmark3DMarkWorkProgress({ offset: 0, queueFingerprint: value.queueFingerprint, completedIds: [] });
          onToast("3DMark GPU 확인 목록이 갱신되어 첫 작업 패키지부터 다시 표시합니다.");
          return;
        }
        const saved = readBenchmark3DMarkWorkProgress();
        const nextCompletedIds = saved.queueFingerprint === value.queueFingerprint ? saved.completedIds : [];
        queueFingerprintRef.current = value.queueFingerprint;
        setCompletedIds(nextCompletedIds);
        setWorkPackage(value);
        writeBenchmark3DMarkWorkProgress({ offset: value.offset, queueFingerprint: value.queueFingerprint, completedIds: nextCompletedIds });
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "3DMark GPU 확인 작업 패키지를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset, onToast, refreshToken, retryNonce]);

  function toggleCompleted(partId: string) {
    const next = completedIds.includes(partId) ? completedIds.filter((id) => id !== partId) : [...completedIds, partId];
    setCompletedIds(next);
    writeBenchmark3DMarkWorkProgress({ offset, queueFingerprint: queueFingerprintRef.current, completedIds: next });
  }

  function resetProgress() {
    setOffset(0);
    setWorkPackage(null);
    setCompletedIds([]);
    queueFingerprintRef.current = null;
    writeBenchmark3DMarkWorkProgress({ offset: 0, queueFingerprint: null, completedIds: [] });
    setRetryNonce((current) => current + 1);
    onToast("3DMark GPU 확인 작업 패키지를 처음부터 다시 표시합니다.");
  }

  function downloadPackage() {
    if (!workPackage) return;
    const blob = new Blob([`${JSON.stringify(workPackage, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `3dmark-gpu-review-package-${workPackage.generatedAt.slice(0, 10)}-offset-${workPackage.offset}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`${workPackage.items.length}개 3DMark GPU 작업 패키지를 저장했습니다.`);
  }

  function prepareBatchInput() {
    if (!workPackage || workPackage.items.length === 0) return;
    const pendingItems = workPackage.items.filter((item) => !completedIds.includes(item.partId));
    onPrepareBatchInput((pendingItems.length > 0 ? pendingItems : workPackage.items).slice(0, BENCHMARK_3DMARK_BATCH_MAX_ITEMS));
  }

  const completedCount = workPackage?.items.filter((item) => completedIds.includes(item.partId)).length ?? 0;
  const packageProgressPercent = workPackage && workPackage.items.length > 0 ? Math.round((completedCount / workPackage.items.length) * 100) : 0;
  return <section className="benchmark-3dmark-work-package" data-testid="benchmark-3dmark-work-package" aria-label="3DMark GPU 확인 작업 패키지"><div className="benchmark-3dmark-work-heading"><div><strong>GPU 3DMark 확인 작업 패키지</strong><small>Time Spy·Port Royal 점수가 하나라도 없는 GPU만 저장본으로 묶습니다. 작업 위치와 체크 상태는 이 브라우저에 보관하며, 점수 저장은 기존 확인 절차를 거칩니다.</small></div><FiActivity /><div className="benchmark-3dmark-work-actions"><button className="button button-secondary" type="button" data-testid="benchmark-3dmark-package-to-batch" onClick={prepareBatchInput} disabled={busy || loading || !workPackage || workPackage.items.length === 0}><FiDatabase /> 일괄 입력에 ID 준비</button><button className="button button-light" type="button" data-testid="benchmark-3dmark-package-download" onClick={downloadPackage} disabled={busy || loading || !workPackage || workPackage.items.length === 0}><FiDownload /> JSON 패키지 저장</button><button className="text-button" type="button" data-testid="benchmark-3dmark-package-reset" onClick={resetProgress} disabled={busy || loading}>처음부터</button></div></div>{loading && !workPackage ? <p className="benchmark-3dmark-work-state" role="status"><FiLoader className="spin" /> 3DMark 누락 GPU 작업 목록을 계산하는 중...</p> : error && !workPackage ? <div className="benchmark-3dmark-work-state error" role="alert"><FiAlertTriangle /> <span>{error}</span><button className="text-button" type="button" onClick={() => setRetryNonce((current) => current + 1)}>다시 시도</button></div> : workPackage && <><div className="benchmark-3dmark-work-summary"><span>전체 GPU <strong>{workPackage.summary.totalGpu.toLocaleString("ko-KR")}개</strong></span><span>완전 세트 <strong>{workPackage.summary.completeCount.toLocaleString("ko-KR")}개</strong></span><span>부분 점수 <strong>{workPackage.summary.partialCount.toLocaleString("ko-KR")}개</strong></span><span>점수 없음 <strong>{workPackage.summary.missingCount.toLocaleString("ko-KR")}개</strong></span><span>확인 목록 <strong>{workPackage.summary.queueTotal.toLocaleString("ko-KR")}개</strong></span></div><div className="benchmark-3dmark-work-progress" data-testid="benchmark-3dmark-package-progress"><div><span>이번 패키지 진행률</span><strong>{completedCount} / {workPackage.items.length} · {packageProgressPercent}%</strong></div><div className="benchmark-3dmark-work-progress-track" aria-hidden="true"><span style={{ width: `${packageProgressPercent}%` }} /></div><small>{workPackage.summary.remainingCount === 0 ? "현재 조건의 모든 GPU를 확인했습니다." : `이 패키지 뒤에 ${workPackage.summary.remainingCount.toLocaleString("ko-KR")}개가 남아 있습니다.`}</small></div>{workPackage.items.length === 0 ? <p className="benchmark-3dmark-work-empty"><FiCheckCircle /> 현재 3DMark 점수가 비어 있는 GPU가 없습니다.</p> : <div className="benchmark-3dmark-work-list">{workPackage.items.map((item) => { const isCompleted = completedIds.includes(item.partId); return <article className={isCompleted ? "completed" : ""} key={item.partId}><div className="benchmark-3dmark-work-item-main"><div className="benchmark-3dmark-work-item-top"><span className={`benchmark-3dmark-work-status ${item.status}`}>{item.status === "partial" ? "일부 점수" : "점수 없음"}</span><strong>{item.reviewPriorityScore}점</strong></div><strong>{item.partName}</strong><small>{item.partId} · {item.reviewReason}</small><small>미확인: {item.missingScores.map((key) => BENCHMARK_SCORE_LABELS[key]).join(" · ")}{Object.keys(item.presentScores).length > 0 ? ` · 확인: ${Object.entries(item.presentScores).map(([key, value]) => `${BENCHMARK_SCORE_LABELS[key as BenchmarkScoreKey]} ${value.toLocaleString("ko-KR")}`).join(" · ")}` : ""}</small></div><div className="benchmark-3dmark-work-item-actions"><a href={item.catalogUrl}>카탈로그</a><button className="text-button" type="button" data-testid={`benchmark-3dmark-package-open-${item.partId}`} data-part-id={item.partId} data-part-name={item.partName} onClick={() => onOpenItem(item)} disabled={busy}><FiActivity /> 3DMark 확인 열기</button><label><input type="checkbox" checked={isCompleted} onChange={() => toggleCompleted(item.partId)} disabled={busy} /> 작업 완료</label></div></article>; })}</div>}<div className="benchmark-3dmark-work-pagination"><button className="button button-light button-small" type="button" data-testid="benchmark-3dmark-package-previous" onClick={() => setOffset((current) => Math.max(0, current - BENCHMARK_3DMARK_WORK_PACKAGE_SIZE))} disabled={busy || loading || offset === 0}>이전 패키지</button><span data-testid="benchmark-3dmark-package-range">{workPackage.items.length === 0 ? "0 / 0" : `${workPackage.offset + 1}–${workPackage.offset + workPackage.items.length} / ${workPackage.summary.queueTotal}`}</span><button className="button button-light button-small" type="button" data-testid="benchmark-3dmark-package-next" onClick={() => setOffset(workPackage.nextOffset ?? offset)} disabled={busy || loading || workPackage.nextOffset === undefined}>다음 패키지</button></div><p className="benchmark-3dmark-work-note"><FiInfo /> 서버는 매 요청마다 현재 queueFingerprint를 계산합니다. 목록이 바뀌면 이전 offset을 재사용하지 않고 첫 패키지부터 다시 표시하며, 체크 상태는 점수 저장 완료와 별개인 작업자 메모입니다.</p></>}</section>;
}

type Benchmark3DMarkBatchSeed = { token: number; input: string; count: number };

function csvValueForBenchmark3DMarkBatch(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function benchmark3DMarkBatchSeedFor(items: Benchmark3DMarkReviewWorkItem[]): Benchmark3DMarkBatchSeed {
  const input = ["partId,sourceUrl", ...items.map((item) => `${csvValueForBenchmark3DMarkBatch(item.partId)},`)].join("\n");
  return { token: Date.now(), input, count: items.length };
}

function Benchmark3DMarkBatchPanel({ busy, json, onJsonChange, onToast, preparedInput }: { busy: boolean; json: string; onJsonChange: (value: string) => void; onToast: (message: string) => void; preparedInput: Benchmark3DMarkBatchSeed | null }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Benchmark3DMarkBatchResponse | null>(null);
  const mountedRef = useRef(false);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!preparedInput) return;
    setInput(preparedInput.input);
    setResult(null);
  }, [preparedInput?.input, preparedInput?.token]);

  async function previewBatch() {
    let items: unknown[];
    try {
      items = parseBenchmark3DMarkBatchInput(input);
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "3DMark 일괄 입력을 읽지 못했습니다.");
      return;
    }
    if (items.length === 0) {
      onToast("최소 1개의 GPU 결과 URL을 입력해 주세요.");
      return;
    }
    if (items.length > BENCHMARK_3DMARK_BATCH_MAX_ITEMS) {
      onToast(`한 번에 최대 ${BENCHMARK_3DMARK_BATCH_MAX_ITEMS}개까지 미리 볼 수 있습니다.`);
      return;
    }
    const requestVersion = ++requestVersionRef.current;
    const isCurrent = () => mountedRef.current && requestVersionRef.current === requestVersion;
    setLoading(true);
    setResult(null);
    try {
      const response = await api<Benchmark3DMarkBatchResponse>("/api/admin/benchmark-import/3dmark/batch", { method: "POST", body: JSON.stringify({ items }) });
      if (!isCurrent()) return;
      setResult(response);
      onToast(`3DMark ${response.requestedCount}개를 확인했습니다. 식별 일치 ${response.matchedCount}개 · 수동 대조 ${response.reviewCount}개 · 실패 ${response.failedCount}개`);
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "3DMark 일괄 미리보기에 실패했습니다.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(["partId,sourceUrl\n"], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "3dmark-batch-input-template.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast("3DMark 일괄 입력 CSV 양식을 저장했습니다.");
  }

  function addMatchedToJson() {
    const matchedItems = result?.items.filter((item) => item.status === "matched" && item.preview) ?? [];
    if (matchedItems.length === 0) {
      onToast("GPU 식별자가 일치한 결과가 없어 JSON에 추가할 수 없습니다.");
      return;
    }
    try {
      const parsed: unknown = json.trim() ? JSON.parse(json) : { items: [] };
      const existingItems: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).items)
          ? (parsed as Record<string, unknown>).items as unknown[]
          : (() => { throw new Error("invalid benchmark batch shape"); })();
      const nextItems = [...existingItems];
      matchedItems.forEach((item) => {
        const preview = item.preview!;
        const existingIndex = nextItems.findIndex((value) => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).partId === item.partId);
        const existing = existingIndex >= 0 && nextItems[existingIndex] && typeof nextItems[existingIndex] === "object" && !Array.isArray(nextItems[existingIndex]) ? nextItems[existingIndex] as Record<string, unknown> : {};
        const nextItem: Record<string, unknown> = {
          ...existing,
          partId: item.partId,
          [preview.scoreKey]: preview.score,
          sourceKind: "community_measurement",
          sourceNote: `${preview.benchmarkLabel} 결과 ID ${preview.resultId} · 결과 페이지 GPU 식별자 일치 확인`,
          sourceUrl: preview.sourceUrl
        };
        if (existingIndex >= 0) nextItems[existingIndex] = nextItem;
        else nextItems.push(nextItem);
      });
      onJsonChange(JSON.stringify({ items: nextItems }, null, 2));
      onToast(`식별자가 일치한 ${matchedItems.length}개 3DMark 결과를 입력 JSON에 반영했습니다. JSON 확인 후 저장해 주세요.`);
    } catch {
      onToast("기존 JSON 형식이 올바르지 않아 3DMark 결과를 반영하지 못했습니다. JSON을 먼저 수정해 주세요.");
    }
  }

  return <section className="benchmark-3dmark-batch" data-testid="benchmark-3dmark-batch" aria-label="3DMark 결과 일괄 미리보기"><div className="benchmark-3dmark-batch-heading"><div><strong>여러 GPU 결과 URL을 한 번에 확인</strong><small>작업 패키지의 partId와 3DMark 공식 결과 URL을 CSV 또는 JSON으로 붙여 넣습니다. 서버는 최대 {BENCHMARK_3DMARK_BATCH_MAX_ITEMS}개를 동시에 확인하고, 식별 일치 결과만 기존 확인 JSON에 선택적으로 반영합니다.</small></div><FiDatabase /></div><div className="benchmark-3dmark-batch-input-row"><label><span>입력 형식 · partId,sourceUrl</span><textarea aria-label="3DMark 일괄 입력" data-testid="benchmark-3dmark-batch-input" value={input} onChange={(event) => { setInput(event.target.value); setResult(null); }} placeholder={'partId,sourceUrl\ngpu-rtx-4060,https://www.3dmark.com/spy/62191556\ngpu-...,https://www.3dmark.com/prt/123456'} disabled={busy || loading} /></label><div className="benchmark-3dmark-batch-input-actions"><button className="button button-secondary" type="button" data-testid="benchmark-3dmark-batch-preview" onClick={() => void previewBatch()} disabled={busy || loading || !input.trim()}>{loading ? <><FiLoader className="spin" /> 일괄 확인 중...</> : <><FiSearch /> 일괄 미리보기</>}</button><button className="button button-light" type="button" data-testid="benchmark-3dmark-batch-template" onClick={downloadTemplate} disabled={busy || loading}><FiDownload /> CSV 양식</button></div></div>{result && <><div className="benchmark-3dmark-batch-summary" data-testid="benchmark-3dmark-batch-summary"><span>요청 <strong>{result.requestedCount}</strong></span><span className="matched">식별 일치 <strong>{result.matchedCount}</strong></span><span className="review">수동 대조 <strong>{result.reviewCount}</strong></span><span className="failed">실패 <strong>{result.failedCount}</strong></span></div><div className="benchmark-3dmark-batch-list">{result.items.map((item) => <article className={`benchmark-3dmark-batch-item ${item.status}`} key={`${item.row}-${item.partId}`}><div className="benchmark-3dmark-batch-item-main"><div className="benchmark-3dmark-batch-item-top"><span>행 {item.row}</span><strong className={item.status}>{benchmark3DMarkBatchStatusLabel(item.status)}</strong></div><b>{(item.partName ?? item.partId) || `입력 행 ${item.row}`}</b><small>{item.partId || "partId 없음"} · {item.sourceUrl || "결과 URL 없음"}</small><small>{benchmark3DMarkBatchStatusDescription(item)}</small></div>{item.preview && <a href={safeHttpsUrl(item.preview.sourceUrl) ?? undefined} target="_blank" rel="noreferrer">페이지 <FiExternalLink /></a>}</article>)}</div><div className="benchmark-3dmark-batch-actions"><button className="button button-light" type="button" data-testid="benchmark-3dmark-batch-add" onClick={addMatchedToJson} disabled={busy || result.matchedCount === 0}><FiPlus /> 일치 결과를 JSON에 추가</button><span>수동 대조·불일치·실패 행은 자동 반영하지 않습니다.</span></div></>}<p className="benchmark-3dmark-batch-note"><FiInfo /> 이 기능은 결과 페이지를 읽는 미리보기이며 카탈로그·보강 저장소를 변경하지 않습니다. JSON에 추가한 뒤 sourceNote·URL·점수를 서버 확인하고 저장해야 실제 데이터에 반영됩니다.</p></section>;
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
  const [sourceCheckingPartId, setSourceCheckingPartId] = useState<string | null>(null);
  const [sourceHistoryPartId, setSourceHistoryPartId] = useState<string | null>(null);
  const [sourceHistory, setSourceHistory] = useState<BenchmarkSourceCheckHistoryEntry[]>([]);
  const [sourceHistoryLoading, setSourceHistoryLoading] = useState(false);
  const [sourceHistoryError, setSourceHistoryError] = useState<string | null>(null);
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
  const [benchmark3DMarkUrl, setBenchmark3DMarkUrl] = useState("");
  const [benchmark3DMarkPreview, setBenchmark3DMarkPreview] = useState<Benchmark3DMarkImportResponse | null>(null);
  const [benchmark3DMarkLoading, setBenchmark3DMarkLoading] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<BenchmarkReviewQueue | null>(null);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(true);
  const [reviewQueueError, setReviewQueueError] = useState<string | null>(null);
  const [reviewQueueRefreshToken, setReviewQueueRefreshToken] = useState(0);
  const [benchmark3DMarkBatchSeed, setBenchmark3DMarkBatchSeed] = useState<Benchmark3DMarkBatchSeed | null>(null);
  const [reviewQueueCategoryFilter, setReviewQueueCategoryFilter] = useState<"all" | "cpu" | "gpu">("all");
  const [reviewQueueStatusFilter, setReviewQueueStatusFilter] = useState<"all" | "missing" | "partial" | "stale">("all");
  const benchmarkCsvInputRef = useRef<HTMLInputElement>(null);
  const composerRequestVersionRef = useRef(0);
  const composerTargetPartIdRef = useRef<string | null>(null);
  const benchmark3DMarkRequestVersionRef = useRef(0);
  const sourceHistoryRequestVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const mutationRequestVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      composerRequestVersionRef.current += 1;
      benchmark3DMarkRequestVersionRef.current += 1;
      sourceHistoryRequestVersionRef.current += 1;
      mutationRequestVersionRef.current += 1;
    };
  }, []);

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
      .catch((reason: unknown) => { if (!cancelled) setReviewQueueError(reason instanceof Error ? reason.message : "벤치마크 확인 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setReviewQueueLoading(false); });
    return () => { cancelled = true; };
  }, [reviewQueueRefreshToken]);

  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++composerRequestVersionRef.current;
    setComposerParts([]);
    setComposerPartsLoading(true);
    setComposerSelectedPartId("");
    setComposerScores({});
    setComposerSourceNote("");
    setComposerSourceUrl("");
    setBenchmark3DMarkUrl("");
    setBenchmark3DMarkPreview(null);
    const timer = window.setTimeout(() => {
      setComposerPartsLoading(true);
      void api<{ items: Part[] }>(`/api/parts?category=${composerCategory}&q=${encodeURIComponent(composerQuery)}&quality=all&sort=name&listingPolicy=all&limit=12`)
        .then((payload) => {
          if (cancelled || composerRequestVersionRef.current !== requestVersion) return;
          setComposerParts(payload.items);
          const targetPartId = composerTargetPartIdRef.current;
          const nextSelectedPartId = targetPartId && payload.items.some((part) => part.id === targetPartId)
            ? targetPartId
            : payload.items.some((part) => part.id === composerSelectedPartId) ? composerSelectedPartId : "";
          if (targetPartId) composerTargetPartIdRef.current = null;
          setComposerSelectedPartId(nextSelectedPartId);
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

  useEffect(() => {
    benchmark3DMarkRequestVersionRef.current += 1;
    setBenchmark3DMarkUrl("");
    setBenchmark3DMarkPreview(null);
  }, [composerCategory, composerSelectedPartId]);

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
    onToast(`${parsed.items.length}개 벤치마크 행을 JSON에 반영했습니다. 서버 확인을 실행해 주세요.`);
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
      onToast(`${parsed.items.length}개 CSV 파일 행을 JSON에 반영했습니다. 서버 확인을 실행해 주세요.`);
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
      onToast(kind === "sources" ? "출처를 확인할 벤치마크 대상이 없습니다." : "내보낼 벤치마크 확인 대상이 없습니다.");
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
    onToast(`${items.length}개 ${kind === "sources" ? "출처 분류 확인" : "벤치마크 확인"} 대상의 CSV 템플릿을 저장했습니다.`);
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
      onToast(`${item.partName}을 입력 JSON에 추가했습니다. 미확인 점수·출처 메모·출처 URL을 채운 뒤 확인해 주세요.`);
    } catch {
      onToast("기존 JSON 형식이 올바르지 않아 확인 행을 추가하지 못했습니다. JSON을 먼저 수정해 주세요.");
    }
  }

  async function validate() {
    if (!json.trim()) {
      onToast("확인할 벤치마크 보강 JSON을 입력해 주세요.");
      return;
    }
    try {
      JSON.parse(json);
    } catch {
      onToast("JSON 형식이 올바르지 않습니다.");
      return;
    }
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBusy(true);
    try {
      const result = await api<BenchmarkOverrideValidationResponse>("/api/admin/benchmark-overrides/validate", { method: "POST", body: json });
      if (!isCurrent()) return;
      setValidation(result);
      setValidatedInput(json);
      onToast(result.invalidCount > 0 ? `확인 완료: ${result.validCount}개 저장 가능, ${result.invalidCount}개 수정 필요` : `${result.validCount}개 벤치마크 보강 데이터를 저장할 수 있습니다.`);
    } catch (reason: unknown) {
      if (isCurrent()) {
        setValidation(null);
        setValidatedInput("");
        onToast(reason instanceof Error ? reason.message : "벤치마크 보강 JSON 확인에 실패했습니다.");
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function save() {
    if (!validation || validatedInput !== json) {
      onToast("입력 내용을 바꿨다면 먼저 벤치마크 JSON 확인을 다시 실행해 주세요.");
      return;
    }
    if (validation.invalidCount > 0) {
      onToast("수정이 필요한 항목이 있어 저장하지 않았습니다.");
      return;
    }
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBusy(true);
    try {
      const result = await api<{ saved: boolean; count: number; items: BenchmarkOverrideListItem[] }>("/api/admin/benchmark-overrides", { method: "PUT", body: json });
      if (!isCurrent()) return;
      setOverrides(result.items);
      setReviewQueueRefreshToken((current) => current + 1);
      onMetaRefresh();
      onToast(`${result.count}개 부품의 벤치마크 보강 데이터를 저장했습니다.`);
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "벤치마크 보강 데이터를 저장하지 못했습니다.");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function exportOverrides() {
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBusy(true);
    try {
      const result = await api<{ exportedAt: string; items: BenchmarkOverrideListItem[] }>("/api/admin/benchmark-overrides/export");
      if (!isCurrent()) return;
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
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "벤치마크 보강 데이터를 내보내지 못했습니다.");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function removeOverride(partId: string) {
    if (!window.confirm("이 부품의 수동 벤치마크 보강을 삭제할까요?")) return;
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBusy(true);
    try {
      await api(`/api/admin/benchmark-overrides/${encodeURIComponent(partId)}`, { method: "DELETE" });
      if (!isCurrent()) return;
      setOverrides((current) => current.filter((override) => override.partId !== partId));
      setReviewQueueRefreshToken((current) => current + 1);
      onMetaRefresh();
      onToast("벤치마크 보강 데이터를 삭제했습니다.");
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "벤치마크 보강 데이터를 삭제하지 못했습니다.");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function checkSource(partId: string) {
    if (sourceCheckingPartId) return;
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBusy(true);
    setSourceCheckingPartId(partId);
    try {
      const result = await api<{ persisted: boolean; historyRecorded: boolean; sourceCheck: BenchmarkOverride["sourceCheck"]; override: BenchmarkOverrideListItem }>(`/api/admin/benchmark-overrides/${encodeURIComponent(partId)}/source-check`, { method: "POST" });
      if (!isCurrent()) return;
      setOverrides((current) => current.map((override) => override.partId === partId ? { ...override, ...result.override } : override));
      setReviewQueueRefreshToken((current) => current + 1);
      onMetaRefresh();
      onToast(`벤치마크 출처 확인 완료: ${benchmarkSourceCheckText(result.sourceCheck)}${result.historyRecorded ? " · 이력 기록됨" : ""}`);
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "벤치마크 출처 확인에 실패했습니다.");
    } finally {
      if (isCurrent()) {
        setSourceCheckingPartId(null);
        setBusy(false);
      }
    }
  }

  async function checkSourcesBatch() {
    if (sourceCheckingPartId) return;
    const targets = visibleOverrides.filter((override) => Boolean(override.sourceUrl));
    if (targets.length === 0) {
      onToast("점검할 benchmark HTTPS 페이지 URL이 없습니다.");
      return;
    }
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBusy(true);
    setSourceCheckingPartId("__batch__");
    try {
      const result = await api<BenchmarkSourceCheckBatchResponse>("/api/admin/benchmark-overrides/source-check/batch", { method: "POST", body: JSON.stringify({ partIds: targets.map((override) => override.partId).slice(0, 50), limit: 50 }) });
      if (!isCurrent()) return;
      const checkedById = new Map(result.items.map((item) => [item.partId, item]));
      setOverrides((current) => current.map((override) => {
        const checked = checkedById.get(override.partId);
        return checked ? { ...override, sourceCheck: checked.sourceCheck } : override;
      }));
      setReviewQueueRefreshToken((current) => current + 1);
      onMetaRefresh();
      onToast(`벤치마크 페이지 ${result.checkedCount}개 점검 완료 · 확인됨 ${result.passedCount}개 · 재확인 ${result.reviewCount}개${result.persistFailureCount > 0 ? ` · 저장 실패 ${result.persistFailureCount}개` : ""}`);
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "벤치마크 출처 일괄 확인에 실패했습니다.");
    } finally {
      if (isCurrent()) {
        setSourceCheckingPartId(null);
        setBusy(false);
      }
    }
  }

  async function toggleSourceHistory(partId: string) {
    const requestVersion = ++sourceHistoryRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && sourceHistoryRequestVersionRef.current === requestVersion;
    if (sourceHistoryPartId === partId) {
      setSourceHistoryPartId(null);
      setSourceHistory([]);
      setSourceHistoryError(null);
      setSourceHistoryLoading(false);
      return;
    }
    setSourceHistoryPartId(partId);
    setSourceHistory([]);
    setSourceHistoryLoading(true);
    setSourceHistoryError(null);
    try {
      const result = await api<{ partId: string; entries: BenchmarkSourceCheckHistoryEntry[] }>(`/api/admin/benchmark-overrides/${encodeURIComponent(partId)}/source-check/history?limit=20`);
      if (!isCurrent()) return;
      setSourceHistory(result.entries);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      setSourceHistory([]);
      setSourceHistoryError(reason instanceof Error ? reason.message : "벤치마크 출처 확인 이력을 불러오지 못했습니다.");
    } finally {
      if (isCurrent()) setSourceHistoryLoading(false);
    }
  }

  function openReviewItemInComposer(item: { partId: string; partName: string; category: "cpu" | "gpu" }) {
    composerTargetPartIdRef.current = item.partId;
    setComposerCategory(item.category);
    setComposerQuery(item.partName);
    setComposerSelectedPartId("");
    document.querySelector(".benchmark-override-composer")?.scrollIntoView({ block: "center", behavior: "smooth" });
    onToast(`${item.partName}을 행 작성 도구에서 불러오는 중입니다. 페이지 URL을 입력해 확인하세요.`);
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
      onToast("확인 정보 메모를 입력해 주세요.");
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
      onToast(`${selectedPart.name}의 벤치마크 행을 입력 JSON에 추가했습니다. JSON 확인 후 저장해 주세요.`);
    } catch {
      onToast("기존 JSON 형식이 올바르지 않아 행을 추가하지 못했습니다. JSON을 먼저 수정해 주세요.");
    }
  }

  async function preview3DMarkResult() {
    const selectedPart = composerParts.find((part) => part.id === composerSelectedPartId);
    if (!selectedPart || selectedPart.category !== "gpu") {
      onToast("먼저 3DMark 결과를 연결할 GPU를 검색해 선택해 주세요.");
      return;
    }
    const sourceUrl = benchmark3DMarkUrl.trim();
    if (!sourceUrl) {
      onToast("3DMark Time Spy 또는 Port Royal 결과 URL을 입력해 주세요.");
      return;
    }
    const requestVersion = ++benchmark3DMarkRequestVersionRef.current;
    setBenchmark3DMarkLoading(true);
    setBenchmark3DMarkPreview(null);
    try {
      const result = await api<Benchmark3DMarkImportResponse>("/api/admin/benchmark-import/3dmark", {
        method: "POST",
        body: JSON.stringify({ partId: selectedPart.id, sourceUrl })
      });
      if (!mountedRef.current || benchmark3DMarkRequestVersionRef.current !== requestVersion) return;
      setBenchmark3DMarkPreview(result);
      onToast(result.identityStatus === "matched" ? `${result.benchmarkLabel} ${result.score.toLocaleString("ko-KR")}점의 GPU 식별자가 일치합니다. 확인 행에 반영할 수 있습니다.` : `${result.benchmarkLabel} 결과를 읽었습니다. GPU 식별자를 수동 대조한 뒤 반영해 주세요.`);
    } catch (reason: unknown) {
      if (!mountedRef.current || benchmark3DMarkRequestVersionRef.current !== requestVersion) return;
      onToast(reason instanceof Error ? reason.message : "3DMark 결과를 미리 읽지 못했습니다.");
    } finally {
      if (mountedRef.current && benchmark3DMarkRequestVersionRef.current === requestVersion) setBenchmark3DMarkLoading(false);
    }
  }

  function add3DMarkPreviewToJson() {
    const preview = benchmark3DMarkPreview;
    const selectedPart = composerParts.find((part) => part.id === composerSelectedPartId);
    if (!preview || !selectedPart || preview.identityStatus !== "matched") {
      onToast("GPU 식별자가 일치하는 3DMark 미리보기만 확인 행에 반영할 수 있습니다.");
      return;
    }
    const sourceNote = `${preview.benchmarkLabel} 결과 ID ${preview.resultId} · 결과 페이지 GPU 식별자 일치 확인`;
    try {
      const parsed: unknown = json.trim() ? JSON.parse(json) : { items: [] };
      const existingItems: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).items)
          ? (parsed as Record<string, unknown>).items as unknown[]
          : [];
      const existing = existingItems.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).partId === selectedPart.id);
      const nextItem: Record<string, unknown> = {
        ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
        partId: selectedPart.id,
        [preview.scoreKey]: preview.score,
        sourceKind: "community_measurement",
        sourceNote,
        sourceUrl: preview.sourceUrl
      };
      const nextItems = [...existingItems.filter((item) => !item || typeof item !== "object" || Array.isArray(item) || (item as Record<string, unknown>).partId !== selectedPart.id), nextItem];
      handleJsonChange(JSON.stringify({ items: nextItems }, null, 2));
      setComposerScores((current) => ({ ...current, [preview.scoreKey]: String(preview.score) }));
      setComposerSourceKind("community_measurement");
      setComposerSourceNote(sourceNote);
      setComposerSourceUrl(preview.sourceUrl);
      onToast(`${preview.benchmarkLabel} ${preview.score.toLocaleString("ko-KR")}점을 입력 JSON에 반영했습니다. JSON 확인 후 저장해 주세요.`);
    } catch {
      onToast("기존 JSON 형식이 올바르지 않아 3DMark 결과를 반영하지 못했습니다. JSON을 먼저 수정해 주세요.");
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
    <div className="admin-card-heading"><div><h3>확인된 성능 데이터 보강</h3></div><FiActivity /></div>
    <p className="admin-card-description">페이지에 없거나 별도로 확인한 Cinebench·3DMark 점수를 부품 ID에 연결합니다. 모든 값은 서버에서 부품 종류·양수 정수·출처 메모·HTTPS URL을 확인한 뒤 원자적으로 저장하며, 저장된 페이지는 실제 접근·모델 식별 점검까지 실행할 수 있습니다.</p>
    <div className="benchmark-override-summary"><span>저장된 보강 <strong>{overrides.length}개</strong></span><span>대상: CPU·GPU</span><span>저장소: {storageMode === "postgres" ? "PostgreSQL" : storageMode === "file" ? "JSON fallback" : "확인 중"}</span>{loading && <span>불러오는 중...</span>}{error && <span className="benchmark-override-error">{error}</span>}</div>
    <Benchmark3DMarkWorkPackagePanel busy={busy} onToast={onToast} onOpenItem={openReviewItemInComposer} onPrepareBatchInput={(items) => { const seed = benchmark3DMarkBatchSeedFor(items); setBenchmark3DMarkBatchSeed(seed); onToast(`${seed.count}개 GPU의 partId를 일괄 입력창에 준비했습니다. 각 행에 3DMark 결과 URL을 입력해 주세요.`); }} refreshToken={reviewQueueRefreshToken} />
    <Benchmark3DMarkBatchPanel busy={busy} json={json} onJsonChange={handleJsonChange} onToast={onToast} preparedInput={benchmark3DMarkBatchSeed} />
    {reviewQueueLoading ? <p className="benchmark-review-state"><FiLoader className="spin" /> 벤치마크 확인 우선순위를 계산하는 중...</p> : reviewQueueError ? <div className="benchmark-review-state error" role="alert"><span>{reviewQueueError}</span></div> : reviewQueue && <div className="benchmark-review-queue" aria-label="벤치마크 확인 우선순위"><div className="benchmark-review-heading"><div><strong>먼저 채울 벤치마크 데이터</strong><small>미입력·부분 입력뿐 아니라 오래된 완전 세트와 확인 시점이 없는 점수도 다시 확인합니다.</small></div><button className="button button-light" type="button" onClick={() => exportReviewTemplate()} disabled={busy || reviewQueue.items.length === 0}><FiDownload /> 확인 CSV 템플릿</button><div className="benchmark-review-filters"><label><span>범주</span><select aria-label="벤치마크 확인 목록 범주" value={reviewQueueCategoryFilter} onChange={(event) => setReviewQueueCategoryFilter(event.target.value as "all" | "cpu" | "gpu")} disabled={busy}><option value="all">CPU·GPU 전체</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label><label><span>상태</span><select aria-label="벤치마크 확인 목록 상태" value={reviewQueueStatusFilter} onChange={(event) => setReviewQueueStatusFilter(event.target.value as "all" | "missing" | "partial" | "stale")} disabled={busy}><option value="all">전체 상태</option><option value="missing">점수 없음</option><option value="partial">일부 점수</option><option value="stale">갱신 필요</option></select></label></div></div><div className="benchmark-review-summary"><span>CPU <strong>{reviewQueue.totals.cpu.complete}개 완전</strong> · {reviewQueue.totals.cpu.partial + reviewQueue.totals.cpu.missing + reviewQueue.totals.cpu.stale}개 확인 필요</span><span>GPU <strong>{reviewQueue.totals.gpu.complete}개 완전</strong> · {reviewQueue.totals.gpu.partial + reviewQueue.totals.gpu.missing + reviewQueue.totals.gpu.stale}개 확인 필요</span><span>표시 {visibleReviewItems.length} / {reviewQueue.items.length}개</span></div><div className="benchmark-review-list">{visibleReviewItems.slice(0, 10).map((item) => { const sourceUrl = safeExternalUrl(item.sourceUrl); const benchmarkDate = item.benchmarkUpdatedAt && Number.isFinite(Date.parse(item.benchmarkUpdatedAt)) ? new Date(item.benchmarkUpdatedAt).toLocaleDateString("ko-KR") : "시점 없음"; return <article className="benchmark-review-item" key={item.partId}><div className="benchmark-review-item-main"><div className="benchmark-review-item-top"><span className="category-badge">{item.category === "cpu" ? "CPU" : "GPU"}</span><span className={`benchmark-review-status ${item.status}`}>{item.status === "missing" ? "점수 없음" : item.status === "partial" ? "일부 점수" : "갱신 필요"}</span><strong>{item.reviewPriorityScore}점</strong></div><strong>{item.partName}</strong><small>{item.partId} · {item.reviewReason}{item.benchmarkSourceKind ? ` · ${BENCHMARK_SOURCE_KIND_LABELS[item.benchmarkSourceKind]}` : " · 출처 확인 필요"}</small><small>벤치마크 {benchmarkFreshnessLabels[item.benchmarkFreshness]} · {benchmarkDate} · 미확인: {item.missingScores.length > 0 ? item.missingScores.map((key) => BENCHMARK_SCORE_LABELS[key]).join(" · ") : "없음"}{Object.keys(item.presentScores).length > 0 ? ` · 확인: ${Object.entries(item.presentScores).map(([key, value]) => `${BENCHMARK_SCORE_LABELS[key as BenchmarkScoreKey]} ${value.toLocaleString("ko-KR")}`).join(" · ")}` : ""}</small></div><div className="benchmark-review-item-side"><span>{item.dataQuality === "live" ? "다나와 최신" : item.dataQuality === "manual" ? "직접 확인" : item.dataQuality === "seed" ? "기본 정보" : "일부 스펙 부족"}</span><small>{item.priceKnown && item.priceWon !== undefined ? `${item.priceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}</small>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}{item.category === "gpu" && <button className="text-button benchmark-review-open-composer" type="button" data-testid={`benchmark-review-open-composer-${item.category}-${item.partId}`} onClick={() => openReviewItemInComposer(item)} disabled={busy}><FiActivity /> 3DMark 확인 열기</button>}<button className="text-button benchmark-review-add" type="button" onClick={() => addReviewItemToJson(item)} disabled={busy}>JSON에 추가</button></div></article>; })}</div><p className="benchmark-review-note"><FiInfo /> CSV 템플릿은 기존 점수만 채워 내보내고, 확인 정보 메모와 출처 URL은 비워 둡니다. 점수를 채운 뒤 다시 가져오고 서버 확인을 통과해야 저장됩니다.</p></div>}
    {reviewQueue && reviewQueue.sourceItems.length > 0 && <div className="benchmark-review-queue benchmark-source-review-queue" aria-label="벤치마크 출처·페이지 확인"><div className="benchmark-review-heading"><div><strong>출처 확인이 필요한 benchmark</strong><small>점수·출처는 있지만 출처 확인이 끝나지 않았거나, 출처 provenance 자체가 없는 항목입니다. 기존 점수는 보존하고 정보를 다시 확인하세요.</small></div><button className="button button-light" type="button" onClick={() => exportReviewTemplate("sources")} disabled={busy || reviewQueue.sourceItems.length === 0}><FiDownload /> 출처 확인 CSV</button></div><div className="benchmark-review-summary"><span>CPU 출처 확인 필요 <strong>{reviewQueue.sourceTotals.cpu.unclassified}개</strong></span><span>GPU 출처 확인 필요 <strong>{reviewQueue.sourceTotals.gpu.unclassified}개</strong></span><span>정보 재확인 <strong>{reviewQueue.sourceTotals.cpu.sourceCheckNeedsReview + reviewQueue.sourceTotals.gpu.sourceCheckNeedsReview}개</strong></span><span>표시 {visibleSourceReviewItems.length} / {reviewQueue.sourceItems.length}개</span></div><div className="benchmark-review-list">{visibleSourceReviewItems.slice(0, 10).map((item) => { const sourceUrl = safeExternalUrl(item.sourceUrl); const benchmarkDate = item.benchmarkUpdatedAt && Number.isFinite(Date.parse(item.benchmarkUpdatedAt)) ? new Date(item.benchmarkUpdatedAt).toLocaleDateString("ko-KR") : "시점 없음"; return <article className="benchmark-review-item" key={item.partId}><div className="benchmark-review-item-main"><div className="benchmark-review-item-top"><span className="category-badge">{item.category === "cpu" ? "CPU" : "GPU"}</span><span className={`benchmark-review-status ${item.sourceCheckNeedsReview ? "source-check-review" : "source-unclassified"}`}>{item.sourceCheckNeedsReview ? "페이지 점검" : "출처 확인"}</span><strong>{item.reviewPriorityScore}점</strong></div><strong>{item.partName}</strong><small>{item.partId} · {item.reviewReason}</small><small>벤치마크 {benchmarkFreshnessLabels[item.benchmarkFreshness]} · {benchmarkDate} · 확인: {Object.entries(item.presentScores).map(([key, value]) => BENCHMARK_SCORE_LABELS[key as BenchmarkScoreKey] + " " + value.toLocaleString("ko-KR")).join(" · ")}</small></div><div className="benchmark-review-item-side"><span>{item.dataQuality === "live" ? "다나와 최신" : item.dataQuality === "manual" ? "직접 확인" : item.dataQuality === "seed" ? "기본 정보" : "일부 스펙 부족"}</span><small>{item.priceKnown && item.priceWon !== undefined ? item.priceWon.toLocaleString("ko-KR") + "원" : "가격 확인 필요"}</small>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}{item.category === "gpu" && <button className="text-button benchmark-review-open-composer" type="button" data-testid={`benchmark-review-open-composer-${item.category}-${item.partId}`} onClick={() => openReviewItemInComposer(item)} disabled={busy}><FiActivity /> 3DMark 확인 열기</button>}<button className="text-button benchmark-review-add" type="button" onClick={() => addReviewItemToJson(item)} disabled={busy}>JSON에 추가</button></div></article>; })}</div><p className="benchmark-review-note"><FiInfo /> CSV 템플릿은 확인된 점수를 유지하고 sourceNote·출처 URL을 비워 둡니다. JSON에 추가한 뒤 출처·출처 메모·HTTPS URL을 입력하고 서버 확인을 통과해야 저장됩니다.</p></div>}
    <div className="benchmark-override-composer">
      <div className="benchmark-override-composer-heading"><div><strong>부품을 검색해 벤치마크 행 만들기</strong><small>partId를 직접 입력하지 않고 CPU·GPU를 검색해 JSON에 추가합니다. 추가 후 반드시 서버 확인을 실행해야 합니다.</small></div><FiSearch /></div>
      <div className="benchmark-override-composer-search"><label><span>범주</span><select aria-label="벤치마크 보강 행 범주" value={composerCategory} onChange={(event) => { composerTargetPartIdRef.current = null; setComposerCategory(event.target.value as "cpu" | "gpu"); setComposerSelectedPartId(""); setComposerScores({}); }} disabled={busy}><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label><label><span>부품 검색</span><input value={composerQuery} onChange={(event) => { composerTargetPartIdRef.current = null; setComposerQuery(event.target.value); }} placeholder="모델명·브랜드 검색" disabled={busy} /></label></div>
      {composerPartsLoading ? <p className="benchmark-override-composer-state"><FiLoader className="spin" /> 부품 검색 중...</p> : composerParts.length > 0 ? <div className="benchmark-override-composer-results">{composerParts.map((part) => <button className={part.id === composerSelectedPartId ? "selected" : ""} type="button" onClick={() => setComposerSelectedPartId(part.id)} key={part.id}><strong>{part.name}</strong><small>{part.id} · {part.dataQuality === "live" ? "다나와 최신" : part.dataQuality === "manual" ? "직접 확인" : part.dataQuality === "incomplete" ? "일부 스펙 부족" : "기본 정보"}</small></button>)}</div> : <p className="benchmark-override-composer-state">검색 결과가 없습니다.</p>}
      {composerSelectedPart && <div className="benchmark-override-composer-form"><div className="benchmark-override-selected"><span>선택한 부품</span><strong>{composerSelectedPart.name}</strong><small>{composerSelectedPart.id}</small></div><div className="benchmark-override-score-fields">{composerScoreFields.map((key) => <label key={key}><span>{BENCHMARK_SCORE_LABELS[key]}</span><input type="number" min="1" max="1000000" step="1" value={composerScores[key] ?? ""} onChange={(event) => setComposerScores((current) => ({ ...current, [key]: event.target.value }))} placeholder="점수" disabled={busy} /></label>)}</div><div className="benchmark-override-source-fields"><label><span>벤치마크 출처</span><select aria-label="벤치마크 보강 출처" value={composerSourceKind} onChange={(event) => setComposerSourceKind(event.target.value as BenchmarkSourceKind)} disabled={busy}>{Object.entries(BENCHMARK_SOURCE_KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>확인 정보 메모</span><input value={composerSourceNote} onChange={(event) => setComposerSourceNote(event.target.value)} maxLength={500} placeholder="예: 공식 측정표·측정 조건" disabled={busy} /></label><label><span>정보 URL (HTTPS)</span><input value={composerSourceUrl} onChange={(event) => setComposerSourceUrl(event.target.value)} placeholder="https://..." disabled={busy} /></label></div><button className="button button-light" type="button" onClick={addComposerRow} disabled={busy}><FiPlus /> 입력 JSON에 추가</button></div>}
      {composerCategory === "gpu" && composerSelectedPart && <section className="benchmark-3dmark-import" data-testid="benchmark-3dmark-import" aria-label="3DMark 결과 미리보기"><div className="benchmark-3dmark-heading"><div><strong>3DMark 결과를 점수로 미리 확인</strong><small>공식 결과 페이지의 Graphics Score만 읽고, 선택한 GPU 식별자와 일치할 때만 확인 행에 반영합니다. 미리보기는 저장하지 않습니다.</small></div><FiActivity /></div><div className="benchmark-3dmark-url-row"><label><span>Time Spy·Port Royal 결과 URL</span><input aria-label="3DMark 결과 URL" value={benchmark3DMarkUrl} onChange={(event) => { setBenchmark3DMarkUrl(event.target.value); setBenchmark3DMarkPreview(null); }} placeholder="https://www.3dmark.com/spy/결과ID" disabled={busy || benchmark3DMarkLoading} /></label><button className="button button-secondary" type="button" data-testid="benchmark-3dmark-preview" onClick={() => void preview3DMarkResult()} disabled={busy || benchmark3DMarkLoading || !benchmark3DMarkUrl.trim()}>{benchmark3DMarkLoading ? <><FiLoader className="spin" /> 결과 읽는 중...</> : <><FiSearch /> 결과 미리보기</>}</button></div>{benchmark3DMarkPreview && <div className={`benchmark-3dmark-preview ${benchmark3DMarkPreview.identityStatus}`} data-testid="benchmark-3dmark-preview-result" role="status"><div className="benchmark-3dmark-preview-top"><span className={`benchmark-3dmark-identity ${benchmark3DMarkPreview.identityStatus}`}>{benchmark3DMarkPreview.identityStatus === "matched" ? "GPU 식별 일치" : benchmark3DMarkPreview.identityStatus === "not_found" ? "GPU 식별 불일치" : "수동 대조 필요"}</span><strong>{benchmark3DMarkPreview.score.toLocaleString("ko-KR")}점</strong></div><div className="benchmark-3dmark-preview-meta"><span>{benchmark3DMarkPreview.benchmarkLabel}</span><span>결과 ID {benchmark3DMarkPreview.resultId}</span>{safeHttpsUrl(benchmark3DMarkPreview.sourceUrl) && <a href={safeHttpsUrl(benchmark3DMarkPreview.sourceUrl)} target="_blank" rel="noreferrer"><FiExternalLink /> 페이지 열기</a>}</div><p>{benchmark3DMarkPreview.gpuName ? `결과 페이지 GPU: ${benchmark3DMarkPreview.gpuName}` : "결과 페이지에서 GPU 모델명을 확인하지 못했습니다."}</p><small>{benchmark3DMarkPreview.identityDetail}</small><div className="benchmark-3dmark-preview-actions">{benchmark3DMarkPreview.identityStatus === "matched" ? <button className="button button-light" type="button" data-testid="benchmark-3dmark-add" onClick={add3DMarkPreviewToJson} disabled={busy}><FiPlus /> 확인 행에 반영</button> : <span>식별자가 일치하지 않으면 점수를 자동 반영하지 않습니다.</span>}</div></div>}<p className="benchmark-3dmark-note"><FiInfo /> 3DMark 결과는 사용자 실측 성능 정보로 분류됩니다. 반영 후에도 기존 JSON 확인을 통과해야 저장되며, 실제 제품·측정 조건은 페이지에서 최종 확인해 주세요.</p></section>}
    </div>
    <div className={csvOpen ? "benchmark-override-csv expanded" : "benchmark-override-csv"}><button className="benchmark-override-csv-toggle" type="button" aria-expanded={csvOpen} onClick={() => setCsvOpen((current) => !current)}><span><FiDatabase /> CSV 직접 붙여넣기</span><small>{csvOpen ? "닫기" : "스프레드시트에서 가져오기"}</small><FiChevronDown /></button>{csvOpen && <div className="benchmark-override-csv-body"><textarea aria-label="벤치마크 보강 CSV" value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="partId,partName,category,cinebenchR23Single,cinebenchR23Multi,gpu3dmarkTimeSpyScore,gpu3dmarkPortRoyalScore,sourceNote,sourceKind,sourceUrl,updatedAt\ngpu-...,그래픽카드,gpu,,,15000,11000,측정 조건,independent_review,https://...,2026-08-28" disabled={busy} /><button className="button button-secondary" type="button" onClick={importCsv} disabled={busy || !csvText.trim()}><FiDatabase /> CSV를 JSON으로 변환</button></div>}</div>
    <textarea aria-label="벤치마크 보강 JSON" value={json} onChange={(event) => handleJsonChange(event.target.value)} placeholder={'{"items":[{"partId":"cpu-...","cinebenchR23Single":2100,"sourceKind":"official","sourceNote":"공식 측정표·측정 조건","sourceUrl":"https://..."}]}' } disabled={busy} />
    <div className="benchmark-override-actions"><input ref={benchmarkCsvInputRef} className="benchmark-override-csv-input" type="file" accept=".csv,text/csv" aria-label="벤치마크 보강 CSV 파일 가져오기" onChange={(event) => void importCsvFile(event)} disabled={busy} /><button className="button button-light" type="button" onClick={() => benchmarkCsvInputRef.current?.click()} disabled={busy}><FiDownload /> CSV 파일 가져오기</button><button className="button button-secondary" type="button" data-testid="benchmark-overrides-validate" onClick={() => void validate()} disabled={busy || !json.trim()}><FiCheckCircle /> JSON 확인</button><button className="button button-primary" type="button" data-testid="benchmark-overrides-save" onClick={() => void save()} disabled={busy || !canSave}><FiSave /> 벤치마크 저장</button><button className="button button-light" type="button" onClick={() => void exportOverrides()} disabled={busy}><FiExternalLink /> JSON 내보내기</button><button className="button button-light" type="button" onClick={exportCsv} disabled={busy || overrides.length === 0}><FiExternalLink /> CSV 내보내기</button></div>
    {validation && <div className={validation.invalidCount === 0 ? "benchmark-override-validation valid" : "benchmark-override-validation invalid"} role="status"><strong>{validation.invalidCount === 0 ? <><FiCheckCircle /> 저장 가능</> : <><FiAlertTriangle /> 저장 차단</>} · {validation.validCount}개 저장 가능 · {validation.invalidCount}개 수정 필요</strong>{validation.invalidCount === 0 && <small>신규 {createCount}개 · 수정 {updateCount}개 · 변경 없음 {unchangedCount}개</small>}{changePreviewItems.slice(0, 5).map((item) => <p key={`preview-${item.partId}`}><b>{item.partName ?? item.partId}</b> · {item.operation === "create" ? "신규 등록" : "기존 값 수정"}{item.changedFields && item.changedFields.length > 0 ? ` · 변경: ${item.changedFields.join(", ")}` : ""}</p>)}{invalidItems.slice(0, 5).map((item) => <p key={item.partId}><b>{item.partName ?? item.partId}</b> · {item.errors.join(" · ")}</p>)}{invalidItems.length > 5 && <small>그 외 {invalidItems.length - 5}개 오류도 서버 응답에 포함되어 있습니다.</small>}</div>}
    <BenchmarkSourceCheckTools overrides={visibleOverrides} busy={busy} sourceCheckingPartId={sourceCheckingPartId} sourceHistoryPartId={sourceHistoryPartId} sourceHistory={sourceHistory} sourceHistoryLoading={sourceHistoryLoading} sourceHistoryError={sourceHistoryError} onCheck={(partId) => void checkSource(partId)} onCheckBatch={() => void checkSourcesBatch()} onToggleHistory={(partId) => void toggleSourceHistory(partId)} />
    <div className="benchmark-override-list-heading"><strong>저장된 보강 목록</strong><span>{visibleOverrides.length} / {overrides.length}개</span></div>
    <div className="benchmark-override-list-controls"><label><span>목록 검색</span><input aria-label="저장된 보강 목록 검색" value={overrideQuery} onChange={(event) => setOverrideQuery(event.target.value)} placeholder="부품명·ID·정보 검색" disabled={busy} /></label><label><span>범주</span><select aria-label="저장된 보강 범주 필터" value={overrideCategoryFilter} onChange={(event) => setOverrideCategoryFilter(event.target.value as "all" | "cpu" | "gpu")} disabled={busy}><option value="all">CPU·GPU 전체</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label><label><span>출처</span><select aria-label="저장된 보강 출처 필터" value={overrideSourceFilter} onChange={(event) => setOverrideSourceFilter(event.target.value as BenchmarkSourceKind | "unclassified" | "all")} disabled={busy}><option value="all">전체 출처</option>{Object.entries(BENCHMARK_SOURCE_KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}<option value="unclassified">출처 확인 필요</option></select></label></div>
    <div className="benchmark-override-list">{overrides.length === 0 ? <p className="benchmark-override-empty">아직 수동으로 보강한 벤치마크 데이터가 없습니다.</p> : visibleOverrides.length === 0 ? <p className="benchmark-override-empty">검색·범주 조건에 맞는 보강 데이터가 없습니다.</p> : visibleOverrides.map((override) => <article className="benchmark-override-item" key={override.partId}><div><strong>{override.partName ?? override.partId}</strong><span>{override.category ? `${CATEGORY_LABELS[override.category]} · ` : ""}{benchmarkOverrideScoreText(override)}</span><small>{override.partId} · {benchmarkSourceKindLabel(override.sourceKind)} · {override.sourceNote}{override.sourceUrl ? ` · ${override.sourceUrl}` : ""}</small></div><div><small>{new Date(override.updatedAt).toLocaleDateString("ko-KR")}</small><button className="text-button danger-text-button" type="button" onClick={() => void removeOverride(override.partId)} disabled={busy}><FiTrash2 /> 삭제</button></div></article>)}</div>
    <p className="benchmark-override-note"><FiInfo /> JSON 항목 예시: CPU는 <code>cinebenchR23Single</code>·<code>cinebenchR23Multi</code>, GPU는 <code>gpu3dmarkTimeSpyScore</code>·<code>gpu3dmarkPortRoyalScore</code>를 사용합니다. 페이지와 다른 값을 입력할 때는 측정 조건을 sourceNote에 남겨 주세요.</p>
  </section>;
}
