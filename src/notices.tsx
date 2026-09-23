// Shared inline notice components used by the shell and lazy views.
import type { BuildHistoryEntry } from "../shared/build-history";
import { RetryAfterButton } from "./RetryAfterButton";
import { FiClock, FiInfo, FiLoader, FiRefreshCw, FiXCircle } from "react-icons/fi";

export function RequestErrorNotice({ message, onRetry, retrying, hasLastResult }: { message: string; onRetry: () => void; retrying: boolean; hasLastResult: boolean }) {
  return <div className="request-error" role="alert">
    <div className="request-error-copy"><FiXCircle /><div><strong>잠시 문제가 생겼어요.</strong></div></div>
    <RetryAfterButton className="button button-small button-light" message={message} onRetry={onRetry} retrying={retrying} idleContent={<><FiRefreshCw /> 다시 시도</>} retryingContent={<><FiLoader className="spin" /> 재시도 중...</>} testId="request-retry-button" />
  </div>;
}

export function ChangeHistoryPanel({ entries, onRestore, restoring }: { entries: BuildHistoryEntry[]; onRestore: (entry: BuildHistoryEntry) => void; restoring: boolean }) {
  if (entries.length === 0) return null;
  return <section className="change-history-panel" aria-label="견적 변경 이력">
    <div className="change-history-heading"><div><p className="eyebrow">BUILD HISTORY</p><h2>변경 이력</h2><p>부품을 시험하거나 수량을 바꾼 뒤 이전 구성으로 되돌릴 수 있어요.</p></div><span className="change-history-icon"><FiClock /></span></div>
    <div className="change-history-list">{entries.slice(0, 6).map((entry, index) => <article className="change-history-item" key={entry.id}><div className="change-history-item-copy"><span>{index === 0 ? "최근 변경" : `${index + 1}단계 전`}</span><strong>{entry.label}</strong><small>{new Date(entry.changedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small></div><button className="button button-small button-light" type="button" onClick={() => onRestore(entry)} disabled={restoring}><FiRefreshCw /> {restoring ? "검사 중..." : "이전 구성 복원"}</button></article>)}</div>
    <p className="change-history-note"><FiInfo /> 복원하면 부품과 추천 기준을 되돌리고 현재 부품 정보로 다시 확인합니다.</p>
  </section>;
}
