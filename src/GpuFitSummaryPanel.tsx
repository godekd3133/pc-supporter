import { FiBox, FiCheckCircle, FiExternalLink, FiInfo, FiLayers, FiMonitor, FiZap } from "react-icons/fi";
import type { IconType } from "react-icons";
import { gpuPurchaseEvidenceFor, type GpuFitStatus, type GpuFitSummary, type PciePowerOptionFit } from "../shared/gpu-fit";
import type { Part, PhysicalEvidenceSource, PciePowerConnectorKind, PciePowerRequirement } from "../shared/types";
import { safeHttpsUrl } from "./safe-source-url";

type FitTone = "good" | "warning" | "danger" | "unknown" | "neutral";

const STATUS_LABELS: Record<GpuFitStatus, string> = {
  compatible: "기준 통과",
  incompatible: "차단",
  needs_review: "확인 필요",
  not_applicable: "미적용"
};

function toneFor(status: GpuFitStatus): FitTone {
  return status === "compatible" ? "good" : status === "incompatible" ? "danger" : status === "needs_review" ? "warning" : "neutral";
}

function connectorLabel(kind: PciePowerConnectorKind) {
  if (kind === "12v2x6") return "16핀(12V2x6)";
  if (kind === "12vhpwr") return "16핀(12VHPWR)";
  return kind === "pcie_8pin_6plus2" ? "8핀(6+2)" : "6핀";
}

function requirementText(requirements: PciePowerRequirement[]) {
  return requirements.map((requirement) => `${connectorLabel(requirement.kind)} ${requirement.count}개`).join(" + ");
}

function optionText(options: PciePowerRequirement[][], requirementsKnown: boolean, adapterOptionIndices: number[]) {
  if (!requirementsKnown) return "GPU 보조전원 정보 확인 필요";
  return options.length > 0 ? options.map((option, index) => `${adapterOptionIndices.includes(index) ? "어댑터" : "원문"} 경로 ${index + 1}: ${requirementText(option)}`).join(" 또는 ") : "GPU 보조전원 요구 없음";
}

function connectorText(connectors: Partial<Record<PciePowerConnectorKind, number>> | undefined) {
  if (!connectors) return "PSU 보조전원 정보 확인 필요";
  const entries = (Object.entries(connectors) as Array<[PciePowerConnectorKind, number | undefined]>)
    .filter(([, count]) => count !== undefined)
    .map(([kind, count]) => `${connectorLabel(kind)} ${count}개`);
  return entries.length > 0 ? entries.join(" + ") : "확인된 PSU 커넥터 없음";
}

function optionFitText(option: PciePowerOptionFit, index: number, isAdapter: boolean) {
  const path = isAdapter ? "어댑터 경로" : "원문 경로";
  if (option.status === "compatible") return `${path} ${index + 1} · 충족`;
  if (option.status === "blocker") return `${path} ${index + 1} · 부족 ${requirementText(option.missing)}`;
  const unknown = option.unknown.length > 0 ? ` · 미확인 ${requirementText(option.unknown)}` : "";
  const missing = option.missing.length > 0 ? ` · 부족 ${requirementText(option.missing)}` : "";
  return `${path} ${index + 1} · 확인 필요${missing}${unknown}`;
}

function psuStructureText(cableType: Part["specs"]["psuCableType"], railType: Part["specs"]["psuRailType"]) {
  const cable = cableType === "fully_modular" ? "풀모듈러" : cableType === "semi_modular" ? "세미모듈러" : cableType === "fixed" ? "케이블 일체형" : "케이블 구조 확인 필요";
  const rail = railType === "single" ? "12V 싱글레일" : railType === "multi" ? "12V 다중레일" : "12V 레일 정보 확인 필요";
  return `${cable} · ${rail}`;
}

function psuCableTopologyDetail(fit: GpuFitSummary["connector"]) {
  const runs = fit.psuIndependentPcieCableRuns === undefined ? "독립 런 수 확인 필요" : `독립 PCIe 런 ${fit.psuIndependentPcieCableRuns}개`;
  const topology = fit.psuPcieCableTopology === "independent" ? "분배 없음" : fit.psuPcieCableTopology === "shared" ? "분배·공유 표기" : "분배 구조 확인 필요";
  return `${runs} · ${topology}`;
}

function physicalEvidenceDetail(fit: GpuFitSummary["physical"], status: GpuFitStatus) {
  if (fit.status === "not_applicable" && status === "needs_review") return "GPU 슬롯·케이블 굽힘·케이스 측면의 제조사 물리 검수 근거가 아직 등록되지 않았습니다.";
  return physicalDetail(fit);
}

function cableTopologyEvidenceDetail(fit: GpuFitSummary["connector"], status: GpuFitStatus) {
  if (fit.psuCableTopologyStatus === "not_applicable" && status === "needs_review") return "다중 8핀 연결 경로의 독립 PCIe 케이블 근거가 아직 등록되지 않았습니다.";
  return psuCableTopologyDetail(fit);
}

function evidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

function evidenceSourceIdentity(source: PhysicalEvidenceSource) {
  return `${evidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}`;
}

function EvidenceSourceList({ sources }: { sources: PhysicalEvidenceSource[] | undefined }) {
  const safeSources = (sources ?? []).flatMap((source) => {
    const note = source.note?.trim();
    if (!note) return [];
    const url = safeHttpsUrl(source.url);
    return [{ ...source, note, ...(url ? { url } : {}) }];
  });
  return <div className="gpu-fit-evidence-sources" aria-label="물리 근거 출처"><strong>물리 근거 출처</strong>{safeSources.length === 0 ? <small>등록된 출처 메모 없음 · 제조사 매뉴얼 확인 필요</small> : safeSources.map((source) => <small key={`${source.category}-${source.note}-${source.url ?? ""}`}><b>{evidenceSourceIdentity(source)}</b> {source.note}{source.updatedAt ? ` · 검수 갱신 ${new Date(source.updatedAt).toLocaleDateString("ko-KR")}` : ""}{source.url && <a href={source.url} target="_blank" rel="noreferrer">원문 <FiExternalLink /></a>}</small>)}</div>;
}

function mmDetail(actualMm: number | undefined, limitMm: number | undefined, clearanceMm: number | undefined, actualLabel: string, limitLabel: string) {
  if (actualMm === undefined || limitMm === undefined) return `${actualLabel} 또는 ${limitLabel} 원문 확인 필요`;
  if (clearanceMm === undefined) return `${actualLabel} ${actualMm}mm · ${limitLabel} ${limitMm}mm · 여유 계산 필요`;
  return `${actualLabel} ${actualMm}mm · ${limitLabel} ${limitMm}mm · ${clearanceMm >= 0 ? `${clearanceMm}mm 여유` : `${Math.abs(clearanceMm)}mm 초과`}`;
}

function powerDetail(fit: GpuFitSummary["power"]) {
  if (fit.gpuPowerW === undefined || fit.recommendedPsuW === undefined || fit.psuWattageW === undefined) return "GPU 소비전력·권장 PSU·선택 PSU 정보를 모두 확인해야 합니다.";
  return `GPU ${fit.gpuPowerW}W · 권장 PSU ${fit.recommendedPsuW}W · 선택 PSU ${fit.psuWattageW}W · ${fit.headroomW !== undefined ? fit.headroomW >= 0 ? `${fit.headroomW}W 여유` : `${Math.abs(fit.headroomW)}W 부족` : "여유 계산 필요"}`;
}

function physicalDetail(fit: GpuFitSummary["physical"]) {
  const slot = fit.gpuSlotOccupancy === undefined ? undefined : `GPU 물리 슬롯 ${fit.gpuSlotOccupancy}`;
  if (fit.gpuCableBendClearanceMm === undefined || fit.caseSidePanelClearanceMm === undefined) return [slot, "케이블 측면 여유 확인 필요"].filter(Boolean).join(" · ") || "제조사 물리 치수 확인 필요";
  const clearance = fit.cableClearanceMm ?? fit.caseSidePanelClearanceMm - fit.gpuCableBendClearanceMm;
  return `${slot ? `${slot} · ` : ""}케이블 요구 ${fit.gpuCableBendClearanceMm}mm · 케이스 ${fit.caseSidePanelClearanceMm}mm · ${clearance >= 0 ? `${clearance}mm 여유` : `${Math.abs(clearance)}mm 부족`}`;
}

function FitMetric({ icon: Icon, label, value, detail, status }: { icon: IconType; label: string; value: string; detail: string; status: GpuFitStatus }) {
  const tone = toneFor(status);
  return <article className={`gpu-fit-metric ${tone}`}><span className="gpu-fit-metric-icon"><Icon /></span><div><div className="gpu-fit-metric-heading"><span>{label}</span><strong>{STATUS_LABELS[status]}</strong></div><b>{value}</b><small>{detail}</small></div></article>;
}

function actionText(fit: GpuFitSummary, computerCase: Part | undefined, psu: Part | undefined) {
  const purchaseEvidence = gpuPurchaseEvidenceFor(fit);
  const actions: string[] = [];
  if (fit.length.status === "incompatible") actions.push(`GPU 길이가 케이스 한도를 넘습니다. ${fit.length.limitMm !== undefined ? `${fit.length.limitMm}mm 이하 GPU` : "더 여유 있는 케이스"}를 선택하세요.`);
  else if (fit.length.status === "needs_review") actions.push("GPU와 케이스의 장착 길이 원문을 함께 확인하세요.");
  if (fit.thickness.status === "needs_review") actions.push(`${fit.thickness.warningThresholdMm}mm 기준을 넘거나 두께 원문이 부족합니다. 메인보드 인접 슬롯·케이스 측판 간섭을 확인하세요.`);
  if (fit.power.status === "incompatible") actions.push(`PSU 정격이 권장 기준보다 낮습니다. ${fit.power.recommendedPsuW !== undefined ? `${fit.power.recommendedPsuW}W 이상 PSU` : "더 큰 PSU"}를 비교하세요.`);
  else if (fit.power.status === "needs_review") actions.push(`${psu ? "GPU·PSU" : "PSU"} 전력 스펙을 확인해야 합니다.`);
  if (fit.connector.status === "incompatible") actions.push("GPU의 보조전원 선택지를 충족하는 PSU 커넥터를 선택하세요.");
  else if (fit.connector.status === "needs_review") actions.push("PSU 커넥터 수량과 GPU 원문에 명시된 연결 경로를 확인하세요.");
  if (purchaseEvidence.pcieCableTopology === "needs_review") actions.push("커넥터 수량과 별도로 PSU PCIe 케이블 런 수·분배 구조가 GPU 연결 요구를 충족하는지 제조사 표에서 확인하세요.");
  if (purchaseEvidence.physical === "incompatible") actions.push("GPU 전원 케이블 요구 여유보다 케이스 측면 공간이 작습니다. 더 여유 있는 케이스 또는 케이블 조건이 맞는 GPU를 비교하세요.");
  else if (purchaseEvidence.physical === "needs_review") actions.push("GPU 물리 슬롯·케이블 굽힘 여유와 케이스 측면 공간을 제조사 매뉴얼에서 확인하세요.");
  if (actions.length === 0) actions.push(`${computerCase?.name ?? "케이스"}와 ${psu?.name ?? "PSU"}에 대해 현재 등록된 GPU 장착·전원 기준을 통과했습니다.`);
  return actions;
}

export function GpuFitSummaryPanel({ fit, gpu, computerCase, psu }: { fit: GpuFitSummary; gpu: Part; computerCase?: Part; psu?: Part }) {
  const purchaseEvidence = gpuPurchaseEvidenceFor(fit);
  const displayStatus: GpuFitStatus = fit.status === "compatible" && purchaseEvidence.status !== "compatible" ? purchaseEvidence.status : fit.status;
  const connectorStatusText = fit.connector.matchedOptionIndex !== undefined
    ? `${fit.connector.adapterOptionIndices.includes(fit.connector.matchedOptionIndex) ? "어댑터" : "원문"} 경로 ${fit.connector.matchedOptionIndex + 1} 충족`
    : fit.connector.status === "incompatible" ? "확인된 커넥터로 충족 경로 없음" : fit.connector.status === "needs_review" ? "충족 경로를 확정하지 못함" : "보조전원 요구 없음";
  const thicknessValue = fit.thickness.actualMm === undefined ? "확인 필요" : `${fit.thickness.actualMm}mm`;
  const powerValue = fit.power.psuWattageW === undefined ? "확인 필요" : `${fit.power.psuWattageW}W PSU`;
  const connectorValue = !fit.connector.requirementsKnown ? "요구 정보 확인 필요" : fit.connector.options.length === 0 ? "보조전원 없음" : fit.connector.matchedOptionIndex !== undefined ? `경로 ${fit.connector.matchedOptionIndex + 1}` : "경로 확인 필요";
  return <section className={`gpu-fit-summary-panel ${toneFor(displayStatus)}`} aria-label="GPU 실장·전원 요약" data-testid="gpu-fit-summary-panel">
    <div className="gpu-fit-summary-heading"><div><p className="eyebrow">GPU FIT DOSSIER</p><h2>GPU 실장·전원 요약</h2><p>{gpu.name}를 기준으로 케이스 장착 치수와 PSU 전원 경로를 한 번에 확인합니다.</p></div><div className="gpu-fit-summary-badge"><FiMonitor /><strong>{STATUS_LABELS[displayStatus]}</strong></div></div>
    <div className="gpu-fit-summary-context"><span><FiMonitor /> GPU · {gpu.name}</span><span><FiBox /> 케이스 · {computerCase?.name ?? "미선택"}</span><span><FiZap /> PSU · {psu?.name ?? "미선택"}</span></div>
    <div className="gpu-fit-metrics">
      <FitMetric icon={FiBox} label="케이스 장착 길이" value={fit.length.actualMm !== undefined && fit.length.limitMm !== undefined ? `${fit.length.actualMm} / ${fit.length.limitMm}mm` : "확인 필요"} detail={mmDetail(fit.length.actualMm, fit.length.limitMm, fit.length.clearanceMm, "GPU", "케이스 허용")} status={fit.length.status} />
      <FitMetric icon={FiLayers} label="두께·슬롯 간섭" value={thicknessValue} detail={fit.thickness.actualMm === undefined ? "GPU 두께 원문 확인 필요" : `${fit.thickness.warningThresholdMm}mm 이상이면 인접 슬롯·측판을 확인합니다.`} status={fit.thickness.status} />
      <FitMetric icon={FiZap} label="PSU 전력 여유" value={powerValue} detail={powerDetail(fit.power)} status={fit.power.status} />
      <FitMetric icon={FiMonitor} label="보조전원 연결" value={connectorValue} detail={connectorStatusText} status={fit.connector.status} />
      {purchaseEvidence.physical !== "not_applicable" && <FitMetric icon={FiLayers} label="물리 슬롯·케이블" value={fit.physical.gpuSlotOccupancy === undefined ? "검수 필요" : `${fit.physical.gpuSlotOccupancy} 슬롯`} detail={physicalEvidenceDetail(fit.physical, purchaseEvidence.physical)} status={purchaseEvidence.physical} />}
      {purchaseEvidence.pcieCableTopology !== "not_applicable" && <FitMetric icon={FiZap} label="PCIe 케이블 분배" value={fit.connector.psuIndependentPcieCableRuns === undefined ? "검수 필요" : `${fit.connector.psuIndependentPcieCableRuns}개 런`} detail={cableTopologyEvidenceDetail(fit.connector, purchaseEvidence.pcieCableTopology)} status={purchaseEvidence.pcieCableTopology} />}
    </div>
    <div className="gpu-fit-connector-panel"><div><strong>GPU가 요구하는 연결 선택지</strong><small>{optionText(fit.connector.options, fit.connector.requirementsKnown, fit.connector.adapterOptionIndices)}</small></div><div><strong>PSU에서 확인된 커넥터</strong><small>{connectorText(fit.connector.connectors)}</small><small>{psuStructureText(fit.connector.psuCableType, fit.connector.psuRailType)}</small></div>{fit.connector.optionFits.length > 0 && <div className="gpu-fit-connector-options"><strong>선택지별 판정</strong>{fit.connector.optionFits.map((option, index) => <span className={option.status === "compatible" ? "good" : option.status === "blocker" ? "danger" : "unknown"} key={`${index}-${option.status}`}>{optionFitText(option, index, fit.connector.adapterOptionIndices.includes(index))}</span>)}</div>}</div>
    {purchaseEvidence.status !== "not_applicable" && <EvidenceSourceList sources={purchaseEvidence.sources} />}
    <div className="gpu-fit-actions"><div><strong>다음 행동</strong>{actionText(fit, computerCase, psu).map((action) => <p key={action}><FiCheckCircle /> {action}</p>)}</div></div>
    <p className="gpu-fit-note"><FiInfo /> 수치가 확인된 경우에만 길이·전력 여유를 계산합니다. PSU 커넥터 개수만으로 독립 케이블·레일 구성이나 케이블 굽힘 반경을 추정하지 않으며, 실제 조립 전 제조사 매뉴얼·케이스 전면 구조·측면 여유를 별도로 확인해야 합니다.</p>
  </section>;
}
