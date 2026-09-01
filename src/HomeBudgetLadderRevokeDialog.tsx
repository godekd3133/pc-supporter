import { useEffect } from "react";
import { FiAlertTriangle, FiInfo, FiLoader, FiXCircle } from "react-icons/fi";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";

export function HomeBudgetLadderRevokeDialog({ entry, submitting, onClose, onConfirm }: { entry: BudgetLadderLocalShareEntry; submitting: boolean; onClose: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section className="home-budget-ladder-revoke-dialog" role="alertdialog" aria-modal="true" aria-labelledby="budget-ladder-revoke-title" aria-describedby="budget-ladder-revoke-description">
      <div className="modal-header"><div><p className="eyebrow">REVOKE SHARE</p><h2 id="budget-ladder-revoke-title">공유 snapshot을 취소할까요?</h2><p>서버에서 링크를 폐기하기 전에 대상을 확인하세요.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={submitting} aria-label="공유 취소 확인창 닫기"><FiXCircle /></button></div>
      <div className="home-budget-ladder-revoke-body">
        <div className="home-budget-ladder-revoke-warning"><FiAlertTriangle /><div><strong>이 작업은 공유받은 사람에게도 영향을 줍니다.</strong><p id="budget-ladder-revoke-description">취소 후에는 이 링크로 예산 비교 snapshot을 다시 열 수 없습니다. 현재 브라우저의 최근 공유 이력에서도 함께 제거됩니다.</p></div></div>
        <dl className="home-budget-ladder-revoke-details"><div><dt>공유 이름</dt><dd>{entry.name}</dd></div><div><dt>버전</dt><dd>v{entry.versionNumber ?? 1}</dd></div><div><dt>생성 시각</dt><dd>{new Date(entry.createdAt).toLocaleString("ko-KR")}</dd></div><div><dt>대상 링크</dt><dd><code>{new URL(entry.url).pathname}</code></dd></div></dl>
        <p className="home-budget-ladder-revoke-note"><FiInfo /> 단순히 홈 목록에서만 숨기려면 취소 대신 `이력에서 제거`를 선택하세요.</p>
      </div>
      <div className="home-budget-ladder-revoke-actions"><button className="button button-light" type="button" onClick={onClose} disabled={submitting} autoFocus>돌아가기</button><button className="button button-danger" type="button" onClick={onConfirm} disabled={submitting}>{submitting ? <><FiLoader className="spin" /> 공유 취소 중...</> : <><FiXCircle /> 서버에서 공유 취소</>}</button></div>
    </section>
  </div>;
}
