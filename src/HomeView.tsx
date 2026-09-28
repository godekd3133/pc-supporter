import { Suspense, lazy, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowRight, FiBell, FiCheckCircle, FiChevronDown, FiCpu, FiDatabase, FiEdit3, FiInfo, FiLoader, FiMonitor, FiRefreshCw, FiSearch, FiShield, FiTag, FiTarget, FiTrendingUp, FiXCircle, FiZap } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult, Part, PartCategory, PartSelection, ServiceMeta } from "../shared/types";
import { CATEGORY_LABELS, PART_CATEGORIES } from "../shared/types";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import type { AlternativeComparisonLocalShareEntry } from "../shared/alternative-comparison-local-history";
import type { SavedBuildVersionLocalShareEntry } from "../shared/saved-build-version-local-history";
import type { SavedBuildMonitorAlternative } from "../shared/saved-build-monitor-alerts";
import { savedBuildMonitorSummaryForDisplay, savedBuildMonitorTitleForDisplay } from "../shared/saved-build-monitor-copy";
import { compatibilityDisplayStatusFor } from "../shared/compatibility-display-status";

export type AlertCenterItem = {
  id: string;
  source: "build" | "watchlist";
  sourceLabel: string;
  kind: string;
  title: string;
  message: string;
  alternative?: SavedBuildMonitorAlternative;
  createdAt: string;
  read: boolean;
};

function HomeAlertCenter({ items, unreadCount, hasBuildAlerts, hasWatchlistAlerts, onOpenHistory, onOpenWatchlist }: { items: AlertCenterItem[]; unreadCount: number; hasBuildAlerts: boolean; hasWatchlistAlerts: boolean; onOpenHistory: () => void; onOpenWatchlist: () => void }) {
  if (items.length === 0) return null;
  return <section className="home-alerts" aria-label="알림 센터" data-testid="home-alert-center">
    <div className="home-alerts-heading"><div><h2>알림</h2><p>저장한 견적과 가격 추적 알림입니다.</p></div>{unreadCount > 0 && <span className="home-alerts-badge" data-testid="home-alert-unread-count">읽지 않은 알림 {unreadCount}개</span>}</div>
    <div className="home-alerts-list" aria-live="polite">{items.map((item) => {
      const ItemIcon = item.source === "build"
        ? (item.kind === "critical" || item.kind === "review" ? FiAlertTriangle : item.kind === "failed" ? FiXCircle : item.kind === "improved" ? FiCheckCircle : item.kind === "alternative" ? FiTrendingUp : FiBell)
        : FiTag;
      return <article className={`home-alerts-item ${item.read ? "" : "unread"}`} data-testid={`home-alert-${item.id}`} key={item.id}>
        <span className={`home-alerts-item-icon ${item.source}`}><ItemIcon /></span>
        <div className="home-alerts-item-copy"><div className="home-alerts-item-title"><strong>{savedBuildMonitorTitleForDisplay(item.title)}</strong><span>{item.source === "build" ? "저장한 견적" : "가격 추적"} · {item.sourceLabel}</span></div><p>{savedBuildMonitorSummaryForDisplay(item.message)}</p>{item.alternative && <div className="home-alerts-alternative"><span>{item.alternative.currentPartName}</span><b>→</b><strong>{item.alternative.candidatePartName}</strong>{item.alternative.priceDeltaWon !== undefined && <em>{item.alternative.priceDeltaWon < 0 ? `${Math.abs(item.alternative.priceDeltaWon).toLocaleString("ko-KR")}원 절약` : `가격 ${item.alternative.priceDeltaWon > 0 ? "+" : ""}${item.alternative.priceDeltaWon.toLocaleString("ko-KR")}원`}</em>}</div>}<small>{new Date(item.createdAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}{item.read ? "" : " · 아직 안 봄"}</small></div>
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

function FeatureCard({ Icon, title, description }: { Icon: IconType; title: string; description: string }) {
  return <article className="feature-card"><Icon className="feature-icon" /><h3>{title}</h3><p>{description}</p></article>;
}

function GuidedHomePreview() {
  return <div className="hero-panel guided-home-preview" data-testid="home-guided-entry">
    <div className="panel-kicker">견적 시작</div>
    <div className="guided-home-preview-heading"><div><strong>용도와 예산 선택</strong><span>선택한 조건에 맞춰 PC 견적을 구성합니다.</span></div></div>
    <dl className="guided-home-preview-choices">
      <div><dt>사용 목적</dt><dd>게임 · 작업</dd></div>
      <div><dt>화면과 성능</dt><dd>FHD · QHD · 4K</dd></div>
      <div><dt>예산</dt><dd>원하는 금액</dd></div>
    </dl>
  </div>;
}

function HomeCurrentBuildPreview({ build, result, resultIsStale, partMap, onOpenResult }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; onOpenResult: () => void }) {
  const selectedCategories = PART_CATEGORIES
    .map((category) => ({ category, selections: selectionList(build, category) }))
    .filter((entry) => entry.selections.length > 0);
  const selectedPartCount = selectedCategories.reduce((total, entry) => total + entry.selections.reduce((count, selection) => count + selection.quantity, 0), 0);
  const accessoryCount = accessorySelections(build).reduce((total, selection) => total + selection.quantity, 0);
  const resultIsCurrent = Boolean(result && !resultIsStale);
  const displayStatus = result ? compatibilityDisplayStatusFor(result) : undefined;
  const accessoryCompatibility = result?.accessoryCompatibility;
  const warningCount = (result?.warningCount ?? 0) + (accessoryCompatibility?.warningCount ?? 0);
  const status = !result ? "호환 확인 전" : resultIsStale ? "구성이 바뀌었어요" : displayStatus === "incompatible" ? result.status === "incompatible" ? "호환되지 않는 부품이 있어요" : "주변 부품의 호환을 확인해 주세요" : displayStatus === "needs_review" ? result.status === "needs_review" ? "확인할 정보가 있어요" : "주변 부품 정보가 부족해요" : warningCount > 0 ? "호환되지만 확인할 항목이 있어요" : "호환에 문제가 없어요";
  const statusTone = !result || resultIsStale ? "review" : displayStatus ?? "review";
  const resultCounts = resultIsCurrent
    ? [
        result!.blockerCount > 0 ? `호환 불가 ${result!.blockerCount}개` : "",
        result!.warningCount > 0 ? `주의 ${result!.warningCount}개` : "",
        result!.unknownCount > 0 ? `확인할 정보 ${result!.unknownCount}개` : "",
        accessoryCompatibility?.blockerCount ? `주변 부품 호환 불가 ${accessoryCompatibility.blockerCount}개` : "",
        accessoryCompatibility?.warningCount ? `주변 부품 주의 ${accessoryCompatibility.warningCount}개` : "",
        accessoryCompatibility?.unknownCount ? `주변 부품 확인 필요 ${accessoryCompatibility.unknownCount}개` : ""
      ].filter(Boolean).join(" · ") || "부품 간 호환 문제를 찾지 못했어요."
    : resultIsStale ? "부품 구성이 바뀌어 이전 결과는 현재 견적에 적용되지 않아요." : "부품을 고른 뒤 호환 결과를 확인해 주세요.";
  return <section className="hero-panel home-current-preview" aria-label="현재 부품 구성" data-testid="home-current-build-preview">
    <div className="panel-kicker">현재 구성</div>
    <div className={`home-current-preview-status ${statusTone}`}><span className="status-dot" /><strong>{status}</strong></div>
    <p className="home-current-preview-summary">{resultCounts}</p>
    <div className="home-current-preview-parts">
      {selectedCategories.slice(0, 3).map(({ category, selections }) => <div key={category}><span>{CATEGORY_LABELS[category]}</span><strong>{selections.map((selection) => partMap.get(selection.partId)?.name ?? "부품 정보 없음").join(" · ")}</strong></div>)}
      {selectedCategories.length > 3 && <small>그 밖의 부품 {selectedCategories.length - 3}종</small>}
    </div>
    <p className="home-current-preview-count">부품 {selectedPartCount}개{accessoryCount > 0 ? ` · 주변 부품 ${accessoryCount}개` : ""}</p>
    {resultIsCurrent && <button className="text-button home-current-preview-link" type="button" onClick={onOpenResult}>호환 결과 보기 <FiArrowRight /></button>}
  </section>;
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
  const findings = result && !resultIsStale ? result.findings.filter((finding) => selections.some((selection) => finding.affectedPartIds.includes(selection.partId))) : [];
  if (findings.some((finding) => finding.severity === "blocker")) return { state: "호환 불가", tone: "incompatible", name: names };
  if (findings.some((finding) => finding.severity === "warning")) return { state: "주의", tone: "warning", name: names };
  if (findings.some((finding) => finding.severity === "unknown")) return { state: "확인 필요", tone: "review", name: names };
  if (result && !resultIsStale) return { state: "괜찮아요", tone: "success", name: names };
  return { state: "", tone: "neutral", name: names };
}

function MobileHomeView({ build, result, resultIsStale, partMap, alertItems, alertUnreadCount, onStart, onGuidedStart, onGenerate, onDemo, onCompatibleDemo, onOpenResult, onOpenHistory, onOpenWatchlist }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; alertItems: AlertCenterItem[]; alertUnreadCount: number; onStart: () => void; onGuidedStart: () => void; onGenerate: () => void; onDemo: () => void; onCompatibleDemo: () => void; onOpenResult: () => void; onOpenHistory: () => void; onOpenWatchlist: () => void }) {
  const selectedCategoryCount = PART_CATEGORIES.filter((category) => selectionList(build, category).length > 0).length;
  const selectedItemCount = PART_CATEGORIES.reduce((count, category) => count + selectionList(build, category).length, 0);
  const hasBuild = selectedItemCount > 0;
  const resultReady = Boolean(result && !resultIsStale);
  const displayStatus = result ? compatibilityDisplayStatusFor(result) : undefined;
  const warningCount = (result?.warningCount ?? 0) + (result?.accessoryCompatibility?.warningCount ?? 0);
  const statusCopy = !resultReady ? undefined
    : displayStatus === "incompatible" ? result!.status === "incompatible" ? "호환되지 않는 부품이 있습니다." : "주변 부품의 호환을 확인해 주세요."
    : displayStatus === "needs_review" ? result!.status === "needs_review" ? "확인이 필요한 부품이 있습니다." : "주변 부품 정보를 더 확인해 주세요."
    : warningCount > 0 ? "호환되지만 추가 확인 항목이 있습니다."
    : "모든 부품이 호환됩니다.";
  return <section className="mobile-home-view" aria-label="PC Supporter 모바일 홈">
    <div className="mobile-home-heading">
      <div><span className="mobile-kicker">내 견적</span><h1>내 PC</h1><p>{statusCopy ?? (hasBuild ? result ? "부품 구성이 바뀌었습니다. 호환 결과를 다시 확인하세요." : "부품 선택을 마치면 호환 결과를 확인할 수 있습니다." : "예산과 용도를 정해 PC 견적을 구성하세요.")}</p></div>
    </div>
    {!hasBuild && !resultReady
      ? <section className="mobile-guided-entry" data-testid="mobile-home-guided-entry" aria-label="새 견적 안내">
          <span className="mobile-kicker">견적 시작</span>
          <h2>용도와 예산으로<br />PC 견적을 구성합니다.</h2>
          <p>부품 이름을 몰라도 시작할 수 있습니다.</p>
        </section>
      : <section className="mobile-current-build" aria-label="현재 견적">
          <div className="mobile-section-heading"><div><span className="mobile-kicker">현재 견적</span><h2>{hasBuild ? resultReady ? "최근 견적" : "현재 구성" : "새 견적"}</h2></div><button type="button" className="mobile-section-link" onClick={resultReady ? onOpenResult : onStart}>{resultReady ? "상세 보기" : "수정하기"}<FiArrowRight /></button></div>
          <p className="mobile-selection-count">필수 부품 <strong>{selectedCategoryCount}/{PART_CATEGORIES.length}</strong>종 선택</p>
          <div className="mobile-build-list">{MOBILE_HOME_ROWS.map(({ label, category, Icon }) => { const row = mobileHomeRowState(build, result, resultIsStale, category, partMap); return <button className={`mobile-build-row ${row.tone}`} type="button" key={category} onClick={onStart}><span className="mobile-build-icon"><Icon /></span><span className="mobile-build-copy"><strong>{label}</strong><small>{row.name}</small></span>{row.state && <span className={`mobile-row-state ${row.tone}`}>{row.state}</span>}<FiArrowRight className="mobile-build-arrow" /></button>; })}</div>
        </section>}
    <div className="mobile-primary-actions"><button className="mobile-primary-action" data-testid="mobile-home-primary-action" type="button" onClick={resultReady ? onOpenResult : hasBuild ? onStart : onGuidedStart}><FiSearch /><span>{resultReady ? "최근 견적 결과 보기" : hasBuild ? "견적 이어서 만들기" : "새 견적 시작하기"}</span><FiArrowRight /></button>{resultReady && <button className="mobile-secondary-action" type="button" onClick={onStart}><FiEdit3 /><span>견적 수정하기</span><FiArrowRight /></button>}</div>
    <section className="mobile-next-steps" aria-label="견적 구성"><div className="mobile-section-heading"><div><span className="mobile-kicker">견적 구성</span><h2>다른 구성</h2></div><button type="button" className="mobile-section-link" onClick={onOpenHistory}>저장한 견적<FiArrowRight /></button></div><button className="mobile-recommend-card" data-testid="mobile-home-recommend" type="button" onClick={hasBuild ? onGenerate : onStart}><span className="mobile-recommend-icon">{hasBuild ? <FiZap /> : <FiEdit3 />}</span><span className="mobile-recommend-copy"><strong>{hasBuild ? "용도·예산으로 다시 구성하기" : "부품을 직접 선택하기"}</strong></span><FiArrowRight /></button></section>
    {alertItems.length > 0 && <section className="mobile-alert-preview" aria-label="모바일 알림 센터" data-testid="mobile-home-alert-center"><div className="mobile-section-heading"><div><h2>알림</h2></div>{alertUnreadCount > 0 && <span className="mobile-alert-badge">읽지 않은 알림 {alertUnreadCount}개</span>}</div><div className="mobile-alert-preview-list">{alertItems.slice(0, 2).map((item) => { const ItemIcon = item.kind === "alternative" ? FiTrendingUp : item.source === "watchlist" ? FiTag : FiBell; return <article className={`mobile-alert-preview-item ${item.kind}`} key={item.id}><span className="mobile-alert-preview-icon"><ItemIcon /></span><div><strong>{savedBuildMonitorTitleForDisplay(item.title)}</strong><p>{savedBuildMonitorSummaryForDisplay(item.message)}</p>{item.alternative && <small>{item.alternative.currentPartName} → {item.alternative.candidatePartName}{item.alternative.priceDeltaWon !== undefined && item.alternative.priceDeltaWon < 0 ? ` · ${Math.abs(item.alternative.priceDeltaWon).toLocaleString("ko-KR")}원 절약` : ""}</small>}</div></article>; })}</div><button className="mobile-alert-preview-action" type="button" onClick={() => alertItems[0].source === "watchlist" ? onOpenWatchlist() : onOpenHistory()}><FiBell /> 알림 자세히 보기 <FiArrowRight /></button></section>}
    <details className="mobile-demo-tools"><summary>예시 구성 보기</summary><div><button type="button" onClick={onDemo}>문제 있는 예시 견적</button><button type="button" onClick={onCompatibleDemo}>문제 없는 예시 견적</button></div></details>
  </section>;
}

export function HomeView({ meta, build, result, resultIsStale, partMap, budgetLadderShares, alternativeComparisonShares, savedBuildVersionShares, alertItems, alertUnreadCount, hasBuildAlerts, hasWatchlistAlerts, onStart, onGuidedStart, onGenerate, onDemo, onCompatibleDemo, onResume, onOpenResult, onOpenHistory, onOpenWatchlist, onCopyBudgetLadderShare, onRemoveBudgetLadderShare, onToastBudgetLadderShare, onCopyAlternativeComparisonShare, onRemoveAlternativeComparisonShare, onRevokeAlternativeComparisonShare, onToastAlternativeComparisonShare, onCopySavedBuildVersionShare, onRemoveSavedBuildVersionShare, onRevokeSavedBuildVersionShare, onToastSavedBuildVersionShare, onToast }: { meta: ServiceMeta | null; build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; budgetLadderShares: BudgetLadderLocalShareEntry[]; alternativeComparisonShares: AlternativeComparisonLocalShareEntry[]; savedBuildVersionShares: SavedBuildVersionLocalShareEntry[]; alertItems: AlertCenterItem[]; alertUnreadCount: number; hasBuildAlerts: boolean; hasWatchlistAlerts: boolean; onStart: () => void; onGuidedStart: () => void; onGenerate: () => void; onDemo: () => void; onCompatibleDemo: () => void; onResume: () => void; onOpenResult: () => void; onOpenHistory: () => void; onOpenWatchlist: () => void; onCopyBudgetLadderShare: (entry: BudgetLadderLocalShareEntry) => void; onRemoveBudgetLadderShare: (id: string) => void; onToastBudgetLadderShare: (message: string) => void; onCopyAlternativeComparisonShare: (entry: AlternativeComparisonLocalShareEntry) => void; onRemoveAlternativeComparisonShare: (id: string) => void; onRevokeAlternativeComparisonShare: (entry: AlternativeComparisonLocalShareEntry) => Promise<boolean>; onToastAlternativeComparisonShare: (message: string) => void; onCopySavedBuildVersionShare: (entry: SavedBuildVersionLocalShareEntry) => void; onRemoveSavedBuildVersionShare: (id: string) => void; onRevokeSavedBuildVersionShare: (entry: SavedBuildVersionLocalShareEntry) => Promise<boolean>; onToastSavedBuildVersionShare: (message: string) => void; onToast: (message: string) => void }) {
  const localShareCount = budgetLadderShares.length + alternativeComparisonShares.length + savedBuildVersionShares.length;
  const hasAnySelection = PART_CATEGORIES.some((category) => selectionList(build, category).length > 0) || accessorySelections(build).length > 0;
  return <div className="home-page">
    <MobileHomeView build={build} result={result} resultIsStale={resultIsStale} partMap={partMap} alertItems={alertItems} alertUnreadCount={alertUnreadCount} onStart={onStart} onGuidedStart={onGuidedStart} onGenerate={onGenerate} onDemo={onDemo} onCompatibleDemo={onCompatibleDemo} onOpenResult={onOpenResult} onOpenHistory={onOpenHistory} onOpenWatchlist={onOpenWatchlist} />
    <section className="hero-section">
      <div className="hero-copy">
        {hasAnySelection
          ? <><p className="eyebrow hero-eyebrow"><FiShield /> 현재 견적</p><h1>내 PC 견적</h1><p className="hero-description">{resultIsStale ? "부품 구성이 바뀌었습니다. 호환 결과를 다시 확인하세요." : result ? "선택한 부품의 호환 결과와 구매 전 확인 항목입니다." : "선택한 부품의 호환 여부와 예상 금액이 여기에 표시됩니다."}</p></>
          : <><p className="eyebrow hero-eyebrow"><FiTarget /> 새 견적</p><h1>PC 견적 만들기</h1><p className="hero-description">용도와 예산을 정해 부품을 고르고, 예상 금액과 호환 결과를 확인하세요.</p></>}
        <div className="hero-actions">
          <button className="button button-primary button-large" onClick={hasAnySelection ? onResume : onGuidedStart}>{hasAnySelection ? "견적 수정하기" : "새 견적 시작하기"} <FiArrowRight /></button>
          <button className="button button-secondary button-large hero-secondary-action" onClick={hasAnySelection ? onGenerate : onStart}>{hasAnySelection ? "다른 구성 보기" : "부품을 직접 선택하기"} {hasAnySelection ? <FiZap /> : <FiEdit3 />}</button>
        </div>
        <details className="hero-demo-tools"><summary>예시 구성 보기 <FiChevronDown /></summary><div><button type="button" onClick={onDemo}><FiActivity /> 문제 있는 예시 견적</button><button type="button" onClick={onCompatibleDemo}><FiCheckCircle /> 문제 없는 예시 견적</button></div></details>
      </div>
      {hasAnySelection ? <HomeCurrentBuildPreview build={build} result={result} resultIsStale={resultIsStale} partMap={partMap} onOpenResult={onOpenResult} /> : <GuidedHomePreview />}
    </section>
    <HomeAlertCenter items={alertItems} unreadCount={alertUnreadCount} hasBuildAlerts={hasBuildAlerts} hasWatchlistAlerts={hasWatchlistAlerts} onOpenHistory={onOpenHistory} onOpenWatchlist={onOpenWatchlist} />
    <details className="home-secondary-details" aria-label="홈 추가 정보">
      <summary><span><FiInfo /> 저장한 견적·비교</span><small>{localShareCount > 0 ? `${localShareCount}개 저장해뒀어요` : "필요할 때 열어보세요"}</small><FiChevronDown /></summary>
      <div className="home-secondary-details-body">
        {budgetLadderShares.length > 0 && <Suspense fallback={null}><LazyHomeBudgetLadderSharePanel entries={budgetLadderShares} onCopy={onCopyBudgetLadderShare} onRemove={onRemoveBudgetLadderShare} onToast={onToastBudgetLadderShare} /></Suspense>}
        {alternativeComparisonShares.length > 0 && <Suspense fallback={null}><LazyHomeAlternativeComparisonSharePanel entries={alternativeComparisonShares} onCopy={onCopyAlternativeComparisonShare} onRemove={onRemoveAlternativeComparisonShare} onRevoke={onRevokeAlternativeComparisonShare} onToast={onToastAlternativeComparisonShare} /></Suspense>}
        {savedBuildVersionShares.length > 0 && <Suspense fallback={null}><LazyHomeSavedBuildVersionSharePanel entries={savedBuildVersionShares} currentCatalogSnapshotAt={meta?.catalogUpdatedAt} onCopy={onCopySavedBuildVersionShare} onRemove={onRemoveSavedBuildVersionShare} onRevoke={onRevokeSavedBuildVersionShare} onToast={onToastSavedBuildVersionShare} /></Suspense>}
        <section className="feature-grid">
          <FeatureCard Icon={FiSearch} title="부품 고르기" description="부품 종류와 주요 사양을 비교해 견적에 담아 보세요." />
          <FeatureCard Icon={FiActivity} title="호환 확인" description="선택한 부품의 호환 결과를 확인합니다." />
          <FeatureCard Icon={FiCheckCircle} title="대안 부품 비교" description="가격과 주요 사양을 나란히 비교합니다." />
        </section>
      </div>
    </details>
  </div>;
}
