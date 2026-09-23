// Extracted from App.tsx to keep the entry chunk lean. Loaded lazily.
import { buildBenchmarkDecisionImpactText, buildBenchmarkImpactStatusText, buildBenchmarkSnapshotStatusText } from "../shared/build-benchmark-snapshot";
import { type CatalogChangeImpact, catalogChangeImpactsFor } from "../shared/catalog-change-impact";
import { catalogRefreshFindingImpactsFor } from "../shared/catalog-refresh-impact";
import type { CatalogRefreshReport } from "../shared/catalog-refresh-report";
import { catalogChangeFieldLabelFor } from "../shared/catalog-spec-coverage";
import { purchaseListRowKeysFor } from "../shared/purchase-list-progress";
import { savedBuildCatalogChangeValueDiffsFor } from "../shared/saved-build-change-causes";
import { type SavedBuildCheckFindingDiff, type SavedBuildCheckTransitionSummary, savedBuildCheckDiffFor, savedBuildCheckFindingDiffFor, savedBuildCheckSnapshotDiffFor, savedBuildCheckTransitionSummaryFor } from "../shared/saved-build-check";
import type { SavedBuildMonitorItem } from "../shared/saved-build-monitor";
import { type AccessoryCategory, type AccessoryItem, type CatalogChangeValueDiff, type CatalogChangeRecord, type Part, type PartCategory, type SavedBuild, type SavedBuildCheckFindingSummary, type SavedBuildCheckSnapshot, ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, DATA_QUALITY_LABELS, isCatalogDataQualityChangeField, isKnownPrice, LISTING_POLICY_LABELS, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import type { SavedBuildLiveCheck } from "./SavedBuildComparisonDecision";
import { api } from "./api";
import { safeExternalUrl } from "./safe-source-url";
import { Fragment, useEffect, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiExternalLink, FiInfo, FiLoader, FiRefreshCw, FiZap } from "react-icons/fi";
import { formatPriceDelta, formatRadiatorPosition, formatRadiatorSupports, formatSpecValue, formatWon } from "./app-format";
import { accessorySelections, purchaseListRowsFor, selectionList } from "./build-edit";

export type SavedBuildCatalogCauseState = {
  key: string;
  status: "idle" | "loading" | "ready" | "error";
  items: CatalogChangeRecord[];
  message?: string;
};

export function myPcAssetReportFor(saved: SavedBuild, monitorItem: SavedBuildMonitorItem | undefined, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>) {
  const live = monitorItem?.status === "ready" ? monitorItem.snapshot : undefined;
  const current = live ?? saved.checkSnapshot;
  const currentPrice = current && current.priceComplete && isKnownPrice(current.totalPriceWon) ? current.totalPriceWon : undefined;
  const checkedAt = live?.checkedAt ?? saved.checkSnapshot?.checkedAt;
  const history = saved.purchasePriceHistory?.priceHistory;
  // priceHistory의 rowKey는 part:{category}:{partId} 같은 행 id — 현재 selection으로
  // 행을 다시 만들어 교체·삭제된 부품의 stale 행을 빼고 수량을 곱해 구매가를 구한다.
  let paidTotal: number | undefined;
  if (history) {
    const rows = purchaseListRowsFor(saved.selection, partMap, accessoryMap);
    const rowKeys = purchaseListRowKeysFor(rows);
    let total = 0;
    let matchedRows = 0;
    rows.forEach((row, index) => {
      const observations = history[rowKeys[index]!];
      const latest = observations?.[observations.length - 1];
      if (!latest || !isKnownPrice(latest.unitPriceWon)) return;
      total += latest.unitPriceWon * row.quantity;
      matchedRows += 1;
    });
    paidTotal = matchedRows > 0 ? total : undefined;
  }
  return { currentPrice, checkedAt, paidTotal };
}

export function savedCoreLineText(saved: SavedBuild, category: PartCategory) {
  const summaryLines = saved.summary?.coreLines.filter((line) => line.category === category) ?? [];
  if (summaryLines.length > 0) return summaryLines.map((line) => `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`).join(", ");
  const selections = selectionList(saved.selection, category);
  return selections.length > 0 ? selections.map((selection) => `${selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ") : "미선택";
}

export function savedAccessoryLineText(saved: SavedBuild) {
  const summaryLines = saved.summary?.accessoryLines ?? [];
  if (summaryLines.length > 0) return summaryLines.map((line) => `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`).join(", ");
  const selections = accessorySelections(saved.selection);
  return selections.length > 0 ? selections.map((selection) => `${selection.accessoryId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ") : "미선택";
}

export function savedPreferenceText(saved: SavedBuild) {
  const preferences = saved.recommendationPreferences;
  if (!preferences) return "기본 기준";
  return `${RECOMMENDATION_PROFILE_LABELS[preferences.profile]} · ${RECOMMENDATION_PRIORITY_LABELS[preferences.priority]} · ${LISTING_POLICY_LABELS[preferences.listingPolicy ?? "retail_only"]}`;
}

export function savedCheckStatusText(status: NonNullable<SavedBuild["checkSnapshot"]>["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

export function savedCheckRiskText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const accessory = snapshot.accessoryCompatibility;
  const base = `${snapshot.blockerCount} 차단 · ${snapshot.warningCount} 주의 · ${snapshot.unknownCount} 확인 필요`;
  const withAccessory = !accessory || (accessory.blockerCount === 0 && accessory.warningCount === 0 && accessory.unknownCount === 0)
    ? base
    : `${base} · 주변 ${accessory.blockerCount} 차단 · ${accessory.warningCount} 주의 · ${accessory.unknownCount} 확인 필요`;
  const resourceState = snapshot.resourceBudget?.state;
  if (resourceState === "danger") return `${withAccessory} · 전력·냉각 기준 미달`;
  if (resourceState === "warning") return `${withAccessory} · 전력·냉각 여유 좁음`;
  if (resourceState === "unknown") return `${withAccessory} · 전력·냉각 확인 필요`;
  return withAccessory;
}

export function savedCheckAnalysisText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  return snapshot.analysisScore === undefined ? snapshot.analysisScoreLabel : `${snapshot.analysisScore}점 · ${snapshot.analysisScoreLabel}`;
}

export function savedCheckPriceText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  return snapshot.priceComplete && isKnownPrice(snapshot.totalPriceWon) ? formatWon(snapshot.totalPriceWon) : "가격 확인 필요";
}

export function savedCheckCatalogRefreshSummary(report: CatalogRefreshReport) {
  const status = report.status === "success" ? "정보 확인 완료" : report.status === "partial" ? "일부 정보 확인" : "정보 확인 실패";
  return `${status} · 성공 ${report.successCount}개 · 실패 ${report.failureCount}개`;
}

export function savedCheckCatalogRefreshPriceText(item: CatalogRefreshReport["items"][number]) {
  const beforeKnown = isKnownPrice(item.previousPriceWon);
  const afterKnown = isKnownPrice(item.nextPriceWon);
  if (!beforeKnown && !afterKnown) return "가격 확인 필요";
  if (!beforeKnown) return `확인 필요 → ${formatWon(item.nextPriceWon!)}`;
  if (!afterKnown) return `${formatWon(item.previousPriceWon!)} → 확인 필요`;
  if (item.previousPriceWon === item.nextPriceWon) return `${formatWon(item.nextPriceWon!)} · 변화 없음`;
  const delta = item.nextPriceWon! - item.previousPriceWon!;
  return `${formatWon(item.previousPriceWon!)} → ${formatWon(item.nextPriceWon!)} · ${delta > 0 ? "+" : ""}${formatWon(delta)}`;
}

export function SavedBuildCheckRefreshEvidence({ report }: { report: CatalogRefreshReport }) {
  return <details className={`history-check-refresh-report ${report.status}`} data-testid="saved-build-check-refresh-report"><summary><FiRefreshCw /> 정보 다시 확인 내용 · {savedCheckCatalogRefreshSummary(report)}</summary><div className="history-check-refresh-report-body">{report.items.slice(0, 6).map((item) => <article key={`${item.target.kind}-${item.target.id}`}><div><strong>{item.name}</strong><small>{item.target.kind === "part" ? "핵심 부품" : "주변 부품"} · {new Date(item.refreshedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small></div><div className="history-check-refresh-report-facts"><span><b>가격</b>{savedCheckCatalogRefreshPriceText(item)}</span><span><b>데이터</b>{DATA_QUALITY_LABELS[item.previousDataQuality]} → {DATA_QUALITY_LABELS[item.nextDataQuality]}</span><span><b>누락</b>{item.previousMissingCount}개 → {item.nextMissingCount}개</span></div><small>{item.changedFields.length > 0 ? `변경 영역 · ${item.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ")}` : "변경된 영역 없음"}</small></article>)}{report.items.length > 6 && <small>그 외 성공 항목 {report.items.length - 6}개</small>}{report.failures.length > 0 && <div className="history-check-refresh-report-failures"><strong>확인 실패</strong>{report.failures.slice(0, 4).map((failure) => <p key={`${failure.target.kind}-${failure.target.id}`}><b>{failure.target.kind === "part" ? "핵심 부품" : "주변 부품"}</b> · {failure.message}</p>)}</div>}<p><FiInfo /> 정보 다시 확인 내용은 이 검사와 같은 견적에 묶여 저장됩니다.</p></div></details>;
}

export function SavedBuildCheckRefreshImpactPanel({ report, findingChanges }: { report: CatalogRefreshReport; findingChanges: SavedBuildCheckFindingDiff[] }) {
  const impacts = catalogRefreshFindingImpactsFor(report, findingChanges);
  const linkedCount = impacts.reduce((total, impact) => total + impact.findingChanges.length, 0);
  return <section className={`history-check-refresh-impact ${report.status}`} aria-label="정보 다시 확인과 결과 변화 연결" data-testid="saved-build-check-refresh-impact"><div className="history-check-refresh-impact-heading"><div><p className="eyebrow">REFRESH → RESULT IMPACT</p><strong>정보 다시 확인과 결과 변화 연결</strong><small>다시 확인한 부품과 결과가 바뀐 부품이 겹치는 경우만 연결해요.</small></div><span>{linkedCount}개 연결</span></div>{report.failures.length > 0 && <p className="history-check-refresh-impact-failure"><FiAlertTriangle /> 확인에 실패한 {report.failures.length}개는 결과 변화와 연결할 수 없어요.</p>}<div className="history-check-refresh-impact-list">{impacts.map(({ item, findingChanges: linkedChanges }) => <article className={linkedChanges.length > 0 ? "linked" : "unlinked"} key={`${item.target.kind}-${item.target.id}`}><div className="history-check-refresh-impact-item-heading"><strong>{item.name}</strong><span>{linkedChanges.length > 0 ? `연결 변화 ${linkedChanges.length}개` : "연결된 변화 없음"}</span></div><small>정보 변경 · {item.changedFields.length > 0 ? item.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ") : "변경된 영역 없음"}</small>{linkedChanges.length > 0 ? <ul>{linkedChanges.slice(0, 4).map((change) => <li key={`${change.key}-${change.change}`}><b>{savedCheckFindingChangeText(change.change)}</b><span>{(change.after ?? change.before)?.title ?? change.key}</span></li>)}</ul> : <p>두 검사 사이에 이 부품과 겹치는 결과 변화가 없어요. 정보 변경이 원인이라고 단정하지 않아요.</p>}</article>)}</div>{impacts.length === 0 && report.failures.length === 0 && <p className="history-check-refresh-impact-empty"><FiInfo /> 확인에 성공한 항목이 없어 결과 변화를 연결할 수 없어요.</p>}<p className="history-check-refresh-impact-note"><FiInfo /> 영향이 있을 만한 연결을 보여주는 참고 정보예요. 정보 변경이 결과 변화의 원인이라고 단정하는 건 아니에요.</p></section>;
}

export function savedCheckResourceText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const resource = snapshot.resourceBudget;
  if (!resource) return "미적용";
  const headroomText = (value: number | undefined) => value === undefined ? "확인 필요" : value >= 0 ? `${value}W 여유` : `${Math.abs(value)}W 부족`;
  return `전력 ${headroomText(resource.powerHeadroomW)} · 냉각 ${headroomText(resource.coolerHeadroomW)}`;
}

export function savedCheckReferenceText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const catalogDate = new Date(snapshot.catalogSnapshotAt);
  const catalogLabel = Number.isNaN(catalogDate.getTime()) ? snapshot.catalogSnapshotAt : catalogDate.toLocaleDateString("ko-KR");
  return `버전 ${snapshot.engineVersion} · 카탈로그 ${catalogLabel}`;
}

export function savedCheckBenchmarkText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const benchmark = snapshot.benchmarkSnapshot;
  if (!benchmark) return "벤치마크 기록 없음";
  return `벤치마크 ${buildBenchmarkSnapshotStatusText(benchmark.status)} · ${benchmark.presentScoreCount}/${benchmark.expectedScoreCount}개 점수`;
}

export function savedAssemblyVerificationText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const verification = snapshot.assemblyVerification;
  if (!verification) return undefined;
  const stateLabel = verification.state === "passed" ? "실측 통과" : verification.state === "failed" ? "실패 항목 있음" : verification.state === "in_progress" ? "실측 진행 중" : "실측 기록 없음";
  const toolLabel: Record<string, string> = { occt: "OCCT", cinebench: "Cinebench", "3dmark": "3DMark", crystaldiskmark: "CrystalDiskMark", other: "기타" };
  const scenarioLabel: Record<string, string> = { idle: "유휴", cpu: "CPU 부하", gpu: "GPU 부하", mixed: "혼합 부하", storage: "저장장치 부하", custom: "사용자 지정" };
  const conditions = [
    verification.loadTool !== "not_recorded" ? toolLabel[verification.loadTool] ?? verification.loadTool : undefined,
    verification.loadScenario !== "not_recorded" ? scenarioLabel[verification.loadScenario] ?? verification.loadScenario : undefined,
    verification.testDurationMinutes !== undefined ? `${verification.testDurationMinutes}분` : undefined,
    verification.ambientTempC !== undefined ? `주변 ${verification.ambientTempC}°C` : undefined,
    verification.cpuMaxTempC !== undefined ? `CPU 최고 ${verification.cpuMaxTempC}°C` : undefined,
    verification.gpuMaxTempC !== undefined ? `GPU 최고 ${verification.gpuMaxTempC}°C` : undefined,
    verification.noiseLevel !== "not_recorded" ? `소음 ${verification.noiseLevel === "quiet" ? "조용함" : verification.noiseLevel === "normal" ? "보통" : "큼"}` : undefined,
    verification.measurementSeriesPointCount !== undefined ? `시계열 ${verification.measurementSeriesPointCount}점` : undefined,
    verification.measurementSource === "csv" ? `CSV ${verification.measurementSourceLabel ?? "가져옴"} · ${verification.measurementSampleCount ?? "-"}샘플` : verification.measurementSource === "manual" ? "직접 입력" : undefined
  ].filter(Boolean);
  const runCount = snapshot.assemblyVerificationHistory?.length ?? 1;
  return `실측 ${runCount}회차 · ${stateLabel} · ${verification.checked}/${verification.total}개${conditions.length > 0 ? ` · ${conditions.join(" · ")}` : ""}`;
}

export function savedCheckFindingSeverityText(severity: SavedBuildCheckFindingSummary["severity"]) {
  return severity === "blocker" ? "차단 오류" : severity === "warning" ? "주의" : severity === "unknown" ? "확인 필요" : "정보";
}

export function savedCheckFindingChangeText(change: SavedBuildCheckFindingDiff["change"]) {
  return change === "resolved" ? "해결됨" : change === "new" ? "새로 발생" : change === "severity_changed" ? "중요도 변경" : change === "details_changed" ? "결과 내용 변경" : "변화 없음";
}

export function savedCheckFindingForChange(change: SavedBuildCheckFindingDiff) {
  return change.after ?? change.before;
}

export function savedCheckFindingAffectedText(finding: SavedBuildCheckFindingSummary | undefined, partMap?: ReadonlyMap<string, Part>) {
  if (!finding || finding.affectedPartIds.length === 0) return undefined;
  return finding.affectedPartIds.map((partId) => partMap?.get(partId)?.name ?? partId).join(", ");
}

export function savedCheckCatalogCauseCategoryText(record: CatalogChangeRecord) {
  return record.kind === "accessory" ? ACCESSORY_CATEGORY_LABELS[record.category as AccessoryCategory] ?? record.category : CATEGORY_LABELS[record.category as PartCategory] ?? record.category;
}

export function savedCheckCatalogCauseReason(record: CatalogChangeRecord) {
  const reasons: string[] = [];
  if (record.changedFields.includes("가격") || record.priceDeltaWon !== undefined) reasons.push(record.priceDeltaWon === undefined ? "가격 확인 상태 변경" : `가격 ${formatPriceDelta(record.priceDeltaWon)}`);
  if (record.changedFields.includes("원문 스펙") || record.changedFields.includes("정규화 스펙")) reasons.push("스펙 변경");
  if (record.changedFields.some(isCatalogDataQualityChangeField)) reasons.push(`데이터 상태 ${record.previousDataQuality ? DATA_QUALITY_LABELS[record.previousDataQuality] : "기록 없음"} → ${DATA_QUALITY_LABELS[record.nextDataQuality]}`);
  if (record.changedFields.includes("누락 필드")) reasons.push(`누락 필드 ${record.previousMissingFields.length}개 → ${record.nextMissingFields.length}개`);
  if (record.changedFields.includes("벤치마크 보강")) reasons.push("벤치마크 보강");
  return reasons.length > 0 ? reasons.join(" · ") : "카탈로그 값 변경";
}

export function savedCheckCatalogCauseDateText(record: CatalogChangeRecord) {
  const changedAt = new Date(record.changedAt);
  return Number.isNaN(changedAt.getTime()) ? record.changedAt : changedAt.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export const CATALOG_SPEC_LABELS: Record<string, string> = {
  socket: "소켓",
  cores: "코어",
  threads: "스레드",
  boostClockGhz: "부스트 클럭",
  cinebenchR23Single: "Cinebench R23 싱글",
  cinebenchR23Multi: "Cinebench R23 멀티",
  maxMemorySpeedMhz: "메모리 지원 속도",
  memoryType: "메모리 타입",
  coolerIncluded: "기본 쿨러 포함",
  tdpW: "TDP",
  pptW: "PPT",
  powerW: "소비전력",
  recommendedPsuW: "권장 파워",
  wattageW: "정격 출력",
  capacityGb: "용량",
  speedMhz: "메모리 속도",
  memoryCasLatency: "CAS 레이턴시",
  memoryVoltageV: "메모리 전압",
  m2PcieGeneration: "M.2 PCIe 세대",
  vramGb: "VRAM",
  lengthMm: "길이",
  thicknessMm: "두께",
  maxGpuLengthMm: "GPU 허용 길이",
  maxCoolerHeightMm: "쿨러 허용 높이",
  supportedSockets: "지원 소켓",
  memoryProfiles: "메모리 프로파일",
  memoryFormFactor: "메모리 슬롯 규격",
  memoryModuleCountPerKit: "킷당 모듈 수",
  memoryTiming: "메모리 타이밍",
  memoryEffectiveLatencyNs: "실효 CAS 지연",
  maxMemoryGb: "최대 메모리",
  memorySlots: "메모리 슬롯",
  m2Slots: "M.2 슬롯",
  m2Interfaces: "M.2 연결",
  m2PcieGenerations: "M.2 PCIe 세대",
  pcieX16Slots: "PCIe x16 슬롯",
  pcieX8Slots: "PCIe x8 슬롯",
  pcieX4Slots: "PCIe x4 슬롯",
  pcieX1Slots: "PCIe x1 슬롯",
  pcieSlotWidth: "PCIe 장착 폭",
  adapterPcieSlotWidth: "PCIe 어댑터 요구 폭",
  pciePowerOptions: "GPU 보조전원 요구",
  pciePowerAdapterOptions: "GPU 어댑터 전원 경로",
  gpuSlotOccupancy: "GPU 물리 슬롯 점유",
  gpuCableBendClearanceMm: "GPU 케이블 굽힘 여유",
  pciePowerConnectors: "PSU 보조전원 커넥터",
  sataPorts: "SATA 포트",
  interface: "인터페이스",
  formFactor: "폼팩터",
  sequentialReadMbps: "순차 읽기",
  sequentialWriteMbps: "순차 쓰기",
  ssdReadIops: "읽기 IOPS",
  ssdWriteIops: "쓰기 IOPS",
  ssdController: "SSD 컨트롤러",
  ssdNandType: "NAND",
  ssdTbwTb: "TBW",
  gpuVendor: "GPU 제조사",
  gpuArchitectureFamily: "GPU 아키텍처",
  gpuMemoryType: "GPU 메모리",
  gpuBoostClockMhz: "GPU 부스트 클럭",
  gpuStreamProcessors: "스트림 프로세서",
  gpuMemoryBandwidthGbps: "VRAM 대역폭",
  gpu3dmarkTimeSpyScore: "3DMark Time Spy",
  gpu3dmarkPortRoyalScore: "3DMark Port Royal",
  motherboardFormFactors: "지원 메인보드 규격",
  supportedPsuFormFactors: "지원 파워 규격",
  maxPsuLengthMm: "PSU 허용 길이",
  caseSidePanelClearanceMm: "케이스 측면 케이블 여유",
  coolerType: "쿨러 타입",
  radiatorSizeMm: "라디에이터",
  radiatorSizesMm: "지원 라디에이터",
  radiatorPosition: "라디에이터 장착 위치",
  radiatorSupports: "위치별 라디에이터 지원",
  hddBays: "HDD 베이",
  ssdBays: "SSD 베이",
  maxCoolingW: "냉각 지원",
  efficiency: "효율",
  psuFormFactor: "PSU 폼팩터",
  psuCableType: "PSU 케이블 구조",
  psuRailType: "PSU 12V 레일",
  psuIndependentPcieCableRuns: "PSU 독립 PCIe 케이블 런",
  psuPcieCableTopology: "PSU PCIe 케이블 분배 구조",
  fanCount: "팬 수",
  fanPortCount: "팬 헤더",
  rgb5vPortCount: "5V ARGB 헤더",
  rgb12vPortCount: "12V RGB 헤더",
  rgbDeviceVoltage: "RGB 전압",
  rgbDeviceCurrentA: "RGB 장치당 소비전류",
  rgbDevicePowerW: "RGB 장치당 소비전력",
  rgbControllerIncluded: "RGB 컨트롤러"
};

export function catalogSpecFieldLabel(key: string) {
  if (CATALOG_SPEC_LABELS[key]) return CATALOG_SPEC_LABELS[key];
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

export function parseCatalogSpecObject(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function catalogSpecValueText(key: string, value: unknown, exists: boolean) {
  if (!exists) return "필드 없음";
  if (value === null || value === undefined || value === "") return "확인 정보 없음";
  if (key === "boostClockGhz") return `${value}GHz`;
  if (key === "maxMemorySpeedMhz" || key === "speedMhz") return `${value}MHz`;
  if (key === "gpuBoostClockMhz") return `${value}MHz`;
  if (key === "tdpW" || key === "pptW" || key === "powerW" || key === "recommendedPsuW" || key === "wattageW") return `${value}W`;
  if (key === "capacityGb" || key === "vramGb" || key === "maxMemoryGb") return `${value}GB`;
  if (key === "memoryVoltageV") return `${value}V`;
  if (key === "memoryCasLatency") return `CL${value}`;
  if (key === "m2PcieGeneration") return `PCIe ${value}`;
  if (key === "psuCableType") return value === "fully_modular" ? "풀모듈러" : value === "semi_modular" ? "세미모듈러" : value === "fixed" ? "케이블 일체형" : String(value);
  if (key === "psuRailType") return value === "single" ? "12V 싱글레일" : value === "multi" ? "12V 다중레일" : String(value);
  if (key === "radiatorPosition") return formatRadiatorPosition(String(value)) ?? String(value);
  if (key === "radiatorSupports" && Array.isArray(value)) return formatRadiatorSupports(value as Array<{ position?: unknown; sizesMm?: unknown }>) ?? "확인 정보 없음";
  if (key === "psuIndependentPcieCableRuns") return `${value}개`;
  if (key === "psuPcieCableTopology") return value === "independent" ? "독립 케이블" : value === "shared" ? "분배·공유 케이블" : String(value);
  if (key === "pcieSlotWidth" || key === "adapterPcieSlotWidth") return `x${value}`;
  if (["memoryModuleCountPerKit", "memorySlots", "m2Slots", "pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots", "hddBays", "ssdBays", "fanCount", "fanPortCount", "rgb5vPortCount", "rgb12vPortCount"].includes(key)) return `${value}개`;
  if (key === "gpuSlotOccupancy") return `${value} 슬롯`;
  if (key === "gpuMemoryBandwidthGbps") return `${value}GB/s`;
  if (key === "gpuStreamProcessors" || key.endsWith("Score")) return Number(value).toLocaleString("ko-KR");
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item !== null ? JSON.stringify(item) : String(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (key.endsWith("Mm")) return `${value}mm`;
  return formatSpecValue(value);
}

export function savedCatalogCauseValueDiffsFor(record: CatalogChangeRecord): CatalogChangeValueDiff[] {
  return savedBuildCatalogChangeValueDiffsFor(record).flatMap((diff) => {
    if (diff.field !== "정규화 스펙") return [diff];
    const previous = parseCatalogSpecObject(diff.previous);
    const next = parseCatalogSpecObject(diff.next);
    if (!previous || !next) return [diff];
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
      .slice(0, 12);
    return keys.length > 0
      ? keys.map((key) => ({
        field: `정규화 스펙 · ${catalogSpecFieldLabel(key)}`,
        previous: catalogSpecValueText(key, previous[key], Object.prototype.hasOwnProperty.call(previous, key)),
        next: catalogSpecValueText(key, next[key], Object.prototype.hasOwnProperty.call(next, key))
      }))
      : [diff];
  });
}

export const CATALOG_SPEC_ORDER_BY_CATEGORY: Record<string, string[]> = {
  cpu: ["socket", "cores", "threads", "boostClockGhz", "tdpW", "pptW", "maxMemorySpeedMhz", "cinebenchR23Single", "cinebenchR23Multi"],
  cooler: ["supportedSockets", "maxCoolingW", "maxCoolerHeightMm", "radiatorSizeMm", "radiatorPosition", "coolerType"],
  motherboard: ["socket", "memoryType", "memoryFormFactor", "maxMemoryGb", "memorySlots", "maxMemorySpeedMhz", "m2Slots", "m2Interfaces", "m2PcieGenerations", "pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots", "sataPorts"],
  memory: ["memoryType", "memoryProfiles", "capacityGb", "memoryModuleCountPerKit", "speedMhz", "memoryCasLatency", "memoryVoltageV"],
  gpu: ["gpuVendor", "gpuArchitectureFamily", "gpuMemoryType", "vramGb", "gpuBoostClockMhz", "gpuStreamProcessors", "gpuMemoryBandwidthGbps", "pciePowerOptions", "pciePowerAdapterOptions", "powerW", "recommendedPsuW", "lengthMm", "thicknessMm", "gpuSlotOccupancy", "gpuCableBendClearanceMm"],
  ssd: ["interface", "formFactor", "m2PcieGeneration", "capacityGb", "sequentialReadMbps", "sequentialWriteMbps", "ssdReadIops", "ssdWriteIops", "ssdController", "ssdNandType", "ssdTbwTb"],
  hdd: ["interface", "formFactor", "capacityGb"],
  case: ["motherboardFormFactors", "maxGpuLengthMm", "caseSidePanelClearanceMm", "maxCoolerHeightMm", "maxPsuLengthMm", "supportedPsuFormFactors", "radiatorSupports", "hddBays", "ssdBays"],
  psu: ["wattageW", "psuDepthMm", "pciePowerConnectors", "psuCableType", "psuRailType", "psuIndependentPcieCableRuns", "psuPcieCableTopology", "efficiency", "psuFormFactor"]
};

export function catalogSpecKeyForLabel(label: string) {
  const entry = Object.entries(CATALOG_SPEC_LABELS).find(([, value]) => value === label);
  return entry?.[0];
}

export function catalogCauseDiffLabel(diff: CatalogChangeValueDiff) {
  return diff.field.startsWith("정규화 스펙 · ") ? diff.field.slice("정규화 스펙 · ".length) : diff.field;
}

export function catalogCauseDiffPriority(record: CatalogChangeRecord, diff: CatalogChangeValueDiff) {
  const key = diff.field.startsWith("정규화 스펙 · ") ? catalogSpecKeyForLabel(catalogCauseDiffLabel(diff)) : undefined;
  if (!key) return 200;
  const order = CATALOG_SPEC_ORDER_BY_CATEGORY[record.category] ?? [];
  const index = order.indexOf(key);
  return index >= 0 ? index : 100;
}

export function SavedCatalogCauseDiffRows({ record, diffs }: { record: CatalogChangeRecord; diffs: CatalogChangeValueDiff[] }) {
  const ordered = diffs.slice().sort((left, right) => catalogCauseDiffPriority(record, left) - catalogCauseDiffPriority(record, right) || left.field.localeCompare(right.field));
  return <div className="history-check-cause-values-list">{ordered.map((diff) => <div className="history-check-cause-value" key={diff.field}><span>{catalogCauseDiffLabel(diff)}</span><small><em>{diff.previous ?? "확인 정보 없음"}</em><b>→</b><em>{diff.next ?? "확인 정보 없음"}</em></small></div>)}</div>;
}

export function savedCheckCatalogCauseSourceUrl(record: CatalogChangeRecord, partMap?: ReadonlyMap<string, Part>, accessoryMap?: ReadonlyMap<string, AccessoryItem>) {
  const item = record.kind === "accessory" ? accessoryMap?.get(record.itemId) : partMap?.get(record.itemId);
  return safeExternalUrl(item?.danawaUrl);
}

export function savedCatalogCauseImpactKindText(kind: CatalogChangeImpact["kind"]) {
  return kind === "compatibility" ? "호환성 규칙" : kind === "analysis" ? "성능 분석" : kind === "purchase" ? "구매 금액" : "데이터 상태";
}

export function savedCheckDriftText(saved: SavedBuild, check: SavedBuildLiveCheck | undefined) {
  const snapshot = saved.checkSnapshot;
  if (!snapshot) return saved.id === "current-draft" ? "저장 전 구성" : "저장 당시 검사 기록 없음";
  if (!check || check.status === "loading") return "현재 기준 재검사 중...";
  if (check.status === "error") return "현재 기준 재검사 실패";
  const diff = savedBuildCheckDiffFor(snapshot, check.result);
  if (!diff.hasChanges) return "저장할 때와 같은 결과";
  const changes: string[] = [];
  if (diff.statusChanged) changes.push("결과 변경");
  if (diff.riskChanged) changes.push("위험 카운트 변경");
  if (diff.accessoryRiskChanged) changes.push("주변 부품 위험 변경");
  if (diff.priceChanged || diff.priceCompletenessChanged) changes.push("가격 변경");
  if (diff.resourceBudgetChanged) changes.push("전력·냉각 예산 변경");
  if (diff.benchmarkChanged) changes.push("벤치마크 변경");
  else if (diff.benchmarkNeedsReview) changes.push("벤치마크 확인 필요");
  if (diff.engineChanged) changes.push("검사 버전 변경");
  if (diff.catalogChanged) changes.push("부품 정보 변경");
  return changes.join(" · ");
}

export function SavedBuildCheckBadge({ snapshot }: { snapshot: NonNullable<SavedBuild["checkSnapshot"]> }) {
  const checkedAt = new Date(snapshot.checkedAt);
  const checkedLabel = Number.isNaN(checkedAt.getTime()) ? snapshot.checkedAt : checkedAt.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  return <div className={`history-check-snapshot ${snapshot.status}`} data-testid="saved-build-check-snapshot"><span className="history-check-snapshot-icon"><FiActivity /></span><div><strong>저장 당시 검사 · {savedCheckStatusText(snapshot.status)}</strong><small>{checkedLabel} · {savedCheckRiskText(snapshot)} · 분석 {savedCheckAnalysisText(snapshot)}</small><small>{savedCheckReferenceText(snapshot)} · 합계 {savedCheckPriceText(snapshot)} · 전력·냉각 {savedCheckResourceText(snapshot)}</small><small>{savedCheckBenchmarkText(snapshot)}</small>{snapshot.actionCenterSummary && <small>먼저 할 일 · {snapshot.actionCenterSummary}</small>}{snapshot.catalogRefreshReport && <small>정보 다시 확인 · {savedCheckCatalogRefreshSummary(snapshot.catalogRefreshReport)}</small>}{savedAssemblyVerificationText(snapshot) && <small>{savedAssemblyVerificationText(snapshot)}</small>}</div></div>;
}

export function SavedCatalogCauseValueDiffs({ record, compact = false, relatedRuleIds = [] }: { record: CatalogChangeRecord; compact?: boolean; relatedRuleIds?: string[] }) {
  const diffs = savedCatalogCauseValueDiffsFor(record);
  if (diffs.length === 0) return <small className="history-check-cause-values-missing">이전·현재 값이 보존되지 않은 구버전 변경 로그입니다.</small>;
  const groupLabel = savedCheckCatalogCauseCategoryText(record);
  const specDiffs = diffs.filter((diff) => diff.field.startsWith("정규화 스펙 · "));
  const priceAndDataDiffs = diffs.filter((diff) => !diff.field.startsWith("정규화 스펙 · ") && diff.field !== "원문 스펙");
  const rawSpecDiffs = diffs.filter((diff) => diff.field === "원문 스펙");
  const allImpacts = [...new Map(diffs.flatMap((diff) => catalogChangeImpactsFor(record, diff)).map((impact) => [impact.id, impact])).values()];
  const exactImpacts = relatedRuleIds.length > 0 ? allImpacts.filter((impact) => impact.ruleIds.some((ruleId) => relatedRuleIds.includes(ruleId))) : [];
  const impacts = exactImpacts.length > 0 ? exactImpacts : allImpacts;
  return <details className={compact ? "history-check-cause-values compact" : "history-check-cause-values"}><summary>{groupLabel} · 변경 값 표 ({diffs.length}개)</summary>{specDiffs.length > 0 && <div className="history-check-cause-group"><strong>핵심 규격 변화</strong><SavedCatalogCauseDiffRows record={record} diffs={specDiffs} /></div>}{priceAndDataDiffs.length > 0 && <div className="history-check-cause-group"><strong>가격·데이터 변화</strong><SavedCatalogCauseDiffRows record={record} diffs={priceAndDataDiffs} /></div>}{rawSpecDiffs.length > 0 && <div className="history-check-cause-group"><strong>수집된 스펙 변화</strong><SavedCatalogCauseDiffRows record={record} diffs={rawSpecDiffs} /></div>}{impacts.length > 0 && <div className="history-check-cause-impact"><strong>{exactImpacts.length > 0 ? "이 결과에 연결된 영향" : "영향이 있을 수 있는 항목"}</strong>{impacts.map((impact) => <div className="history-check-cause-impact-row" key={impact.id}><span>{savedCatalogCauseImpactKindText(impact.kind)}</span><div><strong>{impact.label}</strong><small>{impact.summary}</small>{impact.ruleIds.length > 0 && <small>규칙 · {impact.ruleIds.join(" · ")}</small>}</div></div>)}<small className="history-check-cause-impact-note"><FiRefreshCw /> 값이 바뀌었으니 현재 기준으로 다시 검사해 주세요.</small></div>}</details>;
}

export function SavedCatalogCauseSourceLink({ record, partMap, accessoryMap }: { record: CatalogChangeRecord; partMap?: ReadonlyMap<string, Part>; accessoryMap?: ReadonlyMap<string, AccessoryItem> }) {
  const sourceUrl = savedCheckCatalogCauseSourceUrl(record, partMap, accessoryMap);
  return sourceUrl ? <a className="history-check-cause-source" href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a> : null;
}

export function savedCheckFindingFactText(fact: SavedBuildCheckFindingSummary["facts"][number] | undefined) {
  if (!fact) return "기록 없음";
  const actual = fact.actual ?? "확인 정보 없음";
  return fact.expected ? `${actual} · 기대값 ${fact.expected}` : actual;
}

export function SavedCheckFindingFactDiff({ before, after }: { before?: SavedBuildCheckFindingSummary; after?: SavedBuildCheckFindingSummary }) {
  const beforeFacts = before?.facts ?? [];
  const afterFacts = after?.facts ?? [];
  const labels = [...new Set([...beforeFacts.map((fact) => fact.label), ...afterFacts.map((fact) => fact.label)])];
  if (labels.length === 0) return null;
  const beforeByLabel = new Map(beforeFacts.map((fact) => [fact.label, fact]));
  const afterByLabel = new Map(afterFacts.map((fact) => [fact.label, fact]));
  return <div className="history-check-finding-facts"><strong>결과 값 비교</strong><div className="history-check-finding-facts-grid"><span>항목</span><span>변경 전</span><span>변경 후</span>{labels.map((label) => <Fragment key={label}><b>{label}</b><small>{savedCheckFindingFactText(beforeByLabel.get(label))}</small><small>{savedCheckFindingFactText(afterByLabel.get(label))}</small></Fragment>)}</div></div>;
}

export function SavedBuildCheckTransitionSummary({ summary, before, after }: { summary: SavedBuildCheckTransitionSummary; before: SavedBuildCheckSnapshot; after: SavedBuildCheckSnapshot }) {
  const directionLabel = summary.direction === "improved" ? "개선" : summary.direction === "regressed" ? "악화" : summary.direction === "changed" ? "변경" : "동일";
  const headline = summary.direction === "improved" ? "검사 결과가 개선되었습니다." : summary.direction === "regressed" ? "검사 결과가 악화되었습니다." : summary.direction === "changed" ? "검사 결과에 변화가 있습니다." : "검사 결과가 동일합니다.";
  const lines: string[] = [];
  if (summary.statusChanged) lines.push(`전체 결과 ${savedCheckStatusText(before.status)} → ${savedCheckStatusText(after.status)}`);
  if (summary.resolvedFindingCount > 0) lines.push(`해결된 항목 ${summary.resolvedFindingCount}개`);
  if (summary.newFindingCount > 0) lines.push(`새로 생긴 항목 ${summary.newFindingCount}개`);
  if (summary.severityChangedFindingCount > 0) lines.push(`중요도가 바뀐 항목 ${summary.severityChangedFindingCount}개`);
  if (summary.detailsChangedFindingCount > 0) lines.push(`내용이 바뀐 항목 ${summary.detailsChangedFindingCount}개`);
  if (summary.blockerDelta !== 0) lines.push(`차단 오류 ${before.blockerCount}개 → ${after.blockerCount}개`);
  if (summary.warningDelta !== 0) lines.push(`주의 항목 ${before.warningCount}개 → ${after.warningCount}개`);
  if (summary.unknownDelta !== 0) lines.push(`확인 필요 ${before.unknownCount}개 → ${after.unknownCount}개`);
  if (summary.accessoryBlockerDelta !== 0) lines.push(`주변 부품 차단 ${before.accessoryCompatibility?.blockerCount ?? 0}개 → ${after.accessoryCompatibility?.blockerCount ?? 0}개`);
  if (summary.accessoryWarningDelta !== 0) lines.push(`주변 부품 주의 ${before.accessoryCompatibility?.warningCount ?? 0}개 → ${after.accessoryCompatibility?.warningCount ?? 0}개`);
  if (summary.accessoryUnknownDelta !== 0) lines.push(`주변 부품 확인 필요 ${before.accessoryCompatibility?.unknownCount ?? 0}개 → ${after.accessoryCompatibility?.unknownCount ?? 0}개`);
  if (summary.resourceBudgetChanged) {
    const resourceDelta = [
      summary.powerHeadroomDeltaW !== undefined ? `전력 ${summary.powerHeadroomDeltaW > 0 ? "+" : ""}${summary.powerHeadroomDeltaW}W` : undefined,
      summary.coolerHeadroomDeltaW !== undefined ? `냉각 ${summary.coolerHeadroomDeltaW > 0 ? "+" : ""}${summary.coolerHeadroomDeltaW}W` : undefined
    ].filter((value): value is string => Boolean(value));
    lines.push(`전력·냉각 예산 ${savedCheckResourceText(before)} → ${savedCheckResourceText(after)}${resourceDelta.length > 0 ? ` (${resourceDelta.join(" · ")})` : ""}`);
  }
  if (summary.benchmarkChanged || summary.benchmarkNeedsReview) {
    const impact = summary.benchmarkImpact;
    const detail = impact.changedScoreCount > 0 ? ` · 점수 ${impact.changedScoreCount}개 변경` : impact.benchmarkDateChanged ? " · 자료 시점 변경" : "";
    lines.push(`CPU·GPU ${buildBenchmarkImpactStatusText(impact.status)} · ${buildBenchmarkDecisionImpactText(impact.decisionImpact)}${detail}`);
  }
  if (summary.priceDeltaWon !== undefined && summary.priceDeltaWon !== 0) lines.push(`전체 금액 ${savedCheckPriceText(before)} → ${savedCheckPriceText(after)} (${formatPriceDelta(summary.priceDeltaWon)})`);
  else if (summary.priceCompletenessChanged) lines.push(`가격 상태 ${before.priceComplete ? "확인됨" : "확인 필요"} → ${after.priceComplete ? "확인됨" : "확인 필요"}`);
  if (summary.catalogChanged) lines.push("부품 정보가 바뀌어 다시 확인했습니다.");
  if (summary.engineChanged) lines.push(`검사 버전 ${before.engineVersion} → ${after.engineVersion}`);
  if (lines.length === 0) lines.push("두 시점의 검사 상태·위험 카운트·가격·전력·냉각 예산·벤치마크 변화가 없습니다.");
  const accessoryBlockerCount = after.accessoryCompatibility?.blockerCount ?? 0;
  const accessoryReviewCount = (after.accessoryCompatibility?.warningCount ?? 0) + (after.accessoryCompatibility?.unknownCount ?? 0);
  const nextAction = after.status === "incompatible"
    ? `차단 오류 ${after.blockerCount}개를 해결한 뒤 현재 구성으로 다시 검사하세요.`
    : accessoryBlockerCount > 0
      ? `주변 부품 차단 ${accessoryBlockerCount}개를 수정한 뒤 현재 구성으로 다시 검사하세요.`
    : after.status === "needs_review"
      ? `확인 필요 ${after.unknownCount}개를 제조사·판매처에서 확인한 뒤 구매를 결정해 주세요.`
      : accessoryReviewCount > 0
        ? `주변 부품 주의·확인 필요 ${accessoryReviewCount}개를 제조사·판매처에서 확인한 뒤 구매를 결정해 주세요.`
      : after.warningCount > 0
        ? `호환성은 통과했지만 주의 항목 ${after.warningCount}개를 조립 전에 확인해 주세요.`
        : after.resourceBudget?.state === "danger"
          ? "전력·냉각 여유가 부족해요. 부품이나 냉각·전원 조건을 바꾼 뒤 다시 검사해 주세요."
        : after.resourceBudget?.state === "warning" || after.resourceBudget?.state === "unknown"
          ? "전력·냉각 여유나 스펙 수치를 사기 전에 확인해 주세요."
        : "현재 확인된 정보로는 호환돼요. 구매 전 제조사 안내와 실제 조립 공간도 확인해 주세요.";
  return <section className={`history-check-transition-summary ${summary.direction}`} aria-label="결과 변화 요약" data-testid="saved-build-check-transition-summary"><div className="history-check-transition-heading"><div><p className="eyebrow">DECISION SUMMARY</p><strong>{headline}</strong></div><span>{directionLabel}</span></div><ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul><p className="history-check-transition-action"><FiZap /> 다음 행동 · {nextAction}</p></section>;
}

export function SavedBuildCheckTimeline({ history, buildId, partMap, accessoryMap, showDiff = true, canRecord = false, recording = false, onRecordCheck }: { history: NonNullable<SavedBuild["checkHistory"]>; buildId?: string; partMap?: ReadonlyMap<string, Part>; accessoryMap?: ReadonlyMap<string, AccessoryItem>; showDiff?: boolean; canRecord?: boolean; recording?: boolean; onRecordCheck?: () => void }) {
  const [beforeIndex, setBeforeIndex] = useState(Math.max(0, history.length - 2));
  const [afterIndex, setAfterIndex] = useState(Math.max(0, history.length - 1));
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [catalogCauseState, setCatalogCauseState] = useState<SavedBuildCatalogCauseState>({ key: "", status: "idle", items: [] });
  const latestCheckedAt = history[history.length - 1]?.checkedAt ?? "";
  useEffect(() => {
    setBeforeIndex(Math.max(0, history.length - 2));
    setAfterIndex(Math.max(0, history.length - 1));
  }, [history.length, latestCheckedAt]);
  const entries = history.slice().reverse();
  const before = history[beforeIndex] ?? history[0];
  const after = history[afterIndex] ?? history[history.length - 1];
  const catalogCauseKey = buildId && before && after && before.checkedAt !== after.checkedAt ? `${buildId}:${before.checkedAt}:${after.checkedAt}` : "none";
  useEffect(() => {
    if (catalogCauseKey === "none" || !buildId || !before || !after) {
      setCatalogCauseState({ key: catalogCauseKey, status: "idle", items: [] });
      return;
    }
    let cancelled = false;
    setCatalogCauseState({ key: catalogCauseKey, status: "loading", items: [] });
    const timestamps = [before.checkedAt, after.checkedAt].sort();
    void api<{ items: CatalogChangeRecord[] }>(`/api/builds/${encodeURIComponent(buildId)}/check-causes?from=${encodeURIComponent(timestamps[0])}&to=${encodeURIComponent(timestamps[1])}`, { retry: 1 })
      .then((payload) => {
        if (!cancelled) setCatalogCauseState({ key: catalogCauseKey, status: "ready", items: Array.isArray(payload.items) ? payload.items : [] });
      })
      .catch((error: unknown) => {
        if (!cancelled) setCatalogCauseState({ key: catalogCauseKey, status: "error", items: [], message: error instanceof Error ? error.message : "카탈로그 변경 원인을 확인하지 못했습니다." });
      });
    return () => { cancelled = true; };
  }, [catalogCauseKey, buildId, before?.checkedAt, after?.checkedAt]);
  const topLevelDiff = before && after ? savedBuildCheckSnapshotDiffFor(before, after) : undefined;
  const transitionSummary = before && after ? savedBuildCheckTransitionSummaryFor(before, after) : undefined;
  const findingDiff = before && after ? savedBuildCheckFindingDiffFor(before, after) : undefined;
  const findingChanges = findingDiff?.changes ?? [];
  const changedFindings = findingChanges.filter((change) => change.change !== "unchanged");
  const visibleFindingChanges = showUnchanged ? findingChanges : changedFindings;
  const findingChangeCount = (change: SavedBuildCheckFindingDiff["change"]) => findingChanges.filter((item) => item.change === change).length;
  const dateLabelFor = (snapshot: SavedBuildCheckSnapshot) => {
    const checkedAt = new Date(snapshot.checkedAt);
    return Number.isNaN(checkedAt.getTime()) ? snapshot.checkedAt : checkedAt.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  };
  return (
    <section className="history-check-timeline" aria-label="검사 타임라인" data-testid="saved-build-check-timeline" tabIndex={-1}>
      <div className="history-check-timeline-heading">
        <div><p className="eyebrow">CHECK TIMELINE</p><strong>검사 타임라인</strong></div>
        <div className="history-check-timeline-heading-actions"><span>{history.length}회</span>{canRecord && onRecordCheck && <button className="button button-small button-light" type="button" onClick={onRecordCheck} disabled={recording}>{recording ? <><FiLoader className="spin" /> 재검사 중...</> : <><FiRefreshCw /> 현재 기준 재검사·기록</>}</button>}</div>
      </div>
      <div className="history-check-timeline-list">
        {entries.slice(0, 4).map((snapshot, index) => (
          <article className={`history-check-timeline-entry ${snapshot.status}`} key={`${snapshot.checkedAt}-${snapshot.engineVersion}-${index}`}>
            <span className="history-check-timeline-dot" />
            <div>
              <strong>{index === 0 ? "최근 검사 · " : ""}{savedCheckStatusText(snapshot.status)}</strong>
              <small>{dateLabelFor(snapshot)} · {savedCheckRiskText(snapshot)} · 합계 {savedCheckPriceText(snapshot)}</small>
              <small>{savedCheckReferenceText(snapshot)}</small>
              <small>{savedCheckBenchmarkText(snapshot)}</small>
              {snapshot.actionCenterSummary && <small>먼저 할 일 · {snapshot.actionCenterSummary}</small>}
              {snapshot.catalogRefreshReport && <SavedBuildCheckRefreshEvidence report={snapshot.catalogRefreshReport} />}
              {savedAssemblyVerificationText(snapshot) && <small>{savedAssemblyVerificationText(snapshot)}</small>}
            </div>
          </article>
        ))}
      </div>
      {history.length > 4 && <small className="history-check-timeline-more">이전 검사 {history.length - 4}회는 아래 시점 선택에서 비교할 수 있습니다.</small>}
      {showDiff && history.length > 1 && before && after && (
        <div className="history-check-diff" data-testid="saved-build-check-diff">
          <div className="history-check-diff-heading">
            <div><p className="eyebrow">CHECK DIFF</p><strong>검사 결과 상세 비교</strong><small>두 검사 시점을 선택해 규칙별 변화 원인과 카탈로그 정보를 확인합니다.</small></div>
          </div>
          <div className="history-check-diff-selects">
            <label>기준 검사
              <select aria-label="기준 검사" value={beforeIndex} onChange={(event) => setBeforeIndex(Number(event.target.value))}>
                {history.map((snapshot, index) => <option value={index} key={`before-${snapshot.checkedAt}-${index}`}>검사 {index + 1} · {dateLabelFor(snapshot)} · {savedCheckStatusText(snapshot.status)}</option>)}
              </select>
            </label>
            <span>→</span>
            <label>비교 검사
              <select aria-label="비교 검사" value={afterIndex} onChange={(event) => setAfterIndex(Number(event.target.value))}>
                {history.map((snapshot, index) => <option value={index} key={`after-${snapshot.checkedAt}-${index}`}>검사 {index + 1} · {dateLabelFor(snapshot)} · {savedCheckStatusText(snapshot.status)}</option>)}
              </select>
            </label>
          </div>
          <div className="history-check-period-summary" data-testid="saved-build-check-period-summary">
            <div className="history-check-period before"><span>변경 전 · 검사 {beforeIndex + 1}</span><strong>{savedCheckStatusText(before.status)}</strong><small>{dateLabelFor(before)} · {savedCheckRiskText(before)} · {savedCheckPriceText(before)}</small></div>
            <b aria-hidden="true">→</b>
            <div className="history-check-period after"><span>변경 후 · 검사 {afterIndex + 1}</span><strong>{savedCheckStatusText(after.status)}</strong><small>{dateLabelFor(after)} · {savedCheckRiskText(after)} · {savedCheckPriceText(after)}</small></div>
          </div>
          {transitionSummary && <SavedBuildCheckTransitionSummary summary={transitionSummary} before={before} after={after} />}
          {after.catalogRefreshReport && findingDiff?.available && <SavedBuildCheckRefreshImpactPanel report={after.catalogRefreshReport} findingChanges={findingChanges} />}
          {topLevelDiff && <div className="history-check-diff-overview"><span className={topLevelDiff.statusChanged ? "changed" : ""}>결과 {topLevelDiff.statusChanged ? "변경" : "동일"}</span><span className={topLevelDiff.riskChanged ? "changed" : ""}>위험 카운트 {topLevelDiff.riskChanged ? "변경" : "동일"}</span><span className={topLevelDiff.accessoryRiskChanged ? "changed" : ""}>주변 부품 {topLevelDiff.accessoryRiskChanged ? "변경" : "동일"}</span><span className={topLevelDiff.priceChanged || topLevelDiff.priceCompletenessChanged ? "changed" : ""}>가격 {topLevelDiff.priceChanged || topLevelDiff.priceCompletenessChanged ? "변경" : "동일"}</span><span className={topLevelDiff.resourceBudgetChanged ? "changed" : ""}>전력·냉각 {topLevelDiff.resourceBudgetChanged ? "변경" : "동일"}</span><span className={topLevelDiff.benchmarkChanged || topLevelDiff.benchmarkNeedsReview ? "changed" : ""}>벤치마크 {topLevelDiff.benchmarkChanged ? "변경" : topLevelDiff.benchmarkNeedsReview ? "확인 필요" : "동일"}</span><span className={topLevelDiff.catalogChanged ? "changed" : ""}>카탈로그 {topLevelDiff.catalogChanged ? "기준 변경" : "동일"}</span></div>}
          {catalogCauseState.status === "loading" && <p className="history-check-cause-state"><FiLoader className="spin" /> 선택한 부품의 카탈로그 변경 내역을 확인하는 중...</p>}
          {catalogCauseState.status === "error" && <p className="history-check-cause-state error"><FiAlertTriangle /> 카탈로그 변경 내역을 확인하지 못했습니다. {catalogCauseState.message}</p>}
          {catalogCauseState.status === "ready" && catalogCauseState.items.length === 0 && <p className="history-check-cause-state"><FiInfo /> 두 검사 사이에 선택한 부품의 카탈로그 변경이 없어요. 변경이 원인이라고 단정하지 않아요.</p>}
          {catalogCauseState.status === "ready" && catalogCauseState.items.length > 0 && (
            <div className="history-check-cause-panel" data-testid="saved-build-catalog-causes">
              <div className="history-check-cause-heading"><div><p className="eyebrow">CATALOG CHANGES</p><strong>기록된 카탈로그 변경</strong><small>두 검사 사이에 선택한 부품에서 실제로 기록된 변경만 보여드려요.</small></div><span>{catalogCauseState.items.length}건</span></div>
              <div className="history-check-cause-list">
                {catalogCauseState.items.slice(0, 8).map((record) => <article className="history-check-cause-item" key={record.id}><div><strong>{record.itemName}</strong><small>{record.kind === "accessory" ? "주변 부품" : "핵심 부품"} · {savedCheckCatalogCauseCategoryText(record)} · {savedCheckCatalogCauseDateText(record)}</small></div><p>{savedCheckCatalogCauseReason(record)}</p><small>변경 영역 · {record.changedFields.length > 0 ? record.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ") : "값 변화 없음"}</small><SavedCatalogCauseValueDiffs record={record} /><SavedCatalogCauseSourceLink record={record} partMap={partMap} accessoryMap={accessoryMap} /></article>)}
              </div>
              {catalogCauseState.items.length > 8 && <small className="history-check-cause-more">그 외 {catalogCauseState.items.length - 8}건은 카탈로그 변경 로그에서 확인할 수 있습니다.</small>}
            </div>
          )}
          {findingDiff?.available ? (
            <>
              <div className="history-check-diff-summary"><span className="resolved">해결 {findingChangeCount("resolved")}</span><span className="new">신규 {findingChangeCount("new")}</span><span className="severity_changed">중요도 변경 {findingChangeCount("severity_changed")}</span><span className="details_changed">내용 변경 {findingChangeCount("details_changed")}</span><label><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} /> 변화 없음 포함</label></div>
              {visibleFindingChanges.length > 0 ? <div className="history-check-diff-list">{visibleFindingChanges.map((change) => {
                const beforeFinding = change.before;
                const afterFinding = change.after;
                const finding = afterFinding ?? beforeFinding;
                const affected = savedCheckFindingAffectedText(finding, partMap);
                const relatedCatalogCauses = catalogCauseState.status === "ready" ? catalogCauseState.items.filter((record) => new Set([...(beforeFinding?.affectedPartIds ?? []), ...(afterFinding?.affectedPartIds ?? [])]).has(record.itemId)).slice(0, 3) : [];
                return <article className={`history-check-diff-finding ${change.change}`} key={`${change.key}-${change.change}`}><span className="history-check-diff-label">{savedCheckFindingChangeText(change.change)}</span><div className="history-check-diff-finding-content"><div className="history-check-diff-finding-versions"><div className="history-check-diff-finding-version before"><span>변경 전</span>{beforeFinding ? <><strong>{beforeFinding.title}</strong><small>{savedCheckFindingSeverityText(beforeFinding.severity)} · {beforeFinding.message}</small></> : <small>이 검사에서 이 규칙은 기록되지 않았습니다.</small>}</div><b aria-hidden="true">→</b><div className="history-check-diff-finding-version after"><span>변경 후</span>{afterFinding ? <><strong>{afterFinding.title}</strong><small>{savedCheckFindingSeverityText(afterFinding.severity)} · {afterFinding.message}</small></> : <small>이 검사에서 이 규칙은 기록되지 않았습니다.</small>}</div></div><SavedCheckFindingFactDiff before={beforeFinding} after={afterFinding} />{affected && <small>영향 부품 · {affected}</small>}{relatedCatalogCauses.length > 0 && <div className="history-check-diff-related-causes"><span>관련 카탈로그 변경</span>{relatedCatalogCauses.map((record) => <div className="history-check-diff-related-cause" key={record.id}><small>{record.itemName} · {savedCheckCatalogCauseReason(record)} · {savedCheckCatalogCauseDateText(record)}</small><SavedCatalogCauseValueDiffs record={record} compact relatedRuleIds={[change.key]} /><SavedCatalogCauseSourceLink record={record} partMap={partMap} accessoryMap={accessoryMap} /></div>)}</div>}</div></article>;
              })}</div> : <p className="history-check-diff-empty"><FiCheckCircle /> 선택한 시점 사이에 규칙별 변화가 없습니다.</p>}
            </>
          ) : <p className="history-check-diff-unavailable"><FiInfo /> 이 기록은 전체 결과·가격 요약만 저장된 옛 버전이라 항목별 비교를 보여드릴 수 없어요.</p>}
        </div>
      )}
      {showDiff && history.length === 1 && <p className="history-check-diff-unavailable"><FiInfo /> 검사 기록을 더 저장하면 두 시점의 항목별 변화와 가격 차이를 비교할 수 있어요.</p>}
    </section>
  );
}

export function savedPriceText(saved: SavedBuild, key: "totalPriceWon" | "coreTotalPriceWon" | "accessoryTotalPriceWon") {
  const summary = saved.summary;
  if (!summary) return "확인 필요";
  if (key !== "accessoryTotalPriceWon" && (!summary.priceComplete || !isKnownPrice(summary[key]))) return "가격 확인 필요";
  if (key === "accessoryTotalPriceWon" && summary.accessoryCount > 0 && !summary.priceComplete) return "가격 확인 필요";
  return key === "accessoryTotalPriceWon" && summary.accessoryCount === 0 ? "없음" : formatWon(summary[key]);
}
