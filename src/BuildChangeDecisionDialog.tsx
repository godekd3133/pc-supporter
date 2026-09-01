import { FiActivity, FiAlertTriangle, FiInfo, FiLoader, FiXCircle } from "react-icons/fi";
import type { BuildSelection } from "../shared/types";
import type { BuildPriceSnapshot } from "../shared/build-price-summary";
import type { BuildTransferDiffRow } from "../shared/build-transfer-diff";

export type PendingBuildChange = {
  title: string;
  summary: string;
  nextBuild: BuildSelection;
  rows: BuildTransferDiffRow[];
  beforePrice: BuildPriceSnapshot;
  afterPrice: BuildPriceSnapshot;
  budgetWon?: number;
};

function buildChangeSectionPriceText(value: number, complete: boolean) {
  return complete ? `${value.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function buildChangeBudgetText(snapshot: BuildPriceSnapshot, budgetWon?: number) {
  if (budgetWon === undefined) return "목표 예산 미설정";
  if (!snapshot.priceComplete) return `가격 확인 필요 · 미확인 ${snapshot.unknownPriceCount}개`;
  const delta = snapshot.totalPriceWon - budgetWon;
  return delta <= 0 ? `${Math.abs(delta).toLocaleString("ko-KR")}원 여유` : `${delta.toLocaleString("ko-KR")}원 초과`;
}

function buildChangeBudgetTone(snapshot: BuildPriceSnapshot, budgetWon?: number) {
  if (budgetWon === undefined || !snapshot.priceComplete) return "unknown";
  return snapshot.totalPriceWon > budgetWon ? "over" : "within";
}

export function BuildChangeDecisionDialog({ change, checking, onClose, onConfirm, formatPriceDelta }: { change: PendingBuildChange; checking: boolean; onClose: () => void; onConfirm: () => void; formatPriceDelta: (value: number | undefined) => string }) {
  const before = change.beforePrice;
  const after = change.afterPrice;
  const totalDelta = before.priceComplete && after.priceComplete ? after.totalPriceWon - before.totalPriceWon : undefined;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !checking) onClose(); }}><section className="build-change-dialog" role="dialog" aria-modal="true" aria-labelledby="build-change-preview-title"><div className="modal-header"><div><p className="eyebrow">CHANGE PREVIEW</p><h2 id="build-change-preview-title">{change.title}</h2><p>현재 견적에 바로 반영하기 전에 변경 내용과 구매 금액을 확인합니다.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={checking} aria-label="변경 미리보기 닫기"><FiXCircle /></button></div><div className="build-change-summary"><strong>{change.summary}</strong><small>확인 후 현재 카탈로그 기준으로 전체 호환성 검사를 다시 실행합니다.</small><small>구성·수량·추천 기준이 바뀌면 새 검사 결과와 새 체크리스트로 분리되며, 기존 체크 완료 상태는 새 구성에 자동 재사용하지 않습니다.</small></div><div className="build-change-price-panel"><div className="build-change-price-heading"><strong>구매 결정 요약</strong><span>{totalDelta === undefined ? "가격 확인 필요" : `변경 ${formatPriceDelta(totalDelta)}`}</span></div><div className="build-change-price-grid"><div><span>현재 핵심 부품</span><strong>{buildChangeSectionPriceText(before.coreTotalPriceWon, before.corePriceComplete)}</strong></div><div><span>적용 후 핵심 부품</span><strong>{buildChangeSectionPriceText(after.coreTotalPriceWon, after.corePriceComplete)}</strong></div><div><span>현재 주변 부품</span><strong>{buildChangeSectionPriceText(before.accessoryTotalPriceWon, before.accessoryPriceComplete)}</strong></div><div><span>적용 후 주변 부품</span><strong>{buildChangeSectionPriceText(after.accessoryTotalPriceWon, after.accessoryPriceComplete)}</strong></div><div><span>현재 전체 합계</span><strong>{buildChangeSectionPriceText(before.totalPriceWon, before.priceComplete)}</strong></div><div><span>적용 후 전체 합계</span><strong>{buildChangeSectionPriceText(after.totalPriceWon, after.priceComplete)}</strong></div></div><div className="build-change-budget-row"><span>적용 후 목표 예산</span><strong className={buildChangeBudgetTone(after, change.budgetWon)}>{buildChangeBudgetText(after, change.budgetWon)}</strong></div>{after.unknownPriceCount > 0 && <p className="build-change-price-warning"><FiAlertTriangle /> 적용 후 가격을 확인하지 못한 항목 {after.unknownPriceCount}개가 있어 전체 합계는 확정되지 않습니다.</p>}</div><div className="build-change-diff"><div className="build-change-diff-heading"><strong>변경 예정</strong><span>{change.rows.length}개 항목</span></div><div className="build-change-diff-list">{change.rows.map((row) => <div className="build-change-diff-row" key={row.id}><span>{row.label}</span><small><em>{row.before}</em><b>→</b><em>{row.after}</em></small></div>)}</div></div><p className="build-change-note"><FiInfo /> 적용 전에는 현재 구성과 검사 결과를 바꾸지 않습니다. 적용 후 API 재검사가 실패하면 현재 선택 상태는 유지하고 오류를 표시합니다.</p><div className="build-change-actions"><button className="button button-light" type="button" onClick={onClose} disabled={checking}>취소</button><button className="button button-primary" type="button" onClick={onConfirm} disabled={checking}>{checking ? <><FiLoader className="spin" /> 재검사 중...</> : <><FiActivity /> 적용하고 다시 검사</>}</button></div></section></div>;
}
