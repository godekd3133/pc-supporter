import { Suspense, lazy, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowRight, FiBell, FiCheckCircle, FiChevronDown, FiCpu, FiDatabase, FiEdit3, FiInfo, FiLoader, FiMonitor, FiRefreshCw, FiSearch, FiShield, FiTag, FiTarget, FiTrendingUp, FiXCircle, FiZap } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult, Part, PartCategory, PartSelection, ServiceMeta } from "../shared/types";
import { PART_CATEGORIES } from "../shared/types";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import type { AlternativeComparisonLocalShareEntry } from "../shared/alternative-comparison-local-history";
import type { SavedBuildVersionLocalShareEntry } from "../shared/saved-build-version-local-history";
import type { SavedBuildMonitorAlternative } from "../shared/saved-build-monitor-alerts";

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
        <div className="home-alerts-item-copy"><div className="home-alerts-item-title"><strong>{item.title}</strong><span>{item.source === "build" ? "저장한 견적" : "가격 추적"} · {item.sourceLabel}</span></div><p>{item.message}</p>{item.alternative && <div className="home-alerts-alternative"><span>{item.alternative.currentPartName}</span><b>→</b><strong>{item.alternative.candidatePartName}</strong>{item.alternative.priceDeltaWon !== undefined && <em>{item.alternative.priceDeltaWon < 0 ? `${Math.abs(item.alternative.priceDeltaWon).toLocaleString("ko-KR")}원 절약` : `가격 ${item.alternative.priceDeltaWon > 0 ? "+" : ""}${item.alternative.priceDeltaWon.toLocaleString("ko-KR")}원`}</em>}</div>}<small>{new Date(item.createdAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}{item.read ? "" : " · 아직 안 봄"}</small></div>
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

function HomeDraftResumePanel({ build, result, resultIsStale, onResume, onOpenResult }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; onResume: () => void; onOpenResult: () => void }) {
  const coreEntries = PART_CATEGORIES.flatMap((category) => selectionList(build, category));
  const coreCategoryCount = PART_CATEGORIES.filter((category) => selectionList(build, category).length > 0).length;
  const accessoryCount = accessorySelections(build).length;
  if (coreEntries.length === 0 && accessoryCount === 0) return null;
  const resultLabel = !result ? "아직 검사하지 않았어요" : resultIsStale ? "입력이 바뀌어 다시 확인해요" : scenarioStatusLabel(result.status);
  const resultClass = !result || resultIsStale ? "review" : result.status;
  return <section className="home-draft-resume" aria-label="작업 중인 견적">
    <div className="home-draft-resume-heading"><div><h2>이어서 볼 견적</h2></div><span className={`home-draft-result ${resultClass}`}><span className="status-dot" /> {resultLabel}</span></div>
    <div className="home-draft-resume-summary"><div><span>선택한 핵심 부품</span><strong>{coreEntries.length}개 · {coreCategoryCount}개 범주</strong></div><div><span>주변 부품</span><strong>{accessoryCount}종</strong></div>{result && !resultIsStale ? <div><span>호환성</span><strong>{result.blockerCount > 0 ? "문제 " + result.blockerCount + "개" : "문제 없음"}{result.warningCount > 0 ? " · 주의 " + result.warningCount + "개" : ""}{result.unknownCount > 0 ? " · 사양 미등록 " + result.unknownCount + "개" : ""}</strong></div> : <div><span>다음 단계</span><strong>견적에서 호환성을 확인해 보세요</strong></div>}</div>
    <div className="home-draft-resume-actions"><button className="button button-primary" type="button" onClick={onResume}><FiEdit3 /> 견적 이어서 보기</button>{result && !resultIsStale && <button className="button button-light" type="button" onClick={onOpenResult}><FiActivity /> 호환성 결과 보기</button>}</div>
  </section>;
}

function FeatureCard({ Icon, number, title, description }: { Icon: IconType; number: string; title: string; description: string }) {
  return <article className="feature-card"><span className="feature-number">{number}</span><Icon className="feature-icon" /><h3>{title}</h3><p>{description}</p></article>;
}

function GuidedHomePreview() {
  return <div className="hero-panel guided-home-preview" data-testid="home-guided-entry">
    <div className="panel-kicker">견적 시작</div>
    <div className="guided-home-preview-heading"><span className="guided-home-preview-mark"><FiTarget /></span><div><strong>용도·성능·예산을 고르면</strong><span>부품 조합과 예상 가격을 보여드려요.</span></div></div>
    <div className="guided-home-preview-steps">
      <div><b>01</b><span>사용 목적</span><strong>게임 · 작업 · 예산</strong></div>
      <div><b>02</b><span>목표 성능</span><strong>4K · 144 FPS</strong></div>
      <div><b>03</b><span>추천 결과</span><strong>부품 조합 · 예상 금액</strong></div>
    </div>
    <div className="guided-home-preview-note"><FiCheckCircle /> 부품 모델명은 몰라도 됩니다.</div>
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

function MobileHomeView({ build, result, resultIsStale, partMap, alertItems, alertUnreadCount, onStart, onGuidedStart, onGenerate, onDemo, onCompatibleDemo, onOpenResult, onOpenHistory, onOpenWatchlist }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; alertItems: AlertCenterItem[]; alertUnreadCount: number; onStart: () => void; onGuidedStart: () => void; onGenerate: () => void; onDemo: () => void; onCompatibleDemo: () => void; onOpenResult: () => void; onOpenHistory: () => void; onOpenWatchlist: () => void }) {
  const selectedCategoryCount = PART_CATEGORIES.filter((category) => selectionList(build, category).length > 0).length;
  const selectedItemCount = PART_CATEGORIES.reduce((count, category) => count + selectionList(build, category).length, 0);
  const hasBuild = selectedItemCount > 0;
  const progress = Math.round((selectedCategoryCount / PART_CATEGORIES.length) * 100);
  const resultReady = Boolean(result && !resultIsStale);
  const overallState = resultReady ? scenarioStatusLabel(result!.status) : hasBuild ? "확인할 준비가 됐어요" : "아직 시작하지 않았어요";
  const overallTone = resultReady ? result!.status : hasBuild ? "review" : "empty";
  return <section className="mobile-home-view" aria-label="PC Supporter 모바일 홈">
    <div className="mobile-home-heading">
      <div><span className="mobile-kicker">내 견적</span><h1>내 PC</h1><p>{resultReady ? "현재 구성의 호환성을 확인했어요." : hasBuild ? "고른 부품이 서로 잘 맞는지 확인해 보세요." : "게임이나 작업에 맞는 PC를 골라보세요."}</p></div>
      <span className={`mobile-home-status ${overallTone}`}><span className="mobile-status-dot" /> {overallState}</span>
    </div>
    {!hasBuild && !resultReady
      ? <section className="mobile-guided-entry" data-testid="mobile-home-guided-entry" aria-label="첫 사용자 guided quote">
          <span className="mobile-kicker">견적 시작</span>
          <h2>용도·성능·예산을 고르면<br />예상 견적을 볼 수 있어요.</h2>
          <p>사용 목적, 목표 성능, 예산을 차례로 골라 주세요. 부품 모델명은 몰라도 됩니다.</p>
          <div className="mobile-guided-steps"><div><b>01</b><span>사용 목적</span><strong>게임 · 작업 · 예산</strong></div><div><b>02</b><span>목표 성능</span><strong>4K · 144 FPS</strong></div><div><b>03</b><span>결과 확인</span><strong>예상 가격 · 참고 정보</strong></div></div>
          <div className="mobile-guided-note"><FiCheckCircle /> 처음에는 부품을 고르지 않아도 돼요.</div>
        </section>
      : <section className="mobile-current-build" aria-label="현재 견적">
          <div className="mobile-section-heading"><div><span className="mobile-kicker">현재 견적</span><h2>{hasBuild ? resultReady ? "최근 확인한 구성" : "현재 구성" : "새 견적"}</h2></div><button type="button" className="mobile-section-link" onClick={resultReady ? onOpenResult : onStart}>{resultReady ? "상세 보기" : "수정하기"}<FiArrowRight /></button></div>
          <div className="mobile-health-summary"><div className="mobile-health-score"><span className="mobile-health-score-value"><strong>{resultReady ? Math.max(0, PART_CATEGORIES.length - result!.blockerCount) : selectedCategoryCount}</strong><span>/ {PART_CATEGORIES.length}</span></span></div><div className="mobile-health-copy">{resultReady ? <strong>{result!.status === "compatible" ? "같이 쓸 수 있어요" : result!.status === "needs_review" ? "확인이 필요한 항목이 있어요" : "바꿔야 할 항목이 있어요"}</strong> : !hasBuild ? <strong>첫 견적을 시작해볼까요?</strong> : null}</div></div>
          <div className="mobile-progress-track" aria-label={`필수 부품 ${selectedCategoryCount}개 선택, ${PART_CATEGORIES.length}개 중`} role="progressbar" aria-valuemin={0} aria-valuemax={PART_CATEGORIES.length} aria-valuenow={selectedCategoryCount}><span style={{ width: `${progress}%` }} /></div>
          <div className="mobile-build-list">{MOBILE_HOME_ROWS.map(({ label, category, Icon }) => { const row = mobileHomeRowState(build, result, resultIsStale, category, partMap); return <button className={`mobile-build-row ${row.tone}`} type="button" key={category} onClick={onStart}><span className="mobile-build-icon"><Icon /></span><span className="mobile-build-copy"><strong>{label}</strong><small>{row.name}</small></span>{row.state && <span className={`mobile-row-state ${row.tone}`}>{row.state}</span>}<FiArrowRight className="mobile-build-arrow" /></button>; })}</div>
        </section>}
    <div className="mobile-primary-actions"><button className="mobile-primary-action" data-testid="mobile-home-primary-action" type="button" onClick={resultReady ? onOpenResult : hasBuild ? onStart : onGuidedStart}><FiSearch /><span>{resultReady ? "최근 검사 결과 보기" : hasBuild ? "견적 검사 준비" : "새 견적 시작하기"}</span><FiArrowRight /></button>{resultReady && <button className="mobile-secondary-action" type="button" onClick={onStart}><FiEdit3 /><span>견적 수정하기</span><FiArrowRight /></button>}</div>
    <section className="mobile-next-steps" aria-label="다음 단계"><div className="mobile-section-heading"><div><span className="mobile-kicker">바로 시작</span><h2>추천 구성</h2></div><button type="button" className="mobile-section-link" onClick={onOpenHistory}>저장한 견적<FiArrowRight /></button></div><button className="mobile-recommend-card" data-testid="mobile-home-recommend" type="button" onClick={hasBuild ? onGenerate : onStart}><span className="mobile-recommend-icon">{hasBuild ? <FiZap /> : <FiEdit3 />}</span><span className="mobile-recommend-copy"><strong>{hasBuild ? "용도·예산으로 다시 추천받기" : "부품을 직접 선택하기"}</strong></span><FiArrowRight /></button></section>
    {alertItems.length > 0 && <section className="mobile-alert-preview" aria-label="모바일 알림 센터" data-testid="mobile-home-alert-center"><div className="mobile-section-heading"><div><h2>알림</h2></div>{alertUnreadCount > 0 && <span className="mobile-alert-badge">읽지 않은 알림 {alertUnreadCount}개</span>}</div><div className="mobile-alert-preview-list">{alertItems.slice(0, 2).map((item) => { const ItemIcon = item.kind === "alternative" ? FiTrendingUp : item.source === "watchlist" ? FiTag : FiBell; return <article className={`mobile-alert-preview-item ${item.kind}`} key={item.id}><span className="mobile-alert-preview-icon"><ItemIcon /></span><div><strong>{item.title}</strong><p>{item.message}</p>{item.alternative && <small>{item.alternative.currentPartName} → {item.alternative.candidatePartName}{item.alternative.priceDeltaWon !== undefined && item.alternative.priceDeltaWon < 0 ? ` · ${Math.abs(item.alternative.priceDeltaWon).toLocaleString("ko-KR")}원 절약` : ""}</small>}</div></article>; })}</div><button className="mobile-alert-preview-action" type="button" onClick={() => alertItems[0].source === "watchlist" ? onOpenWatchlist() : onOpenHistory()}><FiBell /> 알림 자세히 보기 <FiArrowRight /></button></section>}
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
          ? <><p className="eyebrow hero-eyebrow"><FiShield /> 부품 호환성 확인</p><h1>고른 부품,<br /><span>서로 맞는지 확인해요.</span></h1><p className="hero-description">호환 문제와 예산을 확인하고, 바꿔 볼 부품도 보여드려요.</p></>
          : <><p className="eyebrow hero-eyebrow"><FiTarget /> 새 PC 맞추기</p><h1>게임·작업에 맞는 PC,<br /><span>예산 안에서 골라봐요.</span></h1><p className="hero-description">주로 하는 게임이나 작업과 예산을 알려주세요. 조건에 맞는 부품 조합과 예상 가격을 보여드릴게요.</p></>}
        <div className="hero-actions">
          <button className="button button-primary button-large" onClick={hasAnySelection ? onStart : onGuidedStart}>{hasAnySelection ? "이 견적 확인하기" : "새 견적 시작하기"} <FiArrowRight /></button>
          <button className="button button-secondary button-large hero-secondary-action" onClick={hasAnySelection ? onGenerate : onStart}>{hasAnySelection ? "다른 구성 추천받기" : "부품을 직접 선택하기"} {hasAnySelection ? <FiZap /> : <FiEdit3 />}</button>
        </div>
        <details className="hero-demo-tools"><summary>예시 구성 보기 <FiChevronDown /></summary><div><button type="button" onClick={onDemo}><FiActivity /> 문제 있는 예시 견적</button><button type="button" onClick={onCompatibleDemo}><FiCheckCircle /> 문제 없는 예시 견적</button></div></details>
      </div>
      {hasAnySelection ? <div className="hero-panel">
        <div className="panel-kicker">호환성 미리보기</div>
      <div className="preview-status"><span className="status-icon danger"><FiXCircle /></span><div><strong>확인이 필요한 부품이 있어요.</strong><span>바로 고칠 문제 3개 · 주의 1개</span></div></div>
      <div className="preview-rule"><span className="rule-icon danger"><FiXCircle /></span><div><strong>CPU와 메인보드 규격이 달라요.</strong><small>CPU: AM5 · 메인보드: LGA1700</small></div><FiChevronDown /></div>
      <div className="preview-rule"><span className="rule-icon warning"><FiAlertTriangle /></span><div><strong>RAM 속도가 이 메인보드에서 지원하는 범위를 넘었어요.</strong><small>속도가 낮아질 수 있어요.</small></div><FiChevronDown /></div>
      <div className="preview-rule"><span className="rule-icon success"><FiCheckCircle /></span><div><strong>문제가 있는 부품은 바로 바꿔볼 수 있어요.</strong><small>바꾼 뒤 다시 확인해요</small></div><FiChevronDown /></div>
      </div> : <GuidedHomePreview />}
    </section>
    <HomeAlertCenter items={alertItems} unreadCount={alertUnreadCount} hasBuildAlerts={hasBuildAlerts} hasWatchlistAlerts={hasWatchlistAlerts} onOpenHistory={onOpenHistory} onOpenWatchlist={onOpenWatchlist} />
    <HomeDraftResumePanel build={build} result={result} resultIsStale={resultIsStale} onResume={onResume} onOpenResult={onOpenResult} />
    <details className="home-secondary-details" aria-label="홈 추가 정보">
      <summary><span><FiInfo /> 저장한 견적·비교</span><small>{localShareCount > 0 ? `${localShareCount}개 저장해뒀어요` : "필요할 때 열어보세요"}</small><FiChevronDown /></summary>
      <div className="home-secondary-details-body">
        {budgetLadderShares.length > 0 && <Suspense fallback={null}><LazyHomeBudgetLadderSharePanel entries={budgetLadderShares} onCopy={onCopyBudgetLadderShare} onRemove={onRemoveBudgetLadderShare} onToast={onToastBudgetLadderShare} /></Suspense>}
        {alternativeComparisonShares.length > 0 && <Suspense fallback={null}><LazyHomeAlternativeComparisonSharePanel entries={alternativeComparisonShares} onCopy={onCopyAlternativeComparisonShare} onRemove={onRemoveAlternativeComparisonShare} onRevoke={onRevokeAlternativeComparisonShare} onToast={onToastAlternativeComparisonShare} /></Suspense>}
        {savedBuildVersionShares.length > 0 && <Suspense fallback={null}><LazyHomeSavedBuildVersionSharePanel entries={savedBuildVersionShares} currentCatalogSnapshotAt={meta?.catalogUpdatedAt} onCopy={onCopySavedBuildVersionShare} onRemove={onRemoveSavedBuildVersionShare} onRevoke={onRevokeSavedBuildVersionShare} onToast={onToastSavedBuildVersionShare} /></Suspense>}
        <section className="feature-grid">
          <FeatureCard Icon={FiSearch} number="01" title="부품 고르기" description="부품 종류와 주요 사양을 비교해 견적에 담아 보세요." />
          <FeatureCard Icon={FiActivity} number="02" title="호환성 검사" description="선택한 부품이 서로 맞는지 확인할 수 있어요." />
          <FeatureCard Icon={FiCheckCircle} number="03" title="대안 부품 비교하기" description="가격과 주요 사양을 비교해 바꿔 볼 부품을 보여줘요." />
        </section>
      </div>
    </details>
  </div>;
}
