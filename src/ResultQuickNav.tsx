import type { IconType } from "react-icons";
import { FiCheckCircle, FiChevronDown, FiSearch, FiShoppingCart, FiZap } from "react-icons/fi";
import type { CompatibilityResult } from "../shared/types";

export function ResultQuickNav({ result, onFocusSection }: { result: CompatibilityResult; onFocusSection: (targetId: string) => void }) {
  const items: Array<{ targetId: string; label: string; detail: string; Icon: IconType }> = [
    { targetId: "result-findings", label: "호환 상세", detail: `${result.findings.length}개 항목`, Icon: FiSearch },
    { targetId: "purchase-checklist", label: "구매 항목", detail: "준비 상태", Icon: FiCheckCircle },
    { targetId: "purchase-list-panel", label: "부품·가격 목록", detail: "수량·예상 금액", Icon: FiShoppingCart }
  ];
  return <details className="result-quick-nav-disclosure">
    <summary><span><FiZap /> 결과에서 바로 이동</span><FiChevronDown /></summary>
    <nav className="result-quick-nav" aria-label="검사 결과 바로가기" data-testid="result-quick-nav">
      <div className="result-quick-nav-intro"><strong>필요한 항목으로 바로 이동</strong><span>필요한 정보를 선택하세요.</span></div>
      <div className="result-quick-nav-links">{items.map(({ targetId, label, detail, Icon }) => <button className="result-quick-nav-link" type="button" data-testid={`result-quick-nav-${targetId}`} onClick={() => onFocusSection(targetId)} key={targetId}><span className="result-quick-nav-icon"><Icon /></span><span><strong>{label}</strong><small>{detail}</small></span><FiChevronDown className="result-quick-nav-chevron" /></button>)}</div>
    </nav>
  </details>;
}
