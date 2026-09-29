import type { AccessoryConnectivityPlan, AccessoryItem, AccessoryPowerRail, AccessoryRgbConnectionPlan, BuildSelection, CompatibilityResult, Part, PartCategory, RecommendationChange, RecommendationPreferences } from "./types";
import { ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, PART_CATEGORIES, RECOMMENDATION_PRIORITY_LABELS } from "./types";
import type { FindingFilter } from "./finding-filters";
import { savedBuildCheckDiffFor, savedBuildCheckFindingDiffFor, savedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";
import type { SavedBuildCheckFindingChange } from "./saved-build-check";
import type { SavedBuildCheckSnapshot } from "./types";
import { gpuPurchaseEvidenceFor } from "./gpu-fit";
import { buildActionCenterFor } from "./build-action-center";
import { buildConnectivitySummaryFor } from "./build-connectivity";
import { assemblyPlanFor } from "./assembly-plan";
import { safeHttpsUrl } from "./safe-source-url";

export type CompatibilityReportSection = "findings" | "purchase-list" | "purchase-checklist" | "purchase-decision" | "actions";

export interface CompatibilityReportViewState {
  path: string;
  findingFilter: FindingFilter;
  section?: CompatibilityReportSection;
}

const reportFindingFilterLabels: Record<FindingFilter, string> = { all: "전체", blocker: "호환 불가", warning: "주의", unknown: "확인 필요", info: "정보" };
const reportSectionLabels: Record<CompatibilityReportSection, string> = { findings: "호환 항목 상세", "purchase-list": "구매 목록", "purchase-checklist": "구매 전 확인 목록", "purchase-decision": "구매 판단", actions: "구매 전 확인할 일" };

function viewStateLines(viewState?: CompatibilityReportViewState) {
  if (!viewState) return [];
  return [
    "[열어둔 화면]",
    `- 결과 경로: ${viewState.path}`,
    `- 상세 필터: ${reportFindingFilterLabels[viewState.findingFilter]}`,
    `- 열린 위치: ${viewState.section ? reportSectionLabels[viewState.section] : "결과 상단"}`,
    ""
  ];
}

function priceText(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${value.toLocaleString("ko-KR")}원`
    : "-";
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
  const priority = RECOMMENDATION_PRIORITY_LABELS[preferences.priority];
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

const PRIVATE_PUBLIC_EXPORT_KEY = /benchmark|cinebench|3dmark|time.?spy|port.?royal|fps|trust|score|confidence|analysisChanged|improvementPercent|performanceSummary|gamingPerformanceAssessment|^weight$/i;
const PRIVATE_PUBLIC_EXPORT_TEXT = /cinebench|time\s*spy|port\s*royal|3dmark|benchmark|벤치마크|recommendation.?trust|trust\s*score|추천\s*신뢰|신뢰도|(?:카탈로그|성능)\s*분석(?:\s*점수)?\s*[:：]?\s*\d+|\bfps\b|초당\s*프레임/i;

function publicReportValue(value: unknown, parentKey = ""): unknown {
  if (PRIVATE_PUBLIC_EXPORT_KEY.test(parentKey)) return undefined;
  if (typeof value === "string") return PRIVATE_PUBLIC_EXPORT_TEXT.test(value) ? undefined : value;
  if (Array.isArray(value)) return value.map((item) => publicReportValue(item, parentKey)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (parentKey === "analysis") return { nextActions: publicReportValue(record.nextActions ?? [], "nextActions") };
    if (parentKey === "dimensions" && typeof record.key === "string" && /cinebench|time\s*spy|port\s*royal|3dmark/i.test(record.key)) return undefined;
    const publicEntries: Array<[string, unknown]> = [];
    for (const [key, entry] of Object.entries(record)) {
      if (PRIVATE_PUBLIC_EXPORT_KEY.test(key)) continue;
      const safeValue = publicReportValue(entry, key);
      if (safeValue !== undefined) publicEntries.push([key, safeValue]);
    }
    return Object.fromEntries(publicEntries);
  }
  return value;
}

function findingSeverityLabel(severity: CompatibilityResult["findings"][number]["severity"]) {
  return severity === "blocker" ? "호환 불가" : severity === "warning" ? "주의" : severity === "unknown" ? "확인 필요" : "정보";
}

function candidateRiskLabel(risk: NonNullable<NonNullable<CompatibilityResult["findings"][number]["suggestions"]>[number]["candidateRisk"]>) {
  return risk === "safe" ? "호환 가능" : risk === "unsafe" ? "호환 불가" : "확인 필요";
}

function accessoryFindingSeverityLabel(severity: NonNullable<CompatibilityResult["accessoryCompatibility"]>["findings"][number]["severity"]) {
  return severity === "blocker" ? "호환 불가" : severity === "warning" ? "주의" : "확인 필요";
}

function accessoryPowerRailText(powerRails?: AccessoryPowerRail[]) {
  if (!powerRails || powerRails.length === 0) return "전원 레일 정보 확인 필요";
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
  return plan.rgbLoadProvenance ? ` · 부하 정보 ${plan.rgbLoadProvenance.manufacturerModel}: ${plan.rgbLoadProvenance.sourceNote}` : "";
}

function accessoryRgbDeviceSummaryText(plan: AccessoryRgbConnectionPlan) {
  return plan.additionalFanDeviceCount
    ? `RGB 장치 ${plan.deviceCount}개 (케이스 ${plan.caseDeviceCount ?? 0}개 + 추가 팬 ${plan.additionalFanDeviceCount}개)`
    : `케이스 RGB ${plan.deviceCount}개`;
}

function accessoryConnectionPlanLines(compatibility: NonNullable<CompatibilityResult["accessoryCompatibility"]>) {
  const plans = compatibility.connectionPlans ?? [];
  if (plans.length === 0) return [];
  const statusLabel = (status: typeof plans[number]["status"]) => status === "pass" ? "연결 가능" : status === "blocked" ? "연결 불가" : "확인 필요";
  const fanEvidence = (plan: typeof plans[number]) => {
    const evidence = plan.fans.filter((fan) => fan.currentProvenance).map((fan) => `${fan.name}: ${fan.currentProvenance?.manufacturerModel}`);
    return evidence.length > 0 ? ` · 전류 정보 ${evidence.join(", ")}` : "";
  };
  return [
    "[주변 부품 연결 구성]",
    ...plans.flatMap((plan) => {
      const fanInputs = [...new Set(plan.fans.flatMap((fan) => fan.connectorTypes))].join(" · ");
      const current = plan.totalCurrentA !== undefined && plan.maxFanCurrentA !== undefined
        ? `${plan.totalCurrentA.toFixed(2)}A / ${plan.maxFanCurrentA.toFixed(2)}A · 여유 ${plan.currentHeadroomA?.toFixed(2) ?? "확인 필요"}A`
        : plan.maxFanCurrentA !== undefined ? `허브 최대 ${plan.maxFanCurrentA.toFixed(2)}A · 팬별 전류 확인 필요` : "전류 정보 확인 필요";
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
  const statusLabel = (status: typeof plans[number]["status"]) => status === "pass" ? "연결 가능" : status === "blocked" ? "연결 불가" : "확인 필요";
  return [
    "[RGB 연결 구성]",
    ...plans.map((plan) => `- ${plan.controllerName}: ${statusLabel(plan.status)} · ${accessoryRgbDeviceSummaryText(plan)} · 필요한 전압 ${plan.requiredVoltages.join(" + ") || "확인 필요"} · 컨트롤러 출력 ${plan.controllerOutputs.join(" · ")}${plan.outputCount !== undefined ? ` · ${plan.outputCount}포트` : ""} · 전원 ${plan.externalPower ?? "확인 필요"} · 레일 ${accessoryPowerRailText(plan.powerRails)} · 부하 ${accessoryRgbLoadText(plan)}${accessoryRgbLoadProvenanceText(plan)}`,),
    ...plans.map((plan) => `  ${plan.summary}`),
    ""
  ];
}

function accessoryFanHubTargetRecommendationLines(compatibility: NonNullable<CompatibilityResult["accessoryCompatibility"]>) {
  const recommendations = compatibility.fanHubTargetRecommendations ?? [];
  if (recommendations.length === 0) return [];
  const statusLabel = (status: typeof recommendations[number]["candidates"][number]["status"]) => status === "pass" ? "추천" : status === "blocked" ? "연결 불가" : "확인 필요";
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
      lines.push("", "확인된 내용:");
      for (const fact of finding.facts) lines.push(`- ${fact.label}: ${fact.actual ?? "확인 필요"}${fact.expected ? ` · 기대값 ${fact.expected}` : ""}`);
    }
    if (finding.affectedPartIds.length > 0) {
      const names = finding.affectedPartIds.map((id) => partMap.get(id)?.name ?? id).join(", ");
      lines.push(`- 영향받은 부품: ${names}`);
    }
    if (finding.suggestions && finding.suggestions.length > 0) {
      lines.push("", "대체 부품:");
      for (const suggestion of finding.suggestions) {
        const candidateStatus = suggestion.candidateRisk ? candidateRiskLabel(suggestion.candidateRisk) : suggestion.fixesCurrentIssue ? "현재 항목 해결 부품" : "현재 항목 미해결";
        const candidateRiskCounts = suggestion.candidateBlockerCount !== undefined || suggestion.candidateWarningCount !== undefined || suggestion.candidateUnknownCount !== undefined
          ? ` · 부품 호환 불가 ${suggestion.candidateBlockerCount ?? "확인 필요"}개/주의 ${suggestion.candidateWarningCount ?? "확인 필요"}개/확인 필요 ${suggestion.candidateUnknownCount ?? "확인 필요"}개`
          : "";
        const remainingRisk = ` · 대체 부품 적용 후 호환 불가 ${suggestion.remainingBlockers}개/주의 ${suggestion.remainingWarnings}개/확인 필요 ${suggestion.remainingUnknown}개`;
        const physical = suggestion.physicalEvidence ? ` · 설치 공간 ${suggestion.physicalEvidence.status === "verified" ? "확인됨" : suggestion.physicalEvidence.status === "review" ? "확인 필요" : "해당 없음"}` : "";
        const performanceSummary = PRIVATE_PUBLIC_EXPORT_TEXT.test(suggestion.performanceSummary) ? undefined : suggestion.performanceSummary;
        lines.push(`- ${suggestion.part.name}${suggestion.recommendedQuantity ? ` · 추천 수량 ${suggestion.recommendedQuantity}개` : ""} · ${candidateStatus}${candidateRiskCounts}${remainingRisk}${performanceSummary ? ` · ${performanceSummary}` : ""} · ${priceText(suggestion.part.priceWon)}${physical}`);
        if (suggestion.gpuTarget) lines.push(`  게임 성능 기준: ${suggestion.gpuTarget.summary}`);
        if (suggestion.candidateReasons && suggestion.candidateReasons.length > 0) lines.push(`  추천 이유: ${suggestion.candidateReasons.slice(0, 3).join(" · ")}`);
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
    "[주변 부품 호환 결과]",
    `결과: ${compatibility.status === "compatible" ? "호환 확인" : compatibility.status === "needs_review" ? "확인 필요" : "구매 보류"}`,
    `호환 불가: ${compatibility.blockerCount}개 · 주의: ${compatibility.warningCount}개 · 확인 필요: ${compatibility.unknownCount}개`
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
    if (finding.action) lines.push(`- 권장 조치: ${finding.action}`);
    lines.push("");
  }
  return lines;
}

function gpuFitStatusLabel(status: NonNullable<CompatibilityResult["gpuFit"]>["status"]) {
  return status === "compatible" ? "문제 없음" : status === "incompatible" ? "맞지 않는 항목 있음" : status === "needs_review" ? "확인 필요" : "미적용";
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
  if (allSources.length === 0) return "설치 안내가 없습니다. 각 부품의 제조사 설명서에서 크기와 연결 방법을 확인해 주세요.";
  return allSources.map((source) => `${physicalSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}: ${source.note}${safeHttpsUrl(source.url) ? ` (${safeHttpsUrl(source.url)})` : ""}`).join(" · ");
}

function gpuFitLines(result: CompatibilityResult) {
  const fit = result.gpuFit;
  if (!fit) return [];
  const purchaseEvidence = gpuPurchaseEvidenceFor(fit);
  const lines = ["[GPU 설치 공간·전원]", `호환 결과: ${gpuFitStatusLabel(fit.status)}`];
  lines.push(`- GPU 길이·케이스 공간: ${fit.length.actualMm === undefined || fit.length.limitMm === undefined ? "확인 필요" : `${fit.length.actualMm}mm / ${fit.length.limitMm}mm · ${fit.length.clearanceMm === undefined ? "여유 확인 필요" : `${fit.length.clearanceMm}mm 여유`}`} · ${gpuFitStatusLabel(fit.length.status)}`);
  lines.push(`- GPU 두께: ${fit.thickness.actualMm === undefined ? "확인 필요" : `${fit.thickness.actualMm}mm`} · ${fit.thickness.warningThresholdMm}mm 이상은 인접 슬롯·측판 확인 · ${gpuFitStatusLabel(fit.thickness.status)}`);
  lines.push(`- PSU 전력: ${fit.power.gpuPowerW === undefined || fit.power.recommendedPsuW === undefined || fit.power.psuWattageW === undefined ? "확인 필요" : `GPU ${fit.power.gpuPowerW}W · 권장 ${fit.power.recommendedPsuW}W · 선택 ${fit.power.psuWattageW}W · 여유 ${fit.power.headroomW ?? "확인 필요"}W`} · ${gpuFitStatusLabel(fit.power.status)}`);
  if (purchaseEvidence.physical !== "not_applicable") {
    const physicalParts = [
      fit.physical.gpuSlotOccupancy === undefined ? undefined : `GPU 물리 슬롯 ${fit.physical.gpuSlotOccupancy}`,
      fit.physical.gpuCableBendClearanceMm === undefined ? undefined : `케이블 요구 ${fit.physical.gpuCableBendClearanceMm}mm`,
      fit.physical.caseSidePanelClearanceMm === undefined ? undefined : `케이스 측면 ${fit.physical.caseSidePanelClearanceMm}mm`,
      fit.physical.cableClearanceMm === undefined ? undefined : `차이 ${fit.physical.cableClearanceMm}mm`
    ].filter((value): value is string => Boolean(value));
    const physicalDetail = physicalParts.length > 0 ? physicalParts.join(" · ") : "제조사 물리 정보 없음";
    lines.push(`- GPU 슬롯·전원 케이블: ${physicalDetail} · ${gpuFitStatusLabel(purchaseEvidence.physical)}`);
  }
  const connectorPath = fit.connector.matchedOptionIndex === undefined
    ? gpuFitStatusLabel(fit.connector.status)
    : `${fit.connector.adapterOptionIndices.includes(fit.connector.matchedOptionIndex) ? "어댑터" : "페이지"} 경로 ${fit.connector.matchedOptionIndex + 1} 충족`;
  lines.push(`- 보조전원: ${!fit.connector.requirementsKnown ? "GPU 요구 정보 확인 필요" : fit.connector.options.length > 0 ? fit.connector.options.map((option, index) => `${fit.connector.adapterOptionIndices.includes(index) ? "어댑터" : "페이지"} 경로 ${index + 1}: ${option.map((requirement) => `${requirement.kind} ${requirement.count}개`).join(" + ")}`).join(" 또는 ") : "요구 없음"} · PSU ${gpuConnectorText(fit.connector.connectors)} · ${connectorPath} · 구조 ${gpuPsuStructureText(fit)}`);
  if (purchaseEvidence.pcieCableTopology !== "not_applicable") {
    const topologyDetail = fit.connector.psuCableTopologyStatus === "not_applicable"
      ? "다중 8핀 경로의 독립 케이블 정보 미등록"
      : `${fit.connector.psuIndependentPcieCableRuns === undefined ? "독립 런 수 확인 필요" : `독립 런 ${fit.connector.psuIndependentPcieCableRuns}개`} · ${fit.connector.psuPcieCableTopology === "shared" ? "분배·공유 케이블" : fit.connector.psuPcieCableTopology === "independent" ? "독립 케이블" : "분배 구조 확인 필요"}`;
    lines.push(`- PCIe 케이블 분배: ${topologyDetail} · ${gpuFitStatusLabel(purchaseEvidence.pcieCableTopology)}`);
  }
  if (purchaseEvidence.status !== "not_applicable") lines.push(`- 설치 안내: ${physicalSourceText(fit)}`);
  lines.push("커넥터 개수만으로 독립 케이블·레일 구성이나 케이블 굽힘 반경을 추정하지 않습니다.", "");
  return lines;
}

function actionCenterStateLabel(state: ReturnType<typeof buildActionCenterFor>["state"]) {
  return state === "blocked" ? "구매 보류" : state === "review" ? "확인 필요" : "진행 가능";
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
    "여기에는 케이스에 기본으로 달린 팬과 RGB 장치만 표시합니다. 추가한 주변 부품과 허브는 아래에서 따로 확인하세요.",
    ""
  ];
}

function actionCenterLines(result: CompatibilityResult, build?: BuildSelection, partMap?: ReadonlyMap<string, Part>) {
  const center = buildActionCenterFor(result, build, partMap);
  return [
    "[구매 전 확인할 일]",
    `상태: ${actionCenterStateLabel(center.state)} · ${center.summary}`,
    ...center.actions.map((action, index) => `${index + 1}. [${action.priority}] ${action.title}: ${action.summary}`),
    ...(center.hiddenCount > 0 ? [`그 외 확인 항목 ${center.hiddenCount}개는 구매 전 확인 목록에서 볼 수 있습니다.`] : []),
    ""
  ];
}

function repairPlanPriceText(priceDeltaWon: number | undefined, priceComplete: boolean) {
  if (!priceComplete || priceDeltaWon === undefined) return "-";
  if (priceDeltaWon === 0) return "변화 없음";
  return `${priceDeltaWon > 0 ? "+" : ""}${priceDeltaWon.toLocaleString("ko-KR")}원`;
}

function repairPlanChangeLine(change: RecommendationChange) {
  const from = change.kind === "change_quantity"
    ? `${change.fromQuantity ?? "?"}개`
    : change.fromPartName ?? `${CATEGORY_LABELS[change.category]} 미선택`;
  const to = change.kind === "change_quantity"
    ? `${change.toQuantity ?? "?"}개`
    : change.toPart.name;
  const performanceSummary = PRIVATE_PUBLIC_EXPORT_TEXT.test(change.performanceSummary) ? undefined : change.performanceSummary;
  return `- ${CATEGORY_LABELS[change.category]}: ${from} → ${to} · 가격 ${repairPlanPriceText(change.priceDeltaWon, change.priceDeltaWon !== undefined)}${performanceSummary ? ` · ${performanceSummary}` : ""}`;
}

function repairPlanLines(result: CompatibilityResult) {
  const plans = result.repairPlans ?? [];
  if (plans.length === 0) return [];
  const lines = ["[호환 문제 해결 방법]"];
  for (const plan of plans) {
    lines.push(
      `### [${plan.label}] ${plan.title}`,
      `- 해결 범위: ${plan.resolvedFindings}개 항목 · 호환 불가 ${plan.resolvedBlockers}개 · 확인 필요 ${plan.resolvedUnknown}개`,
      `- 대체 부품 적용 후: 호환 불가 ${plan.remainingBlockers}개 · 주의 ${plan.remainingWarnings}개 · 확인 필요 ${plan.remainingUnknown}개`,
      `- 가격 변화: ${repairPlanPriceText(plan.priceDeltaWon, plan.priceComplete)} · 적용 후 ${plan.priceComplete ? priceText(plan.afterTotalPriceWon) : "-"}`,
      `- 비교 정보: ${plan.similarityLabel} · ${plan.profileSummary}`,
      `- 추천 이유: ${plan.reason}`
    );
    if (plan.budgetWon !== undefined) {
      const budgetState = !plan.priceComplete
        ? "예산 적합 여부 확인 필요"
        : plan.withinBudget
          ? `예산 내 · ${priceText(plan.budgetWon)} 기준 ${priceText(Math.abs(plan.budgetDeltaWon ?? 0))} 여유`
          : `예산 초과 · ${priceText(Math.abs(plan.budgetDeltaWon ?? 0))}`;
      lines.push(`- 목표 예산: ${budgetState}`);
    }
    if (plan.resolvedFindingTitles.length > 0) lines.push(`- 해결 범위 상세: ${plan.resolvedFindingTitles.join(" · ")}`);
    if (plan.remainingFindingTitles && plan.remainingFindingTitles.length > 0) lines.push(`- 적용 후 남는 항목: ${plan.remainingFindingTitles.join(" · ")}`);
    if (plan.remainingFindingRuleIds && plan.remainingFindingRuleIds.length > 0) lines.push(`- 잔여 규칙 ID: ${plan.remainingFindingRuleIds.join(" · ")}`);
    if (plan.changes.length > 0) {
      lines.push("변경 부품:", ...plan.changes.map(repairPlanChangeLine));
    } else {
      lines.push("변경 부품: 없음");
    }
    lines.push("");
  }
  return lines;
}

function savedCheckStatusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function savedCheckDirectionLabel(direction: ReturnType<typeof savedBuildCheckTransitionSummaryFor>["direction"]) {
  return direction === "improved" ? "개선" : direction === "regressed" ? "악화" : direction === "changed" ? "일부 변화" : "변화 없음";
}

function savedCheckFindingChangeLabel(change: SavedBuildCheckFindingChange) {
  return change === "resolved" ? "해결됨" : change === "new" ? "신규" : change === "severity_changed" ? "중요도 변경" : "내용 변경";
}

function savedCheckResourceText(snapshot: SavedBuildCheckSnapshot) {
  const resource = snapshot.resourceBudget;
  if (!resource) return "미적용";
  const headroomText = (value: number | undefined) => value === undefined ? "확인 필요" : value >= 0 ? `${value}W 여유` : `${Math.abs(value)}W 부족`;
  return `전력 ${headroomText(resource.powerHeadroomW)} · 냉각 ${headroomText(resource.coolerHeadroomW)}`;
}

function savedBuildRecheckLines(snapshot: SavedBuildCheckSnapshot, result: CompatibilityResult) {
  const currentSnapshot = savedBuildCheckSnapshotFor(result);
  const diff = savedBuildCheckDiffFor(snapshot, result);
  const transition = savedBuildCheckTransitionSummaryFor(snapshot, currentSnapshot);
  const findingDiff = savedBuildCheckFindingDiffFor(snapshot, currentSnapshot);
  const lines = [
    "[저장 당시 결과와 현재 결과 비교]",
    `- 결과: ${savedCheckStatusLabel(snapshot.status)} → ${savedCheckStatusLabel(result.status)}`,
    `- 호환 항목: 호환 불가 ${snapshot.blockerCount} → ${result.blockerCount} · 주의 ${snapshot.warningCount} → ${result.warningCount} · 확인 필요 ${snapshot.unknownCount} → ${result.unknownCount}`,
    `- 가격: ${snapshot.priceComplete && result.priceComplete ? `${priceText(snapshot.totalPriceWon)} → ${priceText(result.totalPriceWon)} · 변화 ${repairPlanPriceText(transition.priceDeltaWon, true)}` : "저장 당시 또는 현재 가격: -"}`,
    `- 전력·냉각 여유: ${savedCheckResourceText(snapshot)} → ${savedCheckResourceText(currentSnapshot)}${transition.resourceBudgetChanged ? ` · 전력 ${transition.powerHeadroomDeltaW === undefined ? "상태 변화" : `${transition.powerHeadroomDeltaW > 0 ? "+" : ""}${transition.powerHeadroomDeltaW}W`} · 냉각 ${transition.coolerHeadroomDeltaW === undefined ? "상태 변화" : `${transition.coolerHeadroomDeltaW > 0 ? "+" : ""}${transition.coolerHeadroomDeltaW}W`}` : ""}`,
    `- 계산 버전: ${snapshot.engineVersion} → ${result.engineVersion} · 부품 정보 기준일 ${snapshot.catalogSnapshotAt} → ${result.catalogSnapshotAt}`,
    `- 변화 방향: ${savedCheckDirectionLabel(transition.direction)}`,
    `- 주요 변경: 결과 ${diff.statusChanged ? "변경" : "동일"} · 호환 항목 ${diff.riskChanged ? "변경" : "동일"} · 가격 ${diff.priceChanged || diff.priceCompletenessChanged ? "변경" : "동일"} · 전력·냉각 ${diff.resourceBudgetChanged ? "변경" : "동일"} · 계산·부품 정보 ${diff.engineChanged || diff.catalogChanged ? "변경" : "동일"}`
  ];
  if (!findingDiff.available) {
    lines.push("- 항목 상세: 구버전 저장본이라 규칙별 비교 불가", "");
    return lines;
  }
  const changedFindings = findingDiff.changes.filter((change) => change.change !== "unchanged");
  lines.push(`- 항목 변화: 해결 ${transition.resolvedFindingCount}개 · 신규 ${transition.newFindingCount}개 · 중요도 변경 ${transition.severityChangedFindingCount}개 · 내용 변경 ${transition.detailsChangedFindingCount}개`);
  if (changedFindings.length === 0) {
    lines.push("- 변경된 항목: 없음", "");
    return lines;
  }
  lines.push("변경된 항목:");
  for (const change of changedFindings.slice(0, 8)) {
    const beforeTitle = change.before?.title;
    const afterTitle = change.after?.title;
    const title = afterTitle ?? beforeTitle ?? change.key;
    const detail = beforeTitle && afterTitle && beforeTitle !== afterTitle ? ` · ${beforeTitle} → ${afterTitle}` : "";
    lines.push(`- [${savedCheckFindingChangeLabel(change.change)}] ${title}${detail} · 규칙 ${change.key}`);
  }
  if (changedFindings.length > 8) lines.push(`- 그 외 변경된 항목 ${changedFindings.length - 8}개`);
  lines.push("");
  return lines;
}

function assemblyPlanStateLabel(state: ReturnType<typeof assemblyPlanFor>["state"]) {
  return state === "blocked" ? "구매 보류" : state === "review" ? "확인 필요" : "진행 가능";
}

function assemblyPlanLines(build: BuildSelection, result: CompatibilityResult) {
  const plan = assemblyPlanFor(build, result);
  const stepStatusLabel = (status: ReturnType<typeof assemblyPlanFor>["steps"][number]["status"]) => status === "blocked" ? "구매 보류" : status === "review" ? "확인 필요" : status === "pending" ? "앞 단계 대기" : "진행 가능";
  return [
    "[구매·조립 순서]",
    `상태: ${assemblyPlanStateLabel(plan.state)} · ${plan.summary}`,
    ...plan.steps.map((step) => `${step.order}. [${stepStatusLabel(step.status)}] ${step.title}: ${step.summary}`),
    ""
  ];
}

export function compatibilityReportTextFor(inputResult: CompatibilityResult, build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>, viewState?: CompatibilityReportViewState, savedCheckSnapshot?: SavedBuildCheckSnapshot) {
  const result = publicReportValue(inputResult) as CompatibilityResult;
  const publicSavedCheckSnapshot = savedCheckSnapshot ? publicReportValue(savedCheckSnapshot) as SavedBuildCheckSnapshot : undefined;
  const coreTotal = result.coreTotalPriceWon ?? result.totalPriceWon - (result.accessoryTotalPriceWon ?? 0);
  const coreComplete = result.corePriceComplete ?? result.priceComplete;
  const accessoryTotal = result.accessoryTotalPriceWon ?? 0;
  const accessoryComplete = result.accessoryPriceComplete ?? true;
  const status = result.status === "compatible" ? "호환 가능" : result.status === "needs_review" ? "확인 필요" : "호환 불가";
  const lines = [
    "PC Supporter 호환 결과",
    "===============================",
    `결과: ${status}`,
    `호환 불가: ${result.blockerCount}개 · 주의: ${result.warningCount}개 · 확인 필요: ${result.unknownCount}개`,
    `확인 시각: ${result.checkedAt}`,
    `계산 버전: ${result.engineVersion}`,
    `부품 정보 기준일: ${result.catalogSnapshotAt}`,
    ...viewStateLines(viewState),
    ...(publicSavedCheckSnapshot ? savedBuildRecheckLines(publicSavedCheckSnapshot, result) : []),
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
    `- 핵심 부품: ${coreComplete ? priceText(coreTotal) : "-"}`,
    `- 주변 부품: ${accessoryComplete ? priceText(accessoryTotal) : "-"}`,
    `- 전체 합계: ${result.priceComplete ? priceText(result.totalPriceWon) : "-"}`,
    "",
    ...gpuFitLines(result),
    ...connectivityLines(build, partMap),
    ...actionCenterLines(result, build, partMap),
    ...assemblyPlanLines(build, result),
    "[호환 항목 상세]"
  );
  lines.push(...findingLines(result, partMap));
  if (result.accessoryCompatibility) lines.push(...accessoryFindingLines(result));
  const nextActions = result.analysis?.nextActions ?? [];
  if (nextActions.length > 0) {
    lines.push("[구매 전 확인]");
    nextActions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
    lines.push("");
  }
  lines.push(...repairPlanLines(result));
  lines.push(
    "[참고]",
    "실제 게임 성능은 게임과 설정에 따라 달라질 수 있습니다. 구매 전 메인보드 RAM 지원, 케이스 공간, 케이블 연결을 제품 안내에서 확인하세요. 가격을 확인하지 못한 부품은 따로 표시했습니다."
  );
  return lines.join("\n");
}

export function compatibilityReportJsonFor(result: CompatibilityResult, build: BuildSelection, preferences: RecommendationPreferences | undefined, partMap?: ReadonlyMap<string, Part>, viewState?: CompatibilityReportViewState, savedCheckSnapshot?: SavedBuildCheckSnapshot) {
  const actionCenter = buildActionCenterFor(result, build, partMap);
  const connectivity = partMap ? buildConnectivitySummaryFor(
    build.motherboard ? partMap.get(build.motherboard.partId)?.specs : undefined,
    build.case ? partMap.get(build.case.partId)?.specs : undefined
  ) : undefined;
  return JSON.stringify({
    reportVersion: 1,
    exportedAt: new Date().toISOString(),
    ...(viewState ? { viewState } : {}),
    build,
    recommendationPreferences: preferences ?? result.recommendationPreferences ?? null,
    actionCenter: publicReportValue(actionCenter),
    assemblyPlan: publicReportValue(assemblyPlanFor(build, result)),
    ...(connectivity && connectivity.status !== "not_applicable" ? { connectivity: publicReportValue(connectivity) } : {}),
    ...(savedCheckSnapshot ? {
      savedCheckSnapshot: publicReportValue(savedCheckSnapshot),
      savedCheckDiff: publicReportValue(savedBuildCheckDiffFor(savedCheckSnapshot, result)),
      savedCheckTransition: publicReportValue(savedBuildCheckTransitionSummaryFor(savedCheckSnapshot, savedBuildCheckSnapshotFor(result)))
    } : {}),
    result: publicReportValue(result)
  }, null, 2);
}
