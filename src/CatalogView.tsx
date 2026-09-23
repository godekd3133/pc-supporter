import { useEffect, useMemo, useRef, useState } from "react";
import { FiActivity, FiArrowLeft, FiBox, FiCheck, FiClock, FiCopy, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLayers, FiLoader, FiPlus, FiRefreshCw, FiSearch, FiShare2, FiTrash2, FiTrendingUp } from "react-icons/fi";
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
import { safeHttpsUrl } from "./safe-source-url";
import { catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";
import { CatalogRefreshDiffPanel } from "./CatalogRefreshDiffPanel";
import { PriceTrendChart } from "./PriceTrendChart";

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
const CANDIDATE_SCOPE_LABELS: Record<CatalogCandidateScope, string> = { safe: "호환 가능", no_blocker: "정보 부족 포함", precision: "전체 호환 결과" };
const EMPTY_CATALOG_SPEC_FILTER: CatalogSpecFilter = { socket: "", memoryType: "", formFactor: "", minVramGb: "", minCapacityGb: "", minWattageW: "", minMemorySpeedMhz: "", pcieSlotWidth: "", minPcieSlotCount: "", pcieSlotInfo: "all", interface: "all" };
const CATALOG_GPU_VRAM_OPTIONS = [["", "전체"], ["8", "8GB 이상"], ["12", "12GB 이상"], ["16", "16GB 이상"], ["24", "24GB 이상"], ["32", "32GB 이상"]] as const;
const CATALOG_MEMORY_CAPACITY_OPTIONS = [["", "전체"], ["16", "16GB 이상"], ["32", "32GB 이상"], ["64", "64GB 이상"], ["128", "128GB 이상"]] as const;
const CATALOG_STORAGE_CAPACITY_OPTIONS = [["", "전체"], ["500", "500GB 이상"], ["1000", "1TB 이상"], ["2000", "2TB 이상"], ["4000", "4TB 이상"], ["8000", "8TB 이상"]] as const;
const CATALOG_MEMORY_SPEED_OPTIONS = [["", "전체"], ["4800", "4800MHz 이상"], ["5600", "5600MHz 이상"], ["6000", "6000MHz 이상"], ["6400", "6400MHz 이상"], ["7200", "7200MHz 이상"], ["8000", "8000MHz 이상"]] as const;
const CATALOG_PSU_WATTAGE_OPTIONS = [["", "전체"], ["500", "500W 이상"], ["650", "650W 이상"], ["750", "750W 이상"], ["850", "850W 이상"], ["1000", "1000W 이상"], ["1200", "1200W 이상"]] as const;
const CATALOG_PCIE_SLOT_WIDTH_OPTIONS = [["", "전체 슬롯 폭"], ["16", "x16 이상 사용 가능"], ["8", "x8 이상 사용 가능"], ["4", "x4 이상 사용 가능"], ["1", "x1 이상 사용 가능"]] as const;
const CATALOG_PCIE_SLOT_INFO_OPTIONS = [["all", "전체"], ["complete", "사양 등록"], ["missing", "사양 미등록"]] as const;
const MOBILE_CATALOG_CATEGORY_ORDER: PartCategory[] = ["cpu", "motherboard", "memory", "gpu", "ssd"];

function candidateScopeDescription(scope: CatalogCandidateScope) {
  if (scope === "safe") return "현재 견적과 호환되는 부품만 보여줘요.";
  if (scope === "no_blocker") return "호환 오류가 없는 부품을 보여줘요. 일부 사양은 비어 있을 수 있어요.";
  return "호환 가능, 정보 부족, 호환 불가 부품을 모두 보여줘요.";
}

function candidateScopeResultLabel(scope: CatalogCandidateScope) {
  return scope === "safe" ? "호환 가능" : scope === "no_blocker" ? "호환 오류 없음" : "전체 호환 결과";
}

function selectedPartIdsFor(build: BuildSelection, category: PartCategory) {
  if (category === "memory") return build.memory.map((item) => item.partId);
  if (category === "ssd") return build.ssd.map((item) => item.partId);
  if (category === "hdd") return build.hdd.map((item) => item.partId);
  const selection = build[category];
  return selection ? [selection.partId] : [];
}

function sourceLabel(source: Part["source"]) {
  return source === "danawa" ? "다나와" : source === "manual" ? "직접 확인" : "기본 데이터";
}

function freshnessLabel(part: Part) {
  const freshness = part.dataFreshness ?? classifyDataFreshness(part.updatedAt);
  return DATA_FRESHNESS_LABELS[freshness];
}

function priceLabel(priceWon: number | undefined) {
  return isKnownPrice(priceWon) ? `${priceWon.toLocaleString("ko-KR")}원` : "가격 정보 없음";
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
      similarity: "등록된 주요 사양 비교",
      ...(similarityEvidence ? { similarityEvidence } : {}),
      ...(benchmarkEvidence ? { benchmarkEvidence } : {}),
      performance: "현재 견적에 추가하기 전 주요 사양 비교",
      compatibility: "현재 견적에 추가한 뒤 호환 결과를 확인할 수 있어요.",
      dataQuality: QUALITY_LABELS[part.dataQuality],
      dataFreshness: part.dataFreshness ?? classifyDataFreshness(part.updatedAt),
      ...(part.updatedAt ? { updatedAt: part.updatedAt } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    };
  });
}

function candidateRiskLabel(risk: CatalogPart["candidateRisk"]) {
  return risk === "safe" ? "호환 가능" : risk === "review" ? "호환 정보 부족" : risk === "unsafe" ? "호환되지 않음" : "부품 정보";
}

function candidateDetailSummary(part: CatalogPart) {
  return [part.decision?.summary, part.performanceSummary].filter((value): value is string => Boolean(value)).join(" · ");
}

function CatalogSimilarityEvidencePanel({ part }: { part: CatalogPart }) {
  const evidence = part.similarityEvidence;
  if (!evidence) return null;
  const dimensions = evidence.dimensions ?? [];
  return <section className="catalog-similarity-evidence" aria-label={part.name + " 주요 사양 비교"} data-testid="catalog-similarity-evidence">
    <div className="catalog-similarity-evidence-heading"><div><strong>주요 사양 비교</strong><small>현재 부품과 비교 부품의 사양이에요.</small></div></div>
    {dimensions.length > 0 ? <div className="catalog-similarity-evidence-table-wrap"><table><caption>현재 부품과 비교 부품의 주요 사양</caption><thead><tr><th scope="col">사양</th><th scope="col">현재 부품</th><th scope="col">비교 부품</th></tr></thead><tbody>{dimensions.map((dimension) => <tr key={dimension.key}><th scope="row">{dimension.label}</th><td>{dimension.currentValue}</td><td>{dimension.candidateValue}</td></tr>)}</tbody></table></div> : <p className="catalog-similarity-evidence-empty">비교할 수 있는 사양이 없어요.</p>}
    {part.performanceSummary && <p className="catalog-similarity-evidence-summary">{part.performanceSummary}</p>}
  </section>;
}

function CatalogBenchmarkEvidenceSummary({ part }: { part: CatalogPart }) {
  const evidence = benchmarkEvidenceForPart(part);
  if (!evidence) return null;
  const scores = evidence.rows.filter((row) => row.value !== undefined).map((row) => row.label.replace("Cinebench R23 ", "").replace("3DMark ", "") + " " + row.value!.toLocaleString("ko-KR") + row.unit).join(" · ");
  if (!scores) return null;
  return <em className="catalog-benchmark-evidence-points" data-testid="catalog-benchmark-evidence-summary"><FiActivity /> {scores}</em>;
}

function CatalogBenchmarkEvidence({ part }: { part: CatalogPart }) {
  const evidence = benchmarkEvidenceForPart(part);
  if (!evidence || evidence.rows.every((row) => row.value === undefined)) return null;
  return <section className={"catalog-benchmark-evidence " + evidence.status} aria-label={part.name + " 성능 점수"} data-testid="catalog-benchmark-evidence">
    <div className="catalog-benchmark-evidence-heading"><div><strong><FiActivity /> 성능 점수</strong><small>{evidence.category === "cpu" ? "CPU" : "GPU"} 점수</small></div></div>
    <div className="catalog-benchmark-evidence-score-grid" data-testid="catalog-benchmark-evidence-scores">{evidence.rows.filter((row) => row.value !== undefined).map((row) => <div key={row.key}><span>{row.label}</span><strong>{row.value!.toLocaleString("ko-KR")}{row.unit}</strong></div>)}</div>
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
  return values.slice(0, 4).join(" · ") || "주요 사양 정보 없음";
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
    : "가격 정보 없음";
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

const CATALOG_FILTER_VISIBLE_URL_KEYS = new Set(["category", "q", "page", "mode", "candidateScope", "partId"]);

function catalogFiltersRequestedByUrl() {
  if (typeof window === "undefined") return false;
  return Array.from(new URLSearchParams(window.location.search).keys()).some((key) => !CATALOG_FILTER_VISIBLE_URL_KEYS.has(key));
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
  if (category === "motherboard" && filter.pcieSlotInfo !== "all") values.push(filter.pcieSlotInfo === "complete" ? "PCIe 슬롯 정보 있음" : "PCIe 슬롯 정보 부족");
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

function CatalogPriceHistoryPanel({ part, history, loading, error }: { part: CatalogPart; history?: CatalogPriceHistory; loading: boolean; error: string | null }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [localHistory, setLocalHistory] = useState<CatalogPriceHistory | undefined>(undefined);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (days === 30) {
      setLocalHistory(undefined);
      setLocalError(null);
      setLocalLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLocalHistory(undefined);
    setLocalLoading(true);
    setLocalError(null);
    void api<{ items: CatalogPriceHistory[] }>(`/api/price-history?ids=${encodeURIComponent(`part:${part.id}`)}&days=${days}`, { retry: 1, signal: controller.signal })
      .then((payload) => { if (!cancelled) setLocalHistory(payload.items[0]); })
      .catch((reason: unknown) => { if (!cancelled) setLocalError(reason instanceof Error ? reason.message : "가격 이력을 확인하지 못했습니다."); })
      .finally(() => { if (!cancelled) setLocalLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [days, part.id]);
  const activeHistory = days === 30 ? history : localHistory;
  const activeLoading = days === 30 ? loading : localLoading;
  const activeError = days === 30 ? error : localError;
  const historyPoints = activeHistory?.points ?? [];
  const chartPoints = isKnownPrice(part.priceWon)
    ? [...historyPoints, { changeId: `${part.id}:current`, changedAt: new Date().toISOString(), priceWon: part.priceWon }]
    : historyPoints;
  const prices = chartPoints.map((point) => point.priceWon);
  const minPriceWon = prices.length > 0 ? Math.min(...prices) : undefined;
  const maxPriceWon = prices.length > 0 ? Math.max(...prices) : undefined;
  const currentPriceWon = chartPoints.at(-1)?.priceWon;
  const hasHistory = (activeHistory?.summary.sampleCount ?? 0) > 0;
  const windowLabel = `${days}일`;
  return <section className="catalog-price-history-panel" aria-label={`${part.name} 가격 변동 추이`} data-testid="catalog-price-history-panel">
    <div className="catalog-price-history-heading"><div><p className="eyebrow"><FiTrendingUp /> 가격 변동</p><h3>가격 변동 추이</h3><p>최근 {windowLabel} 가격이에요.</p></div>{activeHistory && <span>{activeHistory.summary.sampleCount}회 기록</span>}</div>
    <div className="catalog-price-history-range" role="group" aria-label="가격 변동 추이 기간">{([7, 30, 90] as const).map((option) => <button className={days === option ? "selected" : ""} type="button" aria-pressed={days === option} data-testid={`catalog-price-history-days-${option}`} onClick={() => setDays(option)} key={option}>{option}일</button>)}</div>
    {activeLoading ? <div className="catalog-price-history-state" role="status"><FiLoader className="spin" /> 가격 변동을 불러오는 중...</div> : activeError && !activeHistory ? <div className="catalog-price-history-state error" role="status"><FiInfo /> 가격 이력을 불러오지 못했어요.</div> : !hasHistory ? <div className="catalog-price-history-state"><FiInfo /> 이 기간에 가격 변동이 없어요.</div> : <>
      <PriceTrendChart points={chartPoints.map((point) => ({ at: point.changedAt, priceWon: point.priceWon }))} ariaLabel={`${part.name} ${windowLabel} 가격 추이`} testId="catalog-price-history-chart" />
      <div className="catalog-price-history-stats"><div><span>최저</span><strong>{minPriceWon?.toLocaleString("ko-KR")}원</strong></div><div><span>현재</span><strong>{currentPriceWon?.toLocaleString("ko-KR")}원</strong></div><div><span>최고</span><strong>{maxPriceWon?.toLocaleString("ko-KR")}원</strong></div></div>
    </>}
  </section>;
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
      <span className="catalog-part-card-copy"><strong>{part.name}</strong><small>{part.brand ?? part.model ?? CATEGORY_LABELS[part.category]}</small><span>{compactSummary(part)}</span><CatalogBenchmarkEvidenceSummary part={part} />{part.candidateRisk && <em className={`catalog-candidate-risk ${part.candidateRisk}`}>{candidateRiskLabel(part.candidateRisk)}</em>}{part.decision && <em className={`catalog-candidate-decision ${part.decision.status}`}>호환 기준 · {part.decision.label}</em>}</span>
      <span className="catalog-part-card-price">{priceLabel(part.priceWon)}</span>
    </button>
    <div className="catalog-part-card-actions">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${part.name} 상품 페이지 보기`}>상품 페이지 <FiExternalLink /></a>}{onWatchPart && <CatalogWatchButton part={part} onWatch={onWatchPart} isWatched={isPartWatched} />}{showCompare && <button className={compareSelected ? "button button-small catalog-part-compare selected" : "button button-small catalog-part-compare"} type="button" aria-pressed={compareSelected} data-testid={`catalog-compare-${part.id}`} onClick={onToggleCompare}>{compareSelected ? <><FiCheck /> 비교 중</> : <><FiLayers /> 비교</>}</button>}<button className="button button-small catalog-part-add" type="button" onClick={onAdd} disabled={selected || blocked}>{blocked ? "호환 불가 · 적용할 수 없어요" : selected ? <><FiCheck /> 현재 선택</> : <><FiPlus /> 견적에 추가</>}</button></div>
  </article>;
}

function CatalogPartDetail({ part, priceHistory, priceHistoryLoading, priceHistoryError, onAdd, selected, compareSelected, showCompare, onToggleCompare, onWatchPart, isPartWatched, onOpenWatchlist, onOpenBuild, onRefresh, refreshing, refreshMessage, refreshError, refreshDiffs }: { part: CatalogPart; priceHistory?: CatalogPriceHistory; priceHistoryLoading: boolean; priceHistoryError: string | null; onAdd: () => void; selected: boolean; compareSelected: boolean; showCompare: boolean; onToggleCompare: () => void; onWatchPart?: (part: Part) => boolean; isPartWatched?: (part: Part) => boolean; onOpenWatchlist?: () => void; onOpenBuild: () => void; onRefresh?: () => void; refreshing?: boolean; refreshMessage?: string | null; refreshError?: string | null; refreshDiffs?: CatalogChangeValueDiff[] | null }) {
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  const blocked = part.candidateRisk === "unsafe";
  return <section className="catalog-detail" aria-label="선택한 부품 상세" data-testid="catalog-part-detail">
    <div className="catalog-detail-heading"><div><p className="eyebrow">부품 정보</p><h2>{part.name}</h2><p>{CATEGORY_LABELS[part.category]} · {part.brand ?? part.model ?? CATEGORY_LABELS[part.category]}</p></div><CatalogPartVisual part={part} /></div>


    <CatalogBenchmarkEvidence part={part} />
    <CatalogPriceActionPanel part={part} history={priceHistory} loading={priceHistoryLoading} error={priceHistoryError} />
    <CatalogPriceHistoryPanel part={part} history={priceHistory} loading={priceHistoryLoading} error={priceHistoryError} />
    {part.candidateRisk && <div className={`catalog-candidate-summary ${part.candidateRisk}`}><strong>{candidateRiskLabel(part.candidateRisk)}</strong><small className="catalog-candidate-scope-note">현재 견적 기준</small><span>{candidateDetailSummary(part) || "현재 견적과의 호환 정보예요."}</span>{part.candidateReasons && part.candidateReasons.length > 0 && <small>호환 정보 · {part.candidateReasons.slice(0, 2).join(" · ")}</small>}{part.remainingBlockers !== undefined && <small>남은 항목 · 호환 불가 {part.remainingBlockers} · 주의 {part.remainingWarnings ?? 0} · 정보 부족 {part.remainingUnknown ?? 0}</small>}</div>}
    <CatalogSimilarityEvidencePanel part={part} />
    <div className="catalog-detail-price"><div><span>예상 가격</span></div><strong>{priceLabel(part.priceWon)}</strong></div>
    <dl className="catalog-detail-specs">{specRowsFor(part).map(([label, value]) => <div key={`${label}-${value}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {part.missingFields.length > 0 && <p className="catalog-detail-missing"><FiInfo /> 정보가 없는 사양 {part.missingFields.slice(0, 5).map((field) => catalogMissingFieldLabelFor(field)).join(", ")}{part.missingFields.length > 5 ? ` 외 ${part.missingFields.length - 5}개` : ""}</p>}

    <div className="catalog-detail-actions">{onWatchPart && <CatalogWatchButton part={part} onWatch={onWatchPart} isWatched={isPartWatched} />}{onOpenWatchlist && <button className="button button-light" type="button" onClick={onOpenWatchlist}><FiClock /> 가격 추적 화면</button>}{showCompare && <button className={compareSelected ? "button button-light catalog-detail-compare selected" : "button button-light catalog-detail-compare"} type="button" aria-pressed={compareSelected} onClick={onToggleCompare}>{compareSelected ? <><FiCheck /> 비교에서 제외</> : <><FiLayers /> 비교에 추가</>}</button>}<button className="button button-primary" type="button" onClick={onAdd} disabled={selected || blocked}>{blocked ? "호환 불가 · 적용할 수 없어요" : selected ? <><FiCheck /> 현재 견적에 선택됨</> : <><FiPlus /> 현재 견적에 추가</>}</button><button className="button button-light" type="button" onClick={onOpenBuild}><FiActivity /> 내 견적에서 보기</button>{part.source === "danawa" && part.sourceProductCode && part.danawaUrl && <button className="button button-light catalog-detail-refresh" type="button" data-testid="catalog-refresh-part" onClick={onRefresh} disabled={!onRefresh || refreshing}>{refreshing ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiRefreshCw /> 가격·사양 새로 불러오기</>}</button>}{sourceUrl && <a className="button button-light" href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 상품 페이지 열기</a>}</div>
    {(refreshMessage || refreshError) && <p className={refreshError ? "catalog-detail-refresh-status error" : "catalog-detail-refresh-status"} role={refreshError ? "alert" : "status"}><FiInfo /> {refreshError ?? refreshMessage}</p>}
    {refreshDiffs !== undefined && refreshDiffs !== null && <CatalogRefreshDiffPanel diffs={refreshDiffs} kind="part" />}
    {blocked && <p className="catalog-detail-blocked-note"><FiInfo /> 현재 견적과 호환되지 않아 추가할 수 없어요.</p>}

  </section>;
}

function CatalogNonCoreNotice({ count, categoryMismatchCount, query, onOpenAccessories }: { count: number; categoryMismatchCount: number; query: string; onOpenAccessories?: (query?: string) => void }) {
  if (count <= 0) return null;
  const normalizedCategoryMismatchCount = Math.min(count, Math.max(0, categoryMismatchCount));
  const nonCategoryCount = count - normalizedCategoryMismatchCount;
  return <div className="catalog-non-core-notice" role="status" data-testid="catalog-non-core-notice"><FiInfo /><div><strong>{count.toLocaleString("ko-KR")}개는 부품이 아니라 결과에서 뺐어요.</strong><p>{normalizedCategoryMismatchCount > 0 && `분류가 맞지 않는 항목 ${normalizedCategoryMismatchCount.toLocaleString("ko-KR")}개`}{normalizedCategoryMismatchCount > 0 && nonCategoryCount > 0 ? " · " : ""}{nonCategoryCount > 0 && `주변 부품·비핵심 상품 ${nonCategoryCount.toLocaleString("ko-KR")}개`}는 호환 부품과 따로 보여줘요.</p></div>{nonCategoryCount > 0 && onOpenAccessories && <button className="button button-small button-light" type="button" data-testid="catalog-open-accessories" onClick={() => onOpenAccessories(query.trim() || undefined)}>주변 부품에서 보기</button>}</div>;
}

function CatalogIncompleteNotice({ count, category, missingFields }: { count: number; category: PartCategory; missingFields: CatalogSpecCoverageMissingField[] }) {
  if (count <= 0) return null;
  return <div className="catalog-incomplete-notice" role="status" data-testid="catalog-incomplete-notice"><FiInfo /><div><strong>필요한 사양이 없는 부품 {count.toLocaleString("ko-KR")}개는 호환 여부를 비교하기 어려워요.</strong><p>사양을 확인하면 호환성 비교에 포함할 수 있어요.</p><div className="catalog-incomplete-fields">{missingFields.slice(0, 3).map((field) => <a className="catalog-incomplete-field-link" data-testid="catalog-open-missing-field" href={`/catalog?category=${encodeURIComponent(category)}&quality=incomplete&missingField=${encodeURIComponent(field.field)}`} key={field.field}>{catalogMissingFieldLabelFor(field.field)} {field.count}개</a>)}</div></div><a className="button button-small button-light" data-testid="catalog-open-incomplete" href={`/catalog?category=${encodeURIComponent(category)}&quality=incomplete`}>사양 미등록 부품 보기</a></div>;
}

function CatalogSpecFilterPanel({ category, filter, specExcludedCount, specFilterDiagnostics, onChange, onReset }: { category: PartCategory; filter: CatalogSpecFilter; specExcludedCount: number; specFilterDiagnostics: Array<{ key: string; label: string; excludedCount: number; missingCount: number }>; onChange: (next: CatalogSpecFilter) => void; onReset: () => void }) {
  const summary = catalogSpecFilterSummaryFor(category, filter);
  const update = <K extends keyof CatalogSpecFilter>(key: K, value: CatalogSpecFilter[K]) => onChange({ ...filter, [key]: value });
  const missing = specFilterDiagnostics.filter((diagnostic) => diagnostic.missingCount > 0).slice(0, 3);
  return <section className="catalog-spec-filter-panel" aria-label="카탈로그 핵심 사양 필터" data-testid="catalog-spec-filters"><div className="catalog-spec-filter-heading"><div><strong>핵심 사양 조건</strong><small>입력한 사양과 맞는 부품을 찾아요. 사양이 없는 부품은 비교에서 빠질 수 있어요.</small></div><button className="text-button" type="button" data-testid="catalog-clear-spec-filters" onClick={onReset} disabled={!summary}>조건 초기화</button></div><div className="catalog-spec-filter-grid">{["cpu", "cooler", "motherboard"].includes(category) && <label><span>소켓</span><input aria-label="카탈로그 소켓 스펙 필터" value={filter.socket} placeholder="예: AM5" onChange={(event) => update("socket", event.target.value)} /></label>}{["cpu", "motherboard", "memory"].includes(category) && <label><span>메모리 세대</span><input aria-label="카탈로그 메모리 세대 스펙 필터" value={filter.memoryType} placeholder="예: DDR5" onChange={(event) => update("memoryType", event.target.value)} /></label>}{["case", "motherboard", "memory", "ssd", "psu"].includes(category) && <label><span>폼팩터</span><input aria-label="카탈로그 폼팩터 스펙 필터" value={filter.formFactor} placeholder="예: ATX · M.2" onChange={(event) => update("formFactor", event.target.value)} /></label>}{category === "motherboard" && <><label><span>PCIe 슬롯 정보</span><select aria-label="카탈로그 PCIe 슬롯 사양 필터" value={filter.pcieSlotInfo} onChange={(event) => update("pcieSlotInfo", event.target.value as CatalogSpecFilter["pcieSlotInfo"])}>{CATALOG_PCIE_SLOT_INFO_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>PCIe 슬롯 폭</span><select aria-label="카탈로그 PCIe 슬롯 폭 스펙 필터" value={filter.pcieSlotWidth} onChange={(event) => update("pcieSlotWidth", event.target.value)}>{CATALOG_PCIE_SLOT_WIDTH_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>해당 슬롯 수 ≥</span><input aria-label="카탈로그 최소 PCIe 슬롯 수 스펙 필터" type="number" min="1" step="1" value={filter.minPcieSlotCount} placeholder="예: 1" onChange={(event) => update("minPcieSlotCount", event.target.value)} /></label></>}{category === "gpu" && <label><span>최소 VRAM</span><select aria-label="카탈로그 최소 VRAM 스펙 필터" value={filter.minVramGb} onChange={(event) => update("minVramGb", event.target.value)}>{CATALOG_GPU_VRAM_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{["memory", "ssd", "hdd"].includes(category) && <label><span>{category === "memory" ? "최소 모듈 용량" : "최소 용량"}</span><select aria-label="카탈로그 최소 용량 스펙 필터" value={filter.minCapacityGb} onChange={(event) => update("minCapacityGb", event.target.value)}>{(category === "memory" ? CATALOG_MEMORY_CAPACITY_OPTIONS : CATALOG_STORAGE_CAPACITY_OPTIONS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{category === "memory" && <label><span>최소 속도</span><select aria-label="카탈로그 최소 메모리 속도 스펙 필터" value={filter.minMemorySpeedMhz} onChange={(event) => update("minMemorySpeedMhz", event.target.value)}>{CATALOG_MEMORY_SPEED_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{category === "psu" && <label><span>최소 정격</span><select aria-label="카탈로그 최소 PSU 출력 스펙 필터" value={filter.minWattageW} onChange={(event) => update("minWattageW", event.target.value)}>{CATALOG_PSU_WATTAGE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{["ssd", "hdd"].includes(category) && <label><span>연결 방식</span><select aria-label="카탈로그 저장장치 연결 방식 스펙 필터" value={filter.interface} onChange={(event) => update("interface", event.target.value as CatalogSpecFilter["interface"])}><option value="all">전체 연결 방식</option><option value="NVMe">NVMe</option><option value="SATA">SATA</option></select></label>}</div>{summary && <p className="catalog-spec-filter-summary" data-testid="catalog-spec-filter-summary"><FiLayers /> {summary}{specExcludedCount > 0 ? ` · 조건 제외 ${specExcludedCount.toLocaleString("ko-KR")}개` : ""}</p>}{missing.length > 0 && <p className="catalog-spec-filter-missing" role="status"><FiInfo /> 조건 비교에 필요한 값이 없는 상품 {missing.map((item) => `${item.label} ${item.missingCount}개`).join(" · ")}는 결과에서 제외했습니다.</p>}</section>;
}

function CatalogSpecPresetAction({ preset, onApply }: { preset: ReturnType<typeof catalogCompatibilityPresetFor>; onApply: (values: Partial<CatalogSpecFilter>) => void }) {
  if (!preset.summary) return null;
  return <div className="catalog-spec-preset" data-testid="catalog-spec-preset"><div><strong>현재 구성에 맞는 조건</strong><small>{preset.summary}</small></div><button className="button button-small button-light" type="button" data-testid="catalog-apply-spec-preset" onClick={() => onApply(preset.values)}>조건 적용</button>{preset.omitted.length > 0 && <p><FiInfo /> 입력하지 않은 조건: {preset.omitted.join(" · ")}</p>}</div>;
}

function catalogBenchmarkComparisonRowsFor(parts: CatalogPart[]) {
  type ComparisonRow = { key: string; label: string; values: string[] };
  const evidences = parts.map((part) => benchmarkEvidenceForPart(part));
  if (!evidences.some(Boolean)) return [];
  const rows = new Map<string, ComparisonRow>();
  const addRow = (key: string, label: string, valueFor: (evidence: BenchmarkEvidencePart | undefined) => string) => {
    rows.set(key, { key, label, values: evidences.map(valueFor) });
  };
  const scoreRows = new Map<string, { label: string; values: string[] }>();
  evidences.forEach((evidence, index) => {
    evidence?.rows.forEach((row) => {
      const comparison = scoreRows.get(row.key) ?? { label: row.label, values: Array.from({ length: parts.length }, () => "정보 없음") };
      comparison.values[index] = row.value === undefined ? "정보 없음" : `${row.value.toLocaleString("ko-KR")}${row.unit}`;
      scoreRows.set(row.key, comparison);
    });
  });
  scoreRows.forEach((row, key) => rows.set(`benchmark-score-${key}`, { key: `benchmark-score-${key}`, label: row.label, values: row.values }));
  return [...rows.values()].map((row) => ({ ...row, changed: new Set(row.values).size > 1 }));
}

function catalogComparisonSpecRowsFor(parts: CatalogPart[]) {
  const benchmarkLabels = new Set(["CPU 싱글 점수", "CPU 멀티 점수", "Time Spy", "Port Royal"]);
  const rows = new Map<string, { key: string; label: string; values: string[] }>();
  parts.forEach((part, index) => {
    for (const [label, value] of specRowsFor(part)) {
      if (benchmarkLabels.has(label)) continue;
      const key = label;
      const row = rows.get(key) ?? { key, label, values: Array.from({ length: parts.length }, () => "정보 없음") };
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
      if (mountedRef.current) onToast("부품 비교를 복사했어요.");
    } catch {
      if (mountedRef.current) onToast("복사하지 못했어요. 브라우저에서 복사를 허용한 뒤 다시 시도해 주세요.");
    }
  }
  async function downloadComparisonCsv() {
    const { alternativeComparisonCsvFor } = await import("../shared/alternative-comparison-export");
    if (!mountedRef.current) return;
    downloadCatalogComparisonFile(alternativeComparisonCsvFor(comparisonCandidates, comparisonContext), `pc-supporter-catalog-comparison-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    onToast("부품 비교를 CSV 파일로 저장했어요.");
  }
  async function downloadComparisonJson() {
    const { alternativeComparisonJsonFor } = await import("../shared/alternative-comparison-export");
    if (!mountedRef.current) return;
    downloadCatalogComparisonFile(alternativeComparisonJsonFor(comparisonCandidates, comparisonContext), `pc-supporter-catalog-comparison-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
    onToast("부품 비교를 JSON 파일로 저장했어요.");
  }
  return <section className="catalog-spec-comparison" aria-label="카탈로그 부품 비교" data-testid="catalog-spec-comparison">
    <div className="catalog-spec-comparison-heading"><div><h2>{CATEGORY_LABELS[category]} 부품 비교</h2><p>선택한 부품의 가격·핵심 사양·성능을 나란히 비교해요.</p></div><span><FiLayers /> {parts.length} / 3개</span></div>
    {comparisonContext.currentPartName && <div className="catalog-spec-comparison-baseline" data-testid="catalog-comparison-baseline"><div><span>비교 기준</span><strong>{comparisonContext.currentPartName}</strong></div><div>{comparisonContext.currentPartSummary && <small>{comparisonContext.currentPartSummary}</small>}{comparisonContext.currentPartPrice && <em>{comparisonContext.currentPartPrice}</em>}</div></div>}
    <div className="catalog-spec-comparison-table-wrap"><table><caption>{CATEGORY_LABELS[category]} 부품의 가격과 사양을 비교해요. 페이지를 이동해도 선택한 부품은 유지돼요.</caption><thead><tr><th scope="col">비교 항목</th>{parts.map((part) => <th scope="col" key={part.id}><div className="catalog-spec-comparison-part-heading"><span>{part.name}</span><button className="text-button" type="button" data-testid={`catalog-comparison-remove-${part.id}`} onClick={() => onRemove(part.id)}>제외</button></div></th>)}</tr></thead><tbody>
      {rows.map((row) => { const changed = new Set(row.values).size > 1; return <tr className={changed ? "changed" : undefined} key={row.key}><th scope="row">{row.label}{changed && <small> 차이</small>}</th>{row.values.map((value, index) => <td className={value === "정보 없음" || value === "가격 정보 없음" || value === "정보 없음" || value === "사양 미등록" ? "unknown" : undefined} key={`${row.key}-${parts[index]?.id ?? index}`}>{value}</td>)}</tr>; })}
      <tr className="catalog-spec-comparison-actions"><th scope="row">견적에 추가</th>{parts.map((part) => { const blocked = part.candidateRisk === "unsafe"; const selected = selectedIds.has(part.id); return <td key={`${part.id}-add`}><button className="button button-small" type="button" data-testid={`catalog-comparison-add-${part.id}`} onClick={() => onAdd(part)} disabled={selected || blocked}>{blocked ? "차단 위험" : selected ? "현재 선택됨" : "이 부품 추가"}</button></td>; })}</tr>
    </tbody></table></div>
    {sharedComparison && <div className="catalog-spec-comparison-share-preview" data-testid="catalog-comparison-share-preview"><label><span>비교 공유 링크{sharedComparison.expiresAt ? ` · ${new Date(sharedComparison.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="카탈로그 부품 비교 공유 링크" type="text" value={sharedComparison.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div><a className="text-button" href={sharedComparison.url}>열기</a>{onRevokeComparison && <button className="text-button danger-text-button" type="button" onClick={() => void revokeComparison()}><FiTrash2 /> 공유 취소</button>}</div></div>}
    <div className="catalog-spec-comparison-actions"><button className="text-button" type="button" data-testid="catalog-comparison-copy" onClick={() => void copyComparison()}><FiCopy /> 비교 복사</button><button className="text-button" type="button" data-testid="catalog-comparison-csv" onClick={() => void downloadComparisonCsv()}><FiDownload /> CSV 저장</button><button className="text-button" type="button" data-testid="catalog-comparison-json" onClick={() => void downloadComparisonJson()}><FiDownload /> JSON 저장</button>{onShareComparison && <button className="text-button" type="button" data-testid="catalog-comparison-share" onClick={() => void shareComparison()} disabled={sharingComparison}>{sharingComparison ? <><FiRefreshCw className="spin" /> 공유 준비 중...</> : <><FiShare2 /> 공유 링크</>}</button>}{onCompareScenarios && <button className="button button-small button-light" type="button" data-testid="catalog-spec-virtual-compare" onClick={() => onCompareScenarios(category, parts)} disabled={!compareReady}>{compareReady ? <><FiActivity /> 현재 견적에 미리 비교</> : <><FiActivity /> 호환 결과 확인 후 비교</>}</button>}<button className="text-button" type="button" data-testid="catalog-comparison-clear" onClick={onClear}><FiRefreshCw /> 비교 선택 초기화</button></div>

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
  const [filtersOpen, setFiltersOpen] = useState(catalogFiltersRequestedByUrl);
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
      setFiltersOpen(catalogFiltersRequestedByUrl());
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
      setRefreshPartMessage(`${refreshedPart.name} 정보 업데이트 완료 · ${payload.changedFields.length > 0 ? `${payload.changedFields.length}개 영역 갱신` : "변경된 영역 없음"}`);
      setRefreshPartDiffs(payload.valueDiffs ?? []);
      setRetryNonce((current) => current + 1);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      setRefreshPartError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "부품 상세 정보를 다시 확인하지 못했습니다.");
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
    ? `안전 ${riskCounts.safe.toLocaleString("ko-KR")} · 정보 부족 ${riskCounts.review.toLocaleString("ko-KR")} · 호환 불가 ${riskCounts.unsafe.toLocaleString("ko-KR")}`
    : undefined;
  const candidateEmptyMessage = mode !== "compatible"
    ? query.trim()
      ? `"${query.trim().slice(0, 40)}" 검색 결과가 없습니다. 다른 모델명이나 조건을 확인해 주세요.`
      : "조건에 맞는 부품이 없습니다."
    : candidateScope === "safe"
      ? "현재 견적과 호환되는 부품이 없어요."
      : candidateScope === "no_blocker"
        ? "현재 견적과 호환되는 부품이 없어요. 다른 사양을 선택해 보세요."
        : "현재 견적에 맞는 부품이 없어요.";

  const brandOptions = meta?.catalogBrandCounts?.[category] ?? [];

  return <div className={filtersOpen ? "catalog-page filters-open" : "catalog-page"}>
    <div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">부품 목록</p><h1>부품 찾기</h1></div><div className="catalog-heading-actions"><button className="button button-light catalog-filter-toggle" type="button" onClick={() => setFiltersOpen((current) => !current)}><FiSearch /> {filtersOpen ? "조건 접기" : "상세 조건"}</button><button className="button button-secondary" type="button" onClick={onOpenBuild}><FiActivity /> 현재 견적 보기</button></div></div>
    <CatalogSpecFilterPanel category={category} filter={specFilter} specExcludedCount={specExcludedCount} specFilterDiagnostics={specFilterDiagnostics} onChange={(next) => { setSpecFilter(next); setPage(0); }} onReset={() => { setSpecFilter({ ...EMPTY_CATALOG_SPEC_FILTER }); setPage(0); }} />
    <CatalogSpecPresetAction preset={catalogSpecPreset} onApply={(values) => { setSpecFilter((current) => ({ ...current, ...values })); setPage(0); }} />
    {brandOptions.length > 0 && <div className="catalog-brand-suggestions" role="group" aria-label="카탈로그 제조사 빠른 선택"><span>빠른 제조사</span>{brandOptions.slice(0, 8).map((option) => <button className={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR") ? "selected" : ""} type="button" aria-pressed={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR")} onClick={() => { setBrand(option.brand); setPage(0); }} key={option.brand}>{option.brand}<small>{option.count}</small></button>)}</div>}
    <section className="catalog-brand-filter-panel" aria-label="카탈로그 제조사 필터" data-testid="catalog-brand-filter"><label><span>제조사</span><input aria-label="카탈로그 제조사 필터" type="search" value={brand} onChange={(event) => { setBrand(event.target.value.slice(0, 80)); setPage(0); }} placeholder="예: ASUS · AMD · GIGABYTE" /></label>{brand.trim() && <button className="text-button" type="button" onClick={() => { setBrand(""); setPage(0); }}>제조사 초기화</button>}</section>
    {benchmarkSortAvailable && <section className="catalog-brand-filter-panel catalog-benchmark-sort-panel" aria-label="카탈로그 성능 정렬" data-testid="catalog-benchmark-sort-panel"><label><span>성능 정렬</span><select aria-label="카탈로그 성능 정렬" data-testid="catalog-benchmark-sort" value={benchmarkSort ? "benchmark_desc" : "off"} onChange={(event) => { const enabled = event.target.value === "benchmark_desc"; setBenchmarkSort(enabled); if (enabled) setSort("price_asc"); setPage(0); }}><option value="off">사용 안 함</option><option value="benchmark_desc">{category === "cpu" ? "Cinebench R23 점수 높은 순" : "3DMark 점수 높은 순"}</option></select></label></section>}
    <section className="catalog-toolbar" aria-label="부품 카탈로그 필터"><div className="catalog-mode-toggle" role="group" aria-label="카탈로그 탐색 모드"><button className={mode === "catalog" ? "selected" : ""} type="button" aria-pressed={mode === "catalog"} onClick={() => { setMode("catalog"); setPartId(undefined); setMissingField(""); setBenchmarkSort(false); setSort("price_asc"); setPage(0); }}>전체 카탈로그</button><button className={mode === "compatible" ? "selected" : ""} type="button" aria-pressed={mode === "compatible"} onClick={() => { setMode("compatible"); setBenchmarkStatus("all"); setPartId(undefined); setMissingField(""); setBenchmarkSort(false); setSort("similarity"); setPage(0); }}>현재 견적에 맞는 부품</button><small>{mode === "compatible" ? "현재 견적에 맞는 부품만 골라 보여줘요." : "호환 여부와 상관없이 전체 부품을 찾아봅니다."}</small><button className="text-button catalog-filter-link-button" type="button" data-testid="catalog-copy-filter-link" onClick={() => void copyCatalogSearchLink()}><FiCopy /> 조건 링크 복사</button></div>{mode === "compatible" && <div className="catalog-candidate-scope" role="group" aria-label="호환 부품 범위"><span>호환 상태</span>{(Object.keys(CANDIDATE_SCOPE_LABELS) as CatalogCandidateScope[]).map((scope) => <button className={candidateScope === scope ? "selected" : ""} type="button" aria-pressed={candidateScope === scope} data-testid={`catalog-scope-${scope}`} onClick={() => { setCandidateScope(scope); setBenchmarkSort(false); setSort("similarity"); setPage(0); }} key={scope}>{CANDIDATE_SCOPE_LABELS[scope]}</button>)}<small>{candidateScopeDescription(candidateScope)}</small></div>}<form className="catalog-search" onSubmit={(event) => { event.preventDefault(); setPage(0); }}><FiSearch /><input aria-label="부품 카탈로그 검색" enterKeyHint="search" value={query} onChange={(event) => { setPartId(undefined); setQuery(event.target.value); }} placeholder="모델명·제조사·소켓·메모리 세대 검색" /><button className="button button-primary button-small" type="submit">검색</button></form><div className="mobile-catalog-category-chips" role="group" aria-label="모바일 카탈로그 범주 빠른 선택">{MOBILE_CATALOG_CATEGORY_ORDER.map((item) => <button className={category === item ? "selected" : ""} type="button" aria-pressed={category === item} onClick={() => { setPartId(undefined); setMissingField(""); setCategory(item); if (item !== "cpu" && item !== "gpu") { setBenchmarkStatus("all"); setBenchmarkSort(false); } setPage(0); }} key={item}>{CATEGORY_LABELS[item]}</button>)}</div><div className={`catalog-filters${mode === "catalog" && (category === "cpu" || category === "gpu") ? " with-benchmark" : ""}`}><label><span>범주</span><select aria-label="카탈로그 부품 범주" value={category} onChange={(event) => { const nextCategory = event.target.value as PartCategory; setPartId(undefined); setMissingField(""); setCategory(nextCategory); if (nextCategory !== "cpu" && nextCategory !== "gpu") { setBenchmarkStatus("all"); setBenchmarkSort(false); } }}>{PART_CATEGORIES.map((item) => <option value={item} key={item}>{CATEGORY_LABELS[item]}</option>)}</select></label><label><span>가격</span><select aria-label="카탈로그 가격 상태" value={priceStatus} onChange={(event) => setPriceStatus(event.target.value as PriceAvailabilityFilter)}><option value="all">{PRICE_AVAILABILITY_LABELS.all}</option><option value="known">{PRICE_AVAILABILITY_LABELS.known}</option><option value="unknown">{PRICE_AVAILABILITY_LABELS.unknown}</option></select></label>{mode === "catalog" && (category === "cpu" || category === "gpu") && <label><span>성능 점수</span><select aria-label="카탈로그 성능 점수 상태" value={benchmarkStatus} onChange={(event) => { setBenchmarkStatus(event.target.value as BenchmarkAvailabilityFilter); setPage(0); }}><option value="all">{BENCHMARK_AVAILABILITY_LABELS.all}</option><option value="complete">{BENCHMARK_AVAILABILITY_LABELS.complete}</option><option value="incomplete">{BENCHMARK_AVAILABILITY_LABELS.incomplete}</option></select></label>}<label><span>구매 조건</span><select aria-label="카탈로그 구매 조건" value={listingPolicy} onChange={(event) => setListingPolicy(event.target.value as ListingPolicy)}>{Object.entries(LISTING_POLICY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>정렬</span><select aria-label="카탈로그 정렬" value={sort} onChange={(event) => { setBenchmarkSort(false); setSort(event.target.value as CatalogSort); }}><option value="price_asc">가격 낮은 순</option><option value="price_desc">가격 높은 순</option><option value="name">이름 순</option><option value="updated">최근 갱신</option>{mode === "compatible" && <><option value="similarity">유사도 높은 순</option><option value="value">가성비 높은 순</option></>}</select></label></div>{missingField && <div className="catalog-missing-field-filter" data-testid="catalog-missing-field-filter"><div><span>누락 필드 필터</span><strong>{catalogMissingFieldLabelFor(missingField)}</strong><small>{missingField}</small></div><button className="text-button" type="button" onClick={() => { setMissingField(""); setPage(0); }}>필터 해제</button></div>}</section>
    <section className="catalog-comparison-bar" aria-label="카탈로그 부품 비교" data-testid="catalog-comparison-bar"><div><strong><FiLayers /> 부품 비교 {compareIds.length} / 3</strong></div><button className="button button-small button-primary" type="button" data-testid="catalog-compare-submit" onClick={compareSelectedParts} disabled={compareParts.length < 2 || (mode === "compatible" && (!onCompareParts || !compareReady))}>{mode === "compatible" ? (compareReady ? <><FiActivity /> 선택 부품 미리 비교</> : <><FiActivity /> 호환 결과 확인 후 비교</>) : <><FiLayers /> 선택 부품 비교</>}</button></section>{mode === "catalog" && catalogComparisonOpen && compareParts.length >= 2 && <CatalogSpecComparison category={category} parts={compareParts} selectedIds={selectedIds} compareReady={compareReady} comparisonContext={comparisonContext} onAdd={onAddPart} onRemove={removeComparePart} onCompareScenarios={onCompareParts} onShareComparison={onShareComparison} onRevokeComparison={onRevokeComparison} onToast={onToast} onClear={() => { setCompareIds([]); setComparePartsById({}); setCatalogComparisonOpen(false); }} />}<div className="catalog-layout"><section className="catalog-results" aria-label="부품 카탈로그 결과"><div className="catalog-results-heading"><div><p className="eyebrow">{mode === "compatible" ? "현재 견적에 맞는 부품" : "부품 목록"}</p><h2>{CATEGORY_LABELS[category]} {mode === "compatible" ? candidateScopeResultLabel(candidateScope) : "목록"}</h2></div><span>{loading ? "불러오는 중" : `${total.toLocaleString("ko-KR")}개 결과 · ${page + 1}/${pageCount}페이지${candidateScopeSummary ? ` · ${candidateScopeSummary}` : ""}`}</span></div><CatalogIncompleteNotice count={mode === "compatible" ? incompleteExcludedCount : 0} category={category} missingFields={incompleteMissingFields} /><CatalogNonCoreNotice count={mode === "catalog" ? nonCoreExcludedCount : 0} categoryMismatchCount={mode === "catalog" ? categoryMismatchExcludedCount : 0} query={query} onOpenAccessories={onOpenAccessories} />{mode === "catalog" && benchmarkStatus !== "all" && <p className="catalog-benchmark-filter-summary" data-testid="catalog-benchmark-filter-summary"><FiActivity /> {BENCHMARK_AVAILABILITY_LABELS[benchmarkStatus]} · {total.toLocaleString("ko-KR")}개 표시{benchmarkExcludedCount > 0 ? ` · ${benchmarkStatus === "complete" ? "일부·없음" : "완전 세트"} ${benchmarkExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}</p>}{error ? <div className="catalog-state error" role="alert"><FiInfo /><div><strong>부품 목록을 불러오지 못했어요.</strong></div><button className="button button-small button-light" type="button" onClick={() => setRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 시도</button></div> : loading ? <div className="catalog-state" role="status"><FiLoader className="spin" /> {mode === "compatible" ? `${CANDIDATE_SCOPE_LABELS[candidateScope]}를 계산하는 중...` : "부품 카탈로그를 불러오는 중..."}</div> : items.length === 0 ? <div className="catalog-state"><FiSearch /> {candidateEmptyMessage}</div> : <div className="catalog-part-list">{items.map((part) => <CatalogPartCard key={part.id} part={part} selected={selectedIds.has(part.id)} compareSelected={compareIds.includes(part.id)} showCompare onSelect={() => setSelectedId(part.id)} onAdd={() => onAddPart(part)} onToggleCompare={() => toggleCompare(part)} onWatchPart={onWatchPart} isPartWatched={isPartWatched} />)}</div>}{total > 0 && <div className="catalog-pagination"><button className="button button-light button-small" type="button" onClick={() => goToPage(page - 1)} disabled={page === 0 || loading}>이전</button><span>{page + 1} / {pageCount}</span><button className="button button-light button-small" type="button" onClick={() => goToPage(page + 1)} disabled={page >= pageCount - 1 || loading}>다음</button></div>}</section><aside>{selectedPart ? <CatalogPartDetail part={selectedPart} priceHistory={selectedPriceHistory} priceHistoryLoading={selectedPriceHistoryLoading} priceHistoryError={selectedPriceHistoryError} selected={selectedIds.has(selectedPart.id)} compareSelected={compareIds.includes(selectedPart.id)} showCompare onToggleCompare={() => toggleCompare(selectedPart)} onAdd={() => onAddPart(selectedPart)} onWatchPart={onWatchPart} isPartWatched={isPartWatched} onOpenWatchlist={onOpenWatchlist} onOpenBuild={onOpenBuild} onRefresh={() => void refreshCatalogPart(selectedPart)} refreshing={refreshingPartId === selectedPart.id} refreshMessage={refreshPartMessage} refreshError={refreshPartError} refreshDiffs={refreshPartDiffs} /> : <section className="catalog-detail-empty"><FiBox /><h2>부품을 선택하세요</h2></section>}</aside></div>
  </div>;
}
