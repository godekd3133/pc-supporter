import { useEffect, useMemo, useRef, useState } from "react";
import { FiActivity, FiArrowLeft, FiBox, FiCheck, FiClock, FiCopy, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLayers, FiLoader, FiPlus, FiRefreshCw, FiSearch, FiShare2, FiTrash2 } from "react-icons/fi";
import type { AlternativeRiskCounts, BenchmarkAvailabilityFilter, BuildSelection, CatalogChangeValueDiff, CompatiblePartCandidate, DataFreshness, DataQuality, GamingRefreshRate, GamingResolution, ListingPolicy, Part, PartCategory, PartRefreshResponse, PriceAvailabilityFilter, RecommendationProfile, ServiceMeta } from "../shared/types";
import { BENCHMARK_AVAILABILITY_LABELS, BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, isKnownPrice, LISTING_POLICY_LABELS, LISTING_TYPE_LABELS, PART_CATEGORIES, PRICE_AVAILABILITY_LABELS } from "../shared/types";
import { CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistContains, catalogWatchlistFromJson } from "../shared/catalog-watchlist";
import { priceWatchDecisionFor } from "../shared/price-watch-decision";
import type { PriceWatchDecisionHistory } from "../shared/price-watch-decision";
import { alternativeComparisonBenchmarkEvidenceFor, alternativeComparisonSimilarityEvidenceFor } from "../shared/alternative-comparison-export";
import type { AlternativeComparisonCandidate, AlternativeComparisonExportContext } from "../shared/alternative-comparison-export";
import { classifyDataFreshness } from "../shared/data-freshness";
import { benchmarkEvidenceForPart, benchmarkFreshnessLabelFor, benchmarkSourceCheckLabelFor } from "../shared/benchmark-evidence";
import type { BenchmarkEvidencePart } from "../shared/benchmark-evidence";
import { similarityBasisLabelFor, similarityReferenceTextFor } from "../shared/similarity-evidence";
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import type { CatalogSpecCoverageMissingField } from "../shared/catalog-spec-coverage";
import { compatibilityFilterPresetFor } from "../shared/compatibility-filter-preset";
import { safeExternalUrl } from "../shared/safe-source-url";
import { ApiError, api } from "./api";
import { CatalogSpecProvenance } from "./CatalogSpecProvenance";
import { safeHttpsUrl } from "./safe-source-url";
import { catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";
import { CatalogRefreshDiffPanel } from "./CatalogRefreshDiffPanel";

type CatalogSort = "price_asc" | "price_desc" | "name" | "updated" | "similarity" | "value";
export type CatalogCandidateScope = "safe" | "no_blocker" | "precision";
export type CatalogPart = Part & Partial<Pick<CompatiblePartCandidate, "candidateRisk" | "candidateReasons" | "remainingBlockers" | "remainingWarnings" | "remainingUnknown" | "recommendedQuantity" | "similarityScore" | "similarityLabel" | "similarityEvidence" | "performanceSummary" | "valueScore" | "valueLabel" | "valueEvidence" | "recommendationTrust" | "decision" | "physicalEvidence">> & { dataFreshness?: DataFreshness };
type CatalogPriceHistory = { kind: "part"; itemId: string; windowDays: 7 | 30 | 90; points: Array<{ changeId: string; changedAt: string; priceWon: number }>; summary: PriceWatchDecisionHistory & { maxPriceWon?: number } };
type CatalogSpecFilter = {
  socket: string;
  memoryType: string;
  formFactor: string;
  minVramGb: string;
  minCapacityGb: string;
  minWattageW: string;
  minMemorySpeedMhz: string;
  pcieSlotWidth: string;
  minPcieSlotCount: string;
  pcieSlotInfo: "all" | "complete" | "missing";
  interface: "all" | "NVMe" | "SATA";
};
type CatalogResponse = { items: CatalogPart[]; total: number; offset: number; limit: number; priceExcludedCount?: number; freshnessExcludedCount?: number; benchmarkStatus?: BenchmarkAvailabilityFilter; benchmarkExcludedCount?: number; nonCoreExcludedCount?: number; categoryMismatchExcludedCount?: number; missingField?: string; incompleteExcludedCount?: number; incompleteMissingFields?: CatalogSpecCoverageMissingField[]; specFilter?: Partial<CatalogSpecFilter>; specExcludedCount?: number; specFilterDiagnostics?: Array<{ key: string; label: string; excludedCount: number; missingCount: number }>; riskExcludedCount?: number; riskCounts?: AlternativeRiskCounts; mode?: CatalogCandidateScope };
type CatalogComparisonShare = { id: string; url: string; ownerToken: string; expiresAt?: string };
type CatalogComparisonContext = AlternativeComparisonExportContext;
type CatalogComparisonShareHandler = (candidates: AlternativeComparisonCandidate[], context?: { name?: string; category?: string; currentPartName?: string; currentPartSummary?: string; currentPartPrice?: string }) => Promise<CatalogComparisonShare | undefined>;
type CatalogComparisonRevokeHandler = (share: CatalogComparisonShare) => Promise<boolean>;
const PAGE_SIZE = 24;
const QUALITY_LABELS: Record<DataQuality, string> = DATA_QUALITY_LABELS;
const CANDIDATE_SCOPE_LABELS: Record<CatalogCandidateScope, string> = { safe: "안전 후보", no_blocker: "차단 없음", precision: "전체 정밀" };
const EMPTY_CATALOG_SPEC_FILTER: CatalogSpecFilter = { socket: "", memoryType: "", formFactor: "", minVramGb: "", minCapacityGb: "", minWattageW: "", minMemorySpeedMhz: "", pcieSlotWidth: "", minPcieSlotCount: "", pcieSlotInfo: "all", interface: "all" };
const CATALOG_GPU_VRAM_OPTIONS = [["", "전체"], ["8", "8GB 이상"], ["12", "12GB 이상"], ["16", "16GB 이상"], ["24", "24GB 이상"], ["32", "32GB 이상"]] as const;
const CATALOG_MEMORY_CAPACITY_OPTIONS = [["", "전체"], ["16", "16GB 이상"], ["32", "32GB 이상"], ["64", "64GB 이상"], ["128", "128GB 이상"]] as const;
const CATALOG_STORAGE_CAPACITY_OPTIONS = [["", "전체"], ["500", "500GB 이상"], ["1000", "1TB 이상"], ["2000", "2TB 이상"], ["4000", "4TB 이상"], ["8000", "8TB 이상"]] as const;
const CATALOG_MEMORY_SPEED_OPTIONS = [["", "전체"], ["4800", "4800MHz 이상"], ["5600", "5600MHz 이상"], ["6000", "6000MHz 이상"], ["6400", "6400MHz 이상"], ["7200", "7200MHz 이상"], ["8000", "8000MHz 이상"]] as const;
const CATALOG_PSU_WATTAGE_OPTIONS = [["", "전체"], ["500", "500W 이상"], ["650", "650W 이상"], ["750", "750W 이상"], ["850", "850W 이상"], ["1000", "1000W 이상"], ["1200", "1200W 이상"]] as const;
const CATALOG_PCIE_SLOT_WIDTH_OPTIONS = [["", "전체 슬롯 폭"], ["16", "x16 이상 사용 가능"], ["8", "x8 이상 사용 가능"], ["4", "x4 이상 사용 가능"], ["1", "x1 이상 사용 가능"]] as const;
const CATALOG_PCIE_SLOT_INFO_OPTIONS = [["all", "전체 정보 상태"], ["complete", "정보 확인됨"], ["missing", "정보 부족"]] as const;
const MOBILE_CATALOG_CATEGORY_ORDER: PartCategory[] = ["cpu", "motherboard", "memory", "gpu", "ssd"];

function candidateScopeDescription(scope: CatalogCandidateScope) {
  if (scope === "safe") return "새 차단 오류와 확인 필요를 만들지 않는 후보만 표시합니다.";
  if (scope === "no_blocker") return "새 차단 오류는 없지만 확인 필요가 남을 수 있는 후보를 포함합니다.";
  return "안전·확인 필요·차단 후보를 모두 정밀 평가해 표시합니다. 차단 후보는 적용하지 않습니다.";
}

function candidateScopeResultLabel(scope: CatalogCandidateScope) {
  return scope === "safe" ? "안전 후보" : scope === "no_blocker" ? "차단 없음 후보" : "전체 정밀 후보";
}

function selectedPartIdsFor(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory.map((item) => item.partId);
  if (category === "ssd") return build.ssd.map((item) => item.partId);
  if (category === "hdd") return build.hdd.map((item) => item.partId);
  const selection = build[category];
  return selection ? [selection.partId] : [];
}

function sourceLabel(source: Part["source"]) {
  return source === "danawa" ? "다나와 수집" : source === "manual" ? "수동 검수" : "프로젝트 데이터";
}

function freshnessLabel(part: Part) {
  const freshness = part.dataFreshness ?? classifyDataFreshness(part.updatedAt);
  return DATA_FRESHNESS_LABELS[freshness];
}

function priceLabel(priceWon: number | undefined) {
  return isKnownPrice(priceWon) ? `${priceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function downloadCatalogComparisonFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function catalogComparisonCandidatesFor(parts: CatalogPart[]): AlternativeComparisonCandidate[] {
  return parts.map((part) => {
    const sourceUrl = safeExternalUrl(part.danawaUrl);
    const similarityEvidence = alternativeComparisonSimilarityEvidenceFor(part.similarityEvidence);
    const benchmarkEvidence = alternativeComparisonBenchmarkEvidenceFor(benchmarkEvidenceForPart(part));
    return {
      name: part.name,
      category: part.category,
      partId: part.id,
      ...(isKnownPrice(part.priceWon) ? { priceWon: part.priceWon } : {}),
      priceEvidence: catalogPriceEvidenceFor(part),
      summary: compactSummary(part),
      price: priceLabel(part.priceWon),
      purchaseCondition: `${catalogPriceEvidenceLabelFor(part)} · ${part.listingType ? LISTING_TYPE_LABELS[part.listingType] : LISTING_TYPE_LABELS.retail}`,
      similarity: "카탈로그 스펙 직접 비교",
      ...(similarityEvidence ? { similarityEvidence } : {}),
      ...(benchmarkEvidence ? { benchmarkEvidence } : {}),
      performance: "현재 견적 대입 전 관찰 가능한 핵심 스펙 비교",
      compatibility: "현재 견적 대입 전 · 호환 검사 필요",
      dataQuality: QUALITY_LABELS[part.dataQuality],
      dataFreshness: part.dataFreshness ?? classifyDataFreshness(part.updatedAt),
      ...(part.updatedAt ? { updatedAt: part.updatedAt } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    };
  });
}

function candidateRiskLabel(risk: CatalogPart["candidateRisk"]) {
  return risk === "safe" ? "호환 확인" : risk === "review" ? "확인 필요" : risk === "unsafe" ? "차단 위험" : "카탈로그 기준";
}

function candidateDetailSummary(part: CatalogPart) {
  return [
    part.decision?.summary,
    part.similarityScore !== undefined ? `성능 유사도 · ${part.similarityLabel ?? "비교"} ${part.similarityScore}점` : undefined,
    part.performanceSummary,
    part.valueScore !== undefined && part.valueLabel ? `${part.valueLabel} ${part.valueScore}점` : undefined
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

function CatalogSimilarityEvidencePanel({ part }: { part: CatalogPart }) {
  const evidence = part.similarityEvidence;
  if (part.similarityScore === undefined || !evidence) return null;
  const dimensions = evidence.dimensions ?? [];
  return <section className="catalog-similarity-evidence" aria-label={`${part.name} 성능 비교 근거`} data-testid="catalog-similarity-evidence"><div className="catalog-similarity-evidence-heading"><div><strong>성능 비교 근거</strong><small>{part.similarityLabel ?? "비교"} {part.similarityScore}점 · {similarityBasisLabelFor(evidence)} · {evidence.comparedDimensions} / {evidence.totalDimensions}개 지표</small></div><span>{evidence.confidence === "high" ? "근거 충분" : evidence.confidence === "limited" ? "근거 제한" : "근거 확인 필요"}</span></div>{dimensions.length > 0 ? <div className="catalog-similarity-evidence-table-wrap"><table><caption>현재 선택 부품과 후보의 성능·확인 스펙 비교</caption><thead><tr><th scope="col">지표</th><th scope="col">현재</th><th scope="col">후보</th><th scope="col">일치 점수</th></tr></thead><tbody>{dimensions.map((dimension) => <tr key={dimension.key}><th scope="row">{dimension.label}</th><td>{dimension.currentValue}{dimension.source === "model_reference" && <small className="similarity-dimension-source">모델 참조</small>}</td><td>{dimension.candidateValue}</td><td>{dimension.score}점</td></tr>)}</tbody></table></div> : <p className="catalog-similarity-evidence-empty">현재 부품과 후보에서 함께 확인된 비교 지표가 없습니다. 호환 조건과 원문 스펙을 우선 확인하세요.</p>}{part.performanceSummary && <p className="catalog-similarity-evidence-summary">{part.performanceSummary}</p>}{evidence.reference && <p className="catalog-similarity-evidence-reference" data-testid="catalog-similarity-reference"><FiInfo /> <span>{similarityReferenceTextFor(evidence)}. 선택 부품에 직접 확인된 값은 유지하고, 비어 있던 모델 공통 지표만 참조값으로 보완했습니다.</span></p>}{evidence.notes?.filter((note) => !(evidence.reference && note.startsWith("현재 선택 부품에 없는"))).map((note) => <small className="catalog-similarity-evidence-note" key={note}><FiInfo /> {note}</small>)}<small className="catalog-similarity-evidence-disclaimer"><FiInfo /> 점수는 저장된 카탈로그 근거의 상대 비교이며 실제 FPS·작업 시간·게임 성능을 보장하지 않습니다.</small></section>;
}

function catalogBenchmarkStatusLabel(status: BenchmarkEvidencePart["status"]) {
  return status === "complete" ? "완전 근거" : status === "partial" ? "부분 근거" : "점수 없음";
}

function catalogBenchmarkDateLabel(value: string | undefined) {
  if (!value) return "갱신일 미확인";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("ko-KR") : value;
}

function catalogBenchmarkSourceCheckClass(evidence: BenchmarkEvidencePart) {
  if (!evidence.sourceCheck) return "not-checked";
  return benchmarkSourceCheckLabelFor(evidence.sourceCheck) === "원문 검증됨" ? "verified" : "review";
}

function CatalogBenchmarkEvidenceSummary({ part }: { part: CatalogPart }) {
  const evidence = benchmarkEvidenceForPart(part);
  if (!evidence) return null;
  const scoreSummary = evidence.rows.map((row) => `${row.label.replace("Cinebench R23 ", "").replace("3DMark ", "")} ${row.value === undefined ? "확인 필요" : `${row.value.toLocaleString("ko-KR")}${row.unit}`}`).join(" · ");
  const sourceSummary = evidence.provenance ? BENCHMARK_SOURCE_KIND_LABELS[evidence.provenance.sourceKind] : "출처 유형 미등록";
  return <><em className={`catalog-benchmark-evidence-summary ${evidence.status}`} data-testid="catalog-benchmark-evidence-summary"><FiActivity /> 성능 근거 · {catalogBenchmarkStatusLabel(evidence.status)} {evidence.presentCount}/{evidence.totalCount}</em><em className={`catalog-benchmark-evidence-points ${evidence.status}`} title={`${scoreSummary} · ${sourceSummary} · ${benchmarkSourceCheckLabelFor(evidence.sourceCheck)}`}>{scoreSummary} · {sourceSummary} · {benchmarkSourceCheckLabelFor(evidence.sourceCheck)}</em></>;
}

function CatalogBenchmarkEvidence({ part }: { part: CatalogPart }) {
  const evidence = benchmarkEvidenceForPart(part);
  if (!evidence) return null;
  const sourceUrl = safeHttpsUrl(evidence.provenance?.sourceUrl);
  const sourceCheckLabel = benchmarkSourceCheckLabelFor(evidence.sourceCheck);
  const sourceNote = evidence.provenance?.sourceNote?.trim() || "점수 출처 메모 미등록 · 원문 확인 필요";
  return <section className={`catalog-benchmark-evidence ${evidence.status}`} aria-label={`${part.name} 성능 근거`} data-testid="catalog-benchmark-evidence">
    <div className="catalog-benchmark-evidence-heading"><div><strong><FiActivity /> 성능 근거 상세</strong><small>{catalogBenchmarkStatusLabel(evidence.status)} · {evidence.presentCount}/{evidence.totalCount}개 점수 · 자료 {benchmarkFreshnessLabelFor(evidence.benchmarkFreshness)}</small></div><span>{evidence.category === "cpu" ? "CPU" : "GPU"}</span></div>
    <div className="catalog-benchmark-evidence-score-grid" data-testid="catalog-benchmark-evidence-scores">{evidence.rows.map((row) => <div key={row.key}><span>{row.label}</span><strong>{row.value === undefined ? "확인 필요" : `${row.value.toLocaleString("ko-KR")}${row.unit}`}</strong></div>)}</div>
    <div className="catalog-benchmark-evidence-source"><div><span>점수 출처</span><strong>{evidence.provenance ? BENCHMARK_SOURCE_KIND_LABELS[evidence.provenance.sourceKind] : "출처 유형 미등록"}</strong><small>{sourceNote}{evidence.provenance?.updatedAt ? ` · 근거 갱신 ${catalogBenchmarkDateLabel(evidence.provenance.updatedAt)}` : ""}</small></div>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 원문</a>}</div>
    <div className="catalog-benchmark-evidence-meta"><span className={catalogBenchmarkSourceCheckClass(evidence)}>원문 점검 · {sourceCheckLabel}{evidence.sourceCheck?.detail ? ` · ${evidence.sourceCheck.detail}` : ""}</span><small>부품 데이터 갱신 {catalogBenchmarkDateLabel(evidence.dataUpdatedAt)}</small></div>
    <p className="catalog-benchmark-evidence-note"><FiInfo /> 점수는 측정 설정·드라이버·시스템 조건에 따라 달라지는 참고값입니다. 출처가 없거나 일부 점수만 있으면 비교 전 원문 확인이 필요합니다.</p>
  </section>;
}

function compactSummary(part: Part) {
  const values = [
    part.specs.socket,
    part.specs.memoryType,
    part.specs.capacityGb !== undefined ? `${part.specs.capacityGb}GB` : undefined,
    part.specs.vramGb !== undefined ? `VRAM ${part.specs.vramGb}GB` : undefined,
    part.specs.wattageW !== undefined ? `${part.specs.wattageW}W` : undefined,
    part.specs.formFactor,
    part.specs.interface
  ].filter((value): value is string => typeof value === "string");
  return values.slice(0, 4).join(" · ") || "상세 스펙 확인 필요";
}

function selectionsForCategory(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function catalogComparisonContextFor(build: BuildSelection, category: PartCategory, partMap: ReadonlyMap<string, Part>): CatalogComparisonContext {
  const selections = selectionsForCategory(build, category);
  const entries = selections
    .map((selection) => ({ selection, part: partMap.get(selection.partId) }))
    .filter((entry): entry is { selection: (typeof selections)[number]; part: Part } => Boolean(entry.part));
  if (entries.length === 0) return {};
  const currentPartName = entries.map(({ selection, part }) => `${part.name}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(" · ");
  const currentPartSummary = entries.map(({ part }) => compactSummary(part)).join(" / ");
  const currentPartPriceKnown = entries.length === selections.length && entries.every(({ part }) => isKnownPrice(part.priceWon));
  const currentPartPrice = currentPartPriceKnown
    ? priceLabel(entries.reduce((total, { selection, part }) => total + (part.priceWon ?? 0) * selection.quantity, 0))
    : "가격 확인 필요";
  return { category: CATEGORY_LABELS[category], currentPartName, currentPartSummary, currentPartPrice };
}

function specRowsFor(part: Part) {
  const specs = part.specs;
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: unknown, suffix = "") => {
    if (value === undefined || value === null || value === "") return;
    const text = Array.isArray(value) ? value.join(" · ") : typeof value === "boolean" ? value ? "있음" : "없음" : String(value);
    rows.push([label, `${text}${suffix}`]);
  };
  add("소켓", specs.socket);
  add("지원 소켓", specs.supportedSockets);
  add("메모리 세대", specs.memoryType);
  add("메모리 규격", specs.memoryFormFactor);
  add("코어", specs.cores, "코어");
  add("스레드", specs.threads, "스레드");
  add("부스트 클럭", specs.boostClockGhz, "GHz");
  add("TDP", specs.tdpW, "W");
  add("PPT", specs.pptW, "W");
  add("내장 그래픽", specs.integratedGraphics);
  add("CPU 싱글 점수", specs.cinebenchR23Single);
  add("CPU 멀티 점수", specs.cinebenchR23Multi);
  add("최대 메모리", specs.maxMemoryGb, "GB");
  add("메모리 슬롯", specs.memorySlots, "개");
  add("메모리 속도", specs.speedMhz, "MHz");
  add("킷 모듈 수", specs.memoryModuleCountPerKit, "개");
  add("메모리 타이밍", specs.memoryTiming);
  add("CAS 지연", specs.memoryCasLatency, "");
  add("용량", specs.capacityGb, "GB");
  add("연결 방식", specs.interface);
  add("폼팩터", specs.formFactor);
  add("순차 읽기", specs.sequentialReadMbps, "MB/s");
  add("순차 쓰기", specs.sequentialWriteMbps, "MB/s");
  add("컨트롤러", specs.ssdController);
  add("낸드", specs.ssdNandType);
  add("TBW", specs.ssdTbwTb, "TB");
  add("GPU 제조사", specs.gpuVendor);
  add("GPU 아키텍처", specs.gpuArchitectureFamily);
  add("VRAM", specs.vramGb, "GB");
  add("GPU 메모리", specs.gpuMemoryType);
  add("GPU 소비전력", specs.powerW, "W");
  add("권장 파워", specs.recommendedPsuW, "W");
  add("GPU 길이", specs.lengthMm, "mm");
  add("GPU 폭", specs.widthMm, "mm");
  add("GPU 두께", specs.thicknessMm, "mm");
  add("GPU 슬롯 점유", specs.gpuSlotOccupancy, "slot");
  add("Time Spy", specs.gpu3dmarkTimeSpyScore);
  add("Port Royal", specs.gpu3dmarkPortRoyalScore);
  add("메인보드 규격", specs.motherboardFormFactors);
  add("M.2 슬롯", specs.m2Slots, "개");
  add("SATA 포트", specs.sataPorts, "개");
  add("PCIe x16 슬롯", specs.pcieX16Slots, "개");
  add("PCIe x8 슬롯", specs.pcieX8Slots, "개");
  add("PCIe x4 슬롯", specs.pcieX4Slots, "개");
  add("PCIe x1 슬롯", specs.pcieX1Slots, "개");
  add("최대 GPU 길이", specs.maxGpuLengthMm, "mm");
  add("최대 쿨러 높이", specs.maxCoolerHeightMm, "mm");
  add("최대 PSU 길이", specs.maxPsuLengthMm, "mm");
  add("HDD 베이", specs.hddBays, "개");
  add("SSD 베이", specs.ssdBays, "개");
  add("최대 냉각 용량", specs.maxCoolingW, "W");
  add("PSU 규격", specs.psuFormFactor);
  add("PSU 깊이", specs.psuDepthMm, "mm");
  add("정격 출력", specs.wattageW, "W");
  add("효율", specs.efficiency);
  add("케이블", specs.psuCableType === "fully_modular" ? "풀모듈러" : specs.psuCableType === "semi_modular" ? "세미모듈러" : specs.psuCableType === "fixed" ? "케이블 일체형" : undefined);
  add("레일", specs.psuRailType === "single" ? "싱글 레일" : specs.psuRailType === "multi" ? "멀티 레일" : undefined);
  add("팬 수", specs.fanCount, "개");
  add("팬 포트", specs.fanPortCount, "개");
  add("RGB 포트", specs.rgbPortCount, "개");
  return rows.filter(([, value], index, all) => all.findIndex(([, candidate]) => candidate === value) === index).slice(0, 18);
}

function catalogWatchTargetFor(part: Part, raw = typeof window === "undefined" ? null : window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)) {
  if (typeof window === "undefined") return undefined;
  return catalogWatchlistFromJson(raw).find((entry) => entry.kind === "part" && entry.itemId === part.id)?.targetPriceWon;
}

function initialCatalogCategory() {
  if (typeof window === "undefined") return "cpu" as PartCategory;
  const value = new URLSearchParams(window.location.search).get("category");
  return PART_CATEGORIES.includes(value as PartCategory) ? value as PartCategory : "cpu";
}

function initialCatalogQuery() {
  if (typeof window === "undefined") return "";
  const value = new URLSearchParams(window.location.search).get("q") ?? new URLSearchParams(window.location.search).get("search");
  return value?.trim().slice(0, 160) ?? "";
}

function initialCatalogBrand() {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("brand") ?? "").trim().slice(0, 80);
}

function initialCatalogPartId() {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("partId");
  return value?.trim().slice(0, 160) || undefined;
}

function initialCatalogPage() {
  if (typeof window === "undefined") return 0;
  const params = new URLSearchParams(window.location.search);
  if (params.get("partId")) return 0;
  const value = Number.parseInt(params.get("page") ?? "", 10);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, 1000) - 1 : 0;
}

function initialCatalogMode() {
  if (typeof window === "undefined") return "catalog" as const;
  return new URLSearchParams(window.location.search).get("mode") === "compatible" ? "compatible" as const : "catalog" as const;
}

function initialCatalogCandidateScope() {
  if (typeof window === "undefined") return "safe" as CatalogCandidateScope;
  const value = new URLSearchParams(window.location.search).get("candidateScope");
  return value === "no_blocker" || value === "precision" || value === "safe" ? value : "safe";
}

function initialCatalogQuality() {
  if (typeof window === "undefined") return "all" as const;
  const value = new URLSearchParams(window.location.search).get("quality");
  return value === "seed" || value === "live" || value === "manual" || value === "incomplete" ? value : "all";
}

function initialCatalogMissingField() {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("missingField") ?? "").trim().slice(0, 120);
}

function initialCatalogFreshness() {
  if (typeof window === "undefined") return "all" as const;
  const value = new URLSearchParams(window.location.search).get("freshness");
  return value === "fresh" || value === "aging" || value === "stale" || value === "unknown" ? value : "all";
}

function initialCatalogPriceStatus() {
  if (typeof window === "undefined") return "all" as const;
  const value = new URLSearchParams(window.location.search).get("priceStatus");
  return value === "known" || value === "unknown" ? value : "all";
}

function initialCatalogBenchmarkStatus(): BenchmarkAvailabilityFilter {
  if (typeof window === "undefined") return "all";
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  const mode = params.get("mode");
  const value = params.get("benchmarkStatus");
  return mode !== "compatible" && (category === "cpu" || category === "gpu") && (value === "complete" || value === "incomplete") ? value : "all";
}

function initialCatalogSpecFilter(): CatalogSpecFilter {
  if (typeof window === "undefined") return { ...EMPTY_CATALOG_SPEC_FILTER };
  const params = new URLSearchParams(window.location.search);
  const value = (key: keyof CatalogSpecFilter) => params.get(key)?.trim() ?? "";
  const interfaceValue = value("interface");
  const pcieSlotInfoValue = value("pcieSlotInfo");
  return {
    socket: value("socket"),
    memoryType: value("memoryType"),
    formFactor: value("formFactor"),
    minVramGb: value("minVramGb"),
    minCapacityGb: value("minCapacityGb"),
    minWattageW: value("minWattageW"),
    minMemorySpeedMhz: value("minMemorySpeedMhz"),
    pcieSlotWidth: value("pcieSlotWidth"),
    minPcieSlotCount: value("minPcieSlotCount"),
    pcieSlotInfo: pcieSlotInfoValue === "complete" || pcieSlotInfoValue === "missing" ? pcieSlotInfoValue : "all",
    interface: interfaceValue === "NVMe" || interfaceValue === "SATA" ? interfaceValue : "all"
  };
}

function catalogSpecFilterPayloadFor(category: PartCategory, filter: CatalogSpecFilter) {
  const payload: Record<string, string> = {};
  if (["cpu", "cooler", "motherboard"].includes(category) && filter.socket.trim()) payload.socket = filter.socket.trim();
  if (["cpu", "motherboard", "memory"].includes(category) && filter.memoryType.trim()) payload.memoryType = filter.memoryType.trim();
  if (["case", "motherboard", "memory", "ssd", "psu"].includes(category) && filter.formFactor.trim()) payload.formFactor = filter.formFactor.trim();
  if (category === "gpu" && filter.minVramGb.trim()) payload.minVramGb = filter.minVramGb.trim();
  if (["memory", "ssd", "hdd"].includes(category) && filter.minCapacityGb.trim()) payload.minCapacityGb = filter.minCapacityGb.trim();
  if (category === "psu" && filter.minWattageW.trim()) payload.minWattageW = filter.minWattageW.trim();
  if (category === "memory" && filter.minMemorySpeedMhz.trim()) payload.minMemorySpeedMhz = filter.minMemorySpeedMhz.trim();
  if (category === "motherboard" && filter.pcieSlotWidth.trim()) payload.pcieSlotWidth = filter.pcieSlotWidth.trim();
  if (category === "motherboard" && filter.minPcieSlotCount.trim()) payload.minPcieSlotCount = filter.minPcieSlotCount.trim();
  if (category === "motherboard" && filter.pcieSlotInfo !== "all") payload.pcieSlotInfo = filter.pcieSlotInfo;
  if (["ssd", "hdd"].includes(category) && filter.interface !== "all") payload.interface = filter.interface;
  return payload;
}

function catalogSpecFilterSummaryFor(category: PartCategory, filter: CatalogSpecFilter) {
  const values: string[] = [];
  if (["cpu", "cooler", "motherboard"].includes(category) && filter.socket.trim()) values.push(`소켓 ${filter.socket.trim()}`);
  if (["cpu", "motherboard", "memory"].includes(category) && filter.memoryType.trim()) values.push(`메모리 세대 ${filter.memoryType.trim()}`);
  if (["case", "motherboard", "memory", "ssd", "psu"].includes(category) && filter.formFactor.trim()) values.push(`폼팩터 ${filter.formFactor.trim()}`);
  if (category === "gpu" && filter.minVramGb.trim()) values.push(`VRAM ${filter.minVramGb.trim()}GB 이상`);
  if (["memory", "ssd", "hdd"].includes(category) && filter.minCapacityGb.trim()) values.push(`${category === "memory" ? "모듈 용량" : "용량"} ${filter.minCapacityGb.trim()}GB 이상`);
  if (category === "psu" && filter.minWattageW.trim()) values.push(`정격 ${filter.minWattageW.trim()}W 이상`);
  if (category === "memory" && filter.minMemorySpeedMhz.trim()) values.push(`속도 ${filter.minMemorySpeedMhz.trim()}MHz 이상`);
  if (category === "motherboard" && (filter.pcieSlotWidth.trim() || filter.minPcieSlotCount.trim())) {
    const width = filter.pcieSlotWidth.trim() ? `x${filter.pcieSlotWidth.trim()} 이상` : "전체 폭";
    const count = filter.minPcieSlotCount.trim() || "1";
    values.push(`PCIe ${width} 슬롯 ${count}개 이상`);
  }
  if (category === "motherboard" && filter.pcieSlotInfo !== "all") values.push(filter.pcieSlotInfo === "complete" ? "PCIe 슬롯 정보 확인됨" : "PCIe 슬롯 정보 부족");
  if (["ssd", "hdd"].includes(category) && filter.interface !== "all") values.push(filter.interface);
  return values.join(" · ");
}

function catalogCompatibilityPresetFor(category: PartCategory, build: BuildSelection, partMap: ReadonlyMap<string, Part>) {
  const preset = compatibilityFilterPresetFor(category, build, partMap);
  const supportedKeys = new Set(["socket", "memoryType", "formFactor", "minVramGb", "minCapacityGb", "minWattageW", "minMemorySpeedMhz", "pcieSlotWidth", "minPcieSlotCount", "pcieSlotInfo", "storageInterface"]);
  const values = Object.fromEntries(Object.entries(preset.values)
    .filter(([key, value]) => supportedKeys.has(key as keyof CatalogSpecFilter) && value !== undefined)
    .map(([key, value]) => [key === "storageInterface" ? "interface" : key, value])) as Partial<CatalogSpecFilter>;
  return { values, summary: catalogSpecFilterSummaryFor(category, { ...EMPTY_CATALOG_SPEC_FILTER, ...values }), omitted: preset.omitted };
}

function initialCatalogListingPolicy() {
  if (typeof window === "undefined") return "all" as ListingPolicy;
  const value = new URLSearchParams(window.location.search).get("listingPolicy");
  return value === "retail_only" || value === "include_bulk" || value === "all" ? value : "all";
}

function initialCatalogSort() {
  if (typeof window === "undefined") return "price_asc" as CatalogSort;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("sort");
  if (value === "benchmark_desc" && params.get("mode") === "compatible") return "similarity";
  if ((value === "similarity" || value === "value") && params.get("mode") !== "compatible") return "price_asc";
  if (value === "price_asc" || value === "price_desc" || value === "name" || value === "updated" || value === "similarity" || value === "value") return value;
  return params.get("mode") === "compatible" ? "similarity" : "price_asc";
}

function initialCatalogBenchmarkSort() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  return params.get("mode") !== "compatible" && (category === "cpu" || category === "gpu") && params.get("sort") === "benchmark_desc";
}

function CatalogWatchButton({ part, onWatch, isWatched }: { part: Part; onWatch: (part: Part) => boolean; isWatched?: (part: Part) => boolean }) {
  const [watching, setWatching] = useState(() => isWatched?.(part) ?? catalogWatchTargetFor(part) !== undefined);
  useEffect(() => {
    if (isWatched?.(part) || catalogWatchTargetFor(part) !== undefined) setWatching(true);
  }, [isWatched, part.id]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_WATCHLIST_STORAGE_KEY) return;
      setWatching(catalogWatchlistContains(catalogWatchlistFromJson(event.newValue), { kind: "part", itemId: part.id }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [part.id]);
  function register() {
    if (onWatch(part)) setWatching(true);
  }
  return <button className={watching ? "text-button part-watch-button watched" : "text-button part-watch-button"} type="button" data-item-id={part.id} onClick={register} disabled={watching} aria-label={`${part.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "추적 중" : "가격 추적"}</button>;
}

function CatalogPriceActionPanel({ part, history, loading, error }: { part: Part; history?: CatalogPriceHistory; loading: boolean; error: string | null }) {
  const targetPriceWon = catalogWatchTargetFor(part);
  const decision = priceWatchDecisionFor({ currentStatus: isKnownPrice(part.priceWon) ? "available" : "unavailable", currentPriceWon: part.priceWon, targetPriceWon, nearLowThresholdPercent: 10, history: history?.summary });
  const historySummary = history && history.summary.sampleCount > 0
    ? `최근 ${history.windowDays}일 ${history.summary.sampleCount}회${history.summary.minPriceWon !== undefined ? ` · 최저 ${history.summary.minPriceWon.toLocaleString("ko-KR")}원` : ""}${history.summary.fromHighPercent !== undefined && history.summary.fromHighPercent < -0.05 ? ` · 최고가 대비 ${history.summary.fromHighPercent.toFixed(1)}%` : ""}`
    : undefined;
  return <section className={`catalog-price-action ${decision.state}`} aria-label="가격 행동 상태"><div><span>가격 행동</span><strong>{decision.label}</strong><small>{decision.summary}</small></div>{loading && !history && <small className="catalog-price-action-loading">최근 가격 이력 확인 중...</small>}{error && !history && <small className="catalog-price-action-error">가격 이력을 확인하지 못했습니다.</small>}{historySummary && <small className="catalog-price-action-history">{historySummary}</small>}</section>;
}

function CatalogPartVisual({ part }: { part: CatalogPart }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageUrl = safeExternalUrl(part.imageUrl);
  if (imageUrl && imageUrl !== failedImageUrl) {
    return <img src={imageUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedImageUrl(imageUrl)} />;
  }
  return <FiBox aria-hidden="true" data-image-fallback="true" />;
}

function CatalogPartCard({ part, selected, compareSelected, showCompare, onSelect, onAdd, onToggleCompare, onWatchPart, isPartWatched }: { part: CatalogPart; selected: boolean; compareSelected: boolean; showCompare: boolean; onSelect: () => void; onAdd: () => void; onToggleCompare: () => void; onWatchPart?: (part: Part) => boolean; isPartWatched?: (part: Part) => boolean }) {
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  const blocked = part.candidateRisk === "unsafe";
  return <article className={selected ? "catalog-part-card selected" : "catalog-part-card"}>
    <button className="catalog-part-card-main" type="button" data-testid={`catalog-part-${part.id}`} onClick={onSelect}>
      <span className="catalog-part-card-image"><CatalogPartVisual part={part} /></span>
      <span className="catalog-part-card-copy"><strong>{part.name}</strong><small>{part.brand ?? part.model ?? sourceLabel(part.source)}</small><span>{compactSummary(part)}</span><em>{QUALITY_LABELS[part.dataQuality]} · {freshnessLabel(part)}</em><em className={`catalog-price-evidence ${catalogPriceEvidenceFor(part)}`} data-testid={`catalog-price-evidence-${part.id}`} title={catalogPriceEvidenceDescriptionFor(part)}>{catalogPriceEvidenceLabelFor(part)}</em><CatalogBenchmarkEvidenceSummary part={part} />{part.candidateRisk && <em className={`catalog-candidate-risk ${part.candidateRisk}`}>{candidateRiskLabel(part.candidateRisk)}{part.similarityScore !== undefined ? ` · 유사도 ${part.similarityScore}점` : ""}</em>}{part.decision && <em className={`catalog-candidate-decision ${part.decision.status}`}>후보 기준 · {part.decision.label}</em>}</span>
      <span className="catalog-part-card-price">{priceLabel(part.priceWon)}</span>
    </button>
    <div className="catalog-part-card-actions">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${part.name} 원문 보기`}>원문 <FiExternalLink /></a>}{onWatchPart && <CatalogWatchButton part={part} onWatch={onWatchPart} isWatched={isPartWatched} />}{showCompare && <button className={compareSelected ? "button button-small catalog-part-compare selected" : "button button-small catalog-part-compare"} type="button" aria-pressed={compareSelected} data-testid={`catalog-compare-${part.id}`} onClick={onToggleCompare}>{compareSelected ? <><FiCheck /> 비교 중</> : <><FiLayers /> 비교</>}</button>}<button className="button button-small catalog-part-add" type="button" onClick={onAdd} disabled={selected || blocked}>{blocked ? "차단 위험 · 적용 불가" : selected ? <><FiCheck /> 현재 선택</> : <><FiPlus /> 견적에 추가</>}</button></div>
  </article>;
}

function CatalogPartDetail({ part, priceHistory, priceHistoryLoading, priceHistoryError, onAdd, selected, compareSelected, showCompare, onToggleCompare, onWatchPart, isPartWatched, onOpenWatchlist, onOpenBuild, onRefresh, refreshing, refreshMessage, refreshError, refreshDiffs }: { part: CatalogPart; priceHistory?: CatalogPriceHistory; priceHistoryLoading: boolean; priceHistoryError: string | null; onAdd: () => void; selected: boolean; compareSelected: boolean; showCompare: boolean; onToggleCompare: () => void; onWatchPart?: (part: Part) => boolean; isPartWatched?: (part: Part) => boolean; onOpenWatchlist?: () => void; onOpenBuild: () => void; onRefresh?: () => void; refreshing?: boolean; refreshMessage?: string | null; refreshError?: string | null; refreshDiffs?: CatalogChangeValueDiff[] | null }) {
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  const blocked = part.candidateRisk === "unsafe";
  return <section className="catalog-detail" aria-label="선택한 부품 상세" data-testid="catalog-part-detail">
    <div className="catalog-detail-heading"><div><p className="eyebrow">PART DETAIL</p><h2>{part.name}</h2><p>{CATEGORY_LABELS[part.category]} · {part.brand ?? part.model ?? sourceLabel(part.source)}</p></div><CatalogPartVisual part={part} /></div>
    <div className="catalog-detail-badges"><span>{QUALITY_LABELS[part.dataQuality]}</span><span>{freshnessLabel(part)}</span><span>{sourceLabel(part.source)}</span>{part.listingType && part.listingType !== "retail" && <span>{part.listingType === "bulk" ? "벌크" : part.listingType === "parallel_import" ? "병행수입" : "유통 조건 확인"}</span>}</div>
    <CatalogSpecProvenance part={part} />
    <CatalogBenchmarkEvidence part={part} />
    <CatalogPriceActionPanel part={part} history={priceHistory} loading={priceHistoryLoading} error={priceHistoryError} />
    {part.candidateRisk && <div className={`catalog-candidate-summary ${part.candidateRisk}`}><strong>{candidateRiskLabel(part.candidateRisk)}</strong><small className="catalog-candidate-scope-note">후보 기준 · 현재 견적 대입 평가</small><span>{candidateDetailSummary(part) || "현재 견적 기준 후보 평가 결과입니다."}</span>{part.candidateReasons && part.candidateReasons.length > 0 && <small>평가 메모 · {part.candidateReasons.slice(0, 2).join(" · ")}</small>}{part.remainingBlockers !== undefined && <small>남은 위험 · 차단 {part.remainingBlockers} · 주의 {part.remainingWarnings ?? 0} · 확인 필요 {part.remainingUnknown ?? 0}</small>}{part.recommendationTrust && <small>추천 근거 · {part.recommendationTrust.level === "high" ? "높음" : part.recommendationTrust.level === "medium" ? "보통" : "낮음"} {part.recommendationTrust.score}점</small>}</div>}
    <CatalogSimilarityEvidencePanel part={part} />
    <div className="catalog-detail-price"><div><span>현재 가격</span><small className={`catalog-detail-price-evidence ${catalogPriceEvidenceFor(part)}`} data-testid="catalog-price-evidence" title={catalogPriceEvidenceDescriptionFor(part)}>{catalogPriceEvidenceLabelFor(part)}</small></div><strong>{priceLabel(part.priceWon)}</strong></div>
    <dl className="catalog-detail-specs">{specRowsFor(part).map(([label, value]) => <div key={`${label}-${value}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {part.missingFields.length > 0 && <p className="catalog-detail-missing"><FiInfo /> 확인되지 않은 스펙 {part.missingFields.slice(0, 5).join(", ")}{part.missingFields.length > 5 ? ` 외 ${part.missingFields.length - 5}개` : ""}</p>}
    {part.rawSpecText && <details className="catalog-detail-raw"><summary>저장된 원문 스펙 보기</summary><p>{part.rawSpecText}</p></details>}
    <div className="catalog-detail-actions">{onWatchPart && <CatalogWatchButton part={part} onWatch={onWatchPart} isWatched={isPartWatched} />}{onOpenWatchlist && <button className="button button-light" type="button" onClick={onOpenWatchlist}><FiClock /> 가격 추적 화면</button>}{showCompare && <button className={compareSelected ? "button button-light catalog-detail-compare selected" : "button button-light catalog-detail-compare"} type="button" aria-pressed={compareSelected} onClick={onToggleCompare}>{compareSelected ? <><FiCheck /> 비교에서 제외</> : <><FiLayers /> 비교에 추가</>}</button>}<button className="button button-primary" type="button" onClick={onAdd} disabled={selected || blocked}>{blocked ? "차단 위험 · 적용 불가" : selected ? <><FiCheck /> 현재 견적에 선택됨</> : <><FiPlus /> 현재 견적에 추가</>}</button><button className="button button-light" type="button" onClick={onOpenBuild}><FiActivity /> 견적 검사로 이동</button>{part.source === "danawa" && part.sourceProductCode && part.danawaUrl && <button className="button button-light catalog-detail-refresh" type="button" data-testid="catalog-refresh-part" onClick={onRefresh} disabled={!onRefresh || refreshing}>{refreshing ? <><FiLoader className="spin" /> 원문 확인 중...</> : <><FiRefreshCw /> 원문 다시 확인</>}</button>}{sourceUrl && <a className="button button-light" href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 원문 열기</a>}</div>
    {(refreshMessage || refreshError) && <p className={refreshError ? "catalog-detail-refresh-status error" : "catalog-detail-refresh-status"} role={refreshError ? "alert" : "status"}><FiInfo /> {refreshError ?? refreshMessage}</p>}
    {refreshDiffs !== undefined && refreshDiffs !== null && <CatalogRefreshDiffPanel diffs={refreshDiffs} kind="part" />}
    {blocked && <p className="catalog-detail-blocked-note"><FiInfo /> 전체 정밀 후보에서 차단 위험이 확인된 부품은 현재 견적에 자동 적용하지 않습니다.</p>}
    <p className="catalog-detail-note"><FiInfo /> 카탈로그의 스펙·가격·갱신 상태를 보여주는 화면입니다. 현재 견적에 추가한 뒤 전체 호환성 검사를 실행해야 실제 조합 판정을 확인할 수 있습니다.</p>
  </section>;
}

function CatalogNonCoreNotice({ count, categoryMismatchCount, query, onOpenAccessories }: { count: number; categoryMismatchCount: number; query: string; onOpenAccessories?: (query?: string) => void }) {
  if (count <= 0) return null;
  const normalizedCategoryMismatchCount = Math.min(count, Math.max(0, categoryMismatchCount));
  const nonCategoryCount = count - normalizedCategoryMismatchCount;
  return <div className="catalog-non-core-notice" role="status" data-testid="catalog-non-core-notice"><FiInfo /><div><strong>{count.toLocaleString("ko-KR")}개는 핵심 후보에서 제외되었습니다.</strong><p>{normalizedCategoryMismatchCount > 0 && `카테고리 정합성 불일치 ${normalizedCategoryMismatchCount.toLocaleString("ko-KR")}개`}{normalizedCategoryMismatchCount > 0 && nonCategoryCount > 0 ? " · " : ""}{nonCategoryCount > 0 && `주변 부품·비핵심 유통 ${nonCategoryCount.toLocaleString("ko-KR")}개`}는 핵심 호환 후보와 분리해 관리합니다. 원본 레코드는 데이터 품질 검수용으로 보존합니다.</p></div>{nonCategoryCount > 0 && onOpenAccessories && <button className="button button-small button-light" type="button" data-testid="catalog-open-accessories" onClick={() => onOpenAccessories(query.trim() || undefined)}>주변 부품에서 보기</button>}</div>;
}

function CatalogIncompleteNotice({ count, category, missingFields }: { count: number; category: PartCategory; missingFields: CatalogSpecCoverageMissingField[] }) {
  if (count <= 0) return null;
  return <div className="catalog-incomplete-notice" role="status" data-testid="catalog-incomplete-notice"><FiInfo /><div><strong>데이터 부족 후보 {count.toLocaleString("ko-KR")}개는 안전 후보에서 제외했습니다.</strong><p>필수 스펙이 부족한 부품을 호환 가능하다고 가정하지 않습니다. 원문을 보강한 뒤 다시 후보 평가에 포함할 수 있습니다.</p><div className="catalog-incomplete-fields">{missingFields.slice(0, 3).map((field) => <a className="catalog-incomplete-field-link" data-testid="catalog-open-missing-field" href={`/catalog?category=${encodeURIComponent(category)}&quality=incomplete&missingField=${encodeURIComponent(field.field)}`} key={field.field}>{catalogMissingFieldLabelFor(field.field)} {field.count}개</a>)}</div></div><a className="button button-small button-light" data-testid="catalog-open-incomplete" href={`/catalog?category=${encodeURIComponent(category)}&quality=incomplete`}>불완전 데이터 보기</a></div>;
}

function CatalogSpecFilterPanel({ category, filter, specExcludedCount, specFilterDiagnostics, onChange, onReset }: { category: PartCategory; filter: CatalogSpecFilter; specExcludedCount: number; specFilterDiagnostics: Array<{ key: string; label: string; excludedCount: number; missingCount: number }>; onChange: (next: CatalogSpecFilter) => void; onReset: () => void }) {
  const summary = catalogSpecFilterSummaryFor(category, filter);
  const update = <K extends keyof CatalogSpecFilter>(key: K, value: CatalogSpecFilter[K]) => onChange({ ...filter, [key]: value });
  const missing = specFilterDiagnostics.filter((diagnostic) => diagnostic.missingCount > 0).slice(0, 3);
  return <section className="catalog-spec-filter-panel" aria-label="카탈로그 핵심 사양 필터" data-testid="catalog-spec-filters"><div className="catalog-spec-filter-heading"><div><span className="mini-label">SPEC FILTER</span><strong>핵심 사양 조건</strong><small>전체 카탈로그에 확인된 값만 적용합니다. 값을 확인하지 못한 상품은 조건을 만족한다고 추정하지 않습니다.</small></div><button className="text-button" type="button" data-testid="catalog-clear-spec-filters" onClick={onReset} disabled={!summary}>조건 초기화</button></div><div className="catalog-spec-filter-grid">{["cpu", "cooler", "motherboard"].includes(category) && <label><span>소켓</span><input aria-label="카탈로그 소켓 스펙 필터" value={filter.socket} placeholder="예: AM5" onChange={(event) => update("socket", event.target.value)} /></label>}{["cpu", "motherboard", "memory"].includes(category) && <label><span>메모리 세대</span><input aria-label="카탈로그 메모리 세대 스펙 필터" value={filter.memoryType} placeholder="예: DDR5" onChange={(event) => update("memoryType", event.target.value)} /></label>}{["case", "motherboard", "memory", "ssd", "psu"].includes(category) && <label><span>폼팩터</span><input aria-label="카탈로그 폼팩터 스펙 필터" value={filter.formFactor} placeholder="예: ATX · M.2" onChange={(event) => update("formFactor", event.target.value)} /></label>}{category === "motherboard" && <><label><span>PCIe 슬롯 정보</span><select aria-label="카탈로그 PCIe 슬롯 정보 상태 필터" value={filter.pcieSlotInfo} onChange={(event) => update("pcieSlotInfo", event.target.value as CatalogSpecFilter["pcieSlotInfo"])}>{CATALOG_PCIE_SLOT_INFO_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>PCIe 슬롯 폭</span><select aria-label="카탈로그 PCIe 슬롯 폭 스펙 필터" value={filter.pcieSlotWidth} onChange={(event) => update("pcieSlotWidth", event.target.value)}>{CATALOG_PCIE_SLOT_WIDTH_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>해당 슬롯 수 ≥</span><input aria-label="카탈로그 최소 PCIe 슬롯 수 스펙 필터" type="number" min="1" step="1" value={filter.minPcieSlotCount} placeholder="예: 1" onChange={(event) => update("minPcieSlotCount", event.target.value)} /></label></>}{category === "gpu" && <label><span>최소 VRAM</span><select aria-label="카탈로그 최소 VRAM 스펙 필터" value={filter.minVramGb} onChange={(event) => update("minVramGb", event.target.value)}>{CATALOG_GPU_VRAM_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{["memory", "ssd", "hdd"].includes(category) && <label><span>{category === "memory" ? "최소 모듈 용량" : "최소 용량"}</span><select aria-label="카탈로그 최소 용량 스펙 필터" value={filter.minCapacityGb} onChange={(event) => update("minCapacityGb", event.target.value)}>{(category === "memory" ? CATALOG_MEMORY_CAPACITY_OPTIONS : CATALOG_STORAGE_CAPACITY_OPTIONS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{category === "memory" && <label><span>최소 속도</span><select aria-label="카탈로그 최소 메모리 속도 스펙 필터" value={filter.minMemorySpeedMhz} onChange={(event) => update("minMemorySpeedMhz", event.target.value)}>{CATALOG_MEMORY_SPEED_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{category === "psu" && <label><span>최소 정격</span><select aria-label="카탈로그 최소 PSU 출력 스펙 필터" value={filter.minWattageW} onChange={(event) => update("minWattageW", event.target.value)}>{CATALOG_PSU_WATTAGE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{["ssd", "hdd"].includes(category) && <label><span>연결 방식</span><select aria-label="카탈로그 저장장치 연결 방식 스펙 필터" value={filter.interface} onChange={(event) => update("interface", event.target.value as CatalogSpecFilter["interface"])}><option value="all">전체 연결 방식</option><option value="NVMe">NVMe</option><option value="SATA">SATA</option></select></label>}</div>{summary && <p className="catalog-spec-filter-summary" data-testid="catalog-spec-filter-summary"><FiLayers /> {summary}{specExcludedCount > 0 ? ` · 조건 제외 ${specExcludedCount.toLocaleString("ko-KR")}개` : ""}</p>}{missing.length > 0 && <p className="catalog-spec-filter-missing" role="status"><FiInfo /> 조건 비교에 필요한 값이 없는 상품 {missing.map((item) => `${item.label} ${item.missingCount}개`).join(" · ")}는 결과에서 제외했습니다.</p>}</section>;
}

function CatalogSpecPresetAction({ preset, onApply }: { preset: ReturnType<typeof catalogCompatibilityPresetFor>; onApply: (values: Partial<CatalogSpecFilter>) => void }) {
  if (!preset.summary) return null;
  return <div className="catalog-spec-preset" data-testid="catalog-spec-preset"><div><span className="mini-label">QUICK MATCH</span><strong>현재 구성 기준 조건</strong><small>{preset.summary}</small></div><button className="button button-small button-light" type="button" data-testid="catalog-apply-spec-preset" onClick={() => onApply(preset.values)}>현재 구성 기준 적용</button>{preset.omitted.length > 0 && <p><FiInfo /> 자동 적용에서 제외한 정보: {preset.omitted.join(" · ")}</p>}</div>;
}

function catalogBenchmarkComparisonRowsFor(parts: CatalogPart[]) {
  type ComparisonRow = { key: string; label: string; values: string[] };
  const evidences = parts.map((part) => benchmarkEvidenceForPart(part));
  if (!evidences.some(Boolean)) return [];
  const rows = new Map<string, ComparisonRow>();
  const addRow = (key: string, label: string, valueFor: (evidence: BenchmarkEvidencePart | undefined) => string) => {
    rows.set(key, { key, label, values: evidences.map(valueFor) });
  };
  addRow("benchmark-status", "성능 근거", (evidence) => evidence ? `${catalogBenchmarkStatusLabel(evidence.status)} · ${evidence.presentCount}/${evidence.totalCount}` : "해당 없음");
  const scoreRows = new Map<string, { label: string; values: string[] }>();
  evidences.forEach((evidence, index) => {
    evidence?.rows.forEach((row) => {
      const comparison = scoreRows.get(row.key) ?? { label: row.label, values: Array.from({ length: parts.length }, () => "확인 필요") };
      comparison.values[index] = row.value === undefined ? "확인 필요" : `${row.value.toLocaleString("ko-KR")}${row.unit}`;
      scoreRows.set(row.key, comparison);
    });
  });
  scoreRows.forEach((row, key) => rows.set(`benchmark-score-${key}`, { key: `benchmark-score-${key}`, label: row.label, values: row.values }));
  addRow("benchmark-source", "성능 출처", (evidence) => evidence?.provenance ? BENCHMARK_SOURCE_KIND_LABELS[evidence.provenance.sourceKind] : "출처 유형 미등록");
  addRow("benchmark-source-check", "원문 점검", (evidence) => evidence ? benchmarkSourceCheckLabelFor(evidence.sourceCheck) : "해당 없음");
  addRow("benchmark-freshness", "근거 갱신", (evidence) => evidence ? benchmarkFreshnessLabelFor(evidence.benchmarkFreshness) : "해당 없음");
  return [...rows.values()].map((row) => ({ ...row, changed: new Set(row.values).size > 1 }));
}

function catalogComparisonSpecRowsFor(parts: CatalogPart[]) {
  const benchmarkLabels = new Set(["CPU 싱글 점수", "CPU 멀티 점수", "Time Spy", "Port Royal"]);
  const rows = new Map<string, { key: string; label: string; values: string[] }>();
  parts.forEach((part, index) => {
    for (const [label, value] of specRowsFor(part)) {
      if (benchmarkLabels.has(label)) continue;
      const key = label;
      const row = rows.get(key) ?? { key, label, values: Array.from({ length: parts.length }, () => "미확인") };
      row.values[index] = value;
      rows.set(key, row);
    }
  });
  return [...rows.values()].slice(0, 10).map((row) => ({ ...row, changed: new Set(row.values).size > 1 }));
}

function CatalogSpecComparison({ category, parts, selectedIds, compareReady, comparisonContext, onAdd, onRemove, onCompareScenarios, onShareComparison, onRevokeComparison, onToast, onClear }: { category: PartCategory; parts: CatalogPart[]; selectedIds: ReadonlySet<string>; compareReady: boolean; comparisonContext: CatalogComparisonContext; onAdd: (part: CatalogPart) => void; onRemove: (partId: string) => void; onCompareScenarios?: (category: PartCategory, parts: CatalogPart[]) => void; onShareComparison?: CatalogComparisonShareHandler; onRevokeComparison?: CatalogComparisonRevokeHandler; onToast: (message: string) => void; onClear: () => void }) {
  const benchmarkRows = catalogBenchmarkComparisonRowsFor(parts);
  const specRows = catalogComparisonSpecRowsFor(parts);
  const comparisonCandidates = catalogComparisonCandidatesFor(parts);
  const comparisonKey = parts.map((part) => part.id).join(",");
  const [sharedComparison, setSharedComparison] = useState<CatalogComparisonShare | null>(null);
  const [sharingComparison, setSharingComparison] = useState(false);
  const mountedRef = useRef(true);
  const overviewRows = [
    { key: "price", label: "가격", values: parts.map((part) => priceLabel(part.priceWon)) },
    { key: "data", label: "데이터", values: parts.map((part) => `${QUALITY_LABELS[part.dataQuality]} · ${freshnessLabel(part)} · ${catalogPriceEvidenceLabelFor(part)}`) },
    { key: "listing", label: "구매 조건", values: parts.map((part) => part.listingType ? LISTING_TYPE_LABELS[part.listingType] : LISTING_TYPE_LABELS.retail) }
  ];
  const rows = [...overviewRows, ...benchmarkRows, ...specRows];
  useEffect(() => {
    setSharedComparison(null);
  }, [comparisonKey]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  async function shareComparison() {
    if (!onShareComparison || sharingComparison) return;
    setSharingComparison(true);
    try {
      const shared = await onShareComparison(comparisonCandidates, { name: `${CATEGORY_LABELS[category]} 부품 비교`, ...comparisonContext });
      if (mountedRef.current && shared) setSharedComparison(shared);
    } finally {
      if (mountedRef.current) setSharingComparison(false);
    }
  }
  async function revokeComparison() {
    if (!sharedComparison || !onRevokeComparison) return;
    if (await onRevokeComparison(sharedComparison)) {
      if (mountedRef.current) setSharedComparison(null);
    }
  }
  async function copyComparison() {
    try {
      const { alternativeComparisonTextFor } = await import("../shared/alternative-comparison-export");
      await navigator.clipboard.writeText(alternativeComparisonTextFor(comparisonCandidates, comparisonContext));
      if (mountedRef.current) onToast("카탈로그 부품 비교를 클립보드에 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("카탈로그 부품 비교 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }
  async function downloadComparisonCsv() {
    const { alternativeComparisonCsvFor } = await import("../shared/alternative-comparison-export");
    if (!mountedRef.current) return;
    downloadCatalogComparisonFile(alternativeComparisonCsvFor(comparisonCandidates, comparisonContext), `pc-supporter-catalog-comparison-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    onToast("카탈로그 부품 비교 CSV를 저장했습니다.");
  }
  async function downloadComparisonJson() {
    const { alternativeComparisonJsonFor } = await import("../shared/alternative-comparison-export");
    if (!mountedRef.current) return;
    downloadCatalogComparisonFile(alternativeComparisonJsonFor(comparisonCandidates, comparisonContext), `pc-supporter-catalog-comparison-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
    onToast("카탈로그 부품 비교 JSON을 저장했습니다.");
  }
  return <section className="catalog-spec-comparison" aria-label="카탈로그 부품 비교" data-testid="catalog-spec-comparison">
    <div className="catalog-spec-comparison-heading"><div><p className="eyebrow">CATALOG COMPARISON</p><h2>{CATEGORY_LABELS[category]} 부품 비교</h2><p>전체 카탈로그에서 고른 2~3개를 가격·핵심 스펙·데이터 상태 기준으로 나란히 확인합니다.</p></div><span><FiLayers /> {parts.length} / 3개</span></div>
    {comparisonContext.currentPartName && <div className="catalog-spec-comparison-baseline" data-testid="catalog-comparison-baseline"><div><span>현재 기준선</span><strong>{comparisonContext.currentPartName}</strong></div><div>{comparisonContext.currentPartSummary && <small>{comparisonContext.currentPartSummary}</small>}{comparisonContext.currentPartPrice && <em>{comparisonContext.currentPartPrice}</em>}</div></div>}
    <div className="catalog-spec-comparison-table-wrap"><table><caption>{CATEGORY_LABELS[category]} 후보의 관찰 가능한 가격·스펙을 비교합니다. 페이지를 이동해도 선택한 부품은 유지됩니다.</caption><thead><tr><th scope="col">비교 항목</th>{parts.map((part) => <th scope="col" key={part.id}><div className="catalog-spec-comparison-part-heading"><span>{part.name}</span><button className="text-button" type="button" data-testid={`catalog-comparison-remove-${part.id}`} onClick={() => onRemove(part.id)}>제외</button></div></th>)}</tr></thead><tbody>
      {rows.map((row) => { const changed = new Set(row.values).size > 1; return <tr className={changed ? "changed" : undefined} key={row.key}><th scope="row">{row.label}{changed && <small> 차이</small>}</th>{row.values.map((value, index) => <td className={value === "미확인" || value === "가격 확인 필요" || value === "확인 필요" || value === "출처 유형 미등록" || value === "원문 검증 안 함" ? "unknown" : undefined} key={`${row.key}-${parts[index]?.id ?? index}`}>{value}</td>)}</tr>; })}
      <tr className="catalog-spec-comparison-actions"><th scope="row">견적에 추가</th>{parts.map((part) => { const blocked = part.candidateRisk === "unsafe"; const selected = selectedIds.has(part.id); return <td key={`${part.id}-add`}><button className="button button-small" type="button" data-testid={`catalog-comparison-add-${part.id}`} onClick={() => onAdd(part)} disabled={selected || blocked}>{blocked ? "차단 위험" : selected ? "현재 선택됨" : "이 부품 추가"}</button></td>; })}</tr>
    </tbody></table></div>
    {sharedComparison && <div className="catalog-spec-comparison-share-preview" data-testid="catalog-comparison-share-preview"><label><span>비교 공유 링크{sharedComparison.expiresAt ? ` · ${new Date(sharedComparison.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="카탈로그 부품 비교 공유 링크" type="text" value={sharedComparison.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div><a className="text-button" href={sharedComparison.url}>열기</a>{onRevokeComparison && <button className="text-button danger-text-button" type="button" onClick={() => void revokeComparison()}><FiTrash2 /> 공유 취소</button>}</div></div>}
    <div className="catalog-spec-comparison-actions"><button className="text-button" type="button" data-testid="catalog-comparison-copy" onClick={() => void copyComparison()}><FiCopy /> 비교 복사</button><button className="text-button" type="button" data-testid="catalog-comparison-csv" onClick={() => void downloadComparisonCsv()}><FiDownload /> CSV 저장</button><button className="text-button" type="button" data-testid="catalog-comparison-json" onClick={() => void downloadComparisonJson()}><FiDownload /> JSON 저장</button>{onShareComparison && <button className="text-button" type="button" data-testid="catalog-comparison-share" onClick={() => void shareComparison()} disabled={sharingComparison}>{sharingComparison ? <><FiRefreshCw className="spin" /> 공유 준비 중...</> : <><FiShare2 /> 공유 링크</>}</button>}{onCompareScenarios && <button className="button button-small button-light" type="button" data-testid="catalog-spec-virtual-compare" onClick={() => onCompareScenarios(category, parts)} disabled={!compareReady}>{compareReady ? <><FiActivity /> 현재 견적에 가상 비교</> : <><FiActivity /> 검사 후 가상 비교 가능</>}</button>}<button className="text-button" type="button" data-testid="catalog-comparison-clear" onClick={onClear}><FiRefreshCw /> 비교 선택 초기화</button></div>
    <p className="catalog-spec-comparison-note"><FiInfo /> 이 표는 카탈로그 관찰값 비교입니다. 현재 견적과의 실제 소켓·슬롯·전력·장착 호환성은 부품을 추가한 뒤 `견적 검사`에서 다시 확인해야 합니다.</p>
  </section>;
}

export function CatalogView({ meta, build, partMap, profile, gamingResolution, gamingRefreshRate, onAddPart, onCompareParts, compareReady = false, onWatchPart, isPartWatched, onOpenWatchlist, onOpenBuild, onOpenAccessories, onShareComparison, onRevokeComparison, onToast, onBack }: { meta: ServiceMeta | null; build: BuildSelection; partMap: ReadonlyMap<string, Part>; profile: RecommendationProfile; gamingResolution?: GamingResolution; gamingRefreshRate?: GamingRefreshRate; onAddPart: (part: Part) => void; onCompareParts?: (category: PartCategory, parts: CatalogPart[]) => void; compareReady?: boolean; onWatchPart?: (part: Part) => boolean; isPartWatched?: (part: Part) => boolean; onOpenWatchlist?: () => void; onOpenBuild: () => void; onOpenAccessories?: (query?: string) => void; onShareComparison?: CatalogComparisonShareHandler; onRevokeComparison?: CatalogComparisonRevokeHandler; onToast: (message: string) => void; onBack: () => void }) {
  const [, setWatchlistStorageVersion] = useState(0);
  const [category, setCategory] = useState<PartCategory>(initialCatalogCategory);
  const [mode, setMode] = useState<"catalog" | "compatible">(initialCatalogMode);
  const [candidateScope, setCandidateScope] = useState<CatalogCandidateScope>(initialCatalogCandidateScope);
  const [query, setQuery] = useState(initialCatalogQuery);
  const [brand, setBrand] = useState(initialCatalogBrand);
  const [partId, setPartId] = useState<string | undefined>(initialCatalogPartId);
  const [quality, setQuality] = useState<DataQuality | "all">(initialCatalogQuality);
  const [missingField, setMissingField] = useState(initialCatalogMissingField);
  const [freshness, setFreshness] = useState<DataFreshness | "all">(initialCatalogFreshness);
  const [priceStatus, setPriceStatus] = useState<PriceAvailabilityFilter>(initialCatalogPriceStatus);
  const [benchmarkStatus, setBenchmarkStatus] = useState<BenchmarkAvailabilityFilter>(initialCatalogBenchmarkStatus);
  const [listingPolicy, setListingPolicy] = useState<ListingPolicy>(initialCatalogListingPolicy);
  const [sort, setSort] = useState<CatalogSort>(initialCatalogSort);
  const [benchmarkSort, setBenchmarkSort] = useState(initialCatalogBenchmarkSort);
  const [page, setPage] = useState(initialCatalogPage);
  const [specFilter, setSpecFilter] = useState<CatalogSpecFilter>(initialCatalogSpecFilter);
  const [items, setItems] = useState<CatalogPart[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [riskCounts, setRiskCounts] = useState<AlternativeRiskCounts | null>(null);
  const [selectedPriceHistory, setSelectedPriceHistory] = useState<CatalogPriceHistory | undefined>(undefined);
  const [selectedPriceHistoryLoading, setSelectedPriceHistoryLoading] = useState(false);
  const [selectedPriceHistoryError, setSelectedPriceHistoryError] = useState<string | null>(null);
  const [catalogComparisonOpen, setCatalogComparisonOpen] = useState(false);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CATALOG_WATCHLIST_STORAGE_KEY) setWatchlistStorageVersion((current) => current + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const [comparePartsById, setComparePartsById] = useState<Record<string, CatalogPart>>({});
  const [nonCoreExcludedCount, setNonCoreExcludedCount] = useState(0);
  const [categoryMismatchExcludedCount, setCategoryMismatchExcludedCount] = useState(0);
  const [incompleteExcludedCount, setIncompleteExcludedCount] = useState(0);
  const [incompleteMissingFields, setIncompleteMissingFields] = useState<CatalogSpecCoverageMissingField[]>([]);
  const [benchmarkExcludedCount, setBenchmarkExcludedCount] = useState(0);
  const [specExcludedCount, setSpecExcludedCount] = useState(0);
  const [specFilterDiagnostics, setSpecFilterDiagnostics] = useState<Array<{ key: string; label: string; excludedCount: number; missingCount: number }>>([]);
  const [refreshingPartId, setRefreshingPartId] = useState<string | null>(null);
  const [refreshPartMessage, setRefreshPartMessage] = useState<string | null>(null);
  const [refreshPartError, setRefreshPartError] = useState<string | null>(null);
  const [refreshPartDiffs, setRefreshPartDiffs] = useState<CatalogChangeValueDiff[] | null>(null);
  const previousCatalogFilterKeyRef = useRef<string | null>(null);
  const previousCatalogFilterQueryRef = useRef<string | null>(null);
  const previousCatalogUrlRef = useRef<string | null>(null);
  const restoreCatalogUrlRef = useRef(false);
  const restoreCatalogFilterRef = useRef(false);
  const catalogQueryHistoryActiveRef = useRef(false);
  const catalogQueryHistoryTimerRef = useRef<number | null>(null);
  const refreshRequestVersionRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const selectedIds = useMemo(() => new Set(selectedPartIdsFor(build, category)), [build, category]);
  const selectedPart = items.find((part) => part.id === selectedId) ?? null;
  const compareParts = useMemo(() => compareIds.map((id) => comparePartsById[id]).filter((part): part is CatalogPart => Boolean(part)), [compareIds, comparePartsById]);
  const comparisonContext = useMemo(() => catalogComparisonContextFor(build, category, partMap), [build, category, partMap]);
  const catalogSpecPreset = useMemo(() => catalogCompatibilityPresetFor(category, build, partMap), [build, category, partMap]);
  const benchmarkSortAvailable = mode === "catalog" && (category === "cpu" || category === "gpu");
  const catalogSort = benchmarkSortAvailable && benchmarkSort ? "benchmark_desc" : sort;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.pathname.startsWith("/catalog")) return;
    const params = new URLSearchParams();
    params.set("category", category);
    if (query.trim()) params.set("q", query.trim());
    if (brand.trim()) params.set("brand", brand.trim());
    if (partId) params.set("partId", partId);
    if (mode === "compatible") {
      params.set("mode", "compatible");
      params.set("candidateScope", candidateScope);
    }
    if (quality !== "all") params.set("quality", quality);
    if (missingField) params.set("missingField", missingField);
    if (freshness !== "all") params.set("freshness", freshness);
    if (priceStatus !== "all") params.set("priceStatus", priceStatus);
    if (mode !== "compatible" && (category === "cpu" || category === "gpu") && benchmarkStatus !== "all") params.set("benchmarkStatus", benchmarkStatus);
    if (listingPolicy !== "all") params.set("listingPolicy", listingPolicy);
    if (page > 0) params.set("page", String(page + 1));
    if (mode === "compatible" || catalogSort !== "price_asc") params.set("sort", catalogSort);
    Object.entries(catalogSpecFilterPayloadFor(category, specFilter)).forEach(([key, value]) => params.set(key, value));
    const nextSearch = params.toString();
    const nextUrl = `/catalog${nextSearch ? `?${nextSearch}` : ""}`;
    const currentUrl = window.location.pathname + window.location.search;
    const filterKey = [candidateScope, category, mode, partId ?? "", quality, missingField, freshness, priceStatus, benchmarkStatus, listingPolicy, catalogSort, query, brand, JSON.stringify(catalogSpecFilterPayloadFor(category, specFilter))].join("\u0000");
    const catalogTextFilterKey = [query, brand].join("\u0001");
    const queryChanged = previousCatalogFilterQueryRef.current !== null && previousCatalogFilterQueryRef.current !== catalogTextFilterKey;
    const clearQueryHistoryTimer = () => {
      if (catalogQueryHistoryTimerRef.current !== null) {
        window.clearTimeout(catalogQueryHistoryTimerRef.current);
        catalogQueryHistoryTimerRef.current = null;
      }
    };
    if (restoreCatalogUrlRef.current) {
      clearQueryHistoryTimer();
      catalogQueryHistoryActiveRef.current = false;
      restoreCatalogUrlRef.current = false;
      if (currentUrl !== nextUrl) window.history.replaceState(window.history.state, "", nextUrl);
    } else if (previousCatalogFilterKeyRef.current !== null && previousCatalogFilterKeyRef.current !== filterKey && page > 0) {
      clearQueryHistoryTimer();
      catalogQueryHistoryActiveRef.current = false;
      previousCatalogFilterQueryRef.current = catalogTextFilterKey;
      return;
    } else if (queryChanged) {
      if (currentUrl !== nextUrl) {
        if (catalogQueryHistoryActiveRef.current) window.history.replaceState(window.history.state, "", nextUrl);
        else if (previousCatalogUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
        else window.history.pushState(window.history.state, "", nextUrl);
      }
      previousCatalogUrlRef.current = nextUrl;
      catalogQueryHistoryActiveRef.current = true;
      clearQueryHistoryTimer();
      catalogQueryHistoryTimerRef.current = window.setTimeout(() => {
        catalogQueryHistoryActiveRef.current = false;
        catalogQueryHistoryTimerRef.current = null;
      }, 800);
      previousCatalogFilterQueryRef.current = catalogTextFilterKey;
      return;
    }
    clearQueryHistoryTimer();
    catalogQueryHistoryActiveRef.current = false;
    if (currentUrl !== nextUrl) {
      if (previousCatalogUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
      else window.history.pushState(window.history.state, "", nextUrl);
    }
    previousCatalogUrlRef.current = nextUrl;
    previousCatalogFilterQueryRef.current = catalogTextFilterKey;
  }, [benchmarkStatus, benchmarkSort, brand, candidateScope, category, catalogSort, freshness, listingPolicy, missingField, mode, page, partId, priceStatus, quality, query, sort, specFilter]);

  useEffect(() => {
    const filterKey = [candidateScope, category, mode, partId ?? "", quality, missingField, freshness, priceStatus, benchmarkStatus, listingPolicy, catalogSort, query, brand, JSON.stringify(catalogSpecFilterPayloadFor(category, specFilter))].join("\u0000");
    const restoringFilter = restoreCatalogFilterRef.current;
    if (previousCatalogFilterKeyRef.current === null) {
      previousCatalogFilterKeyRef.current = filterKey;
      previousCatalogFilterQueryRef.current = [query, brand].join("\u0001");
      restoreCatalogFilterRef.current = false;
      return;
    }
    if (previousCatalogFilterKeyRef.current === filterKey) {
      restoreCatalogFilterRef.current = false;
      return;
    }
    previousCatalogFilterKeyRef.current = filterKey;
    previousCatalogFilterQueryRef.current = [query, brand].join("\u0001");
    refreshRequestVersionRef.current += 1;
    if (!restoringFilter) setPage(0);
    setItems([]);
    setTotal(0);
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setCompareIds([]);
    setComparePartsById({});
    setCatalogComparisonOpen(false);
    restoreCatalogFilterRef.current = false;
  }, [benchmarkStatus, benchmarkSort, brand, candidateScope, category, catalogSort, mode, partId, quality, missingField, freshness, priceStatus, listingPolicy, sort, query, specFilter]);

  useEffect(() => {
    const onPopState = () => {
      if (!window.location.pathname.startsWith("/catalog")) return;
      restoreCatalogUrlRef.current = true;
      restoreCatalogFilterRef.current = true;
      setCategory(initialCatalogCategory());
      setMode(initialCatalogMode());
      setCandidateScope(initialCatalogCandidateScope());
      setQuery(initialCatalogQuery());
      setBrand(initialCatalogBrand());
      setPartId(initialCatalogPartId());
      setQuality(initialCatalogQuality());
      setMissingField(initialCatalogMissingField());
      setFreshness(initialCatalogFreshness());
      setPriceStatus(initialCatalogPriceStatus());
      setBenchmarkStatus(initialCatalogBenchmarkStatus());
      setListingPolicy(initialCatalogListingPolicy());
      setSort(initialCatalogSort());
      setBenchmarkSort(initialCatalogBenchmarkSort());
      setPage(initialCatalogPage());
      setSpecFilter(initialCatalogSpecFilter());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (loading) return;
    const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [loading, page, total]);

  useEffect(() => {
    refreshRequestVersionRef.current += 1;
    setRefreshPartMessage(null);
    setRefreshPartError(null);
    setRefreshPartDiffs(null);
  }, [selectedPart?.id]);

  useEffect(() => {
    if (items.length === 0 || compareIds.length === 0) return;
    setComparePartsById((current) => {
      let changed = false;
      const next = { ...current };
      for (const part of items) {
        if (!compareIds.includes(part.id) || next[part.id] === part) continue;
        next[part.id] = part;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [compareIds, items]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setRiskCounts(null);
      setNonCoreExcludedCount(0);
      setCategoryMismatchExcludedCount(0);
      setIncompleteExcludedCount(0);
      setIncompleteMissingFields([]);
      setBenchmarkExcludedCount(0);
      setSpecExcludedCount(0);
      setSpecFilterDiagnostics([]);
      const request = mode === "compatible"
        ? api<CatalogResponse>("/api/parts/compatible", { method: "POST", body: JSON.stringify({ category, build, profile, gamingResolution, gamingRefreshRate, q: query.trim(), brand: brand.trim(), quality, freshness, priceStatus, listingPolicy, sort, mode: candidateScope, riskFilter: "all", performanceFilter: "all", physicalEvidenceFilter: "all", recommendationTrustFilter: "all", specFilter: catalogSpecFilterPayloadFor(category, specFilter), offset: page * PAGE_SIZE, limit: PAGE_SIZE }), retry: 2, retryOnRateLimit: true, signal: controller.signal })
        : (() => {
          const params = new URLSearchParams({ category, q: query.trim(), brand: brand.trim(), quality, freshness, priceStatus, listingPolicy, sort: catalogSort === "similarity" || catalogSort === "value" ? "price_asc" : catalogSort, offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
          if (missingField) params.set("missingField", missingField);
          if (partId) params.set("partId", partId);
          if ((category === "cpu" || category === "gpu") && benchmarkStatus !== "all") params.set("benchmarkStatus", benchmarkStatus);
          Object.entries(catalogSpecFilterPayloadFor(category, specFilter)).forEach(([key, value]) => params.set(key, value));
          return api<CatalogResponse>(`/api/parts?${params.toString()}`, { retry: 2, signal: controller.signal });
        })();
      void request
        .then((payload) => { if (!cancelled) { setItems(payload.items); setTotal(payload.total); setNonCoreExcludedCount(payload.nonCoreExcludedCount ?? 0); setCategoryMismatchExcludedCount(payload.categoryMismatchExcludedCount ?? 0); setIncompleteExcludedCount(mode === "compatible" ? payload.incompleteExcludedCount ?? 0 : 0); setIncompleteMissingFields(mode === "compatible" ? payload.incompleteMissingFields ?? [] : []); setBenchmarkExcludedCount(mode === "catalog" ? payload.benchmarkExcludedCount ?? 0 : 0); setSpecExcludedCount(payload.specExcludedCount ?? 0); setSpecFilterDiagnostics(payload.specFilterDiagnostics ?? []); setRiskCounts(mode === "compatible" ? payload.riskCounts ?? null : null); setSelectedId((current) => payload.items.some((item) => item.id === current) ? current : payload.items[0]?.id ?? null); } })
        .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "부품 카탈로그를 불러오지 못했습니다."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 220);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [benchmarkStatus, benchmarkSort, brand, build, candidateScope, category, catalogSort, freshness, gamingRefreshRate, gamingResolution, listingPolicy, missingField, mode, page, partId, priceStatus, profile, quality, query, retryNonce, sort, specFilter]);

  useEffect(() => {
    if (!selectedPart) {
      setSelectedPriceHistory(undefined);
      setSelectedPriceHistoryError(null);
      setSelectedPriceHistoryLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSelectedPriceHistory(undefined);
    setSelectedPriceHistoryLoading(true);
    setSelectedPriceHistoryError(null);
    void api<{ items: CatalogPriceHistory[] }>(`/api/price-history?ids=${encodeURIComponent(`part:${selectedPart.id}`)}&days=30`, { retry: 1, signal: controller.signal })
      .then((payload) => {
        if (!cancelled) setSelectedPriceHistory(payload.items[0]);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setSelectedPriceHistoryError(reason instanceof Error ? reason.message : "가격 이력을 확인하지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setSelectedPriceHistoryLoading(false);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [selectedPart?.id]);

  function goToPage(nextPage: number) {
    setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refreshCatalogPart(part: CatalogPart) {
    if (part.source !== "danawa" || refreshingPartId) return;
    const requestVersion = ++refreshRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && refreshRequestVersionRef.current === requestVersion;
    setRefreshingPartId(part.id);
    setRefreshPartMessage(null);
    setRefreshPartError(null);
    setRefreshPartDiffs(null);
    try {
      const payload = await api<PartRefreshResponse>(`/api/parts/${encodeURIComponent(part.id)}/refresh`, { method: "POST", retry: 0 });
      if (!isCurrent()) return;
      const refreshedPart: CatalogPart = { ...payload.part, dataFreshness: classifyDataFreshness(payload.part.updatedAt) };
      setItems((current) => current.map((item) => item.id === refreshedPart.id ? refreshedPart : item));
      setComparePartsById((current) => current[refreshedPart.id] ? { ...current, [refreshedPart.id]: refreshedPart } : current);
      setRefreshPartMessage(`${refreshedPart.name} 원문 확인 완료 · ${payload.changedFields.length > 0 ? `${payload.changedFields.length}개 영역 갱신` : "변경된 영역 없음"}`);
      setRefreshPartDiffs(payload.valueDiffs ?? []);
      setRetryNonce((current) => current + 1);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      setRefreshPartError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "부품 상세 원문을 다시 확인하지 못했습니다.");
    } finally {
      if (isCurrent()) setRefreshingPartId(null);
    }
  }

  function toggleCompare(part: CatalogPart) {
    if (!compareIds.includes(part.id) && compareIds.length >= 3) return;
    setComparePartsById((current) => {
      if (compareIds.includes(part.id)) {
        const next = { ...current };
        delete next[part.id];
        return next;
      }
      return { ...current, [part.id]: part };
    });
    setCompareIds((current) => current.includes(part.id)
      ? current.filter((id) => id !== part.id)
      : current.length >= 3 ? current : [...current, part.id]);
  }

  function removeComparePart(partId: string) {
    setCompareIds((current) => current.filter((id) => id !== partId));
    setComparePartsById((current) => {
      const next = { ...current };
      delete next[partId];
      return next;
    });
  }

  function compareSelectedParts() {
    if (compareParts.length < 2) return;
    if (mode === "catalog") {
      setCatalogComparisonOpen(true);
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="catalog-spec-comparison"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      return;
    }
    if (!onCompareParts) return;
    onCompareParts(category, compareParts);
  }

  async function copyCatalogSearchLink() {
    const url = window.location.origin + window.location.pathname + window.location.search;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(url);
      if (mountedRef.current) onToast("현재 카탈로그 검색 조건 링크를 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("현재 카탈로그 검색 조건 링크: " + url);
    }
  }

  const candidateScopeSummary = riskCounts
    ? `안전 ${riskCounts.safe.toLocaleString("ko-KR")} · 확인 필요 ${riskCounts.review.toLocaleString("ko-KR")} · 차단 ${riskCounts.unsafe.toLocaleString("ko-KR")}`
    : undefined;
  const candidateEmptyMessage = mode !== "compatible"
    ? query.trim()
      ? `"${query.trim().slice(0, 40)}" 검색 결과가 없습니다. 다른 모델명이나 조건을 확인해 주세요.`
      : "조건에 맞는 부품이 없습니다."
    : candidateScope === "safe"
      ? "현재 견적에 새 위험을 만들지 않는 안전 후보가 없습니다."
      : candidateScope === "no_blocker"
        ? "현재 견적에 새 차단 오류가 없는 후보가 없습니다. 안전 후보 또는 확인 필요 후보 범위를 조정해 보세요."
        : "전체 정밀 검사 결과 후보가 없습니다.";

  const brandOptions = meta?.catalogBrandCounts?.[category] ?? [];

  return <div className="catalog-page">
    <div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">PART CATALOG</p><h1>부품 카탈로그 탐색</h1><p>전체 부품 목록에서 핵심 스펙·가격·데이터 상태를 확인하고 현재 견적에 추가합니다.</p></div><button className="button button-secondary" type="button" onClick={onOpenBuild}><FiActivity /> 현재 견적 보기</button></div>
    <CatalogSpecFilterPanel category={category} filter={specFilter} specExcludedCount={specExcludedCount} specFilterDiagnostics={specFilterDiagnostics} onChange={(next) => { setSpecFilter(next); setPage(0); }} onReset={() => { setSpecFilter({ ...EMPTY_CATALOG_SPEC_FILTER }); setPage(0); }} />
    <CatalogSpecPresetAction preset={catalogSpecPreset} onApply={(values) => { setSpecFilter((current) => ({ ...current, ...values })); setPage(0); }} />
    {brandOptions.length > 0 && <div className="catalog-brand-suggestions" role="group" aria-label="카탈로그 제조사 빠른 선택"><span>빠른 제조사</span>{brandOptions.slice(0, 8).map((option) => <button className={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR") ? "selected" : ""} type="button" aria-pressed={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR")} onClick={() => { setBrand(option.brand); setPage(0); }} key={option.brand}>{option.brand}<small>{option.count}</small></button>)}</div>}
    <section className="catalog-brand-filter-panel" aria-label="카탈로그 제조사 필터" data-testid="catalog-brand-filter"><label><span>MANUFACTURER FILTER · 제조사</span><input aria-label="카탈로그 제조사 필터" type="search" value={brand} onChange={(event) => { setBrand(event.target.value.slice(0, 80)); setPage(0); }} placeholder="예: ASUS · AMD · GIGABYTE" /></label><small>현재 범주와 선택한 데이터·호환 후보 조건에 같은 제조사 조건을 적용합니다. URL에 보존되므로 조건 링크로 다시 열 수 있습니다.</small>{brand.trim() && <button className="text-button" type="button" onClick={() => { setBrand(""); setPage(0); }}>제조사 초기화</button>}</section>
    {benchmarkSortAvailable && <section className="catalog-brand-filter-panel catalog-benchmark-sort-panel" aria-label="카탈로그 성능 정렬" data-testid="catalog-benchmark-sort-panel"><label><span>PERFORMANCE SORT · 성능 정렬</span><select aria-label="카탈로그 성능 정렬" data-testid="catalog-benchmark-sort" value={benchmarkSort ? "benchmark_desc" : "off"} onChange={(event) => { const enabled = event.target.value === "benchmark_desc"; setBenchmarkSort(enabled); if (enabled) setSort("price_asc"); setPage(0); }}><option value="off">사용 안 함</option><option value="benchmark_desc">{category === "cpu" ? "Cinebench R23 점수 높은 순" : "3DMark 점수 높은 순"}</option></select></label><small>{category === "cpu" ? "Cinebench R23 멀티코어 점수를 우선 사용하고, 점수가 없는 CPU는 뒤로 보냅니다." : "3DMark Time Spy 점수를 우선 사용하고, 점수가 없는 GPU는 뒤로 보냅니다."} 점수는 저장된 참고 근거이며 실제 성능을 보장하지 않습니다.</small></section>}
    <section className="catalog-toolbar" aria-label="부품 카탈로그 필터"><div className="catalog-mode-toggle" role="group" aria-label="카탈로그 탐색 모드"><button className={mode === "catalog" ? "selected" : ""} type="button" aria-pressed={mode === "catalog"} onClick={() => { setMode("catalog"); setPartId(undefined); setMissingField(""); setBenchmarkSort(false); setSort("price_asc"); setPage(0); }}>전체 카탈로그</button><button className={mode === "compatible" ? "selected" : ""} type="button" aria-pressed={mode === "compatible"} onClick={() => { setMode("compatible"); setBenchmarkStatus("all"); setPartId(undefined); setMissingField(""); setBenchmarkSort(false); setSort("similarity"); setPage(0); }}>현재 견적 호환 후보</button><small>{mode === "compatible" ? "현재 견적에 후보를 대입해 위험도 범위를 선택합니다." : "호환성에 관계없이 카탈로그 전체를 탐색합니다."}</small><button className="text-button catalog-filter-link-button" type="button" data-testid="catalog-copy-filter-link" onClick={() => void copyCatalogSearchLink()}><FiCopy /> 조건 링크 복사</button></div>{mode === "compatible" && <div className="catalog-candidate-scope" role="group" aria-label="호환 후보 평가 범위"><span>평가 범위</span>{(Object.keys(CANDIDATE_SCOPE_LABELS) as CatalogCandidateScope[]).map((scope) => <button className={candidateScope === scope ? "selected" : ""} type="button" aria-pressed={candidateScope === scope} data-testid={`catalog-scope-${scope}`} onClick={() => { setCandidateScope(scope); setBenchmarkSort(false); setSort("similarity"); setPage(0); }} key={scope}>{CANDIDATE_SCOPE_LABELS[scope]}</button>)}<small>{candidateScopeDescription(candidateScope)}</small></div>}<form className="catalog-search" onSubmit={(event) => { event.preventDefault(); setPage(0); }}><FiSearch /><input aria-label="부품 카탈로그 검색" enterKeyHint="search" value={query} onChange={(event) => { setPartId(undefined); setQuery(event.target.value); }} placeholder="모델명·제조사·소켓·메모리 세대 검색" /><button className="button button-primary button-small" type="submit">검색</button></form><div className="mobile-catalog-category-chips" role="group" aria-label="모바일 카탈로그 범주 빠른 선택">{MOBILE_CATALOG_CATEGORY_ORDER.map((item) => <button className={category === item ? "selected" : ""} type="button" aria-pressed={category === item} onClick={() => { setPartId(undefined); setMissingField(""); setCategory(item); if (item !== "cpu" && item !== "gpu") { setBenchmarkStatus("all"); setBenchmarkSort(false); } setPage(0); }} key={item}>{CATEGORY_LABELS[item]}</button>)}</div><div className={`catalog-filters${mode === "catalog" && (category === "cpu" || category === "gpu") ? " with-benchmark" : ""}`}><label><span>범주</span><select aria-label="카탈로그 부품 범주" value={category} onChange={(event) => { const nextCategory = event.target.value as PartCategory; setPartId(undefined); setMissingField(""); setCategory(nextCategory); if (nextCategory !== "cpu" && nextCategory !== "gpu") { setBenchmarkStatus("all"); setBenchmarkSort(false); } }}>{PART_CATEGORIES.map((item) => <option value={item} key={item}>{CATEGORY_LABELS[item]}</option>)}</select></label><label><span>데이터</span><select aria-label="카탈로그 데이터 품질" value={quality} onChange={(event) => setQuality(event.target.value as DataQuality | "all") }><option value="all">전체 데이터</option>{Object.entries(QUALITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>갱신 상태</span><select aria-label="카탈로그 갱신 상태" value={freshness} onChange={(event) => setFreshness(event.target.value as DataFreshness | "all")}><option value="all">전체 상태</option><option value="fresh">{DATA_FRESHNESS_LABELS.fresh}</option><option value="aging">{DATA_FRESHNESS_LABELS.aging}</option><option value="stale">{DATA_FRESHNESS_LABELS.stale}</option><option value="unknown">{DATA_FRESHNESS_LABELS.unknown}</option></select></label><label><span>가격</span><select aria-label="카탈로그 가격 상태" value={priceStatus} onChange={(event) => setPriceStatus(event.target.value as PriceAvailabilityFilter)}><option value="all">{PRICE_AVAILABILITY_LABELS.all}</option><option value="known">{PRICE_AVAILABILITY_LABELS.known}</option><option value="unknown">{PRICE_AVAILABILITY_LABELS.unknown}</option></select></label>{mode === "catalog" && (category === "cpu" || category === "gpu") && <label><span>성능 근거</span><select aria-label="카탈로그 성능 근거 상태" value={benchmarkStatus} onChange={(event) => { setBenchmarkStatus(event.target.value as BenchmarkAvailabilityFilter); setPage(0); }}><option value="all">{BENCHMARK_AVAILABILITY_LABELS.all}</option><option value="complete">{BENCHMARK_AVAILABILITY_LABELS.complete}</option><option value="incomplete">{BENCHMARK_AVAILABILITY_LABELS.incomplete}</option></select></label>}<label><span>구매 조건</span><select aria-label="카탈로그 구매 조건" value={listingPolicy} onChange={(event) => setListingPolicy(event.target.value as ListingPolicy)}>{Object.entries(LISTING_POLICY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>정렬</span><select aria-label="카탈로그 정렬" value={sort} onChange={(event) => { setBenchmarkSort(false); setSort(event.target.value as CatalogSort); }}><option value="price_asc">가격 낮은 순</option><option value="price_desc">가격 높은 순</option><option value="name">이름 순</option><option value="updated">최근 갱신</option>{mode === "compatible" && <><option value="similarity">유사도 높은 순</option><option value="value">가성비 높은 순</option></>}</select></label></div>{missingField && <div className="catalog-missing-field-filter" data-testid="catalog-missing-field-filter"><div><span>누락 필드 필터</span><strong>{catalogMissingFieldLabelFor(missingField)}</strong><small>{missingField}</small></div><button className="text-button" type="button" onClick={() => { setMissingField(""); setPage(0); }}>필터 해제</button></div>}</section>
    <section className="catalog-comparison-bar" aria-label="카탈로그 부품 비교" data-testid="catalog-comparison-bar"><div><strong><FiLayers /> {mode === "compatible" ? "후보 비교" : "부품 비교"} {compareIds.length} / 3</strong><small>{mode === "compatible" ? (compareIds.length >= 2 ? "선택한 후보를 현재 구성에 가상 적용해 비교합니다." : "현재 페이지에서 후보를 2~3개 선택하세요.") : (compareIds.length >= 2 ? "선택한 부품의 가격·핵심 스펙을 나란히 확인합니다." : "현재 페이지에서 부품을 2~3개 선택하세요.")}</small></div><button className="button button-small button-primary" type="button" data-testid="catalog-compare-submit" onClick={compareSelectedParts} disabled={compareParts.length < 2 || (mode === "compatible" && (!onCompareParts || !compareReady))}>{mode === "compatible" ? (compareReady ? <><FiActivity /> 선택 후보 가상 비교</> : <><FiActivity /> 검사 후 비교 가능</>) : <><FiLayers /> 선택 부품 비교</>}</button>{mode === "compatible" && !compareReady && <small className="catalog-comparison-warning">현재 견적을 먼저 검사하면 후보별 적용 후 위험·가격 변화를 계산할 수 있습니다.</small>}</section>{mode === "catalog" && catalogComparisonOpen && compareParts.length >= 2 && <CatalogSpecComparison category={category} parts={compareParts} selectedIds={selectedIds} compareReady={compareReady} comparisonContext={comparisonContext} onAdd={onAddPart} onRemove={removeComparePart} onCompareScenarios={onCompareParts} onShareComparison={onShareComparison} onRevokeComparison={onRevokeComparison} onToast={onToast} onClear={() => { setCompareIds([]); setComparePartsById({}); setCatalogComparisonOpen(false); }} />}<div className="catalog-layout"><section className="catalog-results" aria-label="부품 카탈로그 결과"><div className="catalog-results-heading"><div><p className="eyebrow">{mode === "compatible" ? "COMPATIBLE CANDIDATES" : "CATALOG RESULTS"}</p><h2>{CATEGORY_LABELS[category]} {mode === "compatible" ? candidateScopeResultLabel(candidateScope) : "목록"}</h2></div><span>{loading ? "불러오는 중" : `${total.toLocaleString("ko-KR")}개 결과 · ${page + 1}/${pageCount}페이지${candidateScopeSummary ? ` · ${candidateScopeSummary}` : ""}`}</span></div><CatalogIncompleteNotice count={mode === "compatible" ? incompleteExcludedCount : 0} category={category} missingFields={incompleteMissingFields} /><CatalogNonCoreNotice count={mode === "catalog" ? nonCoreExcludedCount : 0} categoryMismatchCount={mode === "catalog" ? categoryMismatchExcludedCount : 0} query={query} onOpenAccessories={onOpenAccessories} />{mode === "catalog" && benchmarkStatus !== "all" && <p className="catalog-benchmark-filter-summary" data-testid="catalog-benchmark-filter-summary"><FiActivity /> {BENCHMARK_AVAILABILITY_LABELS[benchmarkStatus]} · {total.toLocaleString("ko-KR")}개 표시{benchmarkExcludedCount > 0 ? ` · ${benchmarkStatus === "complete" ? "일부·없음" : "완전 세트"} ${benchmarkExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}</p>}{error ? <div className="catalog-state error" role="alert"><FiInfo /><div><strong>부품 목록을 불러오지 못했습니다.</strong><p>{error}</p></div><button className="button button-small button-light" type="button" onClick={() => setRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 시도</button></div> : loading ? <div className="catalog-state" role="status"><FiLoader className="spin" /> {mode === "compatible" ? `${CANDIDATE_SCOPE_LABELS[candidateScope]}를 계산하는 중...` : "부품 카탈로그를 불러오는 중..."}</div> : items.length === 0 ? <div className="catalog-state"><FiSearch /> {candidateEmptyMessage}</div> : <div className="catalog-part-list">{items.map((part) => <CatalogPartCard key={part.id} part={part} selected={selectedIds.has(part.id)} compareSelected={compareIds.includes(part.id)} showCompare onSelect={() => setSelectedId(part.id)} onAdd={() => onAddPart(part)} onToggleCompare={() => toggleCompare(part)} onWatchPart={onWatchPart} isPartWatched={isPartWatched} />)}</div>}{total > 0 && <div className="catalog-pagination"><button className="button button-light button-small" type="button" onClick={() => goToPage(page - 1)} disabled={page === 0 || loading}>이전</button><span>{page + 1} / {pageCount}</span><button className="button button-light button-small" type="button" onClick={() => goToPage(page + 1)} disabled={page >= pageCount - 1 || loading}>다음</button></div>}</section><aside>{selectedPart ? <CatalogPartDetail part={selectedPart} priceHistory={selectedPriceHistory} priceHistoryLoading={selectedPriceHistoryLoading} priceHistoryError={selectedPriceHistoryError} selected={selectedIds.has(selectedPart.id)} compareSelected={compareIds.includes(selectedPart.id)} showCompare onToggleCompare={() => toggleCompare(selectedPart)} onAdd={() => onAddPart(selectedPart)} onWatchPart={onWatchPart} isPartWatched={isPartWatched} onOpenWatchlist={onOpenWatchlist} onOpenBuild={onOpenBuild} onRefresh={() => void refreshCatalogPart(selectedPart)} refreshing={refreshingPartId === selectedPart.id} refreshMessage={refreshPartMessage} refreshError={refreshPartError} refreshDiffs={refreshPartDiffs} /> : <section className="catalog-detail-empty"><FiBox /><h2>부품을 선택하세요</h2><p>목록에서 부품을 누르면 상세 스펙·가격·데이터 상태와 현재 견적 추가 버튼을 확인할 수 있습니다.</p></section>}</aside></div>
    <p className="catalog-page-note"><FiDatabase /> {mode === "compatible" ? `현재 견적 호환 후보는 ${CANDIDATE_SCOPE_LABELS[candidateScope]} 범위의 전체 호환성 엔진 평가를 기준으로 합니다. ${candidateScopeDescription(candidateScope)}` : "전체 카탈로그는 서버의 현재 데이터 기준으로 페이지 단위 조회합니다."} 가격·스펙·원문·갱신 상태가 확인되지 않은 항목은 별도 상태로 표시하며, 카탈로그 탐색만으로 호환성을 확정하지 않습니다.</p>
  </div>;
}
