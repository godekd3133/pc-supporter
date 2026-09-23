import { FiActivity, FiAlertTriangle, FiInfo, FiLoader, FiXCircle } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult } from "../shared/types";
import type { BuildPriceSnapshot } from "../shared/build-price-summary";
import type { BuildTransferDiffRow } from "../shared/build-transfer-diff";
import type { CandidateApplicationReview } from "../shared/candidate-application";
import { useModalAccessibility } from "./use-modal-accessibility";

export type PendingBuildChange = {
  title: string;
  summary: string;
  nextBuild: BuildSelection;
  rows: BuildTransferDiffRow[];
  beforePrice: BuildPriceSnapshot;
  afterPrice: BuildPriceSnapshot;
  budgetWon?: number;
  candidateReview?: CandidateApplicationReview;
  beforeResult?: CompatibilityResult;
};

function buildChangeSectionPriceText(value: number, complete: boolean) {
  return complete ? `${value.toLocaleString("ko-KR")}원` : "가격 정보 없음";
}

function buildChangeBudgetText(snapshot: BuildPriceSnapshot, budgetWon?: number) {
  if (budgetWon === undefined) return "목표 예산 미설정";
  if (!snapshot.priceComplete) return `가격 정보 없음 · 미확인 ${snapshot.unknownPriceCount}개`;
  const delta = snapshot.totalPriceWon - budgetWon;
  return delta <= 0 ? `${Math.abs(delta).toLocaleString("ko-KR")}원 여유` : `${delta.toLocaleString("ko-KR")}원 초과`;
}

function buildChangeBudgetTone(snapshot: BuildPriceSnapshot, budgetWon?: number) {
  if (budgetWon === undefined || !snapshot.priceComplete) return "unknown";
  return snapshot.totalPriceWon > budgetWon ? "over" : "within";
}

function buildChangeRiskCountText(blockers?: number, warnings?: number, unknown?: number) {
  const counts = [
    blockers !== undefined ? `차단 ${blockers}개` : undefined,
    warnings !== undefined ? `주의 ${warnings}개` : undefined,
    unknown !== undefined ? `정보 부족 ${unknown}개` : undefined
  ].filter((value): value is string => Boolean(value));
  return counts.length > 0 ? counts.join(" · ") : "세부 위험 수치 정보 부족";
}

export function BuildChangeDecisionDialog({ change, checking, onClose, onConfirm, formatPriceDelta }: { change: PendingBuildChange; checking: boolean; onClose: () => void; onConfirm: () => void; formatPriceDelta: (value: number | undefined) => string }) {
  const modalRef = useModalAccessibility({ onClose, closeOnEscape: !checking });
  const before = change.beforePrice;
  const after = change.afterPrice;
  const totalDelta = before.priceComplete && after.priceComplete ? after.totalPriceWon - before.totalPriceWon : undefined;
  const candidateReview = change.candidateReview;
  const candidateBlocked = candidateReview?.status === "avoid";
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !checking) onClose(); }}><section ref={modalRef} tabIndex={-1} className="build-change-dialog" role="dialog" aria-modal="true" aria-labelledby="build-change-preview-title"><div className="modal-header"><div><p className="eyebrow">변경 미리보기</p><h2 id="build-change-preview-title">{change.title}</h2><p>현재 견적에 반영하기 전, 바뀌는 부품과 금액을 살펴봐요.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={checking} aria-label="변경 미리보기 닫기"><FiXCircle /></button></div><div className="build-change-summary"><strong>{change.summary}</strong><small>현재 부품 기준으로 호환 결과를 새로 계산해요.</small><small>구성·수량·추천 조건을 바꾸면 호환 결과와 체크리스트가 새로 만들어져요. 이전 구성의 체크 상태는 옮기지 않아요.</small></div>{candidateReview && <div className={`build-change-candidate-review ${candidateBlocked ? "avoid" : "review"}`} data-testid="build-change-candidate-review" role={candidateBlocked ? "alert" : "region"} aria-label={candidateBlocked ? "적용하지 않는 부품 정보" : "부품 적용 전 살펴보기"}><div className="build-change-candidate-review-heading"><FiAlertTriangle /><div><strong>{candidateBlocked ? "적용 불가 부품" : "적용 전 살펴보기"}</strong><span>{candidateReview.label}</span></div></div><p>{candidateReview.summary}</p><div className="build-change-candidate-review-facts"><div><span>바꿀 부품</span><strong>{buildChangeRiskCountText(candidateReview.candidateBlockerCount, candidateReview.candidateWarningCount, candidateReview.candidateUnknownCount)}</strong></div><div><span>바꾼 뒤 전체 견적</span><strong>{buildChangeRiskCountText(candidateReview.remainingBlockers, candidateReview.remainingWarnings, candidateReview.remainingUnknown)}</strong></div></div>{candidateReview.reasons.length > 0 && <div className="build-change-candidate-review-reasons"><span>확인할 내용</span><ul>{candidateReview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}</div>}<div className="build-change-price-panel"><div className="build-change-price-heading"><strong>구매 결정 요약</strong><span>{totalDelta === undefined ? "가격 정보 없음" : `변경 ${formatPriceDelta(totalDelta)}`}</span></div><div className="build-change-price-grid"><div><span>현재 핵심 부품</span><strong>{buildChangeSectionPriceText(before.coreTotalPriceWon, before.corePriceComplete)}</strong></div><div><span>적용 후 핵심 부품</span><strong>{buildChangeSectionPriceText(after.coreTotalPriceWon, after.corePriceComplete)}</strong></div><div><span>현재 주변 부품</span><strong>{buildChangeSectionPriceText(before.accessoryTotalPriceWon, before.accessoryPriceComplete)}</strong></div><div><span>적용 후 주변 부품</span><strong>{buildChangeSectionPriceText(after.accessoryTotalPriceWon, after.accessoryPriceComplete)}</strong></div><div><span>현재 전체 합계</span><strong>{buildChangeSectionPriceText(before.totalPriceWon, before.priceComplete)}</strong></div><div><span>적용 후 전체 합계</span><strong>{buildChangeSectionPriceText(after.totalPriceWon, after.priceComplete)}</strong></div></div><div className="build-change-budget-row"><span>적용 후 목표 예산</span><strong className={buildChangeBudgetTone(after, change.budgetWon)}>{buildChangeBudgetText(after, change.budgetWon)}</strong></div>{after.unknownPriceCount > 0 && <p className="build-change-price-warning"><FiAlertTriangle /> 가격을 확인하지 못한 항목 {after.unknownPriceCount}개가 있어 전체 금액을 계산할 수 없습니다.</p>}</div><div className="build-change-diff"><div className="build-change-diff-heading"><strong>변경 예정</strong><span>{change.rows.length}개 항목</span></div><div className="build-change-diff-list">{change.rows.map((row) => <div className="build-change-diff-row" key={row.id}><span>{row.label}</span><small><em>{row.before}</em><b>→</b><em>{row.after}</em></small></div>)}</div></div><p className="build-change-note"><FiInfo /> 적용 전에는 현재 견적이 그대로예요. 적용 후 결과를 계산하지 못하면 이전 견적을 유지하고 알려드릴게요.</p><div className="build-change-actions"><button className="button button-light" data-modal-autofocus type="button" onClick={onClose} disabled={checking}>취소</button><button className="button button-primary" type="button" onClick={onConfirm} disabled={checking || candidateBlocked}>{checking ? <><FiLoader className="spin" /> 호환 결과 계산 중...</> : candidateBlocked ? <><FiXCircle /> 적용 불가</> : candidateReview?.status === "review" ? <><FiActivity /> 적용 후 호환 확인</> : <><FiActivity /> 적용하고 호환 결과 보기</>}</button></div></section></div>;
}
