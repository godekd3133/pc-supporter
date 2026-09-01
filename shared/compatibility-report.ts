import type { AccessoryConnectivityPlan, AccessoryItem, AccessoryPowerRail, AccessoryRgbConnectionPlan, BuildSelection, CompatibilityResult, Part, PartCategory, RecommendationPreferences } from "./types";
import { ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, PART_CATEGORIES } from "./types";
import { gpuPurchaseEvidenceFor } from "./gpu-fit";
import { buildActionCenterFor } from "./build-action-center";
import { buildConnectivitySummaryFor } from "./build-connectivity";
import { assemblyPlanFor } from "./assembly-plan";
import { safeHttpsUrl } from "./safe-source-url";
import { valueScoreText } from "./value-score";

function priceText(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${value.toLocaleString("ko-KR")}원`
    : "가격 확인 필요";
}

function quantityText(quantity: number) {
  return quantity > 1 ? ` ×${quantity}` : "";
}

function sourceUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "danawa.com" || hostname.endsWith(".danawa.com"))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function partLine(category: PartCategory, selection: { partId: string; quantity: number }, partMap: ReadonlyMap<string, Part>) {
  const part = partMap.get(selection.partId);
  const name = part?.name ?? selection.partId;
  return `- ${CATEGORY_LABELS[category]}: ${name}${quantityText(selection.quantity)} · ${priceText(part?.priceWon)}${sourceUrl(part?.danawaUrl) ? ` · ${sourceUrl(part?.danawaUrl)}` : ""}`;
}

function preferenceLines(preferences: RecommendationPreferences | undefined) {
  if (!preferences) return ["- 추천 기준: 기본값"];
  const profile = { general: "일반형", gaming: "게이밍", creator: "작업·크리에이터", development: "개발·AI", office: "사무·일반" }[preferences.profile];
  const priority = { balanced: "균형형", budget: "가성비 우선", performance: "성능 우선" }[preferences.priority];
  const listingPolicy = { retail_only: "신품·정식 유통", include_bulk: "벌크 포함", all: "전체 조건" }[preferences.listingPolicy ?? "retail_only"];
  return [
    `- 사용 목적: ${profile}`,
    `- 우선순위: ${priority}`,
    `- 구매 조건: ${listingPolicy}`,
    `- 목표 예산: ${preferences.budgetWon === undefined ? "설정하지 않음" : priceText(preferences.budgetWon)}`,
    ...(preferences.profile === "gaming" && preferences.gamingResolution ? [`- 게임 해상도: ${preferences.gamingResolution}`] : []),
    ...(preferences.profile === "gaming" && preferences.gamingRefreshRate ? [`- 게임 주사율: ${preferences.gamingRefreshRate}Hz`] : [])
  ];
}

function findingSeverityLabel(severity: CompatibilityResult["findings"][number]["severity"]) {
  return severity === "blocker" ? "차단 오류" : severity === "warning" ? "주의" : severity === "unknown" ? "확인 필요" : "정보";
}

function accessoryFindingSeverityLabel(severity: NonNullable<CompatibilityResult["accessoryCompatibility"]>["findings"][number]["severity"]) {
  return severity === "blocker" ? "차단" : severity === "warning" ? "주의" : "확인 필요";
}

function accessoryPowerRailText(powerRails?: AccessoryPowerRail[]) {
  if (!powerRails || powerRails.length === 0) return "전원 레일 근거 확인 필요";
  const roleLabel = (role: AccessoryPowerRail["role"]) => role === "fan" ? "팬" : role === "rgb" ? "RGB" : role === "shared" ? "공용" : "역할 확인 필요";
  return powerRails.map((rail) => {
    const values = [
      rail.maxPowerW !== undefined ? `${rail.maxPowerW.toFixed(2)}W` : undefined,
      rail.maxCurrentA !== undefined ? `${rail.maxCurrentA.toFixed(2)}A` : undefined
    ].filter(Boolean).join(" · ");
    return `${rail.voltage} ${roleLabel(rail.role)}${values ? ` · ${values}` : " · 용량 확인 필요"}`;
  }).join(" / ");
}

function accessoryPortPlanText(plan: AccessoryConnectivityPlan) {
  if (plan.portIssue === "unknown") return "허브 포트 수 확인 필요";
  const allocation = plan.portAssignments.map((assignment) => assignment.portStart === assignment.portEnd
    ? `P${assignment.portStart} ${assignment.name}`
    : `P${assignment.portStart}-P${assignment.portEnd} ${assignment.name} ${assignment.fanCount}개`).join(" · ");
  const unassigned = plan.unassignedFanCount ? ` · ${plan.unassignedFanCount}개 미배치` : "";
  return `${allocation || "배치 정보 확인 필요"}${unassigned}`;
}

function accessoryRgbLoadText(plan: AccessoryRgbConnectionPlan) {
  if (plan.rgbLoadStatus === "unknown") return plan.rgbPerDeviceCurrentA !== undefined || plan.rgbPerDevicePowerW !== undefined ? "컨트롤러 레일 용량 확인 필요" : "장치당 부하 확인 필요";
  if (plan.rgbTotalPowerW !== undefined) return `${plan.rgbTotalPowerW.toFixed(2)}W · ${plan.rgbPowerHeadroomW === undefined ? "여유 확인 필요" : plan.rgbPowerHeadroomW >= 0 ? `${plan.rgbPowerHeadroomW.toFixed(2)}W 여유` : `${Math.abs(plan.rgbPowerHeadroomW).toFixed(2)}W 초과`}`;
  if (plan.rgbTotalCurrentA !== undefined) return `${plan.rgbTotalCurrentA.toFixed(2)}A · ${plan.rgbCurrentHeadroomA === undefined ? "여유 확인 필요" : plan.rgbCurrentHeadroomA >= 0 ? `${plan.rgbCurrentHeadroomA.toFixed(2)}A 여유` : `${Math.abs(plan.rgbCurrentHeadroomA).toFixed(2)}A 초과`}`;
  return "RGB 부하 확인 필요";
}

function accessoryRgbLoadProvenanceText(plan: AccessoryRgbConnectionPlan) {
  return plan.rgbLoadProvenance ? ` · 부하 근거 ${plan.rgbLoadProvenance.manufacturerModel}: ${plan.rgbLoadProvenance.sourceNote}` : "";
}

function accessoryRgbDeviceSummaryText(plan: AccessoryRgbConnectionPlan) {
  return plan.additionalFanDeviceCount
    ? `RGB 장치 ${plan.deviceCount}개 (케이스 ${plan.caseDeviceCount ?? 0}개 + 추가 팬 ${plan.additionalFanDeviceCount}개)`
    : `케이스 RGB ${plan.deviceCount}개`;
}

function accessoryConnectionPlanLines(compatibility: NonNullable<CompatibilityResult["accessoryCompatibility"]>) {
  const plans = compatibility.connectionPlans ?? [];
  if (plans.length === 0) return [];
  const statusLabel = (status: typeof plans[number]["status"]) => status === "pass" ? "확인됨" : status === "blocked" ? "차단" : "확인 필요";
  const fanEvidence = (plan: typeof plans[number]) => {
    const evidence = plan.fans.filter((fan) => fan.currentProvenance).map((fan) => `${fan.name}: ${fan.currentProvenance?.manufacturerModel}`);
    return evidence.length > 0 ? ` · 전류 근거 ${evidence.join(", ")}` : "";
  };
  return [
    "[주변 부품 연결 계획]",
    ...plans.flatMap((plan) => {
      const fanInputs = [...new Set(plan.fans.flatMap((fan) => fan.connectorTypes))].join(" · ");
      const current = plan.totalCurrentA !== undefined && plan.maxFanCurrentA !== undefined
        ? `${plan.totalCurrentA.toFixed(2)}A / ${plan.maxFanCurrentA.toFixed(2)}A · 여유 ${plan.currentHeadroomA?.toFixed(2) ?? "확인 필요"}A`
        : plan.maxFanCurrentA !== undefined ? `허브 최대 ${plan.maxFanCurrentA.toFixed(2)}A · 팬별 전류 확인 필요` : "전류 근거 확인 필요";
      return [
        `- ${plan.hubName}: ${statusLabel(plan.status)} · 팬 ${plan.fanCount}개 · 허브 출력 ${plan.hubFanOutputs.join(" · ") || "확인 필요"} · 팬 입력 ${fanInputs || "확인 필요"} · 포트 ${plan.portIssue === "over_limit" ? `${plan.hubFanPortCount ?? "확인 필요"}개 중 ${plan.assignedFanCount ?? "확인 필요"}개` : plan.portIssue === "unknown" ? "확인 필요" : `${plan.assignedFanCount ?? plan.fanCount}/${plan.hubFanPortCount ?? "확인 필요"}`}`,
        `  전원 ${plan.externalPower ?? "확인 필요"} · ${current} · 레일 ${accessoryPowerRailText(plan.powerRails)}${fanEvidence(plan)}`,
        `  포트 배치 ${accessoryPortPlanText(plan)}`,
        `  ${plan.summary}`
      ];
    }),
    ""
  ];
}

function accessoryRgbConnectionPlanLines(compatibility: NonNullable<CompatibilityResult["accessoryCompatibility"]>) {
  const plans = compatibility.rgbConnectionPlans ?? [];
  if (plans.length === 0) return [];
  const statusLabel = (status: typeof plans[number]["status"]) => status === "pass" ? "확인됨" : status === "blocked" ? "차단" : "확인 필요";
  return [
    "[RGB 연결 계획]",
    ...plans.map((plan) => `- ${plan.controllerName}: ${statusLabel(plan.status)} · ${accessoryRgbDeviceSummaryText(plan)} · 필요한 전압 ${plan.requiredVoltages.join(" + ") || "확인 필요"} · 컨트롤러 출력 ${plan.controllerOutputs.join(" · ")}${plan.outputCount !== undefined ? ` · ${plan.outputCount}포트` : ""} · 전원 ${plan.externalPower ?? "확인 필요"} · 레일 ${accessoryPowerRailText(plan.powerRails)} · 부하 ${accessoryRgbLoadText(plan)}${accessoryRgbLoadProvenanceText(plan)}`,),
    ...plans.map((plan) => `  ${plan.summary}`),
    ""
  ];
}

function accessoryFanHubTargetRecommendationLines(compatibility: NonNullable<CompatibilityResult["accessoryCompatibility"]>) {
  const recommendations = compatibility.fanHubTargetRecommendations ?? [];
  if (recommendations.length === 0) return [];
  const statusLabel = (status: typeof recommendations[number]["candidates"][number]["status"]) => status === "pass" ? "추천" : status === "blocked" ? "차단" : "확인 필요";
  return [
    "[팬 허브 연결 대상 추천]",
    ...recommendations.flatMap((recommendation) => [
      `- ${recommendation.fanName}: ${recommendation.summary}`,
      ...recommendation.candidates.slice(0, 3).map((candidate) => `  ${candidate.hubName}: ${statusLabel(candidate.status)} · ${candidate.reason}`)
    ]),
    ""
  ];
}

function findingLines(result: CompatibilityResult, partMap: ReadonlyMap<string, Part>) {
  const lines: string[] = [];
  for (const finding of result.findings) {
    lines.push(`### [${findingSeverityLabel(finding.severity)}] ${finding.title}`);
    lines.push(finding.message);
    if (finding.facts.length > 0) {
      lines.push("", "판정 사실:");
      for (const fact of finding.facts) lines.push(`- ${fact.label}: ${fact.actual ?? "확인 필요"}${fact.expected ? ` · 기대값 ${fact.expected}` : ""}`);
    }
    if (finding.affectedPartIds.length > 0) {
      const names = finding.affectedPartIds.map((id) => partMap.get(id)?.name ?? id).join(", ");
      lines.push(`- 영향받은 부품: ${names}`);
    }
    if (finding.suggestions && finding.suggestions.length > 0) {
      lines.push("", "대체 후보:");
      for (const suggestion of finding.suggestions) {
        lines.push(`- ${suggestion.part.name}${suggestion.recommendedQuantity ? ` · 추천 수량 ${suggestion.recommendedQuantity}개` : ""} · ${suggestion.similarityLabel} ${suggestion.similarityScore}점 · ${suggestion.performanceSummary} · ${priceText(suggestion.part.priceWon)}${suggestion.valueScore !== undefined && suggestion.valueLabel ? ` · ${suggestion.valueLabel} ${valueScoreText(suggestion.valueScore)}` : ""}`);
      }
    }
    lines.push("");
  }
  return lines;
}

function accessoryFindingLines(result: CompatibilityResult) {
  const compatibility = result.accessoryCompatibility;
  if (!compatibility) return [];
  const lines = [
    "[주변 부품 호환 점검]",
    `판정: ${compatibility.status === "compatible" ? "호환 확인" : compatibility.status === "needs_review" ? "확인 필요" : "구매 보류"}`,
    `차단: ${compatibility.blockerCount}개 · 주의: ${compatibility.warningCount}개 · 확인 필요: ${compatibility.unknownCount}개`
  ];
  lines.push(...accessoryFanHubTargetRecommendationLines(compatibility), ...accessoryConnectionPlanLines(compatibility), ...accessoryRgbConnectionPlanLines(compatibility));
  if (compatibility.findings.length === 0) {
    lines.push("선택한 주변 부품에서 확인 가능한 규격 충돌이 없습니다.", "");
    return lines;
  }
  for (const finding of compatibility.findings) {
    lines.push(`### [${accessoryFindingSeverityLabel(finding.severity)}] ${finding.title}`);
    lines.push(`${finding.accessoryName}: ${finding.message}`);
    for (const fact of finding.facts) lines.push(`- ${fact.label}: ${fact.actual ?? "확인 필요"}${fact.expected ? ` · 기대값 ${fact.expected}` : ""}`);
    if (finding.action) lines.push(`- 다음 행동: ${finding.action}`);
    lines.push("");
  }
  return lines;
}

function gpuFitStatusLabel(status: NonNullable<CompatibilityResult["gpuFit"]>["status"]) {
  return status === "compatible" ? "기준 통과" : status === "incompatible" ? "차단" : status === "needs_review" ? "확인 필요" : "미적용";
}

function gpuConnectorText(connectors: NonNullable<NonNullable<CompatibilityResult["gpuFit"]>["connector"]>["connectors"]) {
  if (!connectors) return "확인 필요";
  const entries = Object.entries(connectors).filter(([, count]) => count !== undefined).map(([kind, count]) => `${kind} ${count}개`);
  return entries.length > 0 ? entries.join(" + ") : "확인된 커넥터 없음";
}

function gpuPsuStructureText(fit: NonNullable<CompatibilityResult["gpuFit"]>) {
  const cable = fit.connector.psuCableType === "fully_modular" ? "풀모듈러" : fit.connector.psuCableType === "semi_modular" ? "세미모듈러" : fit.connector.psuCableType === "fixed" ? "케이블 일체형" : undefined;
  const rail = fit.connector.psuRailType === "single" ? "12V 싱글레일" : fit.connector.psuRailType === "multi" ? "12V 다중레일" : undefined;
  return [cable, rail].filter((value): value is string => Boolean(value)).join(" · ") || "전원 구조 확인 필요";
}

function physicalSourceLabel(category: "gpu" | "case" | "psu") {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

function physicalSourceText(fit: NonNullable<CompatibilityResult["gpuFit"]>) {
  const sources = fit.physical.evidenceSources ?? [];
  const cableSources = fit.connector.cableEvidenceSources ?? [];
  const allSources = [...sources, ...cableSources].filter((source, index, list) => list.findIndex((candidate) => candidate.category === source.category && candidate.note === source.note && candidate.url === source.url) === index);
  if (allSources.length === 0) return "등록된 출처 메모 없음 · 제조사 원문 확인 필요";
  return allSources.map((source) => `${physicalSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}: ${source.note}${safeHttpsUrl(source.url) ? ` (${safeHttpsUrl(source.url)})` : ""}`).join(" · ");
}

function gpuFitLines(result: CompatibilityResult) {
  const fit = result.gpuFit;
  if (!fit) return [];
  const purchaseEvidence = gpuPurchaseEvidenceFor(fit);
  const lines = ["[GPU 실장·전원 요약]", `종합 판정: ${gpuFitStatusLabel(fit.status)}`];
  lines.push(`- 케이스 장착 길이: ${fit.length.actualMm === undefined || fit.length.limitMm === undefined ? "확인 필요" : `${fit.length.actualMm}mm / ${fit.length.limitMm}mm · ${fit.length.clearanceMm === undefined ? "여유 확인 필요" : `${fit.length.clearanceMm}mm 여유`}`} · ${gpuFitStatusLabel(fit.length.status)}`);
  lines.push(`- GPU 두께: ${fit.thickness.actualMm === undefined ? "확인 필요" : `${fit.thickness.actualMm}mm`} · ${fit.thickness.warningThresholdMm}mm 이상은 인접 슬롯·측판 확인 · ${gpuFitStatusLabel(fit.thickness.status)}`);
  lines.push(`- PSU 전력: ${fit.power.gpuPowerW === undefined || fit.power.recommendedPsuW === undefined || fit.power.psuWattageW === undefined ? "확인 필요" : `GPU ${fit.power.gpuPowerW}W · 권장 ${fit.power.recommendedPsuW}W · 선택 ${fit.power.psuWattageW}W · 여유 ${fit.power.headroomW ?? "확인 필요"}W`} · ${gpuFitStatusLabel(fit.power.status)}`);
  if (purchaseEvidence.physical !== "not_applicable") {
    const physicalParts = [
      fit.physical.gpuSlotOccupancy === undefined ? undefined : `GPU 물리 슬롯 ${fit.physical.gpuSlotOccupancy}`,
      fit.physical.gpuCableBendClearanceMm === undefined ? undefined : `케이블 요구 ${fit.physical.gpuCableBendClearanceMm}mm`,
      fit.physical.caseSidePanelClearanceMm === undefined ? undefined : `케이스 측면 ${fit.physical.caseSidePanelClearanceMm}mm`,
      fit.physical.cableClearanceMm === undefined ? undefined : `차이 ${fit.physical.cableClearanceMm}mm`
    ].filter((value): value is string => Boolean(value));
    const physicalDetail = physicalParts.length > 0 ? physicalParts.join(" · ") : "제조사 물리 검수 근거 미등록";
    lines.push(`- GPU 물리 슬롯·케이블: ${physicalDetail} · ${gpuFitStatusLabel(purchaseEvidence.physical)}`);
  }
  const connectorPath = fit.connector.matchedOptionIndex === undefined
    ? gpuFitStatusLabel(fit.connector.status)
    : `${fit.connector.adapterOptionIndices.includes(fit.connector.matchedOptionIndex) ? "어댑터" : "원문"} 경로 ${fit.connector.matchedOptionIndex + 1} 충족`;
  lines.push(`- 보조전원: ${!fit.connector.requirementsKnown ? "GPU 요구 정보 확인 필요" : fit.connector.options.length > 0 ? fit.connector.options.map((option, index) => `${fit.connector.adapterOptionIndices.includes(index) ? "어댑터" : "원문"} 경로 ${index + 1}: ${option.map((requirement) => `${requirement.kind} ${requirement.count}개`).join(" + ")}`).join(" 또는 ") : "요구 없음"} · PSU ${gpuConnectorText(fit.connector.connectors)} · ${connectorPath} · 구조 ${gpuPsuStructureText(fit)}`);
  if (purchaseEvidence.pcieCableTopology !== "not_applicable") {
    const topologyDetail = fit.connector.psuCableTopologyStatus === "not_applicable"
      ? "다중 8핀 경로의 독립 케이블 근거 미등록"
      : `${fit.connector.psuIndependentPcieCableRuns === undefined ? "독립 런 수 확인 필요" : `독립 런 ${fit.connector.psuIndependentPcieCableRuns}개`} · ${fit.connector.psuPcieCableTopology === "shared" ? "분배·공유 케이블" : fit.connector.psuPcieCableTopology === "independent" ? "독립 케이블" : "분배 구조 확인 필요"}`;
    lines.push(`- PCIe 케이블 분배: ${topologyDetail} · ${gpuFitStatusLabel(purchaseEvidence.pcieCableTopology)}`);
  }
  if (purchaseEvidence.status !== "not_applicable") lines.push(`- 물리 근거 출처: ${physicalSourceText(fit)}`);
  lines.push("커넥터 개수만으로 독립 케이블·레일 구성이나 케이블 굽힘 반경을 추정하지 않습니다.", "");
  return lines;
}

function actionCenterStateLabel(state: ReturnType<typeof buildActionCenterFor>["state"]) {
  return state === "blocked" ? "구매 보류" : state === "review" ? "확인 후 진행" : "최종 확인";
}

function connectivityStatusLabel(status: ReturnType<typeof buildConnectivitySummaryFor>["status"]) {
  return status === "pass" ? "확인됨" : status === "review" ? "주의" : status === "unknown" ? "확인 필요" : "미적용";
}

function connectivityLines(build: BuildSelection, partMap: ReadonlyMap<string, Part>) {
  const summary = buildConnectivitySummaryFor(
    build.motherboard ? partMap.get(build.motherboard.partId)?.specs : undefined,
    build.case ? partMap.get(build.case.partId)?.specs : undefined
  );
  if (summary.status === "not_applicable") return [];
  return [
    "[팬·RGB 연결 자원]",
    `상태: ${connectivityStatusLabel(summary.status)}`,
    ...summary.items.map((item) => `- ${item.label}: ${item.detail} · ${connectivityStatusLabel(item.status)}`),
    "케이스 기본 장치 기준이며, 추가한 주변 부품·허브는 별도 주변 부품 호환 점검에서 확인합니다.",
    ""
  ];
}

function actionCenterLines(result: CompatibilityResult, build?: BuildSelection, partMap?: ReadonlyMap<string, Part>) {
  const center = buildActionCenterFor(result, build, partMap);
  return [
    "[우선 조치]",
    `상태: ${actionCenterStateLabel(center.state)} · ${center.summary}`,
    ...center.actions.map((action, index) => `${index + 1}. [${action.priority}] ${action.title}: ${action.summary}`),
    ...(center.hiddenCount > 0 ? [`그 외 우선순위가 낮은 확인 항목 ${center.hiddenCount}개는 구매 전 실행 체크리스트에서 확인할 수 있습니다.`] : []),
    ""
  ];
}

function assemblyPlanStateLabel(state: ReturnType<typeof assemblyPlanFor>["state"]) {
  return state === "blocked" ? "구매 보류" : state === "review" ? "확인 후 진행" : "순서대로 진행";
}

function assemblyPlanLines(build: BuildSelection, result: CompatibilityResult) {
  const plan = assemblyPlanFor(build, result);
  const stepStatusLabel = (status: ReturnType<typeof assemblyPlanFor>["steps"][number]["status"]) => status === "blocked" ? "구매 보류" : status === "review" ? "확인 필요" : status === "pending" ? "앞 단계 대기" : "진행 가능";
  return [
    "[구매·조립 실행 순서]",
    `상태: ${assemblyPlanStateLabel(plan.state)} · ${plan.summary}`,
    ...plan.steps.map((step) => `${step.order}. [${stepStatusLabel(step.status)}] ${step.title}: ${step.summary}`),
    ""
  ];
}

export function compatibilityReportTextFor(result: CompatibilityResult, build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>) {
  const coreTotal = result.coreTotalPriceWon ?? result.totalPriceWon - (result.accessoryTotalPriceWon ?? 0);
  const coreComplete = result.corePriceComplete ?? result.priceComplete;
  const accessoryTotal = result.accessoryTotalPriceWon ?? 0;
  const accessoryComplete = result.accessoryPriceComplete ?? true;
  const status = result.status === "compatible" ? "호환 가능" : result.status === "needs_review" ? "확인 필요" : "호환 불가";
  const lines = [
    "PC Supporter 호환성 검사 리포트",
    "===============================",
    `판정: ${status}`,
    `차단 오류: ${result.blockerCount}개 · 주의: ${result.warningCount}개 · 확인 필요: ${result.unknownCount}개`,
    `검사 시각: ${result.checkedAt}`,
    `검사 엔진: ${result.engineVersion}`,
    `카탈로그 기준: ${result.catalogSnapshotAt}`,
    "",
    "[추천 기준]",
    ...preferenceLines(result.recommendationPreferences),
    "",
    "[선택한 핵심 부품]"
  ];
  for (const category of PART_CATEGORIES) {
    const selections = category === "memory" ? build.memory : category === "ssd" ? build.ssd : category === "hdd" ? build.hdd : build[category] ? [build[category]!] : [];
    for (const selection of selections) lines.push(partLine(category, selection, partMap));
  }
  const accessories = build.accessories ?? [];
  if (accessories.length > 0) {
    lines.push("", "[선택한 주변 부품]");
    for (const selection of accessories) {
      const item = accessoryMap.get(selection.accessoryId);
      lines.push(`- ${item ? ACCESSORY_CATEGORY_LABELS[item.category] : "주변 부품"}: ${item?.name ?? selection.accessoryId}${quantityText(selection.quantity)}${selection.targetPartId ? ` · 대상 SSD ${partMap.get(selection.targetPartId)?.name ?? selection.targetPartId}` : ""}${selection.targetAccessoryId ? ` · 대상 허브 ${accessoryMap.get(selection.targetAccessoryId)?.name ?? selection.targetAccessoryId}` : ""} · ${priceText(item?.priceWon)}${sourceUrl(item?.danawaUrl) ? ` · ${sourceUrl(item?.danawaUrl)}` : ""}`);
    }
  }
  lines.push(
    "",
    "[가격 요약]",
    `- 핵심 부품: ${coreComplete ? priceText(coreTotal) : "가격 확인 필요"}`,
    `- 주변 부품: ${accessoryComplete ? priceText(accessoryTotal) : "가격 확인 필요"}`,
    `- 전체 합계: ${result.priceComplete ? priceText(result.totalPriceWon) : "가격 확인 필요"}`,
    "",
    ...gpuFitLines(result),
    ...connectivityLines(build, partMap),
    ...actionCenterLines(result, build, partMap),
    ...assemblyPlanLines(build, result),
    "[검사 결과 상세]"
  );
  lines.push(...findingLines(result, partMap));
  if (result.accessoryCompatibility) lines.push(...accessoryFindingLines(result));
  if (result.analysis.nextActions.length > 0) {
    lines.push("[다음 행동]");
    result.analysis.nextActions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
    lines.push("");
  }
  if (result.repairPlans && result.repairPlans.length > 0) {
    lines.push("[자동 해결 플랜]");
    for (const plan of result.repairPlans) lines.push(`- ${plan.label}: ${plan.title} · ${plan.resolvedBlockers}개 차단 오류 해결 · 적용 후 ${plan.priceComplete ? priceText(plan.afterTotalPriceWon) : "가격 확인 필요"}`);
    lines.push("");
  }
  lines.push(
    "[데이터 경계]",
    "이 리포트의 판정은 검사 시점의 카탈로그와 규칙 엔진을 기준으로 합니다. 실제 FPS·벤치마크 순위·BIOS 호환성·제조사 QVL·케이스 내부 간섭·케이블 배선은 제조사 원문과 실제 조립 조건을 별도로 확인해야 합니다. 확인되지 않은 가격과 스펙은 추정하지 않았습니다."
  );
  return lines.join("\n");
}

export function compatibilityReportJsonFor(result: CompatibilityResult, build: BuildSelection, preferences: RecommendationPreferences | undefined, partMap?: ReadonlyMap<string, Part>) {
  const actionCenter = buildActionCenterFor(result, build, partMap);
  const connectivity = partMap ? buildConnectivitySummaryFor(
    build.motherboard ? partMap.get(build.motherboard.partId)?.specs : undefined,
    build.case ? partMap.get(build.case.partId)?.specs : undefined
  ) : undefined;
  return JSON.stringify({
    reportVersion: 1,
    exportedAt: new Date().toISOString(),
    build,
    recommendationPreferences: preferences ?? result.recommendationPreferences ?? null,
    actionCenter,
    assemblyPlan: assemblyPlanFor(build, result),
    ...(connectivity && connectivity.status !== "not_applicable" ? { connectivity } : {}),
    result
  }, null, 2);
}
