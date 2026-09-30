import { useCallback, useEffect, useRef, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiClock, FiCpu, FiDatabase, FiLoader, FiRefreshCw, FiServer, FiXCircle } from "react-icons/fi";
import { ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS } from "../shared/types";
import type { AccessoryCrawlCategoryReport, AccessoryCrawlManifest, AccessoryCrawlStatus, CatalogChangeSummary, CrawlCategoryReport, CrawlManifest, CrawlPageFailure, CrawlPageRetryRecord, CrawlStatus } from "../shared/types";
import { api } from "./api";

type CrawlEngineParameters = {
  delayMs: number;
  timeoutMs: number;
  retries: number;
  pages: number;
  limitPerCategory: number;
  details: boolean;
};

type CrawlEngineResponse = {
  parameters: CrawlEngineParameters;
  catalog: { status: CrawlStatus; manifest: CrawlManifest | null };
  accessories: { status: AccessoryCrawlStatus; manifest: AccessoryCrawlManifest | null };
};

function statusTone(status: "idle" | "running" | "completed" | "failed" | "cancelled") {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  return status;
}

function statusLabel(status: "idle" | "running" | "completed" | "failed" | "cancelled") {
  switch (status) {
    case "running": return "실행 중";
    case "completed": return "완료";
    case "failed": return "실패";
    case "cancelled": return "중단됨";
    default: return "대기";
  }
}

function operationLabel(operation: CrawlStatus["operation"]) {
  switch (operation) {
    case "page-retry": return "실패 페이지 단독 재시도";
    case "page-retry-batch": return "실패 페이지 일괄 재시도";
    default: return "카탈로그 수집";
  }
}

function modeLabel(mode: "sample" | "all" | undefined, category?: string) {
  const base = mode === "all" ? "전체 수집" : "샘플 수집";
  return category ? `${base} · ${category}` : base;
}

function coverageBadge(kind: "partial" | "complete" | undefined) {
  return <b className={`crawl-engine-badge ${kind === "complete" ? "complete" : "partial"}`}>{kind === "complete" ? "완전" : "부분"}</b>;
}

function dateTimeLabel(value: string | undefined) {
  return value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "-";
}

function changeSummaryLine(summary: CatalogChangeSummary | undefined) {
  if (!summary) return null;
  const presence = `신규 ${(summary.addedProducts ?? 0).toLocaleString("ko-KR")} · 중단 ${(summary.delistedProducts ?? 0).toLocaleString("ko-KR")} · 재등록 ${(summary.relistedProducts ?? 0).toLocaleString("ko-KR")}`;
  return `검사 ${summary.inspectedProducts.toLocaleString("ko-KR")}개 중 ${summary.changedProducts.toLocaleString("ko-KR")}개 변경 · 가격 ${summary.priceChangedProducts.toLocaleString("ko-KR")} · 스펙 ${summary.specChangedProducts.toLocaleString("ko-KR")} · 누락 필드 ${summary.missingFieldChangedProducts.toLocaleString("ko-KR")} · 품질 ${summary.qualityChangedProducts.toLocaleString("ko-KR")} · ${presence}`;
}

function failedPageCount(report: Pick<CrawlCategoryReport, "failedPages">) {
  return report.failedPages?.length ?? 0;
}

function CatalogCategoryTable({ categories }: { categories: Omit<CrawlCategoryReport, "pageProductCodes">[] }) {
  return <div className="crawl-engine-table-wrap"><table className="crawl-engine-table">
    <thead><tr><th>범주</th><th>페이지</th><th>목록 상품</th><th>중복 제외</th><th>신규</th><th>중단</th><th>재등록</th><th>상세 성공</th><th>상세 실패</th><th>누락</th><th>미완성</th><th>목록</th><th>스펙</th><th>실패 페이지</th></tr></thead>
    <tbody>
      {categories.map((report) => <tr key={report.category} className={report.error ? "has-error" : ""}>
        <td><strong>{CATEGORY_LABELS[report.category]}</strong>{report.error && <small className="crawl-engine-row-error">{report.error}</small>}</td>
        <td>{report.pagesVisited} / {report.pagesExpected}</td>
        <td>{report.listedProducts.toLocaleString("ko-KR")}</td>
        <td>{report.uniqueProducts.toLocaleString("ko-KR")}</td>
        <td>{(report.newProducts ?? 0).toLocaleString("ko-KR")}</td>
        <td className={(report.delistedProducts ?? 0) > 0 ? "warn" : ""}>{(report.delistedProducts ?? 0).toLocaleString("ko-KR")}</td>
        <td>{(report.relistedProducts ?? 0).toLocaleString("ko-KR")}</td>
        <td>{report.detailFetched.toLocaleString("ko-KR")}</td>
        <td className={report.detailFailed > 0 ? "warn" : ""}>{report.detailFailed.toLocaleString("ko-KR")}</td>
        <td className={report.missingProducts > 0 ? "warn" : ""}>{report.missingProducts.toLocaleString("ko-KR")}</td>
        <td className={report.incompleteSpecs > 0 ? "warn" : ""}>{report.incompleteSpecs.toLocaleString("ko-KR")}</td>
        <td>{coverageBadge(report.coverage)}</td>
        <td>{coverageBadge(report.specCoverage)}</td>
        <td className={failedPageCount(report) > 0 ? "warn" : ""}>{failedPageCount(report) > 0 ? `${failedPageCount(report)}개` : "-"}</td>
      </tr>)}
    </tbody>
  </table></div>;
}

function AccessoryCategoryTable({ categories }: { categories: AccessoryCrawlCategoryReport[] }) {
  return <div className="crawl-engine-table-wrap"><table className="crawl-engine-table">
    <thead><tr><th>범주</th><th>페이지</th><th>목록 상품</th><th>중복 제외</th><th>상세 성공</th><th>상세 실패</th><th>누락</th><th>미완성</th><th>목록</th><th>스펙</th></tr></thead>
    <tbody>
      {categories.map((report) => <tr key={report.category}>
        <td><strong>{ACCESSORY_CATEGORY_LABELS[report.category]}</strong></td>
        <td>{report.pagesVisited} / {report.pagesExpected}</td>
        <td>{report.listedProducts.toLocaleString("ko-KR")}</td>
        <td>{report.uniqueProducts.toLocaleString("ko-KR")}</td>
        <td>{report.detailFetched.toLocaleString("ko-KR")}</td>
        <td className={report.detailFailed > 0 ? "warn" : ""}>{report.detailFailed.toLocaleString("ko-KR")}</td>
        <td className={report.missingProducts > 0 ? "warn" : ""}>{report.missingProducts.toLocaleString("ko-KR")}</td>
        <td className={report.incompleteSpecs > 0 ? "warn" : ""}>{report.incompleteSpecs.toLocaleString("ko-KR")}</td>
        <td>{coverageBadge(report.coverage)}</td>
        <td>{coverageBadge(report.specCoverage)}</td>
      </tr>)}
    </tbody>
  </table></div>;
}

function FailedPagesList({ failures }: { failures: CrawlPageFailure[] }) {
  if (failures.length === 0) return null;
  return <details className="crawl-engine-disclosure">
    <summary><span><FiXCircle /> 실패 페이지 전체 {failures.length}개</span><FiChevronDown /></summary>
    <ul className="crawl-engine-failure-list">
      {failures.map((failure, index) => <li key={`${failure.category}-${failure.page}-${index}`}>
        <strong>{CATEGORY_LABELS[failure.category]} · {failure.page}페이지</strong>
        <span className={`crawl-engine-badge ${failure.stage === "list" ? "partial" : "warn"}`}>{failure.stage === "list" ? "목록" : "상세"}</span>
        <small>{failure.attempts}회 시도 · {failure.message} · {dateTimeLabel(failure.occurredAt)}</small>
      </li>)}
    </ul>
  </details>;
}

function RetryHistoryList({ records }: { records: CrawlPageRetryRecord[] }) {
  if (records.length === 0) return null;
  const visible = records.slice(-20).reverse();
  return <details className="crawl-engine-disclosure">
    <summary><span><FiRefreshCw /> 페이지 재시도 이력 {records.length}건</span><FiChevronDown /></summary>
    <ul className="crawl-engine-failure-list">
      {visible.map((record) => <li key={`${record.category}-${record.page}-${record.finishedAt}`}>
        <strong>{CATEGORY_LABELS[record.category]} · {record.page}페이지</strong>
        <span className={`crawl-engine-badge ${record.succeeded ? "complete" : "warn"}`}>{record.succeeded ? "성공" : "실패"}</span>
        <small>{record.attempts}회 시도 · {record.error ? `${record.error} · ` : ""}{dateTimeLabel(record.finishedAt)}</small>
      </li>)}
      {records.length > 20 && <li className="crawl-engine-list-omitted">이전 이력 {records.length - 20}건 생략</li>}
    </ul>
  </details>;
}

export function AdminCrawlEnginePanel({ onToast }: { onToast: (message: string) => void }) {
  const [engine, setEngine] = useState<CrawlEngineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const payload = await api<CrawlEngineResponse>("/api/admin/crawl/engine");
      setEngine(payload);
      setError(null);
      return payload;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "크롤링 엔진 상태를 불러오지 못했습니다.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const payload = await load();
      if (cancelled) return;
      if (payload && (payload.catalog.status.status === "running" || payload.accessories.status.status === "running")) {
        timerRef.current = window.setTimeout(() => { void refresh(); }, 2500);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, [load]);

  const refreshManually = () => {
    setLoading(true);
    void load().then((payload) => {
      if (!payload) onToast("엔진 상태를 불러오지 못했습니다. 서버 연결을 확인해 주세요.");
    });
  };

  const catalog = engine?.catalog;
  const accessories = engine?.accessories;
  const manifest = catalog?.manifest ?? null;
  const accessoryManifest = accessories?.manifest ?? null;
  const totalFailures = manifest?.failedPages?.length ?? 0;
  const retryHistory = manifest?.pageRetryHistory ?? [];

  return <section className="admin-card crawl-engine-card" data-testid="admin-crawl-engine">
    <div className="admin-card-heading">
      <div><p className="eyebrow">크롤링 엔진</p><h3>수집 엔진 상태와 마지막 실행 리포트</h3></div>
      <button className="button button-light button-small" type="button" onClick={refreshManually} disabled={loading}>{loading ? <FiLoader className="spin" /> : <FiRefreshCw />} 새로고침</button>
    </div>
    <p className="admin-card-description">다나와 수집 엔진의 적용 파라미터와 마지막 manifest의 범주별 결과를 봅니다. 파라미터는 서버 환경 변수로 바꿉니다.</p>

    {loading && !engine
      ? <p className="crawl-engine-state"><FiLoader className="spin" /> 엔진 상태를 불러오는 중...</p>
      : error && !engine
        ? <div className="crawl-engine-state error" role="alert"><FiAlertTriangle /><span>{error}</span><button className="button button-light button-small" type="button" onClick={refreshManually}>다시 불러오기</button></div>
        : engine && <>
          <div className="crawl-engine-status-strip" data-testid="crawl-engine-status-strip">
            <span className={`crawl-engine-run-state ${statusTone(catalog!.status.status)}`}>
              {catalog!.status.status === "running" ? <FiLoader className="spin" /> : <FiActivity />}
              핵심 부품 {statusLabel(catalog!.status.status)}{catalog!.status.status === "running" && catalog!.status.operation ? ` · ${operationLabel(catalog!.status.operation)}` : ""}
            </span>
            <span className={`crawl-engine-run-state ${statusTone(accessories!.status.status)}`}>
              {accessories!.status.status === "running" ? <FiLoader className="spin" /> : <FiDatabase />}
              주변 부품 {statusLabel(accessories!.status.status)}
            </span>
            {(catalog!.status.workerPid || accessories!.status.workerPid) && <span className="crawl-engine-param"><FiCpu /> 워커 PID <strong>{catalog!.status.workerPid ?? accessories!.status.workerPid}</strong></span>}
          </div>

          <div className="crawl-engine-params" aria-label="수집 엔진 파라미터">
            <span className="crawl-engine-param"><FiServer /> 요청 간격 <strong>{engine.parameters.delayMs.toLocaleString("ko-KR")}ms</strong><small>DANAWA_CRAWL_DELAY_MS</small></span>
            <span className="crawl-engine-param">타임아웃 <strong>{(engine.parameters.timeoutMs / 1000).toLocaleString("ko-KR")}초</strong><small>DANAWA_CRAWL_TIMEOUT_MS</small></span>
            <span className="crawl-engine-param">재시도 <strong>{engine.parameters.retries}회</strong><small>DANAWA_CRAWL_RETRIES</small></span>
            <span className="crawl-engine-param">샘플 페이지 <strong>{engine.parameters.pages}페이지</strong><small>DANAWA_CRAWL_PAGES</small></span>
            <span className="crawl-engine-param">샘플 상한 <strong>{engine.parameters.limitPerCategory}개</strong><small>DANAWA_CRAWL_LIMIT</small></span>
            <span className="crawl-engine-param">상세 수집 <strong>{engine.parameters.details ? "켜짐" : "꺼짐"}</strong><small>DANAWA_CRAWL_DETAILS</small></span>
          </div>

          {!manifest && <p className="crawl-engine-state"><FiAlertTriangle /> 아직 생성된 핵심 부품 수집 manifest가 없습니다.</p>}
          {manifest && <div className="crawl-engine-manifest" data-testid="crawl-engine-manifest">
            <div className="crawl-engine-manifest-heading">
              <div><strong>핵심 부품 마지막 수집</strong><small>{modeLabel(manifest.mode, manifest.category ? CATEGORY_LABELS[manifest.category] : undefined)} · 시작 {dateTimeLabel(manifest.startedAt)}{manifest.finishedAt ? ` · 종료 ${dateTimeLabel(manifest.finishedAt)}` : ""}{manifest.resumedFromStartedAt ? " · 이어서 실행" : ""}</small></div>
              <div className="crawl-engine-manifest-badges">목록 {coverageBadge(manifest.coverage)} 스펙 {coverageBadge(manifest.specCoverage)}</div>
            </div>
            <div className="crawl-engine-totals">
              <div><span>예상 상품</span><strong>{manifest.totalExpectedProducts.toLocaleString("ko-KR")}</strong></div>
              <div><span>중복 제외 상품</span><strong>{manifest.totalUniqueProducts.toLocaleString("ko-KR")}</strong></div>
              <div><span>상세 성공</span><strong>{manifest.totalDetailFetched.toLocaleString("ko-KR")}</strong></div>
              <div><span>상세 실패</span><strong className={manifest.totalDetailFailed > 0 ? "warn" : ""}>{manifest.totalDetailFailed.toLocaleString("ko-KR")}</strong></div>
              <div><span>목록 누락</span><strong className={manifest.totalMissingProducts > 0 ? "warn" : ""}>{manifest.totalMissingProducts.toLocaleString("ko-KR")}</strong></div>
              <div><span>스펙 미완성</span><strong className={manifest.totalIncompleteSpecs > 0 ? "warn" : ""}>{manifest.totalIncompleteSpecs.toLocaleString("ko-KR")}</strong></div>
              {(manifest.totalPageRetries ?? 0) > 0 && <div><span>페이지 재시도</span><strong>{manifest.totalPageRetries!.toLocaleString("ko-KR")}회</strong></div>}
            </div>
            {changeSummaryLine(manifest.changeSummary) && <p className="crawl-engine-change-summary"><FiCheckCircle /> {changeSummaryLine(manifest.changeSummary)}</p>}
            <CatalogCategoryTable categories={manifest.categories} />
            {totalFailures > 0 && <FailedPagesList failures={manifest.failedPages!} />}
            <RetryHistoryList records={retryHistory} />
            {manifest.lastPageRetryAt && <small className="crawl-engine-note"><FiClock /> 마지막 페이지 재시도 {dateTimeLabel(manifest.lastPageRetryAt)}</small>}
          </div>}

          {accessoryManifest && <div className="crawl-engine-manifest accessory" data-testid="crawl-engine-accessory-manifest">
            <div className="crawl-engine-manifest-heading">
              <div><strong>주변 부품 마지막 수집</strong><small>{modeLabel(accessoryManifest.mode, accessoryManifest.category ? ACCESSORY_CATEGORY_LABELS[accessoryManifest.category] : undefined)}{accessoryManifest.details ? " · 상세 포함" : " · 목록만"}{accessoryManifest.onlyIncomplete ? " · 미확인만" : ""} · 시작 {dateTimeLabel(accessoryManifest.startedAt)}{accessoryManifest.finishedAt ? ` · 종료 ${dateTimeLabel(accessoryManifest.finishedAt)}` : ""}</small></div>
              <div className="crawl-engine-manifest-badges">목록 {coverageBadge(accessoryManifest.coverage)} 스펙 {coverageBadge(accessoryManifest.specCoverage)}</div>
            </div>
            <div className="crawl-engine-totals">
              <div><span>예상 상품</span><strong>{accessoryManifest.totalExpectedProducts.toLocaleString("ko-KR")}</strong></div>
              <div><span>중복 제외 상품</span><strong>{accessoryManifest.totalUniqueProducts.toLocaleString("ko-KR")}</strong></div>
              <div><span>상세 성공</span><strong>{accessoryManifest.totalDetailFetched.toLocaleString("ko-KR")}</strong></div>
              <div><span>상세 실패</span><strong className={accessoryManifest.totalDetailFailed > 0 ? "warn" : ""}>{accessoryManifest.totalDetailFailed.toLocaleString("ko-KR")}</strong></div>
              <div><span>목록 누락</span><strong className={accessoryManifest.totalMissingProducts > 0 ? "warn" : ""}>{accessoryManifest.totalMissingProducts.toLocaleString("ko-KR")}</strong></div>
              <div><span>스펙 미완성</span><strong className={accessoryManifest.totalIncompleteSpecs > 0 ? "warn" : ""}>{accessoryManifest.totalIncompleteSpecs.toLocaleString("ko-KR")}</strong></div>
            </div>
            {changeSummaryLine(accessoryManifest.changeSummary) && <p className="crawl-engine-change-summary"><FiCheckCircle /> {changeSummaryLine(accessoryManifest.changeSummary)}</p>}
            <AccessoryCategoryTable categories={accessoryManifest.categories} />
          </div>}
          {!accessoryManifest && <p className="crawl-engine-state"><FiDatabase /> 아직 생성된 주변 부품 수집 manifest가 없습니다.</p>}
        </>}
  </section>;
}
