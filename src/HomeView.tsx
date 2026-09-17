import { Suspense, lazy, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowRight, FiBell, FiCheckCircle, FiChevronDown, FiCpu, FiDatabase, FiEdit3, FiInfo, FiLoader, FiMonitor, FiRefreshCw, FiSearch, FiShield, FiTag, FiTarget, FiTrash2, FiTrendingUp, FiXCircle, FiZap } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult, Part, PartCategory, PartSelection, ServiceMeta } from "../shared/types";
import { DATA_FRESHNESS_LABELS, PART_CATEGORIES } from "../shared/types";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import type { AlternativeComparisonLocalShareEntry } from "../shared/alternative-comparison-local-history";
import type { SavedBuildVersionLocalShareEntry } from "../shared/saved-build-version-local-history";
import { classifyDataFreshness } from "../shared/data-freshness";
import { ACCESSORY_CATALOG_CACHE_STORAGE_KEY } from "../shared/accessory-catalog-cache";
import { CATALOG_PICKER_CACHE_STORAGE_KEY } from "../shared/catalog-picker-cache";
import { CATALOG_CACHE_CHANGED_EVENT, catalogCacheStatusFromStorage, type CatalogCacheStatusItem } from "../shared/catalog-cache-status";

export type AlertCenterItem = {
  id: string;
  source: "build" | "watchlist";
  sourceLabel: string;
  kind: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};

function HomeAlertCenter({ items, unreadCount, hasBuildAlerts, hasWatchlistAlerts, onOpenHistory, onOpenWatchlist }: { items: AlertCenterItem[]; unreadCount: number; hasBuildAlerts: boolean; hasWatchlistAlerts: boolean; onOpenHistory: () => void; onOpenWatchlist: () => void }) {
  if (items.length === 0) return null;
  return <section className="home-alerts" aria-label="알림 센터" data-testid="home-alert-center">
    <div className="home-alerts-heading"><div><p className="eyebrow">ALERT CENTER</p><h2>새 소식이 있어요</h2><p>저장한 견적과 가격 추적에서 온 소식을 모아봤어요.</p></div>{unreadCount > 0 && <span className="home-alerts-badge" data-testid="home-alert-unread-count">{unreadCount}개 안 봄</span>}</div>
    <div className="home-alerts-list" aria-live="polite">{items.map((item) => {
      const ItemIcon = item.source === "build"
        ? (item.kind === "critical" || item.kind === "review" ? FiAlertTriangle : item.kind === "failed" ? FiXCircle : item.kind === "improved" ? FiCheckCircle : item.kind === "alternative" ? FiTrendingUp : FiBell)
        : FiTag;
      return <article className={`home-alerts-item ${item.read ? "" : "unread"}`} data-testid={`home-alert-${item.id}`} key={item.id}>
        <span className={`home-alerts-item-icon ${item.source}`}><ItemIcon /></span>
        <div className="home-alerts-item-copy"><div className="home-alerts-item-title"><strong>{item.title}</strong><span>{item.source === "build" ? "저장한 견적" : "가격 추적"} · {item.sourceLabel}</span></div><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}{item.read ? "" : " · 아직 안 봄"}</small></div>
      </article>;
    })}</div>
    <div className="home-alerts-actions">{hasBuildAlerts && <button className="button button-light" type="button" data-testid="home-alert-open-history" onClick={onOpenHistory}><FiBell /> 저장한 견적 알림 보기</button>}{hasWatchlistAlerts && <button className="button button-light" type="button" data-testid="home-alert-open-watchlist" onClick={onOpenWatchlist}><FiTag /> 가격 추적 보기</button>}</div>
  </section>;
}

const LazyHomeBudgetLadderSharePanel = lazy(() => import("./HomeBudgetLadderSharePanel").then((module) => ({ default: module.HomeBudgetLadderSharePanel })));
const LazyHomeAlternativeComparisonSharePanel = lazy(() => import("./HomeAlternativeComparisonSharePanel").then((module) => ({ default: module.HomeAlternativeComparisonSharePanel })));
const LazyHomeSavedBuildVersionSharePanel = lazy(() => import("./HomeSavedBuildVersionSharePanel").then((module) => ({ default: module.HomeSavedBuildVersionSharePanel })));

function selectionList(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function accessorySelections(build: BuildSelection) {
  return build.accessories ?? [];
}

function scenarioStatusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "같이 쓸 수 있어요" : status === "needs_review" ? "확인이 필요해요" : "같이 쓰기 어려워요";
}

function homeCatalogFreshnessLabel(meta: ServiceMeta | null) {
  if (!meta) return "정보를 불러오는 중이에요";
  const freshness = classifyDataFreshness(meta.catalogUpdatedAt);
  if (freshness === "fresh") return "최근 확인했어요";
  if (freshness === "aging") return "곧 다시 확인해요";
  if (freshness === "stale") return "오래된 정보예요";
  return "시점 확인이 필요해요";
}

function homeBenchmarkCoveragePercent(complete: number, total: number) {
  return total > 0 ? `${((complete / total) * 100).toFixed(1)}%` : "확인이 필요해요";
}

function homeCacheFreshnessLabel(item: CatalogCacheStatusItem) {
  if (item.count === 0) return "아직 저장하지 않았어요";
  if (item.freshness === "fresh") return "최근 저장했어요";
  if (item.freshness === "aging") return "곧 다시 확인해요";
  if (item.freshness === "stale") return "오래된 목록이에요";
  return "저장 시점 확인이 필요해요";
}

function homeCacheSavedAtLabel(item: CatalogCacheStatusItem) {
  if (!item.cachedAt) return "저장 시점 확인이 필요해요";
  const date = new Date(item.cachedAt);
  return Number.isNaN(date.getTime()) ? "저장 시점 확인이 필요해요" : "저장한 시각 · " + date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function HomeCatalogCachePanel({ onToast }: { onToast: (message: string) => void }) {
  const readStatus = () => catalogCacheStatusFromStorage((key) => window.localStorage.getItem(key));
  const [status, setStatus] = useState(() => typeof window === "undefined" ? undefined : readStatus());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setStatus(readStatus());
    window.addEventListener("storage", refresh);
    window.addEventListener(CATALOG_CACHE_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CATALOG_CACHE_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  function clearCache(kind: "parts" | "accessories" | "all") {
    const labels = kind === "parts" ? "핵심 부품" : kind === "accessories" ? "주변 부품" : "핵심·주변 부품";
    if (!window.confirm(labels + " 목록만 비울까요? 견적 초안·저장 견적·가격 추적 목록은 그대로 있어요.")) return;
    try {
      if (kind === "parts" || kind === "all") window.localStorage.removeItem(CATALOG_PICKER_CACHE_STORAGE_KEY);
      if (kind === "accessories" || kind === "all") window.localStorage.removeItem(ACCESSORY_CATALOG_CACHE_STORAGE_KEY);
      window.dispatchEvent(new Event(CATALOG_CACHE_CHANGED_EVENT));
      setStatus(readStatus());
      setMessage(labels + " 목록을 비웠어요. 다시 열면 새로 저장돼요.");
      onToast(labels + " 목록만 비웠어요. 견적·가격 추적 데이터는 그대로예요.");
    } catch {
      setMessage("브라우저 저장 공간을 바꾸지 못했어요.");
      onToast("부품 목록을 비우지 못했어요.");
    }
  }

  if (!status) return null;
  const cacheItems = [status.parts, status.accessories];
  return <section className={"home-catalog-cache " + (status.hasAny ? "" : "empty")} aria-label="브라우저 카탈로그 캐시 상태" data-testid="home-catalog-cache">
    <div className="home-catalog-cache-heading"><div><p className="eyebrow">LOCAL CATALOG CACHE</p><h2>이 기기에 잠시 저장한 부품 목록</h2><p>서버가 잠시 연결되지 않아도 다시 볼 수 있도록 저장해 둔 목록이에요. 검사 결과·실시간 가격·저장 견적과는 별개예요.</p></div><span>{status.totalCount.toLocaleString("ko-KR")}개</span></div>
    <div className="home-catalog-cache-grid">{cacheItems.map((item) => <article className={"home-catalog-cache-item " + item.freshness} key={item.kind}><div><span>{item.label}</span><strong>{item.count.toLocaleString("ko-KR")}개</strong></div><em>{homeCacheFreshnessLabel(item)}</em><small>{homeCacheSavedAtLabel(item)}</small><button className="text-button" type="button" data-testid={"home-catalog-cache-clear-" + item.kind} onClick={() => clearCache(item.kind)} disabled={item.count === 0}><FiTrash2 /> 이 목록만 비우기</button></article>)}</div>
    {status.hasAny ? <div className="home-catalog-cache-actions"><button className="button button-light" type="button" data-testid="home-catalog-cache-clear-all" onClick={() => clearCache("all")}><FiTrash2 /> 저장한 목록 모두 비우기</button><p><FiInfo /> 목록을 비워도 견적 초안·저장 견적·공유 링크·가격 추적 목록은 그대로예요.</p></div> : <p className="home-catalog-cache-empty"><FiInfo /> 아직 저장된 부품 목록이 없어요. 부품 선택기나 주변 부품 목록을 열면 자동으로 저장돼요.</p>}
    {message && <p className="home-catalog-cache-message" role="status"><FiCheckCircle /> {message}</p>}
  </section>;
}

function HomeDraftResumePanel({ build, result, resultIsStale, onResume, onOpenResult }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; onResume: () => void; onOpenResult: () => void }) {
  const coreEntries = PART_CATEGORIES.flatMap((category) => selectionList(build, category));
  const coreCategoryCount = PART_CATEGORIES.filter((category) => selectionList(build, category).length > 0).length;
  const accessoryCount = accessorySelections(build).length;
  if (coreEntries.length === 0 && accessoryCount === 0) return null;
  const resultLabel = !result ? "아직 검사하지 않았어요" : resultIsStale ? "입력이 바뀌어 다시 확인해요" : scenarioStatusLabel(result.status);
  const resultClass = !result || resultIsStale ? "review" : result.status;
  return <section className="home-draft-resume" aria-label="작업 중인 견적">
    <div className="home-draft-resume-heading"><div><p className="eyebrow">CONTINUE BUILD</p><h2>이어서 볼 견적이 있어요</h2></div><span className={`home-draft-result ${resultClass}`}><span className="status-dot" /> {resultLabel}</span></div>
    <div className="home-draft-resume-summary"><div><span>선택한 핵심 부품</span><strong>{coreEntries.length}개 · {coreCategoryCount}개 범주</strong></div><div><span>주변 부품</span><strong>{accessoryCount}종</strong></div>{result && !resultIsStale ? <div><span>최근 확인</span><strong>차단 {result.blockerCount} · 주의 {result.warningCount} · 확인 필요 {result.unknownCount}</strong></div> : <div><span>다음 할 일</span><strong>견적을 열어 지금 상태를 확인해요</strong></div>}</div>
    <div className="home-draft-resume-actions"><button className="button button-primary" type="button" onClick={onResume}><FiEdit3 /> 견적 이어서 열기</button>{result && !resultIsStale && <button className="button button-light" type="button" onClick={onOpenResult}><FiActivity /> 최근 확인 결과 보기</button>}</div>
  </section>;
}

function HomeDataTrustPanel({ meta, bootstrapLoading, bootstrapErrorCount }: { meta: ServiceMeta | null; bootstrapLoading: boolean; bootstrapErrorCount: number }) {
  const catalogEligibleCount = meta?.catalogEligibleCount ?? meta?.catalogCount ?? 0;
  const catalogEligibleQualityCounts = meta?.catalogEligibleQualityCounts ?? meta?.qualityCounts;
  const catalogEligiblePriceCoverage = meta?.catalogEligiblePriceCoverage ?? meta?.priceCoverage ?? { priced: 0, unpriced: 0 };
  const catalogPriceCoverage = meta && catalogEligibleCount > 0 ? Math.round((catalogEligiblePriceCoverage.priced / catalogEligibleCount) * 1000) / 10 : undefined;
  const incompleteCount = catalogEligibleQualityCounts?.incomplete ?? 0;
  const unknownPriceCount = catalogEligiblePriceCoverage.unpriced;
  const staleCount = meta?.catalogSpecCoverage?.freshnessCounts.stale ?? 0;
  const missingPcieCount = meta?.catalogSpecCoverage?.pcieSlotCoverage?.byRequiredWidth[1]?.missing ?? 0;
  const benchmarkCpuIncompleteCount = meta ? Math.max(0, meta.benchmarkCoverage.cpu.total - meta.benchmarkCoverage.cpu.cinebenchR23Complete) : 0;
  const benchmarkGpuIncompleteCount = meta ? Math.max(0, meta.benchmarkCoverage.gpu.total - meta.benchmarkCoverage.gpu.threeDMarkComplete) : 0;
  const freshness = meta ? classifyDataFreshness(meta.catalogUpdatedAt) : "unknown";
  const state = bootstrapErrorCount > 0 ? "degraded" : !meta && bootstrapLoading ? "loading" : freshness === "stale" || freshness === "unknown" ? "review" : "ready";
  const statusLabel = state === "degraded" ? "일부 정보는 확인이 필요해요" : state === "loading" ? "정보를 불러오고 있어요" : state === "review" ? "정보를 확인해 주세요" : "검사할 준비가 됐어요";
  return <section className={`home-data-trust ${state}`} aria-label="현재 데이터 상태">
    <div className="home-data-trust-heading"><div><p className="eyebrow">DATA TRUST</p><h2>견적에 쓰는 부품 정보</h2><p>어떤 정보로 견적을 계산하는지 먼저 확인해보세요.</p></div><span className={`home-data-trust-status ${state}`}><span className="status-dot" /> {statusLabel}</span></div>
    {meta ? <>
      <div className="home-data-trust-grid">
        <div><span>핵심 부품</span><strong>{catalogEligibleCount.toLocaleString("ko-KR")}개</strong><small>전체 {meta.catalogCount.toLocaleString("ko-KR")}개 중 부품이 아닌 항목 {meta.catalogExcludedNonCoreCount ?? 0}개 제외 · 기본 정보 {catalogEligibleQualityCounts?.seed ?? 0}개 · 스펙 부족 {catalogEligibleQualityCounts?.incomplete ?? 0}개</small></div>
        <div><span>주변 부품 카탈로그</span><strong>{meta.accessoryCount.toLocaleString("ko-KR")}개</strong><small>10개 범주 · 기본 정보 {meta.accessoryQualityCounts.seed.toLocaleString("ko-KR")}개</small></div>
        <div><span>가격 확인 범위</span><strong>{catalogPriceCoverage === undefined ? "확인이 필요해요" : `${catalogPriceCoverage.toFixed(1)}%`}</strong><small>{catalogEligiblePriceCoverage.priced.toLocaleString("ko-KR")}개 확인 · {catalogEligiblePriceCoverage.unpriced.toLocaleString("ko-KR")}개는 아직 미확인</small></div>
        <div><span>카탈로그 기준</span><strong>{homeCatalogFreshnessLabel(meta)}</strong><small>{meta.catalogUpdatedAt && Number.isFinite(Date.parse(meta.catalogUpdatedAt)) ? new Date(meta.catalogUpdatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "갱신 시점을 확인해 주세요"}</small></div>
        <div><span>벤치마크 점수</span><strong>CPU {homeBenchmarkCoveragePercent(meta.benchmarkCoverage.cpu.cinebenchR23Complete, meta.benchmarkCoverage.cpu.total)} · GPU {homeBenchmarkCoveragePercent(meta.benchmarkCoverage.gpu.threeDMarkComplete, meta.benchmarkCoverage.gpu.total)}</strong><small>CPU R23 {meta.benchmarkCoverage.cpu.cinebenchR23Complete.toLocaleString("ko-KR")}/{meta.benchmarkCoverage.cpu.total.toLocaleString("ko-KR")}개 · GPU 3DMark {meta.benchmarkCoverage.gpu.threeDMarkComplete.toLocaleString("ko-KR")}/{meta.benchmarkCoverage.gpu.total.toLocaleString("ko-KR")}개 점수 확인됨</small></div>
      </div>
      <div className="home-data-trust-actions" aria-label="데이터 확인 바로가기">
        {incompleteCount > 0 && <a className="button button-small button-light" data-testid="home-data-trust-open-incomplete" href="/catalog?quality=incomplete">스펙 부족 {incompleteCount.toLocaleString("ko-KR")}개 확인하기 <FiArrowRight /></a>}
        {unknownPriceCount > 0 && <a className="button button-small button-light" data-testid="home-data-trust-open-unpriced" href="/catalog?priceStatus=unknown">가격 미확인 {unknownPriceCount.toLocaleString("ko-KR")}개 확인하기 <FiArrowRight /></a>}
        {staleCount > 0 && <a className="button button-small button-light" data-testid="home-data-trust-open-stale" href="/catalog?freshness=stale">오래된 데이터 {staleCount.toLocaleString("ko-KR")}개 확인하기 <FiArrowRight /></a>}
        {missingPcieCount > 0 && <a className="button button-small button-light" data-testid="home-data-trust-open-pcie" href="/catalog?category=motherboard&pcieSlotInfo=missing">PCIe 정보 부족 {missingPcieCount.toLocaleString("ko-KR")}개 확인하기 <FiArrowRight /></a>}
        {benchmarkCpuIncompleteCount > 0 && <a className="button button-small button-light" data-testid="home-data-trust-open-cpu-benchmark" href="/catalog?category=cpu&benchmarkStatus=incomplete">CPU 벤치 점수 없음 {benchmarkCpuIncompleteCount.toLocaleString("ko-KR")}개 확인하기 <FiArrowRight /></a>}
        {benchmarkGpuIncompleteCount > 0 && <a className="button button-small button-light" data-testid="home-data-trust-open-gpu-benchmark" href="/catalog?category=gpu&benchmarkStatus=incomplete">GPU 벤치 점수 없음 {benchmarkGpuIncompleteCount.toLocaleString("ko-KR")}개 확인하기 <FiArrowRight /></a>}
      </div>
    </> : <p className="home-data-trust-loading"><FiLoader className="spin" /> 부품 정보를 불러오고 있어요. 잠시 후 검사 화면에서 상태를 확인할 수 있어요.</p>}
  </section>;
}

function FeatureCard({ Icon, number, title, description }: { Icon: IconType; number: string; title: string; description: string }) {
  return <article className="feature-card"><span className="feature-number">{number}</span><Icon className="feature-icon" /><h3>{title}</h3><p>{description}</p></article>;
}

function GuidedHomePreview() {
  return <div className="hero-panel guided-home-preview" data-testid="home-guided-entry">
    <div className="panel-kicker">START HERE</div>
    <div className="guided-home-preview-heading"><span className="guided-home-preview-mark"><FiTarget /></span><div><strong>몇 가지 질문만 답하면</strong><span>나에게 맞는 PC 조건을 만들어요.</span></div></div>
    <div className="guided-home-preview-steps">
      <div><b>01</b><span>사용 목적</span><strong>게임 · 작업 · 예산</strong></div>
      <div><b>02</b><span>목표 성능</span><strong>4K · 144 FPS</strong></div>
      <div><b>03</b><span>결과 확인</span><strong>예상 가격 · 참고 정보</strong></div>
    </div>
    <div className="guided-home-preview-note"><FiCheckCircle /> 부품 모델을 몰라도 시작할 수 있어요.</div>
  </div>;
}

type MobileHomeRow = { label: string; category: PartCategory; Icon: IconType };

const MOBILE_HOME_ROWS: MobileHomeRow[] = [
  { label: "CPU", category: "cpu", Icon: FiCpu },
  { label: "메인보드", category: "motherboard", Icon: FiDatabase },
  { label: "RAM", category: "memory", Icon: FiActivity },
  { label: "그래픽카드", category: "gpu", Icon: FiMonitor }
];

function mobileHomeRowState(build: BuildSelection, result: CompatibilityResult | null, resultIsStale: boolean, category: PartCategory, partMap: ReadonlyMap<string, Part>) {
  const selections = selectionList(build, category);
  if (selections.length === 0) return { state: "아직 안 골랐어요", tone: "empty", name: "부품을 골라 주세요" };
  const names = selections.map((selection) => partMap.get(selection.partId)?.name ?? selection.partId).join(", ");
  const hasFinding = result && !resultIsStale && result.findings.some((finding) => selections.some((selection) => finding.affectedPartIds.includes(selection.partId)));
  if (hasFinding) return { state: "확인이 필요해요", tone: "warning", name: names };
  if (result && !resultIsStale) return { state: "괜찮아요", tone: "success", name: names };
  return { state: "", tone: "neutral", name: names };
}

function MobileHomeView({ build, result, resultIsStale, partMap, onStart, onGuidedStart, onGenerate, onDemo, onCompatibleDemo, onOpenResult, onOpenHistory }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; onStart: () => void; onGuidedStart: () => void; onGenerate: () => void; onDemo: () => void; onCompatibleDemo: () => void; onOpenResult: () => void; onOpenHistory: () => void }) {
  const selectedCategoryCount = PART_CATEGORIES.filter((category) => selectionList(build, category).length > 0).length;
  const selectedItemCount = PART_CATEGORIES.reduce((count, category) => count + selectionList(build, category).length, 0);
  const hasBuild = selectedItemCount > 0;
  const progress = Math.round((selectedCategoryCount / PART_CATEGORIES.length) * 100);
  const resultReady = Boolean(result && !resultIsStale);
  const overallState = resultReady ? scenarioStatusLabel(result!.status) : hasBuild ? "확인할 준비가 됐어요" : "아직 시작하지 않았어요";
  const overallTone = resultReady ? result!.status : hasBuild ? "review" : "empty";
  return <section className="mobile-home-view" aria-label="PC Supporter 모바일 홈">
    <div className="mobile-home-heading">
      <div><span className="mobile-kicker">CHECK / HOME</span><h1>내 PC</h1><p>{resultReady ? "지금 구성, 같이 확인해볼까요?" : hasBuild ? "고른 부품이 잘 맞는지 확인해볼까요?" : "지금 필요한 PC를 함께 찾아볼까요?"}</p></div>
      <span className={`mobile-home-status ${overallTone}`}><span className="mobile-status-dot" /> {overallState}</span>
    </div>
    {!hasBuild && !resultReady
      ? <section className="mobile-guided-entry" data-testid="mobile-home-guided-entry" aria-label="첫 사용자 guided quote">
          <span className="mobile-kicker">START HERE</span>
          <h2>몇 가지 질문으로<br />나에게 맞는 PC를 찾아요.</h2>
          <p>부품 모델을 몰라도 괜찮아요. 사용 목적·목표 성능·예산부터 정리해드려요.</p>
          <div className="mobile-guided-steps"><div><b>01</b><span>사용 목적</span><strong>게임 · 작업 · 예산</strong></div><div><b>02</b><span>목표 성능</span><strong>4K · 144 FPS</strong></div><div><b>03</b><span>결과 확인</span><strong>예상 가격 · 참고 정보</strong></div></div>
          <div className="mobile-guided-note"><FiCheckCircle /> 처음에는 부품을 고르지 않아도 돼요.</div>
        </section>
      : <section className="mobile-current-build" aria-label="현재 견적">
          <div className="mobile-section-heading"><div><span className="mobile-kicker">CURRENT BUILD</span><h2>{hasBuild ? resultReady ? "최근 확인한 구성" : "현재 구성" : "새 견적"}</h2></div><button type="button" className="mobile-section-link" onClick={resultReady ? onOpenResult : onStart}>{resultReady ? "상세 보기" : "수정하기"}<FiArrowRight /></button></div>
          <div className="mobile-health-summary"><div className="mobile-health-score"><span className="mobile-health-score-value"><strong>{resultReady ? Math.max(0, PART_CATEGORIES.length - result!.blockerCount) : selectedCategoryCount}</strong><span>/ {PART_CATEGORIES.length}</span></span></div><div className="mobile-health-copy">{resultReady ? <strong>{result!.status === "compatible" ? "같이 쓸 수 있어요" : result!.status === "needs_review" ? "확인이 필요한 항목이 있어요" : "바꿔야 할 항목이 있어요"}</strong> : !hasBuild ? <strong>첫 견적을 시작해볼까요?</strong> : null}</div></div>
          <div className="mobile-progress-track" aria-label={`필수 부품 ${selectedCategoryCount}개 선택, ${PART_CATEGORIES.length}개 중`} role="progressbar" aria-valuemin={0} aria-valuemax={PART_CATEGORIES.length} aria-valuenow={selectedCategoryCount}><span style={{ width: `${progress}%` }} /></div>
          <div className="mobile-build-list">{MOBILE_HOME_ROWS.map(({ label, category, Icon }) => { const row = mobileHomeRowState(build, result, resultIsStale, category, partMap); return <button className={`mobile-build-row ${row.tone}`} type="button" key={category} onClick={onStart}><span className="mobile-build-icon"><Icon /></span><span className="mobile-build-copy"><strong>{label}</strong><small>{row.name}</small></span>{row.state && <span className={`mobile-row-state ${row.tone}`}>{row.state}</span>}<FiArrowRight className="mobile-build-arrow" /></button>; })}</div>
        </section>}
    <div className="mobile-primary-actions"><button className="mobile-primary-action" data-testid="mobile-home-primary-action" type="button" onClick={resultReady ? onOpenResult : hasBuild ? onStart : onGuidedStart}><FiSearch /><span>{resultReady ? "최근 검사 결과 보기" : hasBuild ? "견적 검사 준비" : "새 견적 시작하기"}</span><FiArrowRight /></button>{resultReady && <button className="mobile-secondary-action" type="button" onClick={onStart}><FiEdit3 /><span>견적 수정하기</span><FiArrowRight /></button>}</div>
    <section className="mobile-next-steps" aria-label="다음 단계"><div className="mobile-section-heading"><div><span className="mobile-kicker">QUICK START</span><h2>추천 구성</h2></div><button type="button" className="mobile-section-link" onClick={onOpenHistory}>저장한 견적<FiArrowRight /></button></div><button className="mobile-recommend-card" data-testid="mobile-home-recommend" type="button" onClick={hasBuild ? onGenerate : onStart}><span className="mobile-recommend-icon">{hasBuild ? <FiZap /> : <FiEdit3 />}</span><span className="mobile-recommend-copy"><strong>{hasBuild ? "조건으로 자동 구성" : "부품을 직접 선택하기"}</strong></span><FiArrowRight /></button></section>
    <details className="mobile-demo-tools"><summary>예시 구성 보기</summary><div><button type="button" onClick={onDemo}>문제 있는 예시 견적</button><button type="button" onClick={onCompatibleDemo}>문제 없는 예시 견적</button></div></details>
  </section>;
}

export function HomeView({ meta, bootstrapLoading, bootstrapErrorCount, build, result, resultIsStale, partMap, budgetLadderShares, alternativeComparisonShares, savedBuildVersionShares, alertItems, alertUnreadCount, hasBuildAlerts, hasWatchlistAlerts, onStart, onGuidedStart, onGenerate, onDemo, onCompatibleDemo, onResume, onOpenResult, onOpenHistory, onOpenWatchlist, onCopyBudgetLadderShare, onRemoveBudgetLadderShare, onToastBudgetLadderShare, onCopyAlternativeComparisonShare, onRemoveAlternativeComparisonShare, onRevokeAlternativeComparisonShare, onToastAlternativeComparisonShare, onCopySavedBuildVersionShare, onRemoveSavedBuildVersionShare, onRevokeSavedBuildVersionShare, onToastSavedBuildVersionShare, onToast }: { meta: ServiceMeta | null; bootstrapLoading: boolean; bootstrapErrorCount: number; build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; budgetLadderShares: BudgetLadderLocalShareEntry[]; alternativeComparisonShares: AlternativeComparisonLocalShareEntry[]; savedBuildVersionShares: SavedBuildVersionLocalShareEntry[]; alertItems: AlertCenterItem[]; alertUnreadCount: number; hasBuildAlerts: boolean; hasWatchlistAlerts: boolean; onStart: () => void; onGuidedStart: () => void; onGenerate: () => void; onDemo: () => void; onCompatibleDemo: () => void; onResume: () => void; onOpenResult: () => void; onOpenHistory: () => void; onOpenWatchlist: () => void; onCopyBudgetLadderShare: (entry: BudgetLadderLocalShareEntry) => void; onRemoveBudgetLadderShare: (id: string) => void; onToastBudgetLadderShare: (message: string) => void; onCopyAlternativeComparisonShare: (entry: AlternativeComparisonLocalShareEntry) => void; onRemoveAlternativeComparisonShare: (id: string) => void; onRevokeAlternativeComparisonShare: (entry: AlternativeComparisonLocalShareEntry) => Promise<boolean>; onToastAlternativeComparisonShare: (message: string) => void; onCopySavedBuildVersionShare: (entry: SavedBuildVersionLocalShareEntry) => void; onRemoveSavedBuildVersionShare: (id: string) => void; onRevokeSavedBuildVersionShare: (entry: SavedBuildVersionLocalShareEntry) => Promise<boolean>; onToastSavedBuildVersionShare: (message: string) => void; onToast: (message: string) => void }) {
  const localShareCount = budgetLadderShares.length + alternativeComparisonShares.length + savedBuildVersionShares.length;
  const hasAnySelection = PART_CATEGORIES.some((category) => selectionList(build, category).length > 0) || accessorySelections(build).length > 0;
  return <div className="home-page">
    <MobileHomeView build={build} result={result} resultIsStale={resultIsStale} partMap={partMap} onStart={onStart} onGuidedStart={onGuidedStart} onGenerate={onGenerate} onDemo={onDemo} onCompatibleDemo={onCompatibleDemo} onOpenResult={onOpenResult} onOpenHistory={onOpenHistory} />
    <section className="hero-section">
      <div className="hero-copy">
        {hasAnySelection
          ? <><p className="eyebrow"><FiShield /> 내 PC를 확인하는 첫 단계</p><h1>고른 부품이 서로 잘 맞는지<br /><span>같이 확인해볼까요?</span></h1><p className="hero-description">부품을 고르면 서로 잘 맞는지 확인하고, 문제가 있으면 바꾸는 방법까지 알려드려요.</p></>
          : <><p className="eyebrow"><FiTarget /> 새 PC를 고르는 첫 단계</p><h1>나에게 맞는 PC,<br /><span>몇 가지 질문으로 시작해요.</span></h1><p className="hero-description">게임·작업·예산만 알려주시면 필요한 성능과 예상 가격대를 먼저 정리해드려요.</p></>}
        <div className="hero-actions">
          <button className="button button-primary button-large" onClick={hasAnySelection ? onStart : onGuidedStart}>{hasAnySelection ? "이 견적 확인하기" : "새 견적 시작하기"} <FiArrowRight /></button>
          <button className="button button-secondary button-large hero-secondary-action" onClick={hasAnySelection ? onGenerate : onStart}>{hasAnySelection ? "조건으로 자동 구성" : "부품을 직접 선택하기"} {hasAnySelection ? <FiZap /> : <FiEdit3 />}</button>
        </div>
        <details className="hero-demo-tools"><summary>예시 구성 보기 <FiChevronDown /></summary><div><button type="button" onClick={onDemo}><FiActivity /> 문제 있는 예시 견적</button><button type="button" onClick={onCompatibleDemo}><FiCheckCircle /> 문제 없는 예시 견적</button></div></details>
      </div>
      {hasAnySelection ? <div className="hero-panel">
        <div className="panel-kicker">검사 결과 미리보기</div>
      <div className="preview-status"><span className="status-icon danger"><FiXCircle /></span><div><strong>확인이 필요한 부품이 있어요.</strong><span>바로 고칠 문제 3개 · 주의 1개</span></div></div>
      <div className="preview-rule"><span className="rule-icon danger"><FiXCircle /></span><div><strong>CPU와 메인보드 규격이 달라요.</strong><small>CPU: AM5 · 메인보드: LGA1700</small></div><FiChevronDown /></div>
      <div className="preview-rule"><span className="rule-icon warning"><FiAlertTriangle /></span><div><strong>RAM 속도가 지원 범위를 초과합니다.</strong><small>다운클럭될 수 있어요.</small></div><FiChevronDown /></div>
      <div className="preview-rule"><span className="rule-icon success"><FiCheckCircle /></span><div><strong>문제가 있는 부품은 바로 바꿔볼 수 있어요.</strong><small>바꾼 뒤 다시 확인해요</small></div><FiChevronDown /></div>
      </div> : <GuidedHomePreview />}
    </section>
    <HomeAlertCenter items={alertItems} unreadCount={alertUnreadCount} hasBuildAlerts={hasBuildAlerts} hasWatchlistAlerts={hasWatchlistAlerts} onOpenHistory={onOpenHistory} onOpenWatchlist={onOpenWatchlist} />
    <HomeDraftResumePanel build={build} result={result} resultIsStale={resultIsStale} onResume={onResume} onOpenResult={onOpenResult} />
    <details className="home-secondary-details" aria-label="홈 추가 정보">
      <summary><span><FiInfo /> 저장한 견적·정보 확인</span><small>{localShareCount > 0 ? `${localShareCount}개 저장해뒀어요` : "필요할 때 열어보세요"}</small><FiChevronDown /></summary>
      <div className="home-secondary-details-body">
        {budgetLadderShares.length > 0 && <Suspense fallback={null}><LazyHomeBudgetLadderSharePanel entries={budgetLadderShares} onCopy={onCopyBudgetLadderShare} onRemove={onRemoveBudgetLadderShare} onToast={onToastBudgetLadderShare} /></Suspense>}
        {alternativeComparisonShares.length > 0 && <Suspense fallback={null}><LazyHomeAlternativeComparisonSharePanel entries={alternativeComparisonShares} onCopy={onCopyAlternativeComparisonShare} onRemove={onRemoveAlternativeComparisonShare} onRevoke={onRevokeAlternativeComparisonShare} onToast={onToastAlternativeComparisonShare} /></Suspense>}
        {savedBuildVersionShares.length > 0 && <Suspense fallback={null}><LazyHomeSavedBuildVersionSharePanel entries={savedBuildVersionShares} currentCatalogSnapshotAt={meta?.catalogUpdatedAt} onCopy={onCopySavedBuildVersionShare} onRemove={onRemoveSavedBuildVersionShare} onRevoke={onRevokeSavedBuildVersionShare} onToast={onToastSavedBuildVersionShare} /></Suspense>}
        <HomeDataTrustPanel meta={meta} bootstrapLoading={bootstrapLoading} bootstrapErrorCount={bootstrapErrorCount} />
        <HomeCatalogCachePanel onToast={onToast} />
        <section className="feature-grid">
          <FeatureCard Icon={FiSearch} number="01" title="부품을 찾아서 선택해요" description="모델명을 몰라도 범주별 검색과 주요 스펙을 보며 고를 수 있어요." />
          <FeatureCard Icon={FiActivity} number="02" title="문제를 한 번에 확인해요" description="첫 번째 문제에서 멈추지 않고 고른 견적의 연결 관계를 함께 확인해요." />
          <FeatureCard Icon={FiCheckCircle} number="03" title="왜 그런지부터 해결해요" description="현재값과 지원값을 비교하고 교체·수량 조정 방법을 바로 알려드려요." />
        </section>
        <section className="home-trust-row">
          <div><span className="trust-icon"><FiDatabase /></span><div><strong>부품 정보를 함께 보여드려요</strong><p>다나와에서 모은 정보와 직접 확인한 정보를 구분해서 보여드려요.</p></div></div>
          <div><span className="trust-icon"><FiShield /></span><div><strong>이유까지 보여드려요</strong><p>왜 그런지 규칙과 함께 알려드리고, 같은 입력에는 같은 결과를 드려요.</p></div></div>
          <div><span className="trust-icon"><FiRefreshCw /></span><div><strong>바꾸고 다시 확인해요</strong><p>문제 카드에서 부품을 바꾼 뒤 바로 다시 확인할 수 있어요.</p></div></div>
        </section>
      </div>
    </details>
  </div>;
}
