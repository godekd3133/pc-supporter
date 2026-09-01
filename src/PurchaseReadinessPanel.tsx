import { Suspense, lazy } from "react";
import { FiInfo } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult } from "../shared/types";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";
import type { AssemblyVerificationSurfaceSummary } from "../shared/assembly-verification";
import { purchaseReadinessFor, readinessStateLabel } from "../shared/purchase-readiness";
import { PurchaseDecisionGatePanel } from "./PurchaseDecisionGatePanel";

const LazyAccessoryCompatibilityPanel = lazy(() => import("./AccessoryCompatibilityPanel").then((module) => ({ default: module.AccessoryCompatibilityPanel })));

export function PurchaseReadinessPanel({ result, onEdit, build, onChangeAccessoryHubTarget, checklistProgress, assemblyVerification, onFocusChecklist, onFocusAssemblyVerification }: { result: CompatibilityResult; onEdit: () => void; build: BuildSelection; onChangeAccessoryHubTarget: (index: number, targetAccessoryId: string | undefined) => void; checklistProgress?: PurchaseChecklistProgress; assemblyVerification?: AssemblyVerificationSurfaceSummary; onFocusChecklist: () => void; onFocusAssemblyVerification: () => void }) {
  const readiness = purchaseReadinessFor(result);
  return <>
    <PurchaseDecisionGatePanel readiness={readiness} checklistProgress={checklistProgress} assemblyVerification={assemblyVerification} onFocusChecklist={onFocusChecklist} onFocusAssemblyVerification={onFocusAssemblyVerification} />
    <section className={`purchase-readiness-panel ${readiness.state}`} aria-label="구매 준비도"><div className="purchase-readiness-heading"><div><p className="eyebrow">PURCHASE READINESS</p><h2>구매 준비도</h2><p>{readiness.summary}</p></div><strong>{readiness.label}</strong></div><div className="purchase-readiness-grid">{readiness.items.map((item) => <article className={item.state} key={item.id}><div><span>{item.label}</span><strong>{readinessStateLabel(item.state)}</strong></div><p>{item.summary}</p></article>)}</div><p className="purchase-readiness-note"><FiInfo /> 이 요약은 현재 카탈로그·호환성 규칙·가격 상태를 구매 전 체크리스트로 묶은 것입니다. 실제 BIOS·QVL·온도·소음·배송·판매자 조건은 별도로 확인해야 합니다.</p></section>
    {result.accessoryCompatibility && <Suspense fallback={<div className="accessory-compatibility-panel loading" aria-label="주변 부품 호환 점검 로딩" role="status">주변 부품 호환 점검을 준비하는 중...</div>}><LazyAccessoryCompatibilityPanel result={result.accessoryCompatibility} onEdit={onEdit} onAssignHubTarget={(fanId, hubId) => { const fanIndex = build.accessories?.findIndex((selection) => selection.accessoryId === fanId) ?? -1; if (fanIndex >= 0) onChangeAccessoryHubTarget(fanIndex, hubId); }} /></Suspense>}
  </>;
}
