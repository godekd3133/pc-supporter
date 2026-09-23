import type { IconType } from "react-icons";
import { FiCheckCircle, FiChevronDown, FiSearch, FiShield, FiShoppingCart, FiZap } from "react-icons/fi";
import type { CompatibilityResult } from "../shared/types";

export function ResultQuickNav({ result, onFocusSection }: { result: CompatibilityResult; onFocusSection: (targetId: string) => void }) {
  const actionCount = result.blockerCount + result.warningCount + result.unknownCount;
  const items: Array<{ targetId: string; label: string; detail: string; Icon: IconType }> = [
    { targetId: "purchase-decision-gate", label: "최종 구매 판단", detail: result.blockerCount > 0 ? `차단 ${result.blockerCount}개` : result.warningCount + result.unknownCount > 0 ? "추가 확인 필요" : "진행 가능", Icon: FiShield },
    { targetId: "build-action-center", label: "먼저 할 일", detail: actionCount > 0 ? `${actionCount}개 확인 항목` : "최종 확인", Icon: FiZap },
    { targetId: "result-findings", label: "상세 결과", detail: `${result.findings.length}개 항목`, Icon: FiSearch },
    { targetId: "purchase-checklist", label: "구매 전 체크", detail: "할 일 관리", Icon: FiCheckCircle },
    { targetId: "purchase-list-panel", label: "구매 목록", detail: "가격·구매 상태", Icon: FiShoppingCart }
  ];
  return <details className="result-quick-nav-disclosure">
    <summary><span><FiZap /> 결과에서 바로 이동</span><FiChevronDown /></summary>
    <nav className="result-quick-nav" aria-label="검사 결과 바로가기" data-testid="result-quick-nav">
      <div className="result-quick-nav-intro"><strong>필요한 항목으로 바로 이동</strong><span>긴 결과도 먼저 할 일·상세 결과·구매 준비를 한 번에 확인하세요.</span></div>
      <div className="result-quick-nav-links">{items.map(({ targetId, label, detail, Icon }) => <button className="result-quick-nav-link" type="button" data-testid={`result-quick-nav-${targetId}`} onClick={() => onFocusSection(targetId)} key={targetId}><span className="result-quick-nav-icon"><Icon /></span><span><strong>{label}</strong><small>{detail}</small></span><FiChevronDown className="result-quick-nav-chevron" /></button>)}</div>
    </nav>
  </details>;
}
