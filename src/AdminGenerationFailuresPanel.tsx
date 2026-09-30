import { useCallback, useEffect, useState } from "react";
import { FiActivity, FiAlertTriangle, FiClock, FiLoader, FiRefreshCw, FiXCircle } from "react-icons/fi";
import { api } from "./api";

type GenerationFailureRequest = {
  profile?: string;
  priority?: string;
  performanceTier?: string;
  budgetWon?: number;
  includeGpu?: boolean;
  gamingResolution?: string;
  gamingRefreshRate?: number;
  gamingGameIds?: string[];
  memoryCapacityGb?: number;
  storageCapacityGb?: number;
  hddCount?: number;
  listingPolicy?: string;
  includeNonRetail?: boolean;
};

export type GenerationFailureRecord = {
  at: string;
  requestId?: string;
  route: string;
  statusCode: number;
  error: string;
  context?: string;
  request: GenerationFailureRequest;
  diagnostics: { id: string; title: string; facts: { label: string; value: string }[] }[];
  recoveryOptionIds: string[];
};

type CacheStats = {
  size: number;
  inFlight: number;
  hits: number;
  misses: number;
  coalesced: number;
  evictions: number;
};

type MonitorStatus = {
  scheduler: { enabled: boolean; batchLimit: number; lastProcessedCount: number; skippedCount: number };
  compatibilityCache: CacheStats;
  savedBuildCheckPreviewCache: CacheStats;
  compatiblePartAssessmentCache: CacheStats;
};

type GenerationFailuresResponse = { failures: GenerationFailureRecord[] };

const PROFILE_LABELS: Record<string, string> = {
  general: "일반", office: "사무", gaming: "게임", creator: "크리에이터", development: "개발", upgrade: "업그레이드"
};

function requestSummaryFor(request: GenerationFailureRequest): string[] {
  const parts: string[] = [];
  if (request.profile) parts.push(PROFILE_LABELS[request.profile] ?? request.profile);
  if (request.budgetWon !== undefined) parts.push(`예산 ${request.budgetWon.toLocaleString("ko-KR")}원`);
  if (request.performanceTier) parts.push(`${request.performanceTier} 등급`);
  if (request.includeGpu === true) parts.push("GPU 포함");
  if (request.includeGpu === false) parts.push("내장 GPU");
  if (request.gamingResolution) parts.push(`${request.gamingResolution.toUpperCase()}${request.gamingRefreshRate ? ` ${request.gamingRefreshRate}Hz` : ""}`);
  if (request.memoryCapacityGb !== undefined) parts.push(`RAM ${request.memoryCapacityGb}GB`);
  if (request.storageCapacityGb !== undefined) parts.push(`SSD ${request.storageCapacityGb >= 1000 ? `${(request.storageCapacityGb / 1000).toLocaleString("ko-KR")}TB` : `${request.storageCapacityGb}GB`}`);
  if (request.hddCount) parts.push(`HDD ${request.hddCount}개`);
  if (request.listingPolicy && request.listingPolicy !== "retail_only") parts.push(request.listingPolicy === "all" ? "모든 판매 유형" : "벌크 포함");
  return parts;
}

function cacheHitRate(stats: CacheStats): string {
  const total = stats.hits + stats.misses;
  return total > 0 ? `${Math.round((stats.hits / total) * 100)}%` : "-";
}

export function AdminGenerationFailuresPanel({ onToast }: { onToast: (message: string) => void }) {
  const [failures, setFailures] = useState<GenerationFailureRecord[]>([]);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [failurePayload, statusPayload] = await Promise.all([
        api<GenerationFailuresResponse>("/api/admin/generation-failures?limit=50"),
        api<MonitorStatus>("/api/admin/monitor/status").catch(() => null)
      ]);
      setFailures(failurePayload.failures);
      setMonitorStatus(statusPayload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "실패 기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <section className="admin-card generation-failure-card" data-testid="admin-generation-failures">
    <div className="admin-card-heading">
      <div><p className="eyebrow">견적 엔진</p><h3>자동 구성 실패 기록</h3></div>
      <button className="button button-light button-small" type="button" onClick={() => void load()} disabled={loading}>{loading ? <FiLoader className="spin" /> : <FiRefreshCw />} 새로고침</button>
    </div>
    <p className="admin-card-description">자동 구성·옵션·예산 안내가 실패했을 때의 요청 조건과 진단을 최근 50건까지 보여줍니다. 기록은 서버 재시작까지 메모리에만 유지됩니다.</p>
    {monitorStatus && <div className="generation-failure-ops" data-testid="admin-generation-ops">
      <span><FiActivity /> 모니터 스케줄러 <strong>{monitorStatus.scheduler.enabled ? `켜짐 · 회당 ${monitorStatus.scheduler.batchLimit}건` : "꺼짐"}</strong></span>
      <span>호환 검사 캐시 <strong>{monitorStatus.compatibilityCache.size.toLocaleString("ko-KR")}개</strong> · 적중률 {cacheHitRate(monitorStatus.compatibilityCache)}</span>
      <span>견적 검사 캐시 <strong>{monitorStatus.savedBuildCheckPreviewCache.size.toLocaleString("ko-KR")}개</strong> · 적중률 {cacheHitRate(monitorStatus.savedBuildCheckPreviewCache)}</span>
      <span>후보 평가 캐시 <strong>{monitorStatus.compatiblePartAssessmentCache.size.toLocaleString("ko-KR")}개</strong> · 적중률 {cacheHitRate(monitorStatus.compatiblePartAssessmentCache)}</span>
    </div>}
    {loading && failures.length === 0
      ? <p className="generation-failure-state"><FiLoader className="spin" /> 실패 기록을 불러오는 중...</p>
      : error && failures.length === 0
        ? <div className="generation-failure-state error" role="alert"><FiAlertTriangle /><span>{error}</span><button className="button button-light button-small" type="button" onClick={() => void load()}>다시 불러오기</button></div>
        : failures.length === 0
          ? <p className="generation-failure-state"><FiActivity /> 기록된 자동 구성 실패가 없습니다.</p>
          : <div className="generation-failure-list" role="list">
            {failures.map((failure, index) => <article className="generation-failure-item" key={`${failure.at}-${failure.requestId ?? index}`}>
              <div className="generation-failure-item-top">
                <span className={`generation-failure-status ${failure.statusCode >= 500 ? "server" : "client"}`}>{failure.statusCode}</span>
                <strong>{failure.route.replace("/api/builds/", "")}{failure.context ? ` · ${failure.context}` : ""}</strong>
                <time><FiClock /> {new Date(failure.at).toLocaleString("ko-KR")}</time>
              </div>
              <p className="generation-failure-error"><FiXCircle /> {failure.error}</p>
              <div className="generation-failure-request">{requestSummaryFor(failure.request).map((part) => <em key={part}>{part}</em>)}</div>
              {failure.diagnostics.length > 0 && <ul className="generation-failure-diagnostics">{failure.diagnostics.slice(0, 4).map((diagnostic) => <li key={diagnostic.id}>{diagnostic.title}</li>)}{failure.diagnostics.length > 4 && <li>외 {failure.diagnostics.length - 4}개</li>}</ul>}
              {failure.requestId && <small className="generation-failure-id">기록 ID {failure.requestId}</small>}
            </article>)}
          </div>}
  </section>;
}
