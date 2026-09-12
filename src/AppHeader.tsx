import { useEffect, useState } from "react";
import { FiBookmark, FiCpu, FiDatabase, FiLayers, FiMenu, FiMoreHorizontal, FiSearch, FiTool, FiTrendingUp, FiX, FiZap } from "react-icons/fi";
import type { ApiStatusDetails } from "./api";

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
  onAdmin: () => void;
};

export function AppHeader({ view, networkOnline, apiStatus, bootstrapLoading, bootstrapErrorCount, savedBuildUnreadAlertCount, catalogRefreshProgress, onHome, onBuild, onGenerate, onCatalog, onAccessories, onPriceWatchlist, onHistory, onAdmin }: HeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [view]);

  const statusLabel = !networkOnline ? "오프라인 · 로컬 기능" : apiStatus.status === "offline" ? "API 서버 확인 필요" : apiStatus.status === "degraded" ? "API 응답 지연" : bootstrapErrorCount > 0 ? "일부 정보 확인 필요" : bootstrapLoading ? "서비스 동기화 중" : "규칙 엔진 정상";
  const statusClass = !networkOnline || apiStatus.status === "offline" || apiStatus.status === "degraded" || bootstrapErrorCount > 0 ? "degraded" : bootstrapLoading ? "loading" : "";
  const statusTitle = apiStatus.fallbackAt ? `마지막 확인 데이터 사용 · ${new Date(apiStatus.fallbackAt).toLocaleString("ko-KR")}` : apiStatus.lastSuccessAt ? `API 마지막 성공 ${new Date(apiStatus.lastSuccessAt).toLocaleString("ko-KR")}` : undefined;
  const refreshTotal = Math.max(1, catalogRefreshProgress?.requestedCount ?? 1);
  const refreshCompleted = Math.min(refreshTotal, Math.max(0, catalogRefreshProgress?.completedCount ?? 0));
  const refreshPercent = Math.round((refreshCompleted / refreshTotal) * 100);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="mobile-header-menu" type="button" onClick={() => setMoreOpen(true)} aria-label="더보기 메뉴 열기"><FiMenu /></button>
        <button className="brand" onClick={onHome} aria-label="PC Supporter 홈">
          <span className="brand-mark"><FiCpu /></span>
          <span>
            <strong>PC Supporter</strong>
            <small>견적 호환성 검사</small>
          </span>
        </button>
        <nav className="topnav" aria-label="주 메뉴">
          <button className={view === "editor" || view === "result" ? "nav-link active" : "nav-link"} onClick={onBuild}>견적 검사</button>
          <button className={view === "generator" ? "nav-link active" : "nav-link"} onClick={onGenerate}>자동 구성</button>
          <button className={view === "catalog" ? "nav-link active" : "nav-link"} onClick={onCatalog}>부품 카탈로그</button>
          <button className={view === "accessories" ? "nav-link active" : "nav-link"} onClick={onAccessories}>주변 부품</button>
          <button className={view === "pricewatchlist" ? "nav-link active" : "nav-link"} onClick={onPriceWatchlist}>가격 추적</button>
          <button className={view === "history" ? "nav-link nav-link-with-badge active" : "nav-link nav-link-with-badge"} onClick={onHistory} aria-label={savedBuildUnreadAlertCount > 0 ? `저장 견적, 미읽음 알림 ${savedBuildUnreadAlertCount}건` : "저장 견적"}><span>저장 견적</span>{savedBuildUnreadAlertCount > 0 && <span className="nav-alert-badge" aria-hidden="true">{savedBuildUnreadAlertCount > 99 ? "99+" : savedBuildUnreadAlertCount}</span>}</button>
          <button className={view === "admin" ? "nav-link active" : "nav-link"} onClick={onAdmin}>데이터 센터</button>
        </nav>
        <div className={`topbar-status ${statusClass}`} title={statusTitle}><span className={`status-dot ${statusClass}`} /> {statusLabel}{apiStatus.fallbackAt && <small>마지막 확인 {new Date(apiStatus.fallbackAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</small>}</div>
      </div>
      {catalogRefreshProgress && <div className="topbar-refresh-progress" data-testid="catalog-refresh-progress" role="status" aria-live="polite">
        <div className="topbar-refresh-progress-heading">
          <div>
            <span className="topbar-refresh-progress-kicker">CATALOG REFRESH</span>
            <strong>원문 데이터 확인 중</strong>
          </div>
          <span className="topbar-refresh-progress-count">{refreshCompleted} / {refreshTotal}</span>
        </div>
        <div className="topbar-refresh-progress-track" role="progressbar" aria-label="카탈로그 원문 확인 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={refreshPercent}><span style={{ width: `${refreshPercent}%` }} /></div>
        <small>{catalogRefreshProgress.currentName ? `${catalogRefreshProgress.currentName} 확인 중` : "확인 대상 준비 중"} · 성공 {catalogRefreshProgress.successCount}개 · 실패 {catalogRefreshProgress.failureCount}개</small>
      </div>}
      <nav className="mobile-bottom-nav" aria-label="모바일 주 메뉴">
        <button className={`mobile-bottom-nav-item ${view === "editor" || view === "result" ? "active" : ""}`} type="button" aria-current={view === "editor" || view === "result" ? "page" : undefined} onClick={onBuild}>
          <FiSearch aria-hidden="true" /><span>검사</span>
        </button>
        <button className={`mobile-bottom-nav-item ${view === "catalog" || view === "accessories" ? "active" : ""}`} type="button" aria-current={view === "catalog" || view === "accessories" ? "page" : undefined} onClick={onCatalog}>
          <FiLayers aria-hidden="true" /><span>카탈로그</span>
        </button>
        <button className={`mobile-bottom-nav-item ${view === "history" ? "active" : ""}`} type="button" aria-current={view === "history" ? "page" : undefined} onClick={onHistory} aria-label={savedBuildUnreadAlertCount > 0 ? `저장 견적, 미읽음 알림 ${savedBuildUnreadAlertCount}건` : "저장 견적"}>
          <span className="mobile-bottom-nav-icon"><FiBookmark aria-hidden="true" />{savedBuildUnreadAlertCount > 0 && <span className="mobile-bottom-nav-badge" aria-hidden="true">{savedBuildUnreadAlertCount > 99 ? "99+" : savedBuildUnreadAlertCount}</span>}</span><span>저장</span>
        </button>
        <button className={`mobile-bottom-nav-item ${moreOpen || ["generator", "pricewatchlist", "admin"].includes(view) ? "active" : ""}`} type="button" aria-expanded={moreOpen} aria-controls="mobile-more-sheet" onClick={() => setMoreOpen((open) => !open)}>
          {moreOpen ? <FiX aria-hidden="true" /> : <FiMoreHorizontal aria-hidden="true" />}<span>더보기</span>
        </button>
      </nav>
      {moreOpen && <div className="mobile-more-layer">
        <button className="mobile-more-scrim" type="button" aria-label="더보기 메뉴 닫기" onClick={() => setMoreOpen(false)} />
        <section className="mobile-more-sheet" id="mobile-more-sheet" role="dialog" aria-modal="false" aria-labelledby="mobile-more-title">
          <div className="mobile-more-sheet-handle" aria-hidden="true" />
          <div className="mobile-more-sheet-heading"><div><p className="mobile-kicker">MORE TOOLS</p><h2 id="mobile-more-title">더 필요한 도구</h2></div><button className="mobile-more-close" type="button" onClick={() => setMoreOpen(false)} aria-label="더보기 메뉴 닫기"><FiX /></button></div>
          <div className="mobile-more-grid">
            <button type="button" onClick={() => { setMoreOpen(false); onGenerate(); }}><span><FiZap /></span><strong>자동 구성</strong><small>예산에 맞는 조합 찾기</small></button>
            <button type="button" onClick={() => { setMoreOpen(false); onAccessories(); }}><span><FiTool /></span><strong>주변 부품</strong><small>쿨링·허브·RGB 더하기</small></button>
            <button type="button" onClick={() => { setMoreOpen(false); onPriceWatchlist(); }}><span><FiTrendingUp /></span><strong>가격 추적</strong><small>관심 부품 가격 보기</small></button>
            <button type="button" onClick={() => { setMoreOpen(false); onAdmin(); }}><span><FiDatabase /></span><strong>데이터 센터</strong><small>카탈로그 근거 확인</small></button>
          </div>
        </section>
      </div>}
    </header>
  );
}
