import { FiActivity, FiAlertTriangle, FiCheckCircle, FiInfo, FiLoader, FiXCircle, FiZap } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult, UpgradeBundleRecommendation } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { buildScenarioComparisonFor } from "../shared/build-scenario";
import { savedBuildComparisonExpansionFor } from "../shared/saved-build-comparison";

export type UpgradeBundleScenarioPreviewState = {
  status: "loading" | "ready" | "error";
  bundle: UpgradeBundleRecommendation;
  nextBuild: BuildSelection;
  result?: CompatibilityResult;
  error?: string;
};

function statusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function riskText(result: CompatibilityResult) {
  return `차단 ${result.blockerCount}개 · 주의 ${result.warningCount}개 · 확인 필요 ${result.unknownCount}개`;
}

function directionLabel(direction: ReturnType<typeof buildScenarioComparisonFor>["direction"]) {
  return direction === "improved" ? "위험 감소" : direction === "worsened" ? "위험 증가" : direction === "changed" ? "일부 변화" : "변화 없음";
}

function expansionScenarioText(currentResult: CompatibilityResult, nextResult: CompatibilityResult) {
  const current = savedBuildComparisonExpansionFor(currentResult.metrics);
  const next = savedBuildComparisonExpansionFor(nextResult.metrics);
  if (current.score === undefined || next.score === undefined) return { tone: "unknown", headline: "확장성 계산 불가", detail: `현재 ${current.knownDimensionCount}/${current.totalDimensionCount} · 조합 ${next.knownDimensionCount}/${next.totalDimensionCount}개 지표` };
  const delta = next.score - current.score;
  return { tone: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral", headline: `확장성 ${current.score}점 → ${next.score}점 · ${delta >= 0 ? "+" : ""}${delta}점`, detail: `현재 ${current.knownDimensionCount}/${current.totalDimensionCount} · 조합 ${next.knownDimensionCount}/${next.totalDimensionCount}개 지표` };
}

export function UpgradeBundleScenarioPreviewPanel({ state, currentResult, onApply, onRetry, onClose, formatWon }: { state: UpgradeBundleScenarioPreviewState; currentResult: CompatibilityResult; onApply: () => void; onRetry: () => void; onClose: () => void; formatWon: (value: number | undefined) => string }) {
  if (state.status === "loading") {
    return <section className="upgrade-bundle-scenario-preview loading" aria-label="업그레이드 조합 가상 검증" data-testid="upgrade-bundle-scenario-preview" role="status"><div className="upgrade-bundle-scenario-heading"><div><p className="eyebrow">BUNDLE WHAT-IF CHECK</p><h2>업그레이드 조합 검증 중...</h2><p>현재 견적을 바꾸지 않고 {state.bundle.changes.length}개 부품 조합을 전체 규칙 엔진에 대입합니다.</p></div><FiLoader className="spin" /></div><div className="upgrade-bundle-scenario-loading"><FiActivity /> 조합 전체의 호환성·가격·잔여 finding을 계산하는 중입니다.</div></section>;
  }
  if (state.status === "error" || !state.result) {
    return <section className="upgrade-bundle-scenario-preview error" aria-label="업그레이드 조합 가상 검증" data-testid="upgrade-bundle-scenario-preview" role="alert"><div className="upgrade-bundle-scenario-heading"><div><p className="eyebrow">BUNDLE WHAT-IF CHECK</p><h2>업그레이드 조합 검증에 실패했습니다.</h2><p>{state.error ?? "업그레이드 조합을 전체 견적에 대입하지 못했습니다."}</p></div><FiXCircle /></div><div className="upgrade-bundle-scenario-actions"><button className="button button-light" type="button" onClick={onRetry}><FiActivity /> 다시 검증</button><button className="button button-light" type="button" onClick={onClose}>닫기</button></div></section>;
  }

  const nextResult = state.result;
  const comparison = buildScenarioComparisonFor(currentResult, nextResult);
  const expansionScenario = expansionScenarioText(currentResult, nextResult);
  const nextFindings = nextResult.findings.filter((finding) => finding.severity !== "info").slice(0, 5);
  const unsafe = comparison.direction === "worsened";
  const outcomeNote = comparison.direction === "improved"
    ? comparison.unknownDelta > 0
      ? `전체 위험은 줄었지만 확인 필요 항목이 ${comparison.unknownDelta}개 늘었습니다. 해당 원문을 확인해 주세요.`
      : comparison.warningDelta > 0
        ? `차단 위험은 줄었지만 주의 항목이 ${comparison.warningDelta}개 늘었습니다. 성능·안정성 조건을 확인해 주세요.`
        : "조합 전체를 대입한 결과 현재 구성보다 위험이 줄었습니다."
    : comparison.direction === "worsened"
      ? "조합 전체를 대입한 결과 위험이 늘어 실제 적용하지 않는 편이 안전합니다."
      : comparison.direction === "changed"
        ? "판정 또는 가격이 바뀌었지만 위험 수준은 같으므로 변경 근거를 확인해 주세요."
        : "현재 구성과 위험·가격 결과가 같아 조합 교체 이점이 확인되지 않습니다.";

  return <section className={`upgrade-bundle-scenario-preview ${comparison.direction}`} aria-label="업그레이드 조합 가상 검증" data-testid="upgrade-bundle-scenario-preview">
    <div className="upgrade-bundle-scenario-heading"><div><p className="eyebrow">BUNDLE WHAT-IF CHECK</p><h2>업그레이드 조합 가상 검증</h2><p>현재 견적은 바꾸지 않고 {state.bundle.changes.length}개 부품 조합을 전체 규칙 엔진에 대입한 결과입니다.</p></div><div className="upgrade-bundle-scenario-heading-actions"><span className={`upgrade-bundle-scenario-direction ${comparison.direction}`}>{directionLabel(comparison.direction)}</span><button className="icon-button" type="button" onClick={onClose} aria-label="업그레이드 조합 가상 검증 닫기"><FiXCircle /></button></div></div>
    <div className="upgrade-bundle-scenario-changes">{state.bundle.changes.map((change) => <div className="upgrade-bundle-scenario-change" key={`${change.category}-${change.part.id}`}><span className="category-badge">{CATEGORY_LABELS[change.category]}</span><div><small>{change.currentPartName}</small><strong>→ {change.part.name}</strong><em>{change.improvedDimensions.join(" · ")} · {change.quantity > 1 ? `수량 ${change.quantity}개 · ` : ""}{change.priceDeltaWon !== undefined ? `${change.priceDeltaWon > 0 ? "+" : ""}${change.priceDeltaWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}</em></div></div>)}</div>
    <div className="upgrade-bundle-scenario-comparison"><div><span>현재 구성</span><strong>{statusLabel(comparison.currentStatus)}</strong><small>{riskText(currentResult)}</small>{currentResult.priceComplete ? <small>총액 {formatWon(currentResult.totalPriceWon)}</small> : <small>총액 가격 확인 필요</small>}</div><b>→</b><div className="next"><span>조합 적용 후</span><strong>{statusLabel(comparison.nextStatus)}</strong><small>{riskText(nextResult)}</small>{nextResult.priceComplete ? <small>총액 {formatWon(nextResult.totalPriceWon)}</small> : <small>총액 가격 확인 필요</small>}</div></div>
    <div className={`upgrade-bundle-scenario-expansion ${expansionScenario.tone}`}><span>확장성 여유 변화</span><strong>{expansionScenario.headline}</strong><small>{expansionScenario.detail}</small></div>
    <div className="upgrade-bundle-scenario-summary"><strong>{comparison.summary}</strong><span>{outcomeNote}</span></div>
    <div className="upgrade-bundle-scenario-findings"><div><strong>조합 적용 후 남는 finding</strong><span>{nextFindings.length > 0 ? `${nextResult.findings.filter((finding) => finding.severity !== "info").length}개 중 최대 5개 표시` : "차단·주의·확인 필요 없음"}</span></div>{nextFindings.length > 0 && <ul>{nextFindings.map((finding) => <li key={finding.id}><b>{finding.severity === "blocker" ? "차단" : finding.severity === "warning" ? "주의" : "확인"}</b>{finding.title}</li>)}</ul>}</div>
    <div className="upgrade-bundle-scenario-actions"><button className="button button-light" type="button" onClick={onClose}>계속 비교</button><button className="button button-primary" type="button" onClick={onApply} disabled={unsafe}><FiZap /> {unsafe ? "적용 불가" : "이 조합 적용 전 미리보기"}</button></div>
    <p className="upgrade-bundle-scenario-note"><FiInfo /> 조합 전체 가상 검증은 현재 선택·저장 견적·검사 결과를 바꾸지 않습니다. 실제 적용은 변경 예정·가격을 확인하는 미리보기를 거친 뒤 다시 검사합니다.{unsafe ? " 위험이 늘어난 조합은 적용을 막았습니다." : ""}</p>
  </section>;
}
