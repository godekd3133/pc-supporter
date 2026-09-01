import { FiCpu } from "react-icons/fi";

type HeaderProps = {
  view: string;
  bootstrapLoading: boolean;
  bootstrapErrorCount: number;
  savedBuildUnreadAlertCount: number;
  onHome: () => void;
  onBuild: () => void;
  onGenerate: () => void;
  onCatalog: () => void;
  onAccessories: () => void;
  onPriceWatchlist: () => void;
  onHistory: () => void;
  onAdmin: () => void;
};

export function AppHeader({ view, bootstrapLoading, bootstrapErrorCount, savedBuildUnreadAlertCount, onHome, onBuild, onGenerate, onCatalog, onAccessories, onPriceWatchlist, onHistory, onAdmin }: HeaderProps) {
  const statusLabel = bootstrapErrorCount > 0 ? "일부 정보 확인 필요" : bootstrapLoading ? "서비스 동기화 중" : "규칙 엔진 정상";
  const statusClass = bootstrapErrorCount > 0 ? "degraded" : bootstrapLoading ? "loading" : "";
  return (
    <header className="topbar">
      <div className="topbar-inner">
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
        <div className={`topbar-status ${statusClass}`}><span className={`status-dot ${statusClass}`} /> {statusLabel}</div>
      </div>
    </header>
  );
}
