import { useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiDatabase, FiInfo, FiMonitor, FiSearch, FiShoppingCart, FiTool, FiZap } from "react-icons/fi";
import { buildActionCenterFor, type BuildAction, type BuildActionPriority, type BuildActionSource } from "../shared/build-action-center";
import { actionChecklistCheckedFor, actionChecklistIdsFor, actionChecklistProgressFor, checkedChecklistIdsAfterAction } from "../shared/build-action-links";
import { PURCHASE_CHECKLIST_ACTION_EVENT, PURCHASE_CHECKLIST_CHANGE_EVENT, purchaseChecklistItemsFor } from "../shared/purchase-checklist";
import type { BuildSelection, CompatibilityResult, Part } from "../shared/types";

const priorityLabels: Record<BuildActionPriority, string> = { blocker: "먼저 해결", review: "구매 전 확인", manual: "조립 전 확인" };
const sourceLabels: Record<BuildActionSource, string> = { compatibility: "호환성", accessory: "주변 부품", data: "데이터", physical: "장착·전력", price: "가격", assembly: "조립" };
const sourceIcons: Record<BuildActionSource, typeof FiInfo> = { compatibility: FiZap, accessory: FiTool, data: FiDatabase, physical: FiMonitor, price: FiShoppingCart, assembly: FiCheckCircle };

function actionButtonText(action: BuildAction) {
  return action.ruleId ? "finding 보기" : action.targetId === "gpu-fit-summary-panel" ? "GPU FIT 보기" : action.targetId === "data-health-panel" ? "데이터 보기" : action.targetId === "purchase-list-panel" ? "구매 목록 보기" : action.targetId === "repair-plan-panel" ? "수리 플랜 보기" : action.targetId === "build-connectivity-panel" ? "연결 자원 보기" : "체크리스트 보기";
}

function checkedIdsFromStorage(storageKey: string) {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}

function dispatchChecklistAction(storageKey: string, actionId: string, checked: boolean) {
  try {
    window.dispatchEvent(new CustomEvent(PURCHASE_CHECKLIST_ACTION_EVENT, { detail: { storageKey, actionId, checked } }));
  } catch {
    // The detailed checklist remains available when custom events are unavailable.
  }
}

function writeChecklistIds(storageKey: string, checkedIds: string[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(checkedIds.slice(0, 100)));
  } catch {
    // The in-memory action state still updates when storage is unavailable.
  }
  try {
    window.dispatchEvent(new CustomEvent(PURCHASE_CHECKLIST_CHANGE_EVENT, { detail: { storageKey } }));
  } catch {
    // The detailed checklist remains available when custom events are unavailable.
  }
}

export function BuildActionCenterPanel({ build, result, partMap, checklistStorageKey, onFocusFinding, onFocusSection, onFocusRepairPlans }: { build: BuildSelection; result: CompatibilityResult; partMap: ReadonlyMap<string, Part>; checklistStorageKey: string; onFocusFinding: (ruleId: string) => void; onFocusSection: (targetId: string) => void; onFocusRepairPlans: () => void }) {
  const center = buildActionCenterFor(result, build, partMap);
  const checklistItems = useMemo(() => purchaseChecklistItemsFor(build, result, partMap), [build, result, partMap]);
  const [checkedIds, setCheckedIds] = useState<string[]>(() => checkedIdsFromStorage(checklistStorageKey));
  useEffect(() => {
    setCheckedIds(checkedIdsFromStorage(checklistStorageKey));
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ storageKey?: string }>).detail;
      if (event.type === PURCHASE_CHECKLIST_CHANGE_EVENT && detail?.storageKey && detail.storageKey !== checklistStorageKey) return;
      setCheckedIds(checkedIdsFromStorage(checklistStorageKey));
    };
    window.addEventListener(PURCHASE_CHECKLIST_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PURCHASE_CHECKLIST_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [checklistStorageKey]);
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const checklistItemIdSet = useMemo(() => new Set(checklistItems.map((item) => item.id)), [checklistItems]);
  const actionProgress = useMemo(() => actionChecklistProgressFor(center.actions, checklistItemIdSet, checkedIdSet), [center.actions, checklistItemIdSet, checkedIdSet]);
  const visibleActions = center.actions.slice(0, 6);
  const StatusIcon = center.state === "ready" ? FiCheckCircle : FiAlertTriangle;
  function toggleChecklistAction(actionId: string, checked: boolean) {
    const next = checkedChecklistIdsAfterAction(checkedIds, actionId, checklistItemIdSet, checked);
    setCheckedIds(next);
    writeChecklistIds(checklistStorageKey, next);
    dispatchChecklistAction(checklistStorageKey, actionId, checked);
  }
  return <section className={`build-action-center ${center.state}`} aria-label="우선 조치 목록"><div className="build-action-center-heading"><div><p className="eyebrow">NEXT ACTIONS</p><h2>지금 먼저 확인할 것</h2><p>{center.summary}</p></div><span className="build-action-center-status"><StatusIcon /> {center.state === "blocked" ? "구매 보류" : center.state === "review" ? "확인 후 진행" : "최종 확인"}</span></div>{actionProgress.total > 0 && <div className="build-action-center-progress"><div><span>우선 조치 진행</span><b>{actionProgress.checked} / {actionProgress.total}개</b><em>{actionProgress.percent}%</em></div><div className="build-action-center-progress-track" role="progressbar" aria-label={`우선 조치 ${actionProgress.percent}% 완료`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={actionProgress.percent}><span style={{ width: `${actionProgress.percent}%` }} /></div>{actionProgress.checked === actionProgress.total && center.state !== "ready" && <small className="build-action-center-progress-note">체크리스트는 완료됐지만 {center.state === "blocked" ? "호환성 차단 오류를 해결한 뒤 다시 검사해야 합니다." : "검사 확인 필요 항목을 원문에서 확인한 뒤 진행해야 합니다."}</small>}</div>}<div className="build-action-center-list">{visibleActions.map((action) => { const Icon = sourceIcons[action.source]; const checklistIds = actionChecklistIdsFor(action.id, checklistItemIdSet); const checked = actionChecklistCheckedFor(action.id, checklistItemIdSet, checkedIdSet); return <article className={`build-action-item ${action.priority}${checked ? " checked" : ""}`} key={action.id}><div className="build-action-item-icon"><Icon /></div><div className="build-action-item-copy"><div><span className={`build-action-priority ${action.priority}`}>{priorityLabels[action.priority]}</span><span className="build-action-source">{sourceLabels[action.source]}</span>{checked && <span className="build-action-complete">체크 완료</span>}</div><strong>{action.title}</strong><p>{action.summary}</p></div><div className="build-action-item-actions">{checklistIds.length > 0 && <button className="text-button build-action-item-complete" type="button" aria-label={`${action.title} ${checked ? "완료 취소" : "완료 처리"}`} onClick={() => toggleChecklistAction(action.id, !checked)}>{checked ? "완료 취소" : "완료 처리"}</button>}{(action.ruleId || action.targetId) && <button className="text-button build-action-item-button" type="button" onClick={() => action.ruleId ? onFocusFinding(action.ruleId) : action.targetId === "repair-plan-panel" ? onFocusRepairPlans() : onFocusSection(action.targetId!)}>{actionButtonText(action)} <FiSearch /></button>}</div></article>; })}</div>{center.hiddenCount > 0 && <p className="build-action-center-more"><FiInfo /> 그 외 확인 항목 {center.hiddenCount}개는 구매 전 실행 체크리스트에서 확인할 수 있습니다.</p>}<p className="build-action-center-note"><FiInfo /> 이 패널은 기존 호환성 판정을 다시 계산하지 않고, finding·연결 자원·데이터 상태·가격·GPU FIT 결과를 행동 순서로만 정리합니다. 완료 표시는 이 견적에 연결된 구매 전 체크리스트 상태를 사용합니다.</p></section>;
}
