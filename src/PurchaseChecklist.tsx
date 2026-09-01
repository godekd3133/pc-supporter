import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { FiCheckCircle, FiCopy, FiDownload, FiInfo, FiLoader, FiPrinter, FiRefreshCw } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult, Part } from "../shared/types";
import { actionChecklistIdsFor, checkedChecklistIdsAfterAction } from "../shared/build-action-links";
import { parsePurchaseChecklistJson, PURCHASE_CHECKLIST_ACTION_EVENT, PURCHASE_CHECKLIST_CHANGE_EVENT, purchaseChecklistItemsFor, purchaseChecklistJsonFor, purchaseChecklistProgressFor, purchaseChecklistTextFor, purchaseChecklistTransferDiffFor, purchaseChecklistTransferMatchesCurrentFor } from "../shared/purchase-checklist";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";

function checkedIdsFromStorage(storageKey: string) {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}

function writeCheckedIdsToStorage(storageKey: string, checkedIds: string[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(checkedIds.slice(0, 100)));
  } catch {
    // A full local storage bucket must not prevent the result page from working.
  }
  try {
    window.dispatchEvent(new CustomEvent(PURCHASE_CHECKLIST_CHANGE_EVENT, { detail: { storageKey } }));
  } catch {
    // Custom events are an enhancement; local checklist state remains authoritative.
  }
}

function severityLabel(severity: "blocker" | "warning" | "unknown" | "manual") {
  return severity === "blocker" ? "차단" : severity === "warning" ? "주의" : severity === "unknown" ? "확인 필요" : "직접 확인";
}

type ChecklistFilter = "all" | "finding" | "manual";
type ChecklistTransferPreview = {
  checkedIds: string[];
  ignoredIds: string[];
  itemIds: string[];
  exportedAt?: string;
};

export function PurchaseChecklistPanel({ build, result, partMap, storageKey, onFocusFinding, onFocusSection, onProgressChange }: { build: BuildSelection; result: CompatibilityResult; partMap: ReadonlyMap<string, Part>; storageKey: string; onFocusFinding?: (ruleId: string) => void; onFocusSection?: (targetId: NonNullable<ReturnType<typeof purchaseChecklistItemsFor>[number]["targetId"]>) => void; onProgressChange?: (progress: PurchaseChecklistProgress) => void }) {
  const items = useMemo(() => purchaseChecklistItemsFor(build, result, partMap), [build, result, partMap]);
  const transferInputRef = useRef<HTMLInputElement>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>(() => checkedIdsFromStorage(storageKey));
  const [hydratedStorageKey, setHydratedStorageKey] = useState(storageKey);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [transferPreview, setTransferPreview] = useState<ChecklistTransferPreview | null>(null);
  const [filter, setFilter] = useState<ChecklistFilter>("all");
  const checkedIdSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const progress = purchaseChecklistProgressFor(items, checkedIdSet);
  const allChecked = progress.total > 0 && progress.remaining === 0;
  const state = result.blockerCount > 0 ? "blocked" : result.warningCount > 0 || result.unknownCount > 0 || !allChecked ? "review" : "complete";
  const filterOptions: Array<{ id: ChecklistFilter; label: string }> = [{ id: "all", label: "전체" }, { id: "finding", label: "엔진 finding" }, { id: "manual", label: "직접 확인" }];
  const filterCounts: Record<ChecklistFilter, number> = { all: items.length, finding: items.filter((item) => item.kind === "finding").length, manual: items.filter((item) => item.kind === "manual").length };
  const visibleItems = filter === "all" ? items : items.filter((item) => item.kind === filter);

  useEffect(() => {
    setCheckedIds(checkedIdsFromStorage(storageKey));
    setHydratedStorageKey(storageKey);
    setFilter("all");
    setActionMessage(null);
    setTransferPreview(null);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    onProgressChange?.(progress);
  }, [hydratedStorageKey, onProgressChange, progress.checked, progress.percent, progress.remaining, progress.total, storageKey]);

  useEffect(() => {
    if (hydratedStorageKey === storageKey) writeCheckedIdsToStorage(storageKey, checkedIds);
  }, [checkedIds, hydratedStorageKey, storageKey]);

  useEffect(() => {
    const syncAction = (event: Event) => {
      const detail = (event as CustomEvent<{ storageKey?: string; actionId?: string; checked?: boolean }>).detail;
      if (!detail?.actionId || detail.storageKey !== storageKey || typeof detail.checked !== "boolean") return;
      const actionId = detail.actionId;
      const checklistIds = actionChecklistIdsFor(actionId, new Set(items.map((item) => item.id)));
      if (checklistIds.length === 0) return;
      setCheckedIds((current) => {
        return checkedChecklistIdsAfterAction(current, actionId, new Set(items.map((item) => item.id)), detail.checked!);
      });
    };
    window.addEventListener(PURCHASE_CHECKLIST_ACTION_EVENT, syncAction);
    return () => window.removeEventListener(PURCHASE_CHECKLIST_ACTION_EVENT, syncAction);
  }, [items, storageKey]);

  function toggleItem(itemId: string) {
    setCheckedIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  function checkAll() {
    setCheckedIds(items.map((item) => item.id));
  }

  function clearAll() {
    setCheckedIds([]);
  }

  async function copyChecklist() {
    try {
      await navigator.clipboard.writeText(purchaseChecklistTextFor(items, checkedIdSet));
      setActionMessage("체크리스트를 클립보드에 복사했습니다.");
    } catch {
      setActionMessage("체크리스트 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  function downloadChecklist() {
    const blob = new Blob([purchaseChecklistJsonFor(storageKey, items, checkedIdSet)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-purchase-checklist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    setActionMessage("체크리스트 JSON을 저장했습니다.");
  }

  async function importChecklistFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parsePurchaseChecklistJson(await file.text(), storageKey, items);
      if (parsed.errors.length > 0) {
        setActionMessage(parsed.errors[0]);
        setTransferPreview(null);
        return;
      }
      setTransferPreview({ checkedIds: parsed.checkedIds, ignoredIds: parsed.ignoredIds, itemIds: parsed.itemIds, exportedAt: parsed.exportedAt });
      setActionMessage(null);
    } catch {
      setActionMessage("체크리스트 JSON 파일을 읽지 못했습니다.");
      setTransferPreview(null);
    }
  }

  function applyTransferPreview() {
    if (!transferPreview) return;
    if (!purchaseChecklistTransferMatchesCurrentFor(items.map((item) => item.id), transferPreview.itemIds)) {
      setTransferPreview(null);
      setActionMessage("검사 결과가 바뀌어 체크리스트 항목이 달라졌습니다. JSON을 다시 가져와 주세요.");
      return;
    }
    setCheckedIds(transferPreview.checkedIds);
    setActionMessage(`현재 견적에 ${transferPreview.checkedIds.length}개 완료 상태를 가져왔습니다.${transferPreview.ignoredIds.length > 0 ? ` 현재 없는 항목 ${transferPreview.ignoredIds.length}개는 무시했습니다.` : ""}`);
    setTransferPreview(null);
  }

  const transferDiff = transferPreview ? purchaseChecklistTransferDiffFor(checkedIds, transferPreview.checkedIds) : null;

  const headingLabel = progress.total === 0
    ? "확인 항목 없음"
    : result.blockerCount > 0
      ? allChecked ? `체크 완료 · 차단 ${result.blockerCount}개 잔여` : "구매 보류 항목 있음"
      : result.warningCount > 0 || result.unknownCount > 0
        ? allChecked ? "체크 완료 · 검사 확인 필요" : `${progress.remaining}개 남음`
        : state === "complete" ? "체크·검사 완료" : `${progress.remaining}개 남음`;
  return <section className={`purchase-checklist-panel ${state}`} aria-label="구매 전 실행 체크리스트" data-testid="purchase-checklist">
    <div className="purchase-checklist-heading"><div><p className="eyebrow">ASSEMBLY CHECKLIST</p><h2>구매 전 실행 체크리스트</h2><p>검사 엔진 finding과 사용자가 직접 확인할 제조사·실물 조립 항목을 분리해 관리합니다.</p></div><strong><FiCheckCircle /> {headingLabel}</strong></div>
    <div className="purchase-checklist-progress-heading"><span>진행률</span><b>{progress.checked} / {progress.total}개</b><em>{progress.percent}%</em></div>
    <div className="purchase-checklist-progress" role="progressbar" aria-label={`구매 전 체크리스트 ${progress.percent}% 완료`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div>
    <div className="purchase-checklist-filters" role="group" aria-label="구매 전 체크리스트 필터">{filterOptions.map((option) => <button className={filter === option.id ? "selected" : ""} type="button" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)} key={option.id}>{option.label}<span>{filterCounts[option.id]}</span></button>)}</div>
    <div className="purchase-checklist-actions"><button className="text-button" type="button" onClick={() => void copyChecklist()} disabled={progress.total === 0}><FiCopy /> 체크리스트 복사</button><button className="text-button" type="button" onClick={downloadChecklist} disabled={progress.total === 0}><FiDownload /> JSON 저장</button><input ref={transferInputRef} className="purchase-checklist-transfer-input" type="file" accept=".json,application/json" aria-label="체크리스트 JSON 파일 가져오기" onChange={(event) => void importChecklistFile(event)} disabled={progress.total === 0} /><button className="text-button" type="button" onClick={() => transferInputRef.current?.click()} disabled={progress.total === 0}><FiDownload /> JSON 가져오기</button><button className="text-button" type="button" onClick={() => window.print()} disabled={progress.total === 0}><FiPrinter /> 인쇄</button><button className="text-button" type="button" onClick={checkAll} disabled={progress.total === 0 || progress.remaining === 0}><FiCheckCircle /> 모두 완료 처리</button><button className="text-button" type="button" onClick={clearAll} disabled={progress.checked === 0}><FiRefreshCw /> 체크 초기화</button></div>
    {actionMessage && <p className="purchase-checklist-action-message" role="status">{actionMessage}</p>}
    {transferPreview && transferDiff && <div className="purchase-checklist-transfer-preview" role="region" aria-label="체크리스트 JSON 가져오기 미리보기">
      <div className="purchase-checklist-transfer-preview-heading"><div><strong>체크리스트 가져오기 미리보기</strong><small>내보낸 시각 {transferPreview.exportedAt ?? "알 수 없음"} · 파일 항목 {transferPreview.itemIds.length}개</small></div><span>확인 필요</span></div>
      <div className="purchase-checklist-transfer-stats"><span>현재 완료 <b>{transferDiff.currentCheckedCount}개</b></span><span>가져올 완료 <b>{transferDiff.incomingCheckedCount}개</b></span><span>새로 체크 <b>{transferDiff.addedCount}개</b></span><span>해제 <b>{transferDiff.removedCount}개</b></span><span>유지 <b>{transferDiff.unchangedCount}개</b></span>{transferPreview.ignoredIds.length > 0 && <span>현재 없는 항목 <b>{transferPreview.ignoredIds.length}개</b></span>}</div>
      <p>현재 완료 상태를 즉시 바꾸지 않았습니다. 아래 내용을 확인한 뒤 적용하세요.</p>
      <div className="purchase-checklist-transfer-preview-actions"><button className="text-button" type="button" onClick={() => setTransferPreview(null)}>취소</button><button className="button button-primary" type="button" onClick={applyTransferPreview}>이 상태로 가져오기</button></div>
    </div>}
    {items.length === 0 ? <div className="purchase-checklist-empty"><FiInfo /><span>현재 구성에서 생성된 구매 전 확인 항목이 없습니다.</span></div> : visibleItems.length === 0 ? <div className="purchase-checklist-empty"><FiInfo /><span>선택한 필터에 해당하는 항목이 없습니다.</span><button className="text-button" type="button" onClick={() => setFilter("all")}>전체 보기</button></div> : <div className="purchase-checklist-list">{visibleItems.map((item) => { const checked = checkedIdSet.has(item.id); const ruleId = item.ruleId; return <article className={checked ? "purchase-checklist-item checked" : "purchase-checklist-item"} key={item.id}><label className="purchase-checklist-check"><input type="checkbox" aria-label={`${item.title} 완료`} checked={checked} onChange={() => toggleItem(item.id)} /><span className="purchase-checklist-copy"><span className={`purchase-checklist-kind ${item.kind} ${item.severity}`}>{severityLabel(item.severity)}</span><strong>{item.title}</strong><small>{item.detail}</small></span></label>{ruleId && onFocusFinding ? <button className="text-button purchase-checklist-finding-link" type="button" onClick={() => onFocusFinding(ruleId)}>finding 보기</button> : item.targetId && onFocusSection ? <button className="text-button purchase-checklist-finding-link" type="button" onClick={() => onFocusSection(item.targetId!)}>{item.actionLabel ?? "관련 확인"}</button> : null}</article>; })}</div>}
    <p className="purchase-checklist-note"><FiInfo /> 체크 상태는 이 견적 입력·카탈로그 기준·엔진 버전에 묶어 이 브라우저에만 저장합니다. 새 부품·수량·추천 기준·카탈로그 기준이 바뀌면 이전 체크를 자동으로 재사용하지 않습니다.</p>
  </section>;
}

export function PurchaseChecklistLoading() {
  return <section className="purchase-checklist-panel loading" aria-label="구매 전 실행 체크리스트 로딩" role="status"><FiLoader className="spin" /> 구매 전 체크리스트를 준비하는 중...</section>;
}
