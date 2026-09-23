import { useEffect, useRef, useState } from "react";
import { FiBookmark, FiCpu, FiLayers, FiMenu, FiMoon, FiMoreHorizontal, FiSearch, FiSun, FiTool, FiTrendingUp, FiX, FiZap } from "react-icons/fi";
import type { ApiStatusDetails } from "./api";
import { applyTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY, themeModeFromStorage, type ThemeMode } from "./theme";

export type CatalogRefreshProgress = {
  requestedCount: number;
  completedCount: number;
  successCount: number;
  failureCount: number;
  currentName?: string | null;
};

type HeaderProps = {
  view: string;
  networkOnline: boolean;
  apiStatus: ApiStatusDetails;
  bootstrapLoading: boolean;
  bootstrapErrorCount: number;
  savedBuildUnreadAlertCount: number;
  watchlistUnreadAlertCount: number;
  catalogRefreshProgress: CatalogRefreshProgress | null;
  onHome: () => void;
  onBuild: () => void;
  onGenerate: () => void;
  onCatalog: () => void;
  onAccessories: () => void;
  onPriceWatchlist: () => void;
  onHistory: () => void;
};

export function AppHeader({ view, networkOnline, apiStatus, bootstrapLoading, bootstrapErrorCount, savedBuildUnreadAlertCount, watchlistUnreadAlertCount, catalogRefreshProgress, onHome, onBuild, onGenerate, onCatalog, onAccessories, onPriceWatchlist, onHistory }: HeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      return themeModeFromStorage(window.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      return "light";
    }
  });
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreSheetRef = useRef<HTMLElement | null>(null);
  useEffect(() => setMoreOpen(false), [view]);
  useEffect(() => {
    applyTheme(themeMode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // The theme still applies for this tab when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { mode: themeMode } }));
  }, [themeMode]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setThemeMode(themeModeFromStorage(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!moreOpen) return undefined;
    moreSheetRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMoreOpen(false);
      moreTriggerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  const statusLabel = !networkOnline ? "오프라인" : apiStatus.status === "offline" ? "서버 연결이 끊겼어요" : apiStatus.status === "degraded" ? "연결이 원활하지 않아요" : bootstrapErrorCount > 0 ? "일부 견적 정보를 불러오지 못했어요" : bootstrapLoading ? "불러오는 중" : "연결됨";
  const statusClass = !networkOnline || apiStatus.status === "offline" || apiStatus.status === "degraded" || bootstrapErrorCount > 0 ? "degraded" : bootstrapLoading ? "loading" : "";
  const showStatus = Boolean(statusClass || bootstrapLoading);
  const refreshTotal = Math.max(1, catalogRefreshProgress?.requestedCount ?? 1);
  const refreshCompleted = Math.min(refreshTotal, Math.max(0, catalogRefreshProgress?.completedCount ?? 0));
  const refreshPercent = Math.round((refreshCompleted / refreshTotal) * 100);
  const nextThemeModeLabel = themeMode === "dark" ? "라이트 모드" : "다크 모드";
  const ThemeIcon = themeMode === "dark" ? FiSun : FiMoon;
  const toggleTheme = () => setThemeMode((current) => current === "dark" ? "light" : "dark");
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="mobile-header-menu" type="button" onClick={() => setMoreOpen(true)} aria-label="더보기 메뉴 열기"><FiMenu /></button>
        <button className="brand" onClick={onHome} aria-label="PC Supporter 홈">
          <span className="brand-mark"><FiCpu /></span>
          <span>
            <strong>PC Supporter</strong>
          </span>
        </button>
        <nav className="topnav" aria-label="주 메뉴">
          <button className={view === "editor" || view === "result" ? "nav-link active" : "nav-link"} onClick={onBuild}>내 견적</button>
          <button className={view === "generator" ? "nav-link active" : "nav-link"} onClick={onGenerate}>자동 구성</button>
          <button className={view === "catalog" ? "nav-link active" : "nav-link"} onClick={onCatalog}>부품 카탈로그</button>
          <button className={view === "accessories" ? "nav-link active" : "nav-link"} onClick={onAccessories}>주변 부품</button>
          <button className={view === "pricewatchlist" ? "nav-link nav-link-with-badge active" : "nav-link nav-link-with-badge"} onClick={onPriceWatchlist} aria-label={watchlistUnreadAlertCount > 0 ? `가격 추적, 미읽음 알림 ${watchlistUnreadAlertCount}건` : "가격 추적"}><span>가격 추적</span>{watchlistUnreadAlertCount > 0 && <span className="nav-alert-badge" aria-hidden="true">{watchlistUnreadAlertCount > 99 ? "99+" : watchlistUnreadAlertCount}</span>}</button>
          <button className={view === "history" ? "nav-link nav-link-with-badge active" : "nav-link nav-link-with-badge"} onClick={onHistory} aria-label={savedBuildUnreadAlertCount > 0 ? `저장 견적, 미읽음 알림 ${savedBuildUnreadAlertCount}건` : "저장 견적"}><span>저장 견적</span>{savedBuildUnreadAlertCount > 0 && <span className="nav-alert-badge" aria-hidden="true">{savedBuildUnreadAlertCount > 99 ? "99+" : savedBuildUnreadAlertCount}</span>}</button>
        </nav>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-pressed={themeMode === "dark"} aria-label={`${nextThemeModeLabel}로 전환`} title={`${nextThemeModeLabel}로 전환`}><ThemeIcon aria-hidden="true" /><span>{nextThemeModeLabel}</span></button>
        {showStatus && <div className={`topbar-status ${statusClass}`} role="status"><span className={`status-dot ${statusClass}`} /> {statusLabel}</div>}
      </div>
      {catalogRefreshProgress && <div className="topbar-refresh-progress" data-testid="catalog-refresh-progress" role="status" aria-live="polite">
        <div className="topbar-refresh-progress-heading">
          <div>
            <span className="topbar-refresh-progress-kicker">부품 정보</span>
            <strong>부품 정보 업데이트 중</strong>
          </div>
          <span className="topbar-refresh-progress-count">{refreshCompleted} / {refreshTotal}</span>
        </div>
        <div className="topbar-refresh-progress-track" role="progressbar" aria-label="부품 정보 업데이트 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={refreshPercent}><span style={{ width: `${refreshPercent}%` }} /></div>
        <small>{catalogRefreshProgress.currentName ? `${catalogRefreshProgress.currentName} 업데이트 중` : "업데이트 준비 중"} · {refreshCompleted} / {refreshTotal}개</small>
      </div>}
      <nav className="mobile-bottom-nav" aria-label="모바일 주 메뉴">
        <button className={`mobile-bottom-nav-item ${view === "home" || view === "editor" || view === "result" ? "active" : ""}`} type="button" aria-current={view === "home" || view === "editor" || view === "result" ? "page" : undefined} onClick={onBuild}>
          <FiSearch aria-hidden="true" /><span>견적</span>
        </button>
        <button className={`mobile-bottom-nav-item ${view === "catalog" || view === "accessories" ? "active" : ""}`} type="button" aria-current={view === "catalog" || view === "accessories" ? "page" : undefined} onClick={onCatalog}>
          <FiLayers aria-hidden="true" /><span>카탈로그</span>
        </button>
        <button className={`mobile-bottom-nav-item ${view === "history" ? "active" : ""}`} type="button" aria-current={view === "history" ? "page" : undefined} onClick={onHistory} aria-label={savedBuildUnreadAlertCount > 0 ? `저장 견적, 미읽음 알림 ${savedBuildUnreadAlertCount}건` : "저장 견적"}>
          <span className="mobile-bottom-nav-icon"><FiBookmark aria-hidden="true" />{savedBuildUnreadAlertCount > 0 && <span className="mobile-bottom-nav-badge" aria-hidden="true">{savedBuildUnreadAlertCount > 99 ? "99+" : savedBuildUnreadAlertCount}</span>}</span><span>저장</span>
        </button>
        <button ref={moreTriggerRef} className={`mobile-bottom-nav-item ${moreOpen || ["generator", "pricewatchlist"].includes(view) ? "active" : ""}`} type="button" aria-expanded={moreOpen} aria-controls="mobile-more-sheet" aria-haspopup="dialog" onClick={() => setMoreOpen((open) => !open)}>
          {moreOpen ? <FiX aria-hidden="true" /> : <FiMoreHorizontal aria-hidden="true" />}<span>더보기</span>
        </button>
      </nav>
      {moreOpen && <div className="mobile-more-layer">
        <button className="mobile-more-scrim" type="button" aria-label="더보기 메뉴 닫기" onClick={() => setMoreOpen(false)} />
        <section ref={moreSheetRef} className="mobile-more-sheet" id="mobile-more-sheet" role="dialog" aria-modal="false" aria-labelledby="mobile-more-title" tabIndex={-1}>
          <div className="mobile-more-sheet-handle" aria-hidden="true" />
          <div className="mobile-more-sheet-heading"><div><h2 id="mobile-more-title">추가 기능</h2></div><button className="mobile-more-close" type="button" onClick={() => setMoreOpen(false)} aria-label="더보기 메뉴 닫기"><FiX /></button></div>
          <div className="mobile-more-grid">
            <button type="button" onClick={() => { setMoreOpen(false); onGenerate(); }}><span><FiZap /></span><strong>자동 구성</strong></button>
            <button type="button" onClick={() => { setMoreOpen(false); onAccessories(); }}><span><FiTool /></span><strong>주변 부품</strong></button>
            <button type="button" onClick={() => { setMoreOpen(false); onPriceWatchlist(); }}><span><FiTrendingUp /></span><strong>가격 추적</strong></button>
          </div>
        </section>
      </div>}
    </header>
  );
}
