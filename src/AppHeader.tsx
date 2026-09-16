import { useEffect, useRef, useState } from "react";
import { FiActivity, FiBookmark, FiCpu, FiLayers, FiLoader, FiMenu, FiMoon, FiMoreHorizontal, FiSearch, FiSun, FiTool, FiTrendingUp, FiX, FiZap } from "react-icons/fi";
import { api } from "./api";
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
  catalogRefreshProgress: CatalogRefreshProgress | null;
  onHome: () => void;
  onBuild: () => void;
  onGenerate: () => void;
  onCatalog: () => void;
  onAccessories: () => void;
  onPriceWatchlist: () => void;
  onHistory: () => void;
};

export function AppHeader({ view, networkOnline, apiStatus, bootstrapLoading, bootstrapErrorCount, savedBuildUnreadAlertCount, catalogRefreshProgress, onHome, onBuild, onGenerate, onCatalog, onAccessories, onPriceWatchlist, onHistory }: HeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      return themeModeFromStorage(window.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      return "light";
    }
  });
  const [connectionCheckRunning, setConnectionCheckRunning] = useState(false);
  const [connectionCheckLines, setConnectionCheckLines] = useState<string[]>([]);
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

  async function runConnectionCheck() {
    if (connectionCheckRunning) return;
    setConnectionCheckRunning(true);
    setConnectionCheckLines([]);
    const lines: string[] = [];
    const push = (line: string) => { lines.push(line); setConnectionCheckLines([...lines]); };
    try {
      const startedAt = performance.now();
      const health = await api<{ ok?: boolean; engineVersion?: string }>("/api/health", { retry: 0, timeoutMs: 10_000 });
      push(`서버 상태 확인 완료 · 엔진 ${health.engineVersion ?? "버전 미상"} · ${Math.round(performance.now() - startedAt)}ms`);
    } catch (error) {
      push(`서버 상태 확인 실패 · ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const parts = await api<{ total?: number }>("/api/parts?category=cpu&limit=1", { retry: 0, timeoutMs: 10_000 });
      push(`부품 목록 확인 완료 · CPU ${parts.total ?? "?"}개`);
    } catch (error) {
      push(`부품 목록 확인 실패 · ${error instanceof Error ? error.message : String(error)}`);
    }
    setConnectionCheckRunning(false);
  }
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

  const statusLabel = !networkOnline ? "오프라인 · 저장된 기능만" : apiStatus.status === "offline" ? "서버 연결 확인 필요" : apiStatus.status === "degraded" ? "응답이 느려요" : bootstrapErrorCount > 0 ? "일부 정보 확인 필요" : bootstrapLoading ? "불러오는 중" : "정상 작동 중";
  const statusClass = !networkOnline || apiStatus.status === "offline" || apiStatus.status === "degraded" || bootstrapErrorCount > 0 ? "degraded" : bootstrapLoading ? "loading" : "";
  const showStatus = Boolean(statusClass || bootstrapLoading);
  const statusTitle = apiStatus.fallbackAt ? `마지막 확인 데이터 사용 · ${new Date(apiStatus.fallbackAt).toLocaleString("ko-KR")}` : apiStatus.lastSuccessAt ? `API 마지막 성공 ${new Date(apiStatus.lastSuccessAt).toLocaleString("ko-KR")}` : undefined;
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
          <button className={view === "editor" || view === "result" ? "nav-link active" : "nav-link"} onClick={onBuild}>견적 검사</button>
          <button className={view === "generator" ? "nav-link active" : "nav-link"} onClick={onGenerate}>자동 구성</button>
          <button className={view === "catalog" ? "nav-link active" : "nav-link"} onClick={onCatalog}>부품 카탈로그</button>
          <button className={view === "accessories" ? "nav-link active" : "nav-link"} onClick={onAccessories}>주변 부품</button>
          <button className={view === "pricewatchlist" ? "nav-link active" : "nav-link"} onClick={onPriceWatchlist}>가격 추적</button>
          <button className={view === "history" ? "nav-link nav-link-with-badge active" : "nav-link nav-link-with-badge"} onClick={onHistory} aria-label={savedBuildUnreadAlertCount > 0 ? `저장 견적, 미읽음 알림 ${savedBuildUnreadAlertCount}건` : "저장 견적"}><span>저장 견적</span>{savedBuildUnreadAlertCount > 0 && <span className="nav-alert-badge" aria-hidden="true">{savedBuildUnreadAlertCount > 99 ? "99+" : savedBuildUnreadAlertCount}</span>}</button>
        </nav>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`${nextThemeModeLabel}로 전환`} title={`${nextThemeModeLabel}로 전환`}><ThemeIcon aria-hidden="true" /><span>{nextThemeModeLabel}</span></button>
        {showStatus && <div className={`topbar-status ${statusClass}`} title={statusTitle}><span className={`status-dot ${statusClass}`} /> {statusLabel}{apiStatus.fallbackAt && <small>마지막 확인 {new Date(apiStatus.fallbackAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</small>}</div>}
      </div>
      {catalogRefreshProgress && <div className="topbar-refresh-progress" data-testid="catalog-refresh-progress" role="status" aria-live="polite">
        <div className="topbar-refresh-progress-heading">
          <div>
            <span className="topbar-refresh-progress-kicker">CATALOG REFRESH</span>
            <strong>부품 정보 새로 확인 중</strong>
          </div>
          <span className="topbar-refresh-progress-count">{refreshCompleted} / {refreshTotal}</span>
        </div>
        <div className="topbar-refresh-progress-track" role="progressbar" aria-label="카탈로그 정보 확인 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={refreshPercent}><span style={{ width: `${refreshPercent}%` }} /></div>
        <small>{catalogRefreshProgress.currentName ? `${catalogRefreshProgress.currentName} 확인 중` : "확인 대상 준비 중"} · 성공 {catalogRefreshProgress.successCount}개 · 실패 {catalogRefreshProgress.failureCount}개</small>
      </div>}
      <nav className="mobile-bottom-nav" aria-label="모바일 주 메뉴">
        <button className={`mobile-bottom-nav-item ${view === "home" || view === "editor" || view === "result" ? "active" : ""}`} type="button" aria-current={view === "home" || view === "editor" || view === "result" ? "page" : undefined} onClick={onBuild}>
          <FiSearch aria-hidden="true" /><span>검사</span>
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
          <div className="mobile-more-sheet-heading"><div><p className="mobile-kicker">MORE TOOLS</p><h2 id="mobile-more-title">더 필요한 도구</h2></div><button className="mobile-more-close" type="button" onClick={() => setMoreOpen(false)} aria-label="더보기 메뉴 닫기"><FiX /></button></div>
          <div className="mobile-more-grid">
            <button type="button" onClick={() => { setMoreOpen(false); onGenerate(); }}><span><FiZap /></span><strong>자동 구성</strong></button>
            <button type="button" onClick={() => { setMoreOpen(false); onAccessories(); }}><span><FiTool /></span><strong>주변 부품</strong></button>
            <button type="button" onClick={() => { setMoreOpen(false); onPriceWatchlist(); }}><span><FiTrendingUp /></span><strong>가격 추적</strong></button>
            <button type="button" onClick={() => void runConnectionCheck()} disabled={connectionCheckRunning}><span>{connectionCheckRunning ? <FiLoader className="spin" /> : <FiActivity />}</span><strong>서버 연결 확인</strong></button>
          </div>
          {connectionCheckLines.length > 0 && <div className="mobile-more-connection-check" role="status" aria-label="서버 연결 확인 결과">{connectionCheckLines.map((line) => <p key={line}>{line}</p>)}</div>}
        </section>
      </div>}
    </header>
  );
}
