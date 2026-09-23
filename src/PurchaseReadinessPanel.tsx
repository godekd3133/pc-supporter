import { Suspense, lazy } from "react";
import { FiChevronDown } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult } from "../shared/types";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";
import type { AssemblyVerificationSurfaceSummary } from "../shared/assembly-verification";
import type { PurchaseListExecutionProgress } from "../shared/purchase-list-progress";
import type { PurchaseItemStatus } from "../shared/purchase-list-status";
import { purchaseReadinessFor, readinessStateLabel } from "../shared/purchase-readiness";
import { PurchaseDecisionGatePanel } from "./PurchaseDecisionGatePanel";

const LazyAccessoryCompatibilityPanel = lazy(() => import("./AccessoryCompatibilityPanel").then((module) => ({ default: module.AccessoryCompatibilityPanel })));

export function PurchaseReadinessPanel({ result, onEdit, build, onChangeAccessoryHubTarget, checklistProgress, purchaseProgress, assemblyVerification, onFocusChecklist, onFocusPurchaseList, onFocusAssemblyVerification }: { result: CompatibilityResult; onEdit: () => void; build: BuildSelection; onChangeAccessoryHubTarget: (index: number, targetAccessoryId: string | undefined) => void; checklistProgress?: PurchaseChecklistProgress; purchaseProgress?: PurchaseListExecutionProgress; assemblyVerification?: AssemblyVerificationSurfaceSummary; onFocusChecklist: () => void; onFocusPurchaseList: (status?: PurchaseItemStatus) => void; onFocusAssemblyVerification: () => void }) {
  const readiness = purchaseReadinessFor(result);
  return <>
    <PurchaseDecisionGatePanel readiness={readiness} checklistProgress={checklistProgress} purchaseProgress={purchaseProgress} assemblyVerification={assemblyVerification} onFocusChecklist={onFocusChecklist} onFocusPurchaseList={onFocusPurchaseList} onFocusAssemblyVerification={onFocusAssemblyVerification} />
    <details className="purchase-readiness-details">
      <summary><span>구매 준비도·주변 부품 점검</span><FiChevronDown /></summary>
      <div className="purchase-readiness-details-body">
        <section className={`purchase-readiness-panel ${readiness.state}`} aria-label="구매 준비도"><div className="purchase-readiness-heading"><div><h2>구매 준비도</h2><p>{readiness.summary}</p></div><strong>{readiness.label}</strong></div><div className="purchase-readiness-grid">{readiness.items.map((item) => <article className={item.state} key={item.id}><div><span>{item.label}</span><strong>{readinessStateLabel(item.state)}</strong></div><p>{item.summary}</p></article>)}</div></section>
        {result.accessoryCompatibility && <Suspense fallback={<div className="accessory-compatibility-panel loading" aria-label="주변 부품 호환 점검 로딩" role="status">주변 부품 호환 점검을 준비하는 중...</div>}><LazyAccessoryCompatibilityPanel result={result.accessoryCompatibility} onEdit={onEdit} onAssignHubTarget={(fanId, hubId) => { const fanIndex = build.accessories?.findIndex((selection) => selection.accessoryId === fanId) ?? -1; if (fanIndex >= 0) onChangeAccessoryHubTarget(fanIndex, hubId); }} /></Suspense>}
      </div>
    </details>
  </>;
}
