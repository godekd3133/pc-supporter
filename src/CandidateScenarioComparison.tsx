import { FiActivity, FiCheckCircle, FiClock, FiInfo, FiLoader, FiRefreshCw, FiSave, FiXCircle, FiZap } from "react-icons/fi";
import type { AlternativeRisk, BuildSelection, CompatibilityResult, Part, PartCategory } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import type { BuildScenarioComparison } from "../shared/build-scenario";

export type CandidateScenarioCompareItem = {
  id: string;
  category: PartCategory;
  part: Part;
  risk?: AlternativeRisk;
  quantity?: number;
  affectedPartIds?: string[];
  nextBuild: BuildSelection;
  status: "loading" | "ready" | "error";
  result?: CompatibilityResult;
  comparison?: BuildScenarioComparison;
  error?: string;
};

export type CandidateScenarioInput = {
  category: PartCategory;
  part: Part;
  risk?: AlternativeRisk;
  quantity?: number;
  affectedPartIds?: string[];
};

export type CandidateScenarioCompareState = {
  category: PartCategory;
  items: CandidateScenarioCompareItem[];
};

function statusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function riskLabel(risk: AlternativeRisk | undefined) {
  return risk === "safe" ? "후보 안전" : risk === "review" ? "후보 확인 필요" : risk === "unsafe" ? "후보 차단" : "후보 평가 완료";
}

function directionLabel(direction: BuildScenarioComparison["direction"] | undefined) {
  return direction === "improved" ? "위험 감소" : direction === "worsened" ? "위험 증가" : direction === "changed" ? "일부 변화" : "변화 없음";
}

export function CandidateScenarioComparisonPanel({ state, currentResult, onApply, onSave, onRetry, onClose, formatWon }: { state: CandidateScenarioCompareState; currentResult: CompatibilityResult; onApply: (item: CandidateScenarioCompareItem) => void; onSave?: (item: CandidateScenarioCompareItem) => void; onRetry: (itemId: string) => void; onClose: () => void; formatWon: (value: number | undefined) => string }) {
  const readyCount = state.items.filter((item) => item.status === "ready").length;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="candidate-scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-scenario-title">
      <div className="modal-header"><div><p className="eyebrow">MULTI CANDIDATE WHAT-IF</p><h2 id="candidate-scenario-title">선택 후보 전체 가상 비교</h2><p>현재 견적은 바꾸지 않고 선택한 {state.items.length}개 후보를 각각 전체 규칙 엔진에 대입합니다.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="후보 가상 비교 닫기"><FiXCircle /></button></div>
      <div className="candidate-scenario-baseline"><span><FiActivity /> 현재 기준</span><strong>{statusLabel(currentResult.status)}</strong><small>차단 {currentResult.blockerCount}개 · 주의 {currentResult.warningCount}개 · 확인 필요 {currentResult.unknownCount}개 · {currentResult.priceComplete ? formatWon(currentResult.totalPriceWon) : "가격 확인 필요"}</small></div>
      <div className="candidate-scenario-list">
        {state.items.map((item) => {
          const result = item.result;
          const issues = result?.findings.filter((finding) => finding.severity !== "info").slice(0, 3) ?? [];
          const blocked = item.risk === "unsafe" || (!item.risk && result?.blockerCount !== 0);
          return <article className={`candidate-scenario-card ${item.status} ${item.comparison?.direction ?? ""}`} key={item.id}>
            <div className="candidate-scenario-card-heading"><div><span className="category-badge">{CATEGORY_LABELS[item.category]}</span><strong>{item.part.name}</strong><small>{riskLabel(item.risk)}{item.quantity && item.quantity > 1 ? ` · 수량 ${item.quantity}개` : ""}</small></div>{item.status === "loading" ? <span className="candidate-scenario-status loading"><FiLoader className="spin" /> 검사 중</span> : item.status === "error" ? <span className="candidate-scenario-status error"><FiXCircle /> 실패</span> : <span className={`candidate-scenario-status ${item.comparison?.direction ?? "unchanged"}`}>{item.comparison ? directionLabel(item.comparison.direction) : "검사 완료"}</span>}</div>
            {item.status === "loading" && <div className="candidate-scenario-loading"><FiClock className="spin" /> 후보를 전체 구성에 대입해 호환성·가격·잔여 finding을 계산하는 중입니다.</div>}
            {item.status === "error" && <div className="candidate-scenario-error"><FiXCircle /><span>{item.error ?? "가상 비교에 실패했습니다."}</span><button className="text-button" type="button" onClick={() => onRetry(item.id)}><FiRefreshCw /> 다시 검사</button></div>}
            {item.status === "ready" && result && <><div className="candidate-scenario-result"><div><span>전체 판정</span><strong>{statusLabel(result.status)}</strong></div><div><span>차단</span><strong>{result.blockerCount}개</strong></div><div><span>주의</span><strong>{result.warningCount}개</strong></div><div><span>확인 필요</span><strong>{result.unknownCount}개</strong></div><div><span>적용 후 합계</span><strong>{result.priceComplete ? formatWon(result.totalPriceWon) : "확인 필요"}</strong></div></div><p className="candidate-scenario-delta"><FiActivity /> {item.comparison?.summary ?? "현재 구성과 비교할 변화가 없습니다."}</p>{issues.length > 0 && <div className="candidate-scenario-findings"><strong>적용 후 남는 finding</strong><ul>{issues.map((finding) => <li key={finding.id}><b>{finding.severity === "blocker" ? "차단" : finding.severity === "warning" ? "주의" : "확인"}</b>{finding.title}</li>)}</ul></div>}{issues.length === 0 && <p className="candidate-scenario-clean"><FiCheckCircle /> 차단·주의·확인 필요 finding이 없습니다.</p>}<div className="candidate-scenario-actions"><button className="button button-small button-fix" type="button" disabled={blocked} onClick={() => onApply(item)}>{blocked ? <><FiXCircle /> 적용 불가</> : <><FiZap /> 이 후보 적용 전 미리보기</>}</button>{onSave && <button className="button button-small button-light" type="button" disabled={blocked} onClick={() => onSave(item)}><FiSave /> 새 견적으로 저장</button>}</div></>}
          </article>;
        })}
      </div>
      <p className="candidate-scenario-note"><FiInfo /> 가상 비교는 현재 견적을 바꾸지 않습니다. 실제 적용은 후보별 전체 판정 후 변경 예정·가격을 다시 확인하는 미리보기를 거칩니다. {readyCount} / {state.items.length}개 후보 검사 완료</p>
      <div className="candidate-scenario-footer"><button className="button button-light" type="button" onClick={onClose}>비교 닫기</button></div>
    </section>
  </div>;
}
