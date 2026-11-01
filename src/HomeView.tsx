import { Suspense, lazy, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiArrowRight, FiBell, FiCheckCircle, FiChevronDown, FiDatabase, FiEdit3, FiInfo, FiSearch, FiShield, FiTag, FiTarget, FiTrash2, FiTrendingUp, FiZap } from "react-icons/fi";
import "./home-view.css";
import "./home-layout.css";
import "./tracking-simplify.css";
import { buildPreflightFor } from "../shared/build-preflight";
import type { AccessoryItem, BuildSelection, CompatibilityResult, Part, PartCategory, PartSelection, SavedBuild, ServiceMeta } from "../shared/types";
import type { JourneyActionKind } from "./user-journey";
import { CATEGORY_LABELS, PART_CATEGORIES } from "../shared/types";
import { CATEGORY_ICONS } from "./category-icons";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import type { AlternativeComparisonLocalShareEntry } from "../shared/alternative-comparison-local-history";
import type { SavedBuildVersionLocalShareEntry } from "../shared/saved-build-version-local-history";
import type { SavedBuildMonitorAlert, SavedBuildMonitorAlternative } from "../shared/saved-build-monitor-alerts";
import { savedBuildMonitorSummaryForDisplay, savedBuildMonitorTitleForDisplay } from "../shared/saved-build-monitor-copy";
import { compatibilityDisplayStatusFor } from "../shared/compatibility-display-status";
import { ACCESSORY_CATALOG_CACHE_STORAGE_KEY } from "../shared/accessory-catalog-cache";
import { CATALOG_PICKER_CACHE_STORAGE_KEY } from "../shared/catalog-picker-cache";
import { CATALOG_CACHE_CHANGED_EVENT, catalogCacheStatusFromStorage, type CatalogCacheStatus, type CatalogCacheStatusItem } from "../shared/catalog-cache-status";
import { getLocalStorageHealth, safeLocalStorage, subscribeLocalStorageHealth, type LocalStorageHealth } from "./safe-storage";

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


type HomeCatalogCacheState = { status: CatalogCacheStatus; hasStoredData: boolean; storageHealth: LocalStorageHealth } | null;

function readHomeCatalogCacheState(): HomeCatalogCacheState {
  try {
    const parts = safeLocalStorage.getItem(CATALOG_PICKER_CACHE_STORAGE_KEY);
    const accessories = safeLocalStorage.getItem(ACCESSORY_CATALOG_CACHE_STORAGE_KEY);
    const values = new Map([[CATALOG_PICKER_CACHE_STORAGE_KEY, parts], [ACCESSORY_CATALOG_CACHE_STORAGE_KEY, accessories]]);
    return {
      status: catalogCacheStatusFromStorage((key) => values.get(key)),
      hasStoredData: parts !== null || accessories !== null,
      storageHealth: getLocalStorageHealth()
    };
  } catch {
    return null;
  }
}

function homeCacheFreshnessLabel(item: CatalogCacheStatusItem) {
  if (item.count === 0) return "저장된 항목 없음";
  if (item.freshness === "fresh") return "최근 저장";
  if (item.freshness === "aging") return "확인한 지 오래됐어요";
  if (item.freshness === "stale") return "오래된 목록";
  return "저장 시점을 확인할 수 없어요";
}

function homeCacheSavedAtLabel(item: CatalogCacheStatusItem) {
  if (!item.cachedAt) return "저장 시점을 확인할 수 없어요";
  const date = new Date(item.cachedAt);
  return Number.isNaN(date.getTime())
    ? "저장 시점을 확인할 수 없어요"
    : `마지막 저장 / ${date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`;
}

function HomeCatalogCachePanel({ onToast }: { onToast: (message: string) => void }) {
  const [state, setState] = useState<HomeCatalogCacheState | undefined>(() => typeof window === "undefined" ? undefined : readHomeCatalogCacheState());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setState(readHomeCatalogCacheState());
    refresh();
    const unsubscribeHealth = subscribeLocalStorageHealth(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener(CATALOG_CACHE_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribeHealth();
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CATALOG_CACHE_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  function clearCache(kind: "parts" | "accessories" | "all") {
    const label = kind === "parts" ? "핵심 부품 목록" : kind === "accessories" ? "주변 부품 목록" : "최근 불러온 부품 목록";
    if (!window.confirm(`${label}을(를) 지울까요? 견적 초안/저장 견적/가격 추적은 그대로 남습니다.`)) return;
    try {
      if (kind === "parts" || kind === "all") safeLocalStorage.removeItem(CATALOG_PICKER_CACHE_STORAGE_KEY);
      if (kind === "accessories" || kind === "all") safeLocalStorage.removeItem(ACCESSORY_CATALOG_CACHE_STORAGE_KEY);
      window.dispatchEvent(new Event(CATALOG_CACHE_CHANGED_EVENT));
      const nextState = readHomeCatalogCacheState();
      setState(nextState);
      if (nextState?.storageHealth.persistence === "persistent") {
        setMessage(`${label}을(를) 지웠어요. 견적과 가격 추적은 그대로 남아 있습니다.`);
        onToast("최근 부품 목록을 지웠어요.");
      } else {
        setMessage(`현재 앱 실행 중에는 ${label}이 보이지 않도록 했어요. 브라우저에 저장된 데이터는 삭제되지 않았을 수 있습니다.`);
        onToast("목록을 지우지 못했어요.");
      }
    } catch {
      setState(readHomeCatalogCacheState());
      setMessage("목록을 지우지 못했어요.");
      onToast("부품 목록을 지우지 못했어요.");
    }
  }

  const status = state?.status;
  const cacheItems = status ? [status.parts, status.accessories] : [];
  return <section className={`home-catalog-cache${status?.hasAny ? "" : " empty"}`} aria-label="이 기기에 저장된 부품 목록" data-testid="home-catalog-cache">
    <div className="home-catalog-cache-heading">
      <div>
        <h2>최근 불러온 부품</h2>
        <p></p>
      </div>
      {status?.hasAny && <span>{status.totalCount.toLocaleString("ko-KR")}개</span>}
    </div>
    {state?.storageHealth.persistence === "session" && <p className="home-catalog-cache-empty" role="status"><FiInfo aria-hidden="true" /> {state.storageHealth.reason === "quota" ? "브라우저 저장 공간이 부족해 최근 목록 일부 또는 전부가 앱을 다시 열면 사라질 수 있습니다." : "브라우저 저장 공간에 접근할 수 없어 최근 목록 일부 또는 전부가 앱을 다시 열면 사라질 수 있습니다."}</p>}
    {status?.hasAny ? <>
      <div className="home-catalog-cache-grid">
        {cacheItems.map((item) => <article className={`home-catalog-cache-item ${item.freshness}`} key={item.kind}>
          <div><span>{item.label}</span><strong>{item.count.toLocaleString("ko-KR")}개</strong></div>
          <em>{homeCacheFreshnessLabel(item)}</em>
          <small>{homeCacheSavedAtLabel(item)}</small>
          <button className="text-button" type="button" data-testid={`home-catalog-cache-clear-${item.kind}`} onClick={() => clearCache(item.kind)} disabled={item.count === 0}><FiTrash2 aria-hidden="true" /> 이 목록 지우기</button>
        </article>)}
      </div>
    </> : state?.hasStoredData
      ? <p className="home-catalog-cache-empty" role="status"><FiInfo aria-hidden="true" /> 목록을 불러오지 못했어요.</p>
      : state === null
        ? <p className="home-catalog-cache-empty" role="status"><FiInfo aria-hidden="true" /> 목록을 불러오지 못했어요.</p>
        : state?.storageHealth.persistence === "session" && state.storageHealth.reason === "blocked"
          ? <p className="home-catalog-cache-empty" role="status"><FiInfo aria-hidden="true" /> 목록을 불러오지 못했어요.</p>
          : <p className="home-catalog-cache-empty"><FiInfo aria-hidden="true" /> 최근 본 부품이 없어요.</p>}
    {(state?.hasStoredData || state?.storageHealth.persistence === "session") && <div className="home-catalog-cache-actions">
      <button className="button button-light" type="button" data-testid="home-catalog-cache-clear-all" onClick={() => clearCache("all")}><FiTrash2 aria-hidden="true" /> 최근 부품 목록 모두 지우기</button>
      <p><FiInfo aria-hidden="true" /></p>
    </div>}
    {message && <p className="home-catalog-cache-message" role="status"><FiCheckCircle aria-hidden="true" /> {message}</p>}
  </section>;
}

const LazyHomeSavedBuildPrices = lazy(() => import("./HomeSavedBuildPrices").then((module) => ({ default: module.HomeSavedBuildPrices })));
const LazyHomeAlertCenter = lazy(() => import("./HomeAlertCenter").then((module) => ({ default: module.HomeAlertCenter })));
const LazyHomeSpecSheet = lazy(() => import("./HomeSpecSheet").then((module) => ({ default: module.HomeSpecSheet })));
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

function HomeEntryTitle({ Icon, title, description }: { Icon: IconType; title: string; description: string }) {
  return <div className="home-entry-title"><span className="home-entry-icon"><Icon aria-hidden="true" /></span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

function GuidedHomePreview() {
  return <div className="hero-panel guided-home-preview" data-testid="home-guided-entry">
    <div className="panel-kicker">견적 시작</div>
    <div className="guided-home-preview-heading"><div><strong>용도와 예산 선택</strong></div></div>
    <dl className="guided-home-preview-choices">
      <div><dt><span aria-hidden="true">01</span>사용 목적</dt><dd>게임 / 작업</dd></div>
      <div><dt><span aria-hidden="true">02</span>화면과 성능</dt><dd>FHD / QHD / 4K</dd></div>
      <div><dt><span aria-hidden="true">03</span>예산</dt><dd>원하는 금액</dd></div>
    </dl>
  </div>;
}

function HomeCategoryRow({ onOpenCategory }: { onOpenCategory?: (category: PartCategory) => void }) {
  if (!onOpenCategory) return null;
  return <nav className="home-category-row" aria-label="부품별로 보기">
    {PART_CATEGORIES.map((category) => { const Icon = CATEGORY_ICONS[category]; return <button type="button" key={category} onClick={() => onOpenCategory(category)}><span aria-hidden="true"><Icon /></span>{CATEGORY_LABELS[category]}</button>; })}
  </nav>;
}

// The current draft counts as saved when a saved build holds the same parts and quantities.
function selectionKey(build: BuildSelection) {
  return PART_CATEGORIES.map((category) => selectionList(build, category).map((selection) => `${selection.partId}x${selection.quantity}`).join(",")).join("|");
}

type MobileHomeRow = { label: string; category: PartCategory; Icon: IconType };

const MOBILE_HOME_ROWS: MobileHomeRow[] = [
  { label: "CPU", category: "cpu", Icon: CATEGORY_ICONS.cpu },
  { label: "메인보드", category: "motherboard", Icon: CATEGORY_ICONS.motherboard },
  { label: "RAM", category: "memory", Icon: CATEGORY_ICONS.memory },
  { label: "그래픽카드", category: "gpu", Icon: CATEGORY_ICONS.gpu }
];

function mobileHomeRowState(build: BuildSelection, result: CompatibilityResult | null, resultIsStale: boolean, category: PartCategory, partMap: ReadonlyMap<string, Part>) {
  const selections = selectionList(build, category);
  if (selections.length === 0) return { state: "선택 전", tone: "empty", name: "부품을 골라 주세요" };
  const names = selections.map((selection) => `${partMap.get(selection.partId)?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ");
  const findings = result && !resultIsStale ? result.findings.filter((finding) => selections.some((selection) => finding.affectedPartIds.includes(selection.partId))) : [];
  if (findings.some((finding) => finding.severity === "blocker")) return { state: "호환 불가", tone: "incompatible", name: names };
  if (findings.some((finding) => finding.severity === "warning")) return { state: "주의", tone: "warning", name: names };
  if (findings.some((finding) => finding.severity === "unknown")) return { state: "확인 필요", tone: "review", name: names };
  if (result && !resultIsStale) return { state: "호환 가능", tone: "success", name: names };
  return { state: "", tone: "neutral", name: names };
}

export function MobileHomeRequiredSelectionCount({ build, partMap, accessoryMap }: { build: BuildSelection; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem> }) {
  const preflight = buildPreflightFor(build, partMap, accessoryMap);
  const progress = preflight.requiredTotal > 0
    ? Math.round(Math.min(100, Math.max(0, preflight.requiredSelectedCount / preflight.requiredTotal * 100)))
    : 0;
  return <div className="mobile-selection-progress" data-testid="mobile-home-required-count">
    <p className="mobile-selection-count"><span>필수 부품 선택</span><strong>{preflight.requiredSelectedCount}/{preflight.requiredTotal}</strong></p>
    <div className="mobile-selection-progress-track" role="progressbar" aria-label="필수 부품 선택 진행률" aria-valuemin={0} aria-valuemax={preflight.requiredTotal} aria-valuenow={preflight.requiredSelectedCount} aria-valuetext={`${preflight.requiredSelectedCount}개 선택, ${preflight.requiredTotal}개 중`}>
      <span style={{ width: `${progress}%` }} />
    </div>
  </div>;
}

type MobileHomeAdditionalGroup = { label: string; items: string[] };

function mobileHomeAdditionalGroupsFor(build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): MobileHomeAdditionalGroup[] {
  const primaryCategories = new Set(MOBILE_HOME_ROWS.map((row) => row.category));
  const groups: MobileHomeAdditionalGroup[] = [];
  for (const category of PART_CATEGORIES) {
    const selections = selectionList(build, category);
    const memoryCount = category === "memory" ? selections.reduce((total, selection) => total + selection.quantity, 0) : 0;
    const memoryOverflow = category === "memory" && (selections.length > 1 || memoryCount > 1);
    if (selections.length === 0 || (primaryCategories.has(category) && !memoryOverflow)) continue;
    groups.push({
      label: category === "memory" ? "추가 RAM" : CATEGORY_LABELS[category],
      items: selections.map((selection) => `${partMap.get(selection.partId)?.name ?? "부품 정보 없음"}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`)
    });
  }
  const accessories = accessorySelections(build);
  if (accessories.length > 0) {
    groups.push({
      label: "주변 부품",
      items: accessories.map((selection) => `${accessoryMap.get(selection.accessoryId)?.name ?? "주변 부품 정보 없음"}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`)
    });
  }
  return groups;
}

export function MobileHomeAdditionalSelections({ build, partMap, accessoryMap }: { build: BuildSelection; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem> }) {
  const groups = mobileHomeAdditionalGroupsFor(build, partMap, accessoryMap);
  if (groups.length === 0) return null;
  const accessoryCount = accessorySelections(build).reduce((total, selection) => total + selection.quantity, 0);
  const memoryCount = build.memory.reduce((total, selection) => total + selection.quantity, 0);
  const additionalLabels = groups.map((group) => group.label === "추가 RAM" ? `RAM ${memoryCount}개` : group.label === "주변 부품" ? `주변 부품 ${accessoryCount}개` : group.label);
  return <details className="mobile-build-additional" data-testid="mobile-home-additional-selections" aria-label="추가로 선택한 부품과 주변 부품">
    <summary><span className="mobile-build-additional-copy"><strong>추가 구성 보기</strong><small>{additionalLabels.join(" / ")}</small></span><FiChevronDown aria-hidden="true" /></summary>
    <div className="mobile-build-additional-items">{groups.map((group) => <div className="mobile-build-additional-group" key={group.label}><strong>{group.label}</strong><span>{group.items.join(" / ")}</span></div>)}</div>
  </details>;
}

function MobileHomeView({ build, result, resultIsStale, partMap, accessoryMap, alertItems, alertUnreadCount, savedBuilds, savedBuildMonitorAlerts, onStart, onGuidedStart, onGenerate, onDemo, onCompatibleDemo, onOpenResult, onOpenHistory, onOpenWatchlist, onJourneyAction, onOpenSavedBuild, onToast }: { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; alertItems: AlertCenterItem[]; alertUnreadCount: number; savedBuilds: SavedBuild[]; savedBuildMonitorAlerts?: SavedBuildMonitorAlert[]; onStart: () => void; onGuidedStart: () => void; onGenerate: () => void; onDemo: () => void; onCompatibleDemo: () => void; onOpenResult: () => void; onOpenHistory: () => void; onOpenWatchlist: () => void; onJourneyAction: (action: JourneyActionKind) => void; onOpenSavedBuild: (saved: SavedBuild) => void; onToast: (message: string) => void }) {
  const selectedItemCount = PART_CATEGORIES.reduce((count, category) => count + selectionList(build, category).length, 0);
  const hasBuild = selectedItemCount > 0 || accessorySelections(build).length > 0;
  const draftSaved = hasBuild && savedBuilds.some((saved) => selectionKey(saved.selection) === selectionKey(build));
  const resultReady = Boolean(result && !resultIsStale);
  const displayStatus = result ? compatibilityDisplayStatusFor(result) : undefined;
  const warningCount = (result?.warningCount ?? 0) + (result?.accessoryCompatibility?.warningCount ?? 0);
  const statusCopy = !resultReady ? undefined
    : displayStatus === "incompatible" ? result!.status === "incompatible" ? "호환되지 않는 부품이 있습니다." : "주변 부품의 호환을 확인해 주세요."
    : displayStatus === "needs_review" ? result!.status === "needs_review" ? "확인이 필요한 부품이 있습니다." : "주변 부품 정보를 더 확인해 주세요."
    : warningCount > 0 ? "호환되지만 추가 확인 항목이 있습니다."
    : "모든 부품이 호환됩니다.";
  const headingCopy = statusCopy ?? (resultIsStale
    ? "구성이 바뀌었어요. 호환 결과를 다시 확인해 주세요."
    : hasBuild
      ? "고른 부품을 확인하고, 나머지 구성을 이어가세요."
    : "용도와 예산을 정한 뒤, 부품을 고르고 호환성을 확인해요.");
  return <section className="mobile-home-view" aria-label="PC Supporter 모바일 홈">
    <div className="mobile-home-heading">
      <div><span className="mobile-kicker">내 견적</span><h1>{hasBuild || result ? "내 PC 견적" : "PC 견적 만들기"}</h1><p>{headingCopy}</p></div>
    </div>
    <div className="home-entry-grid">
    <div className="home-entry-card home-entry-primary">
    <HomeEntryTitle Icon={FiTarget} title={hasBuild ? "이어서 완성해요" : "나에게 맞는 PC 찾기"} description={hasBuild ? "현재 견적과 호환 결과를 확인해요." : "용도와 예산에 맞춰 부품을 추천해요."} />
    <div className="mobile-primary-actions"><button className="mobile-primary-action" data-testid="mobile-home-primary-action" type="button" onClick={draftSaved ? onGuidedStart : resultReady ? onOpenResult : hasBuild ? onStart : onGuidedStart}><FiSearch /><span>{draftSaved ? "새 견적 만들기" : resultReady ? "최근 견적 결과 보기" : hasBuild ? "견적 이어서 만들기" : "용도와 예산 정하기"}</span><FiArrowRight /></button>{resultReady && <button className="mobile-secondary-action" type="button" onClick={onStart}><FiEdit3 /><span>견적 수정하기</span><FiArrowRight /></button>}</div>
    {!hasBuild && !resultReady
      ? <section className="mobile-guided-entry" data-testid="mobile-home-guided-entry" aria-label="새 견적 안내">
          <span className="mobile-kicker">견적 진행 순서</span>
          <h2>용도와 예산부터 정해요.</h2>
          <p>게임/작업 용도와 화면에 맞는 부품을 살펴볼 수 있어요.</p>
          <ol className="mobile-guided-steps" aria-label="견적 진행 순서">
            <li><span>1</span>용도</li>
            <li><span>2</span>화면/성능</li>
            <li><span>3</span>예산</li>
          </ol>
          <p className="mobile-guided-outcome">선택한 조건에 맞춰 부품을 추천하고, 호환 결과까지 확인해요.</p>
        </section>
      : <section className="mobile-current-build" aria-label="현재 견적">
          <div className="mobile-section-heading"><div><span className="mobile-kicker">부품 구성</span><h2>{hasBuild ? resultReady ? "최근 견적" : "현재 구성" : "새 견적"}</h2></div></div>
          <MobileHomeRequiredSelectionCount build={build} partMap={partMap} accessoryMap={accessoryMap} />
          <div className="mobile-build-list">{MOBILE_HOME_ROWS.map(({ label, category, Icon }) => { const row = mobileHomeRowState(build, result, resultIsStale, category, partMap); return <button className={`mobile-build-row ${row.tone}`} type="button" key={category} onClick={onStart}><span className="mobile-build-icon" aria-hidden="true"><Icon /></span><span className="mobile-build-copy"><strong>{label}</strong><small>{row.name}</small></span>{row.state && <span className={`mobile-row-state ${row.tone}`}>{row.state}</span>}<FiArrowRight className="mobile-build-arrow" aria-hidden="true" /></button>; })}</div>
          <MobileHomeAdditionalSelections build={build} partMap={partMap} accessoryMap={accessoryMap} />
        </section>}
    </div>
    <section className="mobile-next-steps home-entry-card" aria-label="다른 구성 방법"><div className="mobile-section-heading"><div><span className="mobile-kicker">구성 방법</span><h2>{hasBuild ? "다른 방법으로 구성" : "직접 구성"}</h2></div></div><button className="mobile-recommend-card" data-testid="mobile-home-recommend" type="button" onClick={hasBuild ? onGenerate : onStart}><span className="mobile-recommend-icon">{hasBuild ? <FiZap /> : <FiEdit3 />}</span><span className="mobile-recommend-copy"><strong>{hasBuild ? "용도/예산으로 다시 구성하기" : "부품 선택하기"}</strong>{!hasBuild && <small>원하는 부품을 선택하고 호환성을 확인해요.</small>}</span><FiArrowRight /></button></section>
    </div>
    {savedBuilds.length > 0 && <Suspense fallback={null}><LazyHomeSavedBuildPrices compact savedBuilds={savedBuilds} monitorAlerts={savedBuildMonitorAlerts} onOpenSavedBuild={onOpenSavedBuild} onOpenHistory={onOpenHistory} /></Suspense>}
    {alertItems.length > 0 && <section className="mobile-alert-preview" aria-label="모바일 알림 센터" data-testid="mobile-home-alert-center"><div className="mobile-section-heading"><div><h2>알림</h2></div>{alertUnreadCount > 0 && <span className="mobile-alert-badge">읽지 않은 알림 {alertUnreadCount}개</span>}</div><div className="mobile-alert-preview-list">{alertItems.slice(0, 2).map((item) => { const ItemIcon = item.kind === "alternative" ? FiTrendingUp : item.source === "watchlist" ? FiTag : FiBell; return <article className={`mobile-alert-preview-item ${item.kind}`} key={item.id}><span className="mobile-alert-preview-icon"><ItemIcon /></span><div><strong>{savedBuildMonitorTitleForDisplay(item.title)}</strong><p>{savedBuildMonitorSummaryForDisplay(item.message)}</p>{item.alternative && <small>{item.alternative.currentPartName} → {item.alternative.candidatePartName}{item.alternative.priceDeltaWon !== undefined && item.alternative.priceDeltaWon < 0 ? ` / ${Math.abs(item.alternative.priceDeltaWon).toLocaleString("ko-KR")}원 절약` : ""}</small>}</div></article>; })}</div><button className="mobile-alert-preview-action" type="button" onClick={() => alertItems[0].source === "watchlist" ? onOpenWatchlist() : onOpenHistory()}><FiBell /> 알림 자세히 보기 <FiArrowRight /></button></section>}
    <details className="mobile-cache-disclosure" aria-label="이 기기에 저장된 정보">
      <summary><span><FiDatabase aria-hidden="true" /> 이 기기에 저장된 정보</span><small>최근 부품 목록 관리</small><FiChevronDown aria-hidden="true" /></summary>
      <HomeCatalogCachePanel onToast={onToast} />
    </details>
    <details className="mobile-demo-tools"><summary>예시 구성 보기</summary><div><button type="button" onClick={onDemo}>문제 있는 예시 견적</button><button type="button" onClick={onCompatibleDemo}>문제 없는 예시 견적</button></div></details>
  </section>;
}

export function HomeView({ onOpenCategory, meta, build, result, resultIsStale, partMap, accessoryMap, budgetLadderShares, alternativeComparisonShares, savedBuildVersionShares, alertItems, alertUnreadCount, hasBuildAlerts, hasWatchlistAlerts, savedBuilds, savedBuildMonitorAlerts, onJourneyAction, onOpenSavedBuild, onStart, onGuidedStart, onGenerate, onDemo, onCompatibleDemo, onResume, onOpenResult, onOpenHistory, onOpenWatchlist, onCopyBudgetLadderShare, onRemoveBudgetLadderShare, onToastBudgetLadderShare, onCopyAlternativeComparisonShare, onRemoveAlternativeComparisonShare, onRevokeAlternativeComparisonShare, onToastAlternativeComparisonShare, onCopySavedBuildVersionShare, onRemoveSavedBuildVersionShare, onRevokeSavedBuildVersionShare, onToastSavedBuildVersionShare, onToast }: { onOpenCategory?: (category: PartCategory) => void; meta: ServiceMeta | null; build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; budgetLadderShares: BudgetLadderLocalShareEntry[]; alternativeComparisonShares: AlternativeComparisonLocalShareEntry[]; savedBuildVersionShares: SavedBuildVersionLocalShareEntry[]; alertItems: AlertCenterItem[]; alertUnreadCount: number; hasBuildAlerts: boolean; hasWatchlistAlerts: boolean; savedBuilds: SavedBuild[]; savedBuildMonitorAlerts?: SavedBuildMonitorAlert[]; onJourneyAction: (action: JourneyActionKind) => void; onOpenSavedBuild: (saved: SavedBuild) => void; onStart: () => void; onGuidedStart: () => void; onGenerate: () => void; onDemo: () => void; onCompatibleDemo: () => void; onResume: () => void; onOpenResult: () => void; onOpenHistory: () => void; onOpenWatchlist: () => void; onCopyBudgetLadderShare: (entry: BudgetLadderLocalShareEntry) => void; onRemoveBudgetLadderShare: (id: string) => void; onToastBudgetLadderShare: (message: string) => void; onCopyAlternativeComparisonShare: (entry: AlternativeComparisonLocalShareEntry) => void; onRemoveAlternativeComparisonShare: (id: string) => void; onRevokeAlternativeComparisonShare: (entry: AlternativeComparisonLocalShareEntry) => Promise<boolean>; onToastAlternativeComparisonShare: (message: string) => void; onCopySavedBuildVersionShare: (entry: SavedBuildVersionLocalShareEntry) => void; onRemoveSavedBuildVersionShare: (id: string) => void; onRevokeSavedBuildVersionShare: (entry: SavedBuildVersionLocalShareEntry) => Promise<boolean>; onToastSavedBuildVersionShare: (message: string) => void; onToast: (message: string) => void }) {
  const localShareCount = budgetLadderShares.length + alternativeComparisonShares.length + savedBuildVersionShares.length;
  const hasAnySelection = PART_CATEGORIES.some((category) => selectionList(build, category).length > 0) || accessorySelections(build).length > 0;
  const draftSaved = hasAnySelection && savedBuilds.some((saved) => selectionKey(saved.selection) === selectionKey(build));
  return <div className="home-page">
    <MobileHomeView build={build} result={result} resultIsStale={resultIsStale} partMap={partMap} accessoryMap={accessoryMap} alertItems={alertItems} alertUnreadCount={alertUnreadCount} savedBuilds={savedBuilds} savedBuildMonitorAlerts={savedBuildMonitorAlerts} onStart={onStart} onGuidedStart={onGuidedStart} onGenerate={onGenerate} onDemo={onDemo} onCompatibleDemo={onCompatibleDemo} onOpenResult={onOpenResult} onOpenHistory={onOpenHistory} onOpenWatchlist={onOpenWatchlist} onJourneyAction={onJourneyAction} onOpenSavedBuild={onOpenSavedBuild} onToast={onToast} />
    <section className={`home-workbench${hasAnySelection ? " has-build" : ""}`} aria-label="견적 구성 방법">
      <div className="home-workbench-copy">
        {hasAnySelection
          ? <><p className="eyebrow hero-eyebrow"><FiShield /> 현재 견적</p><h1>내 PC 견적</h1>{resultIsStale && <p className="hero-description">부품 구성이 바뀌었습니다. 호환 결과를 다시 확인하세요.</p>}</>
          : <><p className="eyebrow hero-eyebrow"><FiTarget /> 새 견적</p><h1>PC 견적 만들기</h1><p className="hero-description">용도와 예산을 정하면 부품과 가격, 호환 여부를 확인할 수 있습니다.</p></>}
        <div className="home-workbench-actions">
          <button type="button" className="button button-primary button-large home-entry-cta" onClick={draftSaved ? onGuidedStart : hasAnySelection ? onResume : onGuidedStart}>{draftSaved ? "새 견적 만들기" : hasAnySelection ? "견적 이어서 만들기" : "용도와 예산 정하기"}<FiArrowRight aria-hidden="true" /></button>
          <button type="button" className="button button-secondary button-large home-entry-cta hero-secondary-action" onClick={draftSaved ? onResume : hasAnySelection ? onGenerate : onStart}>{draftSaved ? "이 견적 수정하기" : hasAnySelection ? "다른 구성 보기" : "부품을 직접 선택하기"}</button>
        </div>
        {!hasAnySelection && <GuidedHomePreview />}
        <div className="home-workbench-links">
          <details className="hero-demo-tools"><summary>예시 구성 보기 <FiChevronDown aria-hidden="true" /></summary><div><button type="button" onClick={onDemo}><FiActivity /> 문제 있는 예시 견적</button><button type="button" onClick={onCompatibleDemo}><FiCheckCircle /> 문제 없는 예시 견적</button></div></details>
        </div>
      </div>
      <Suspense fallback={<section className="home-spec-sheet" aria-hidden="true" />}><LazyHomeSpecSheet build={build} result={result} resultIsStale={resultIsStale} partMap={partMap} onOpenResult={onOpenResult} /></Suspense>
    </section>
    {savedBuilds.length > 0 && <Suspense fallback={null}><LazyHomeSavedBuildPrices savedBuilds={savedBuilds} monitorAlerts={savedBuildMonitorAlerts} onOpenSavedBuild={onOpenSavedBuild} onOpenHistory={onOpenHistory} /></Suspense>}
    <HomeCategoryRow onOpenCategory={onOpenCategory} />
    {alertItems.length > 0 && <Suspense fallback={null}><LazyHomeAlertCenter items={alertItems} unreadCount={alertUnreadCount} hasBuildAlerts={hasBuildAlerts} hasWatchlistAlerts={hasWatchlistAlerts} onOpenHistory={onOpenHistory} onOpenWatchlist={onOpenWatchlist} /></Suspense>}
    <details className="home-secondary-details" aria-label="홈 추가 정보">
      <summary><span><FiInfo /> 저장한 견적/비교</span><small>{localShareCount > 0 ? `${localShareCount}개 / 부품 목록 보기` : "견적과 이 기기의 부품 목록"}</small><FiChevronDown /></summary>
      <div className="home-secondary-details-body">
        {budgetLadderShares.length > 0 && <Suspense fallback={null}><LazyHomeBudgetLadderSharePanel entries={budgetLadderShares} onCopy={onCopyBudgetLadderShare} onRemove={onRemoveBudgetLadderShare} onToast={onToastBudgetLadderShare} /></Suspense>}
        {alternativeComparisonShares.length > 0 && <Suspense fallback={null}><LazyHomeAlternativeComparisonSharePanel entries={alternativeComparisonShares} onCopy={onCopyAlternativeComparisonShare} onRemove={onRemoveAlternativeComparisonShare} onRevoke={onRevokeAlternativeComparisonShare} onToast={onToastAlternativeComparisonShare} /></Suspense>}
        {savedBuildVersionShares.length > 0 && <Suspense fallback={null}><LazyHomeSavedBuildVersionSharePanel entries={savedBuildVersionShares} currentCatalogSnapshotAt={meta?.catalogUpdatedAt} onCopy={onCopySavedBuildVersionShare} onRemove={onRemoveSavedBuildVersionShare} onRevoke={onRevokeSavedBuildVersionShare} onToast={onToastSavedBuildVersionShare} /></Suspense>}
        <HomeCatalogCachePanel onToast={onToast} />

      </div>
    </details>
  </div>;
}
