import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { FiActivity, FiCheck, FiChevronDown, FiClock, FiCopy, FiDatabase, FiDownload, FiExternalLink, FiInfo, FiLayers, FiLoader, FiRefreshCw, FiSearch, FiShare2, FiTrash2, FiXCircle } from "react-icons/fi";
import type { AlternativeRiskCounts, BrandCountOption, BuildSelection, CatalogBenchmarkCoverage, CompatiblePartCandidate, DataFreshness, DataQuality, GamingRefreshRate, GamingResolution, Part, PartCategory, PartSelection, PhysicalEvidenceSource, PriceAvailabilityFilter, RecommendationProfile, RecommendationTrustCounts, RecommendationTrustFilter, SimilarityEvidence, ListingPolicy } from "../shared/types";
import { BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, isKnownPrice, LISTING_POLICY_LABELS, LISTING_TYPE_LABELS, PRICE_AVAILABILITY_LABELS } from "../shared/types";
import { alternativeComparisonBenchmarkEvidenceFor, alternativeComparisonCsvFor, alternativeComparisonJsonFor, alternativeComparisonSimilarityEvidenceFor, alternativeComparisonTextFor } from "../shared/alternative-comparison-export";
import { benchmarkEvidenceForPart } from "../shared/benchmark-evidence";
import type { AlternativeComparisonCandidate } from "../shared/alternative-comparison-export";
import { compatibilityFilterPresetFor } from "../shared/compatibility-filter-preset";
import { CANDIDATE_COMPARISON_CRITERIA, candidateComparisonDecisionFor, type CandidateComparisonCriterion } from "../shared/candidate-comparison";
import { physicalEvidenceFilterLabel, type PhysicalEvidenceFilter } from "../shared/physical-evidence-filter";
import { api } from "./api";
import { shouldAutoFallbackToReviewCandidates, shouldOfferReviewCandidates } from "./part-picker-mode";
import { ComparisonBenchmarkCell } from "./ComparisonBenchmarkCell";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";
import { useModalAccessibility } from "./use-modal-accessibility";
import { RetryAfterButton } from "./RetryAfterButton";
import { valueScoreText } from "../shared/value-score";
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import { CATALOG_PICKER_CACHE_STORAGE_KEY, catalogPickerCacheSnapshotFromJson, catalogPickerCacheToJson, catalogPickerCachedFallbackFor, mergeCatalogPickerCache } from "../shared/catalog-picker-cache";
import { classifyDataFreshness } from "../shared/data-freshness";
import { CATALOG_CACHE_CHANGED_EVENT } from "../shared/catalog-cache-status";
import { CATALOG_PRICE_EVIDENCE_LABELS, catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";

export type PickerPerformanceFilter = "all" | "similar" | "verified" | "benchmark";
export type PickerTrustFilter = RecommendationTrustFilter;
export type PickerCandidateMode = "all" | "no_blocker" | "safe" | "precision";
export type PickerRiskFilter = "all" | "safe" | "review" | "unsafe";
export type PickerPhysicalEvidenceFilter = PhysicalEvidenceFilter;
export type PickerFreshnessFilter = "all" | DataFreshness;
export type PickerPriceStatusFilter = PriceAvailabilityFilter;
const PICKER_COMPARISON_CRITERION_LABELS: Record<CandidateComparisonCriterion, string> = {
  balanced: "균형",
  compatibility: "호환 우선",
  performance: "성능 우선",
  price: "가격 우선",
  evidence: "정보 우선"
};
export type PickerPart = Part & {
  dataFreshness?: DataFreshness;
  decision?: CompatiblePartCandidate["decision"];
  candidateRisk?: CompatiblePartCandidate["candidateRisk"];
  candidateReasons?: string[];
  remainingBlockers?: CompatiblePartCandidate["remainingBlockers"];
  remainingWarnings?: CompatiblePartCandidate["remainingWarnings"];
  remainingUnknown?: CompatiblePartCandidate["remainingUnknown"];
  recommendedQuantity?: number;
  similarityScore?: CompatiblePartCandidate["similarityScore"];
  similarityLabel?: CompatiblePartCandidate["similarityLabel"];
  similarityEvidence?: CompatiblePartCandidate["similarityEvidence"];
  performanceSummary?: CompatiblePartCandidate["performanceSummary"];
  valueScore?: CompatiblePartCandidate["valueScore"];
  valueLabel?: CompatiblePartCandidate["valueLabel"];
  valueEvidence?: CompatiblePartCandidate["valueEvidence"];
  recommendationTrust?: CompatiblePartCandidate["recommendationTrust"];
  physicalEvidence?: CompatiblePartCandidate["physicalEvidence"];
};

type PickerSpecFilter = {
  socket: string;
  memoryType: string;
  formFactor: string;
  minVramGb: string;
  minCapacityGb: string;
  minWattageW: string;
  minMemorySpeedMhz: string;
  minMemorySlots: string;
  minM2Slots: string;
  minSataPorts: string;
  pcieSlotWidth: string;
  minPcieSlotCount: string;
  pcieSlotInfo: "all" | "complete" | "missing";
  minHddBays: string;
  minMaxGpuLengthMm: string;
  minMaxCoolerHeightMm: string;
  minMaxPsuLengthMm: string;
  minCoolingW: string;
  maxLengthMm: string;
  maxPsuDepthMm: string;
  storageInterface: "all" | "NVMe" | "SATA";
};

const EMPTY_PICKER_SPEC_FILTER: PickerSpecFilter = { socket: "", memoryType: "", formFactor: "", minVramGb: "", minCapacityGb: "", minWattageW: "", minMemorySpeedMhz: "", minMemorySlots: "", minM2Slots: "", minSataPorts: "", pcieSlotWidth: "", minPcieSlotCount: "", pcieSlotInfo: "all", minHddBays: "", minMaxGpuLengthMm: "", minMaxCoolerHeightMm: "", minMaxPsuLengthMm: "", minCoolingW: "", maxLengthMm: "", maxPsuDepthMm: "", storageInterface: "all" };

function pickerSpecFilterHasValue(filter: PickerSpecFilter) {
  return Object.entries(filter).some(([key, value]) =>
    key === "storageInterface" || key === "pcieSlotInfo" ? value !== "all" : value.trim().length > 0
  );
}

type PickerSpecFilterDiagnostic = {
  key: string;
  label: string;
  excludedCount: number;
  missingCount: number;
};

type PickerPartsResponse = {
  items: PickerPart[];
  total: number;
  riskCounts?: AlternativeRiskCounts;
  riskFilter?: PickerRiskFilter;
  riskExcludedCount?: number;
  budgetWon?: number;
  budgetExcludedCount?: number;
  performanceFilter?: PickerPerformanceFilter;
  performanceExcludedCount?: number;
  physicalEvidenceFilter?: PickerPhysicalEvidenceFilter;
  physicalEvidenceExcludedCount?: number;
  recommendationTrustFilter?: PickerTrustFilter;
  trustExcludedCount?: number;
  recommendationTrustCounts?: RecommendationTrustCounts;
  priceStatus?: PickerPriceStatusFilter;
  priceExcludedCount?: number;
  freshness?: PickerFreshnessFilter;
  freshnessExcludedCount?: number;
  incompleteExcludedCount?: number;
  incompleteMissingFields?: Array<{ field: string; count: number }>;
  specExcludedCount?: number;
  specFilterDiagnostics?: PickerSpecFilterDiagnostic[];
};

type PickerSelectOption = readonly [string, string];
const GPU_VRAM_FILTER_OPTIONS: PickerSelectOption[] = [["", "전체"], ["8", "8GB 이상"], ["12", "12GB 이상"], ["16", "16GB 이상"], ["24", "24GB 이상"], ["32", "32GB 이상"]];
const MEMORY_CAPACITY_FILTER_OPTIONS: PickerSelectOption[] = [["", "전체"], ["16", "16GB 이상"], ["32", "32GB 이상"], ["64", "64GB 이상"], ["128", "128GB 이상"]];
const STORAGE_CAPACITY_FILTER_OPTIONS: PickerSelectOption[] = [["", "전체"], ["500", "500GB 이상"], ["1000", "1TB 이상"], ["2000", "2TB 이상"], ["4000", "4TB 이상"], ["8000", "8TB 이상"]];
const MEMORY_SPEED_FILTER_OPTIONS: PickerSelectOption[] = [["", "전체"], ["4800", "4800MHz 이상"], ["5600", "5600MHz 이상"], ["6000", "6000MHz 이상"], ["6400", "6400MHz 이상"], ["7200", "7200MHz 이상"], ["8000", "8000MHz 이상"]];
const PSU_WATTAGE_FILTER_OPTIONS: PickerSelectOption[] = [["", "전체"], ["500", "500W 이상"], ["650", "650W 이상"], ["750", "750W 이상"], ["850", "850W 이상"], ["1000", "1000W 이상"], ["1200", "1200W 이상"]];
const PCIE_SLOT_WIDTH_FILTER_OPTIONS: PickerSelectOption[] = [["", "전체 슬롯 폭"], ["16", "x16 이상 사용 가능"], ["8", "x8 이상 사용 가능"], ["4", "x4 이상 사용 가능"], ["1", "x1 이상 사용 가능"]];
const PCIE_SLOT_INFO_FILTER_OPTIONS: PickerSelectOption[] = [["all", "전체"], ["complete", "사양 등록"], ["missing", "사양 미등록"]];
const STORAGE_INTERFACE_FILTER_OPTIONS: PickerSelectOption[] = [["all", "전체"], ["NVMe", "NVMe"], ["SATA", "SATA"]];

function PickerIncompleteDataNotice({ category, count, fields }: { category: PartCategory; count: number; fields: Array<{ field: string; count: number }> }) {
  if (count <= 0) return null;
  return <div className="picker-incomplete-data-notice" data-testid="picker-incomplete-data-notice" role="status"><FiInfo /><div><strong>사양이 부족한 부품 {count.toLocaleString("ko-KR")}개는 호환 여부를 판단하기 어려워요.</strong><small>누락된 사양을 확인하면 호환성 결과에 포함할 수 있어요.</small><div className="picker-incomplete-field-links">{fields.slice(0, 3).map((field) => <a href={`/catalog?category=${encodeURIComponent(category)}&quality=incomplete&missingField=${encodeURIComponent(field.field)}`} data-testid="picker-open-missing-field" key={field.field}>{catalogMissingFieldLabelFor(field.field)} {field.count}개</a>)}</div></div></div>;
}

type ShareResult = { id: string; url: string; ownerToken: string; expiresAt?: string };
type ShareHandler = (candidates: AlternativeComparisonCandidate[], context?: { name?: string; category?: string; currentPartName?: string; currentPartSummary?: string; currentPartPrice?: string }) => Promise<ShareResult | undefined>;
type RevokeHandler = (share: ShareResult) => Promise<boolean>;
type PartVisualRenderer = ComponentType<{ part: Part }>;
type PartEvidenceRenderer = ComponentType<{ part: Part }>;
type PartWatchButtonRenderer = ComponentType<{ part: Part; onWatch: (part: Part) => boolean }>;

export type PartPickerProps = {
  category: PartCategory;
  build: BuildSelection;
  partMap: ReadonlyMap<string, Part>;
  profile: RecommendationProfile;
  recommendationListingPolicy?: ListingPolicy;
  gamingResolution?: GamingResolution;
  gamingRefreshRate?: GamingRefreshRate;
  benchmarkCoverage?: CatalogBenchmarkCoverage;
  brandOptions?: BrandCountOption[];
  findingRuleId?: string;
  findingTitle?: string;
  initialCandidateMode?: PickerCandidateMode;
  affectedPartIds?: string[];
  selected: PartSelection[];
  onClose: () => void;
  onSelect: (part: Part) => void;
  onPreview?: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[]) => void;
  onCompareScenarios?: (category: PartCategory, parts: PickerPart[], affectedPartIds?: string[]) => void;
  onToast: (message: string) => void;
  onWatchPart: (part: Part) => boolean;
  onShareComparison: ShareHandler;
  onRevokeComparison: RevokeHandler;
  partSummary: (part: Part | undefined) => string;
  formatWon: (value: number | undefined) => string;
  formatSpecValue: (value: unknown) => string;
  similarityEvidenceText: (evidence?: SimilarityEvidence) => string;
  PartVisual: PartVisualRenderer;
  PartEvidence: PartEvidenceRenderer;
  PartWatchButton: PartWatchButtonRenderer;
};

function pickerSpecFilterPayloadFor(category: PartCategory, filter: PickerSpecFilter) {
  const payload: Record<string, string> = {};
  if (["cpu", "cooler", "motherboard"].includes(category) && filter.socket.trim()) payload.socket = filter.socket.trim();
  if (["cpu", "motherboard", "memory"].includes(category) && filter.memoryType.trim()) payload.memoryType = filter.memoryType.trim();
  if (["case", "motherboard", "memory", "ssd", "psu"].includes(category) && filter.formFactor.trim()) payload.formFactor = filter.formFactor.trim();
  if (category === "gpu" && filter.minVramGb.trim()) payload.minVramGb = filter.minVramGb.trim();
  if ((category === "memory" || category === "ssd" || category === "hdd") && filter.minCapacityGb.trim()) payload.minCapacityGb = filter.minCapacityGb.trim();
  if (category === "psu" && filter.minWattageW.trim()) payload.minWattageW = filter.minWattageW.trim();
  if (category === "memory" && filter.minMemorySpeedMhz.trim()) payload.minMemorySpeedMhz = filter.minMemorySpeedMhz.trim();
  if (category === "motherboard" && filter.minMemorySlots.trim()) payload.minMemorySlots = filter.minMemorySlots.trim();
  if (category === "motherboard" && filter.minM2Slots.trim()) payload.minM2Slots = filter.minM2Slots.trim();
  if (category === "motherboard" && filter.minSataPorts.trim()) payload.minSataPorts = filter.minSataPorts.trim();
  if (category === "motherboard" && filter.pcieSlotWidth.trim()) payload.pcieSlotWidth = filter.pcieSlotWidth.trim();
  if (category === "motherboard" && filter.minPcieSlotCount.trim()) payload.minPcieSlotCount = filter.minPcieSlotCount.trim();
  if (category === "motherboard" && filter.pcieSlotInfo !== "all") payload.pcieSlotInfo = filter.pcieSlotInfo;
  if (category === "case" && filter.minMaxGpuLengthMm.trim()) payload.minMaxGpuLengthMm = filter.minMaxGpuLengthMm.trim();
  if (category === "case" && filter.minMaxCoolerHeightMm.trim()) payload.minMaxCoolerHeightMm = filter.minMaxCoolerHeightMm.trim();
  if (category === "case" && filter.minHddBays.trim()) payload.minHddBays = filter.minHddBays.trim();
  if (category === "case" && filter.minMaxPsuLengthMm.trim()) payload.minMaxPsuLengthMm = filter.minMaxPsuLengthMm.trim();
  if (category === "cooler" && filter.minCoolingW.trim()) payload.minCoolingW = filter.minCoolingW.trim();
  if (category === "gpu" && filter.maxLengthMm.trim()) payload.maxLengthMm = filter.maxLengthMm.trim();
  if (category === "psu" && filter.maxPsuDepthMm.trim()) payload.maxPsuDepthMm = filter.maxPsuDepthMm.trim();
  if ((category === "ssd" || category === "hdd") && filter.storageInterface !== "all") payload.interface = filter.storageInterface;
  return payload;
}

function pickerSpecFilterSummaryFor(category: PartCategory, filter: PickerSpecFilter) {
  const values: string[] = [];
  if (["cpu", "cooler", "motherboard"].includes(category) && filter.socket.trim()) values.push(`소켓 ${filter.socket.trim()}`);
  if (["cpu", "motherboard", "memory"].includes(category) && filter.memoryType.trim()) values.push(`메모리 세대 ${filter.memoryType.trim()}`);
  if (["case", "motherboard", "memory", "ssd", "psu"].includes(category) && filter.formFactor.trim()) values.push(`폼팩터 ${filter.formFactor.trim()}`);
  if (category === "gpu" && filter.minVramGb.trim()) values.push(`VRAM ${filter.minVramGb.trim()}GB 이상`);
  if ((category === "memory" || category === "ssd" || category === "hdd") && filter.minCapacityGb.trim()) values.push(`${category === "memory" ? "모듈 용량" : "용량"} ${filter.minCapacityGb.trim()}GB 이상`);
  if (category === "psu" && filter.minWattageW.trim()) values.push(`정격 ${filter.minWattageW.trim()}W 이상`);
  if (category === "memory" && filter.minMemorySpeedMhz.trim()) values.push(`속도 ${filter.minMemorySpeedMhz.trim()}MHz 이상`);
  if (category === "motherboard" && filter.minMemorySlots.trim()) values.push(`RAM 슬롯 ${filter.minMemorySlots.trim()}개 이상`);
  if (category === "motherboard" && filter.minM2Slots.trim()) values.push(`M.2 슬롯 ${filter.minM2Slots.trim()}개 이상`);
  if (category === "motherboard" && filter.minSataPorts.trim()) values.push(`SATA 포트 ${filter.minSataPorts.trim()}개 이상`);
  if (category === "motherboard" && (filter.pcieSlotWidth.trim() || filter.minPcieSlotCount.trim())) {
    const width = filter.pcieSlotWidth.trim() ? `x${filter.pcieSlotWidth.trim()} 이상` : "전체 폭";
    const count = filter.minPcieSlotCount.trim() || "1";
    values.push(`PCIe ${width} 슬롯 ${count}개 이상`);
  }
  if (category === "motherboard" && filter.pcieSlotInfo !== "all") values.push(filter.pcieSlotInfo === "complete" ? "PCIe 슬롯 정보 확인됨" : "PCIe 슬롯 정보 부족");
  if (category === "case" && filter.minMaxGpuLengthMm.trim()) values.push(`GPU 허용 ${filter.minMaxGpuLengthMm.trim()}mm 이상`);
  if (category === "case" && filter.minMaxCoolerHeightMm.trim()) values.push(`쿨러 허용 ${filter.minMaxCoolerHeightMm.trim()}mm 이상`);
  if (category === "case" && filter.minHddBays.trim()) values.push(`HDD 베이 ${filter.minHddBays.trim()}개 이상`);
  if (category === "case" && filter.minMaxPsuLengthMm.trim()) values.push(`PSU 허용 ${filter.minMaxPsuLengthMm.trim()}mm 이상`);
  if (category === "cooler" && filter.minCoolingW.trim()) values.push(`냉각 용량 ${filter.minCoolingW.trim()}W 이상`);
  if (category === "gpu" && filter.maxLengthMm.trim()) values.push(`GPU 길이 ${filter.maxLengthMm.trim()}mm 이하`);
  if (category === "psu" && filter.maxPsuDepthMm.trim()) values.push(`PSU 깊이 ${filter.maxPsuDepthMm.trim()}mm 이하`);
  if ((category === "ssd" || category === "hdd") && filter.storageInterface !== "all") values.push(filter.storageInterface);
  return values.join(" · ");
}

function pickerSpecFilterDiagnosticSummaryFor(diagnostics: PickerSpecFilterDiagnostic[]) {
  const rows = diagnostics
    .filter((diagnostic) => diagnostic.excludedCount > 0)
    .slice(0, 4)
    .map((diagnostic) => {
      const missingCount = Math.min(diagnostic.missingCount, diagnostic.excludedCount);
      const conditionCount = diagnostic.excludedCount - missingCount;
      const reasons = [
        missingCount > 0 ? `정보 없음 ${missingCount}개` : "",
        conditionCount > 0 ? `조건 미달 ${conditionCount}개` : ""
      ].filter(Boolean);
      return `${diagnostic.label} · ${reasons.join(" · ")}`;
    });
  if (rows.length === 0) return "";
  const remainingCount = diagnostics.filter((diagnostic) => diagnostic.excludedCount > 0).length - rows.length;
  return `조건별로 제외된 이유 · ${rows.join(" / ")}${remainingCount > 0 ? ` / 외 ${remainingCount}개 조건` : ""} · 조건별 수치는 한 부품이 여러 조건에 걸릴 수 있어 합산하지 않습니다.`;
}

function PickerSpecSelect({ ariaLabel, value, options, onChange }: { ariaLabel: string; value: string; options: PickerSelectOption[]; onChange: (value: string) => void }) {
  return <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, label]) => <option value={optionValue} key={optionValue}>{label}</option>)}</select>;
}

function PickerSpecTextInput({ ariaLabel, value, placeholder, onChange }: { ariaLabel: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <input aria-label={ariaLabel} type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function PickerSpecNumberInput({ ariaLabel, value, placeholder, onChange }: { ariaLabel: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <input aria-label={ariaLabel} type="number" inputMode="numeric" min="1" step="1" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function PickerFetchErrorNotice({ subject, message, onRetry, retrying }: { subject: string; message: string; onRetry: () => void; retrying: boolean }) {
  return <div className="fetch-error" role="alert"><div className="fetch-error-copy"><FiXCircle /><div><strong>{subject}을 불러오지 못했습니다.</strong><p>{message}</p><small>입력한 검색 조건과 선택 상태는 유지됩니다.</small></div></div><RetryAfterButton className="button button-small button-light" message={message} onRetry={onRetry} retrying={retrying} idleContent={<><FiSearch /> 다시 불러오기</>} retryingContent={<><FiLoader className="spin" /> 불러오는 중...</>} testId="picker-retry-button" /></div>;
}

function PickerCachedCatalogNotice({ visibleCount, total, latestUpdatedAt, cachedAt }: { visibleCount: number; total: number; latestUpdatedAt?: string; cachedAt?: string }) {
  const updatedAt = latestUpdatedAt ? new Date(latestUpdatedAt) : undefined;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleDateString("ko-KR") : "갱신 시점 확인 필요";
  const cachedAtDate = cachedAt ? new Date(cachedAt) : undefined;
  const cachedLabel = cachedAtDate && !Number.isNaN(cachedAtDate.getTime()) ? cachedAtDate.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "기록 시각 확인 필요";
  const cacheFreshness = cachedAt ? classifyDataFreshness(cachedAt) : "unknown";
  const cacheFreshnessLabel = cacheFreshness === "fresh" ? "최근 캐시" : cacheFreshness === "aging" ? "갱신 권장" : cacheFreshness === "stale" ? "오래된 캐시" : "시각 미확인";
  return <div className={"picker-cached-fallback " + cacheFreshness} data-testid="picker-cached-fallback" role="status"><span className="picker-cached-fallback-icon"><FiDatabase /></span><div><strong>브라우저에 저장된 카탈로그를 임시 표시합니다.</strong><p>서버 목록 요청이 실패해 마지막으로 확인된 {visibleCount.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}개 부품을 보여줘요.</p><small>캐시 저장 {cachedLabel} · 원본 부품 갱신 {updatedLabel} · 탐색용 목록이며 호환 안전성·유사도·실시간 가격은 서버 재연결 후 다시 확인합니다.</small></div><span className={"picker-cached-fallback-badge " + cacheFreshness}>탐색 전용 · {cacheFreshnessLabel}</span></div>;
}

function PickerCachedCatalogList({ items, selected, expandedPickerId, comparePickerIds, onSelect, onToggleCompare, onToggleExpanded, partSummary, formatWon, PartVisual, PartEvidence }: { items: PickerPart[]; selected: PartSelection[]; expandedPickerId: string | null; comparePickerIds: string[]; onSelect: (part: Part) => void; onToggleCompare: (part: PickerPart) => void; onToggleExpanded: (partId: string) => void; partSummary: (part: Part | undefined) => string; formatWon: PartPickerProps["formatWon"]; PartVisual: PartPickerProps["PartVisual"]; PartEvidence: PartPickerProps["PartEvidence"] }) {
  return <div className="picker-list picker-list-cached" data-testid="picker-cached-catalog-list">{items.map((part) => {
    const alreadySelected = selected.some((selection) => selection.partId === part.id);
    const expanded = expandedPickerId === part.id;
    const compared = comparePickerIds.includes(part.id);
    const priceEvidence = catalogPriceEvidenceFor(part);
    return <article className={expanded ? "picker-item-card expanded" : "picker-item-card"} key={part.id}><button className={alreadySelected ? "picker-item already" : "picker-item"} type="button" onClick={() => onSelect(part)}><span className="picker-item-icon"><PartVisual part={part} /></span><span className="picker-item-main"><strong>{part.name}</strong><small>{partSummary(part)}</small><span className="data-badges">{part.listingType && part.listingType !== "retail" && <em className="listing-badge">{LISTING_TYPE_LABELS[part.listingType]}</em>}{part.missingFields.length > 0 && <em className="missing-badge">사양 미등록 {part.missingFields.length}개</em>}</span></span><span className="picker-item-side"><strong>{formatWon(part.priceWon)}</strong>{alreadySelected ? <span><FiCheck /> 선택됨</span> : <span>선택 <FiExternalLink /></span>}</span></button><div className="picker-item-actions"><button className={compared ? "text-button picker-compare-toggle selected" : "text-button picker-compare-toggle"} type="button" aria-pressed={compared} onClick={() => onToggleCompare(part)}>{compared ? "비교 중" : "비교"}</button><button className="text-button picker-item-detail-toggle" type="button" aria-expanded={expanded} onClick={() => onToggleExpanded(part.id)}>{expanded ? "상세·이유 닫기" : "상세·이유"} <FiChevronDown /></button></div>{expanded && <PickerPartDetail part={part} PartEvidence={PartEvidence} />}</article>;
  })}</div>;
}

function PickerEmptyState({ message, canRelaxFilters, canShowReviewCandidates, reviewCandidateCount, onRelaxFilters, onShowReviewCandidates }: { message: string; canRelaxFilters: boolean; canShowReviewCandidates: boolean; reviewCandidateCount: number; onRelaxFilters: () => void; onShowReviewCandidates: () => void }) {
  return <div className="picker-state picker-empty-state" data-testid="picker-empty-state"><FiSearch /><div><strong>조건에 맞는 부품이 없어요.</strong><span>{message}</span>{(canShowReviewCandidates || canRelaxFilters) && <div className="picker-empty-state-actions">{canShowReviewCandidates && <button className="button button-small button-light" type="button" data-testid="picker-empty-review-candidates" onClick={onShowReviewCandidates}>확인 필요 부품도 보기 · {reviewCandidateCount.toLocaleString("ko-KR")}개</button>}{canRelaxFilters && <button className="button button-small button-secondary" type="button" data-testid="picker-empty-relax-filters" onClick={onRelaxFilters}><FiRefreshCw /> 부품 필터 완화</button>}</div>}</div></div>;
}

function pickerCandidatePrice(part: PickerPart, formatWon: PartPickerProps["formatWon"]) {
  const totalPrice = part.recommendedQuantity !== undefined && isKnownPrice(part.priceWon) ? part.priceWon * part.recommendedQuantity : part.priceWon;
  return formatWon(totalPrice);
}

function pickerCandidateRisk(part: PickerPart) {
  if (part.candidateRisk === "safe") return "호환 확인";
  if (part.candidateRisk === "unsafe") return part.candidateReasons && part.candidateReasons.length > 0 ? `차단 있음 · ${part.candidateReasons[0]}` : "차단 오류 있음";
  if (part.candidateRisk === "review") return part.candidateReasons && part.candidateReasons.length > 0 ? `확인 필요 · ${part.candidateReasons[0]}` : "차단 없음 · 확인 필요";
  return "카탈로그 부품";
}

function pickerCandidateFullRiskText(part: PickerPart) {
  if (part.remainingBlockers === undefined || part.remainingWarnings === undefined || part.remainingUnknown === undefined) return "정밀 검사 없음";
  return part.remainingBlockers === 0 && part.remainingWarnings === 0 && part.remainingUnknown === 0
    ? "차단·주의·확인 필요 없음"
    : `차단 ${part.remainingBlockers}개 · 주의 ${part.remainingWarnings}개 · 확인 필요 ${part.remainingUnknown}개`;
}

const pickerTrustLabels: Record<NonNullable<PickerPart["recommendationTrust"]>["level"], string> = { high: "높음", medium: "보통", low: "낮음" };
const pickerFreshnessLabels = DATA_FRESHNESS_LABELS;

function pickerRecommendationTrustText(trust: PickerPart["recommendationTrust"]) {
  return trust ? `${pickerTrustLabels[trust.level]} ${trust.score}점` : "산정 불가";
}

function pickerRecommendationTrustDetail(trust: NonNullable<PickerPart["recommendationTrust"]>) {
  const compatibility = trust.compatibility === "verified" ? "호환 확인됨" : "호환 추가 확인";
  const comparison = trust.totalDimensions > 0 ? `비교 ${trust.comparedDimensions}/${trust.totalDimensions}` : "성능 비교 없음";
  const fullBuild = trust.fullBuildStatus === "clean" ? "전체 견적 정리됨" : `전체 견적 남은 차단 ${trust.remainingBlockerCount}개·주의 ${trust.remainingWarningCount}개·확인 필요 ${trust.remainingUnknownCount}개`;
  const benchmark = trust.benchmarkBacked ? `벤치마크 ${trust.benchmarkSourceKind ? BENCHMARK_SOURCE_KIND_LABELS[trust.benchmarkSourceKind] : "출처 확인 필요"}` : undefined;
  const benchmarkFreshness = benchmark && trust.benchmarkFreshness ? ` · 자료 ${pickerFreshnessLabels[trust.benchmarkFreshness]}` : "";
  const price = trust.priceEvidence ? CATALOG_PRICE_EVIDENCE_LABELS[trust.priceEvidence] : trust.priceKnown ? "가격 기록 있음" : "가격 기록 없음";
  return `${compatibility} · ${comparison} · ${pickerFreshnessLabels[trust.freshness]} · ${price}${benchmark ? ` · ${benchmark}${benchmarkFreshness}` : ""} · ${fullBuild}`;
}

function pickerPhysicalEvidenceLabel(status: NonNullable<PickerPart["physicalEvidence"]>["status"]) {
  return status === "verified" ? "확인됨" : status === "review" ? "확인 필요" : "미적용";
}

function pickerPhysicalEvidenceSources(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).flatMap((source) => {
    const note = typeof source.note === "string" && source.note.trim() ? source.note.trim() : undefined;
    if (!note || !["gpu", "case", "psu"].includes(source.category)) return [];
    const manufacturerModel = source.manufacturerModel?.trim();
    const manufacturerRevision = source.manufacturerRevision?.trim();
    const url = safeHttpsUrl(source.url);
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : undefined;
    return [{ category: source.category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) } satisfies PhysicalEvidenceSource];
  });
}

function pickerPhysicalEvidenceText(evidence: NonNullable<PickerPart["physicalEvidence"]>) {
  return evidence.summary;
}

function pickerPhysicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

function pickerPhysicalEvidenceSourceIdentity(source: PhysicalEvidenceSource) {
  return `${pickerPhysicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}`;
}

function PickerPhysicalEvidence({ part, compact = false }: { part: PickerPart; compact?: boolean }) {
  const evidence = part.physicalEvidence;
  if (!evidence || evidence.status === "not_applicable") return null;
  const status = evidence.status === "verified" ? "규격 일치" : "정보 부족";
  return <div className={"picker-physical-evidence " + evidence.status + (compact ? " compact" : "")} aria-label={part.name + " 장착 규격"}>
    <div><strong>장착 규격</strong><span>{status}</span></div>
    <p>{evidence.summary}</p>
  </div>;
}

function pickerComparisonCandidatesFor(parts: PickerPart[], partSummary: PartPickerProps["partSummary"], formatWon: PartPickerProps["formatWon"], similarityEvidenceText: PartPickerProps["similarityEvidenceText"]): AlternativeComparisonCandidate[] {
  return parts.map((part) => {
    const physicalEvidenceSources = pickerPhysicalEvidenceSources(part.physicalEvidence?.sources);
    const dataFreshness = part.dataFreshness ?? part.recommendationTrust?.freshness;
    const benchmarkEvidence = alternativeComparisonBenchmarkEvidenceFor(benchmarkEvidenceForPart(part));
    return {
      name: part.name,
      category: part.category,
      partId: part.id,
      summary: partSummary(part),
      price: pickerCandidatePrice(part, formatWon),
      ...(isKnownPrice(part.priceWon) ? { priceWon: part.priceWon } : {}),
      priceEvidence: catalogPriceEvidenceFor(part),
      purchaseCondition: pickerPurchaseConditionFor(part),
      ...(part.recommendedQuantity !== undefined ? { recommendedQuantity: part.recommendedQuantity } : {}),
      similarity: part.similarityScore !== undefined && part.similarityLabel ? `${part.similarityLabel} ${part.similarityScore}점` : "계산 불가",
      ...(part.valueScore !== undefined && part.valueLabel ? { valueScore: part.valueScore, valueLabel: part.valueLabel, valueScoreScale: part.valueEvidence?.scoreScale ?? 200 } : {}),
      ...(part.recommendationTrust ? { recommendationTrust: pickerRecommendationTrustText(part.recommendationTrust) } : {}),
      performance: part.performanceSummary ?? "비교 정보 확인",
      compatibility: pickerCandidateRisk(part),
      ...(benchmarkEvidence ? { benchmarkEvidence } : {}),
      ...(alternativeComparisonSimilarityEvidenceFor(part.similarityEvidence) ? { similarityEvidence: alternativeComparisonSimilarityEvidenceFor(part.similarityEvidence) } : {}),
      ...(part.decision ? { decisionSummary: `${part.decision.label} · ${part.decision.summary}` } : {}),
      ...(part.physicalEvidence && part.physicalEvidence.status !== "not_applicable" ? { physicalEvidence: pickerPhysicalEvidenceText(part.physicalEvidence) } : {}),
      ...(physicalEvidenceSources.length > 0 ? { physicalEvidenceSources } : {}),
      dataQuality: DATA_QUALITY_LABELS[part.dataQuality],
      ...(dataFreshness ? { dataFreshness } : {}),
      ...(part.updatedAt ? { updatedAt: new Date(part.updatedAt).toLocaleDateString("ko-KR") } : {}),
      ...(safeExternalUrl(part.danawaUrl) ? { sourceUrl: safeExternalUrl(part.danawaUrl)! } : {})
    };
  });
}

function pickerFreshnessFor(part: PickerPart) {
  return part.dataFreshness ?? part.recommendationTrust?.freshness;
}

function pickerFreshnessLabelFor(part: PickerPart) {
  const freshness = pickerFreshnessFor(part);
  return freshness ? DATA_FRESHNESS_LABELS[freshness] : undefined;
}

function pickerPriceStatusFor(part: PickerPart) {
  return catalogPriceEvidenceFor(part);
}

function pickerPriceStatusLabelFor(part: PickerPart) {
  const priceType = catalogPriceEvidenceFor(part);
  return priceType === "live" || priceType === "manual" ? "판매가" : priceType === "reference" ? "예상가" : priceType === "recorded" ? "이전 가격" : "가격 미등록";
}

function pickerPurchaseConditionFor(part: PickerPart) {
  return `${pickerPriceStatusLabelFor(part)} · ${part.listingType ? LISTING_TYPE_LABELS[part.listingType] : LISTING_TYPE_LABELS.retail}`;
}

function PickerPartDetail({ part, PartEvidence }: { part: PickerPart; PartEvidence: PartEvidenceRenderer }) {
  return <div className="picker-item-detail" aria-label={part.name + " 부품 상세"}>
    {part.candidateRisk === "unsafe" && <p className="picker-unsafe-note"><FiXCircle /> 전체 구성에서 호환 문제가 있어 자동으로 적용하지 않아요. {part.candidateReasons?.join(" · ")}</p>}
    {part.decision && <div className={"picker-decision-summary " + part.decision.status} aria-label={part.name + " 적용 안내"}>
      <div><strong>{part.decision.label}</strong><span>{part.decision.summary}</span></div>
      {part.decision.reasons.length > 0 && <ul>{part.decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    </div>}
    <PickerPhysicalEvidence part={part} />
    <PartEvidence part={part} />
  </div>;
}

function PickerComparison({ parts, currentSelections, category, affectedPartIds, onSelect, onPreview, onCompareScenarios, onCopy, onDownload, onJsonDownload, onShare, onRevoke, partSummary, formatWon, similarityEvidenceText }: { parts: PickerPart[]; currentSelections: Array<{ part: Part; quantity: number }>; category: PartCategory; affectedPartIds?: string[]; onSelect: (part: Part) => void; onPreview?: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[]) => void; onCompareScenarios?: (category: PartCategory, parts: PickerPart[], affectedPartIds?: string[]) => void; onCopy: () => void; onDownload: () => void; onJsonDownload: () => void; onShare: ShareHandler; onRevoke: RevokeHandler; partSummary: PartPickerProps["partSummary"]; formatWon: PartPickerProps["formatWon"]; similarityEvidenceText: PartPickerProps["similarityEvidenceText"] }) {
  const [sharedComparison, setSharedComparison] = useState<ShareResult | null>(null);
  const [sharingComparison, setSharingComparison] = useState(false);
  const shareRequestRef = useRef(0);
  const shareInFlightRef = useRef(false);
  const comparisonContextKey = `${category}:${parts.map((part) => part.id).join(",")}:${affectedPartIds?.join(",") ?? ""}`;
  useEffect(() => {
    shareRequestRef.current += 1;
    shareInFlightRef.current = false;
    setSharingComparison(false);
  }, [comparisonContextKey]);
  useEffect(() => () => {
    shareRequestRef.current += 1;
    shareInFlightRef.current = false;
  }, []);
  const [comparisonCriterion, setComparisonCriterion] = useState<CandidateComparisonCriterion>("balanced");
  const comparisonDecision = candidateComparisonDecisionFor(parts.map((part) => ({
    id: part.id,
    name: part.name,
    priceWon: part.priceWon,
    priceEvidence: catalogPriceEvidenceFor(part),
    similarityScore: part.similarityScore,
    recommendationTrustScore: part.recommendationTrust?.score,
    recommendationTrustLevel: part.recommendationTrust?.level,
    candidateRisk: part.candidateRisk,
    decisionStatus: part.decision?.status,
    freshness: pickerFreshnessFor(part),
    physicalStatus: part.physicalEvidence?.status,
    remainingBlockers: part.remainingBlockers,
    remainingWarnings: part.remainingWarnings,
    remainingUnknown: part.remainingUnknown
  })), comparisonCriterion);
  const comparisonTopPart = comparisonDecision.top ? parts.find((part) => part.id === comparisonDecision.top?.id) : undefined;
  const benchmarkEvidence = parts.map((part) => benchmarkEvidenceForPart(part));
  const hasBenchmarkEvidence = benchmarkEvidence.some((evidence) => Boolean(evidence));
  const exportCandidates = pickerComparisonCandidatesFor(parts, partSummary, formatWon, similarityEvidenceText);
  const currentSelectionNames = currentSelections.length > 0 ? currentSelections.map(({ part, quantity }) => `${part.name}${quantity > 1 ? ` ×${quantity}` : ""}`).join(" · ") : "현재 부품 선택 없음";
  const currentSelectionSummary = currentSelections.length > 0 ? currentSelections.map(({ part }) => partSummary(part)).join(" / ") : "현재 선택 부품이 없어 비교 기준만 보여줘요.";
  const currentSelectionPriceKnown = currentSelections.length > 0 && currentSelections.every(({ part }) => isKnownPrice(part.priceWon));
  const currentSelectionPrice = currentSelectionPriceKnown ? currentSelections.reduce((total, { part, quantity }) => total + (part.priceWon ?? 0) * quantity, 0) : undefined;
  const currentSelectionPriceText = currentSelectionPrice !== undefined ? formatWon(currentSelectionPrice) : currentSelections.length > 0 ? "가격 확인 필요" : undefined;
  async function shareComparison() {
    if (shareInFlightRef.current) return;
    const requestVersion = ++shareRequestRef.current;
    const isCurrent = () => shareRequestRef.current === requestVersion;
    shareInFlightRef.current = true;
    setSharingComparison(true);
    try {
      const share = await onShare(exportCandidates, { name: `${CATEGORY_LABELS[category]} 부품 비교`, category: CATEGORY_LABELS[category], ...(currentSelections.length > 0 ? { currentPartName: currentSelectionNames, currentPartSummary: currentSelectionSummary, ...(currentSelectionPriceText ? { currentPartPrice: currentSelectionPriceText } : {}) } : {}) });
      if (isCurrent() && share) setSharedComparison(share);
    } finally {
      if (isCurrent()) {
        shareInFlightRef.current = false;
        setSharingComparison(false);
      }
    }
  }
  async function revokeComparison() {
    if (sharedComparison && await onRevoke(sharedComparison)) setSharedComparison(null);
  }
  if (parts.length < 2) return null;
  return <section className="picker-comparison" aria-label="부품 비교">
    <div className="picker-comparison-heading"><div><strong>선택 부품 비교</strong><span>{parts.length} / 3개</span></div><div className="picker-comparison-actions">{onCompareScenarios && <button className="text-button" type="button" onClick={() => onCompareScenarios(category, parts, affectedPartIds)}><FiActivity /> 전체 미리 비교</button>}<button className="text-button" type="button" onClick={onCopy}><FiCopy /> 비교 복사</button><button className="text-button" type="button" onClick={onDownload}><FiDownload /> CSV 저장</button><button className="text-button" type="button" onClick={onJsonDownload}><FiDownload /> JSON 저장</button><button className="text-button" type="button" onClick={() => void shareComparison()} disabled={sharingComparison}>{sharingComparison ? <><FiRefreshCw className="spin" /> 공유 중...</> : <><FiShare2 /> 공유 링크</>}</button><FiLayers /></div></div>
    <div className="picker-comparison-baseline" data-testid="picker-comparison-baseline"><div><span>현재 기준선</span><strong>{currentSelectionNames}</strong></div><div><small>{currentSelectionSummary}</small><em>{currentSelectionPrice !== undefined ? formatWon(currentSelectionPrice) : "가격 확인 필요"}</em></div></div>
    <div className="picker-quick-decision" aria-label="부품 빠른 선택" data-testid="picker-quick-decision"><div className="picker-quick-decision-heading"><div><span>QUICK DECISION</span><strong>{comparisonDecision.label} 기준 빠른 선택</strong><small>{comparisonDecision.summary}</small></div><label><span>기준</span><select aria-label="부품 빠른 선택 기준" value={comparisonCriterion} onChange={(event) => setComparisonCriterion(event.target.value as CandidateComparisonCriterion)}>{CANDIDATE_COMPARISON_CRITERIA.map((criterion) => <option value={criterion} key={criterion}>{PICKER_COMPARISON_CRITERION_LABELS[criterion]}</option>)}</select></label></div><div className="picker-quick-decision-ranking">{comparisonDecision.eligibleRanking.slice(0, 3).map((rank, index) => <span className={index === 0 ? "top" : ""} key={rank.id}><b>{index + 1}</b> {rank.name} · {rank.score}점</span>)}{comparisonDecision.excludedIds.length > 0 && <small>적용하지 않음 {comparisonDecision.excludedIds.length}개 제외</small>}</div>{comparisonTopPart && <button className="button button-small picker-quick-apply" type="button" onClick={() => onSelect(comparisonTopPart)}>{comparisonDecision.top?.name} · 1위 부품 적용</button>}</div>
    <div className="picker-comparison-table-wrap"><table><caption>적용 전에 선택한 부품의 가격·성능·호환성을 비교해요.</caption><thead><tr><th scope="col">비교 항목</th>{parts.map((part) => <th scope="col" key={part.id}>{part.name}</th>)}</tr></thead><tbody>
      <tr><th scope="row">핵심 스펙</th>{parts.map((part) => <td key={`${part.id}-summary`}>{partSummary(part)}</td>)}</tr>
      <tr><th scope="row">가격</th>{parts.map((part) => <td key={`${part.id}-price`}>{pickerCandidatePrice(part, formatWon)}{part.recommendedQuantity !== undefined && <small>추천 킷 {part.recommendedQuantity}개</small>}</td>)}</tr>
      <tr><th scope="row">구매 조건</th>{parts.map((part) => <td key={`${part.id}-purchase`}>{pickerPriceStatusLabelFor(part)}<small>{part.listingType ? LISTING_TYPE_LABELS[part.listingType] : LISTING_TYPE_LABELS.retail}</small></td>)}</tr>

      {hasBenchmarkEvidence && <tr data-testid="picker-comparison-benchmark"><th scope="row">벤치마크</th>{parts.map((part, index) => <td key={`${part.id}-benchmark`}><ComparisonBenchmarkCell evidence={benchmarkEvidence[index]} /></td>)}</tr>}

      {parts.some((part) => part.physicalEvidence && part.physicalEvidence.status !== "not_applicable") && <tr><th scope="row">장착 정보</th>{parts.map((part) => <td key={`${part.id}-physical-evidence`}><PickerPhysicalEvidence part={part} compact /></td>)}</tr>}
      <tr><th scope="row">성능 변화</th>{parts.map((part) => <td key={`${part.id}-performance`}>{part.performanceSummary ?? "비교 정보 확인"}</td>)}</tr>
      <tr><th scope="row">호환 상태</th>{parts.map((part) => <td key={`${part.id}-risk`}>{pickerCandidateRisk(part)}</td>)}</tr>
      {parts.some((part) => part.decision) && <tr><th scope="row">판단 요약</th>{parts.map((part) => <td key={`${part.id}-decision`}>{part.decision ? <><strong>{part.decision.label}</strong><small>{part.decision.summary}</small></> : "산정 불가"}</td>)}</tr>}
      {parts.some((part) => part.remainingBlockers !== undefined) && <tr><th scope="row">적용 후 전체 위험</th>{parts.map((part) => <td key={`${part.id}-full-risk`}>{pickerCandidateFullRiskText(part)}</td>)}</tr>}

      {onPreview && <tr><th scope="row">미리 적용</th>{parts.map((part) => <td key={`${part.id}-preview`}><button className="button button-small picker-comparison-preview" type="button" disabled={part.candidateRisk === "unsafe"} onClick={() => onPreview(category, part, part.recommendedQuantity, affectedPartIds)}>{part.candidateRisk === "unsafe" ? "차단됨" : "미리 적용"}</button></td>)}</tr>}
      <tr><th scope="row">적용</th>{parts.map((part) => <td key={`${part.id}-apply`}><button className="button button-small picker-comparison-apply" type="button" disabled={part.candidateRisk === "unsafe"} onClick={() => onSelect(part)}>{part.candidateRisk === "unsafe" ? "적용 불가" : "이 부품 적용"}</button></td>)}</tr>
    </tbody></table></div>
    {sharedComparison && <div className="comparison-share-preview"><label><span>공유 링크{sharedComparison.expiresAt ? ` · ${new Date(sharedComparison.expiresAt).toLocaleString("ko-KR")} 만료` : ""}</span><input aria-label="부품 비교 공유 링크" type="text" value={sharedComparison.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div className="comparison-share-actions"><a className="text-button" href={sharedComparison.url}>열기</a><button className="text-button danger-text-button" type="button" onClick={() => void revokeComparison()}><FiTrash2 /> 공유 취소</button></div></div>}
    <p className="picker-comparison-note"><FiInfo /> 비교 선택만으로는 부품을 적용하지 않아요. 비교표의 `이 부품 적용` 또는 부품 행을 눌렀을 때만 현재 견적에 반영돼요.</p>
  </section>;
}

export function PartPicker({ category, build, partMap, profile, recommendationListingPolicy = "retail_only", gamingResolution, gamingRefreshRate, benchmarkCoverage, brandOptions = [], findingRuleId, findingTitle, initialCandidateMode = findingRuleId ? "safe" : "all", affectedPartIds, selected, onClose, onSelect, onToast, onWatchPart, onShareComparison, onRevokeComparison, onPreview, onCompareScenarios, partSummary, formatWon, formatSpecValue, similarityEvidenceText, PartVisual, PartEvidence, PartWatchButton }: PartPickerProps) {
  const modalRef = useModalAccessibility({ onClose });
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [quality, setQuality] = useState<"all" | DataQuality>("all");
  const [freshness, setFreshness] = useState<PickerFreshnessFilter>("all");
  const [priceStatus, setPriceStatus] = useState<PickerPriceStatusFilter>("all");
  const [sort, setSort] = useState<"price_asc" | "price_desc" | "name" | "updated" | "similarity" | "value">(findingRuleId ? "similarity" : "price_asc");
  const [listingPolicy, setListingPolicy] = useState<ListingPolicy>(recommendationListingPolicy);
  const [candidateMode, setCandidateMode] = useState<PickerCandidateMode>(initialCandidateMode);
  const [riskFilter, setRiskFilter] = useState<PickerRiskFilter>("all");
  const [performanceFilter, setPerformanceFilter] = useState<PickerPerformanceFilter>("all");
  const [physicalEvidenceFilter, setPhysicalEvidenceFilter] = useState<PickerPhysicalEvidenceFilter>("all");
  const [trustFilter, setTrustFilter] = useState<PickerTrustFilter>("all");
  const [candidateBudget, setCandidateBudget] = useState("");
  const [specFilter, setSpecFilter] = useState<PickerSpecFilter>({ ...EMPTY_PICKER_SPEC_FILTER });
  const [expandedPickerId, setExpandedPickerId] = useState<string | null>(null);
  const [comparePickerIds, setComparePickerIds] = useState<string[]>([]);
  const [items, setItems] = useState<PickerPart[]>([]);
  const [total, setTotal] = useState(0);
  const [riskCounts, setRiskCounts] = useState<AlternativeRiskCounts | null>(null);
  const [riskExcludedCount, setRiskExcludedCount] = useState(0);
  const [budgetExcludedCount, setBudgetExcludedCount] = useState(0);
  const [performanceExcludedCount, setPerformanceExcludedCount] = useState(0);
  const [physicalEvidenceExcludedCount, setPhysicalEvidenceExcludedCount] = useState(0);
  const [freshnessExcludedCount, setFreshnessExcludedCount] = useState(0);
  const [incompleteExcludedCount, setIncompleteExcludedCount] = useState(0);
  const [incompleteMissingFields, setIncompleteMissingFields] = useState<Array<{ field: string; count: number }>>([]);
  const [priceExcludedCount, setPriceExcludedCount] = useState(0);
  const [trustExcludedCount, setTrustExcludedCount] = useState(0);
  const [recommendationTrustCounts, setRecommendationTrustCounts] = useState<RecommendationTrustCounts | null>(null);
  const [specExcludedCount, setSpecExcludedCount] = useState(0);
  const [specFilterDiagnostics, setSpecFilterDiagnostics] = useState<PickerSpecFilterDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [cachedSnapshot, setCachedSnapshot] = useState(() => {
    try {
      return typeof window === "undefined" ? { schemaVersion: 1 as const, items: [] as Part[] } : catalogPickerCacheSnapshotFromJson(window.localStorage.getItem(CATALOG_PICKER_CACHE_STORAGE_KEY));
    } catch {
      return { schemaVersion: 1 as const, items: [] as Part[] };
    }
  });
  const cachedParts = cachedSnapshot.items;
  const requestVersionRef = useRef(0);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const autoFallbackAttemptedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
      requestAbortControllerRef.current?.abort();
      requestAbortControllerRef.current = null;
    };
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_PICKER_CACHE_STORAGE_KEY) return;
      setCachedSnapshot(catalogPickerCacheSnapshotFromJson(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => { autoFallbackAttemptedRef.current = false; }, [category, findingRuleId, initialCandidateMode]);
  const compatibilityPreset = compatibilityFilterPresetFor(category, build, partMap);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const hasActiveSpecFilter = pickerSpecFilterHasValue(specFilter);
  const currentSelections = selected.flatMap((selection) => {
    const part = partMap.get(selection.partId);
    return part ? [{ part, quantity: selection.quantity }] : [];
  });
  const pickerCurrentSelectionNames = currentSelections.length > 0 ? currentSelections.map(({ part, quantity }) => `${part.name}${quantity > 1 ? ` ×${quantity}` : ""}`).join(" · ") : undefined;
  const pickerCurrentSelectionSummary = currentSelections.length > 0 ? currentSelections.map(({ part }) => partSummary(part)).join(" / ") : undefined;
  const pickerCurrentSelectionPriceKnown = currentSelections.length > 0 && currentSelections.every(({ part }) => isKnownPrice(part.priceWon));
  const pickerCurrentSelectionPrice = pickerCurrentSelectionPriceKnown ? currentSelections.reduce((total, { part, quantity }) => total + (part.priceWon ?? 0) * quantity, 0) : undefined;
  const pickerComparisonExportContext = { category: CATEGORY_LABELS[category], ...(pickerCurrentSelectionNames ? { currentPartName: pickerCurrentSelectionNames, currentPartSummary: pickerCurrentSelectionSummary, currentPartPrice: pickerCurrentSelectionPrice !== undefined ? formatWon(pickerCurrentSelectionPrice) : "가격 확인 필요" } : {}) };

  useEffect(() => {
    try {
      if (cachedSnapshot.items.length > 0) {
        window.localStorage.setItem(CATALOG_PICKER_CACHE_STORAGE_KEY, catalogPickerCacheToJson(cachedSnapshot.items, cachedSnapshot.cachedAt));
        window.dispatchEvent(new Event(CATALOG_CACHE_CHANGED_EVENT));
      }
    } catch {
      // The in-memory cache still provides a fallback when storage is unavailable.
    }
  }, [cachedSnapshot]);

  function rememberPickerItems(incoming: ReadonlyArray<Part>) {
    setCachedSnapshot((current) => ({ schemaVersion: 1, items: mergeCatalogPickerCache(current.items, incoming), cachedAt: new Date().toISOString() }));
  }

  function applyCompatibilityPreset() {
    if (compatibilityPreset.labels.length === 0) {
      setPresetMessage("현재 견적에서 자동으로 적용할 확인된 조건이 없습니다.");
      return;
    }
    setSpecFilter((current) => ({ ...current, ...compatibilityPreset.values } as PickerSpecFilter));
    setPresetMessage(`${compatibilityPreset.labels.length}개 조건을 적용했습니다. 목록은 확인된 값만 반영합니다.`);
  }

  function clearSpecFilters() {
    setSpecFilter({ ...EMPTY_PICKER_SPEC_FILTER });
    setPresetMessage(null);
  }

  function clearCandidateFilters() {
    setQuality("all");
    setFreshness("all");
    setPriceStatus("all");
    setRiskFilter("all");
    setPerformanceFilter("all");
    setPhysicalEvidenceFilter("all");
    setTrustFilter("all");
    setCandidateBudget("");
    setSpecFilter({ ...EMPTY_PICKER_SPEC_FILTER });
    setPresetMessage("카테고리·검색어·구매 조건은 유지하고 부품 필터만 완화했어요.");
  }

  function requestParts(offset: number, limit: number, signal = requestAbortControllerRef.current?.signal) {
    const specFilterPayload = pickerSpecFilterPayloadFor(category, specFilter);
    if (candidateMode !== "all") {
      return api<PickerPartsResponse>("/api/parts/compatible", {
        method: "POST",
        body: JSON.stringify({ category, build, profile, gamingResolution, gamingRefreshRate, findingRuleId, q: query, brand: brand.trim(), quality, priceStatus, freshness, sort, listingPolicy, mode: candidateMode, riskFilter, performanceFilter, physicalEvidenceFilter, recommendationTrustFilter: trustFilter, specFilter: specFilterPayload, ...(candidateBudget.trim() ? { budgetWon: candidateBudget.trim() } : {}), offset, limit }),
        retry: 2,
        retryOnRateLimit: true,
        ...(signal ? { signal } : {})
      });
    }
    const params = new URLSearchParams({ category, q: query, brand: brand.trim(), quality, priceStatus, freshness, sort, listingPolicy, offset: String(offset), limit: String(limit) });
    Object.entries(specFilterPayload).forEach(([key, value]) => params.set(key, value));
    return api<PickerPartsResponse>(`/api/parts?${params.toString()}`, signal ? { signal } : undefined);
  }

  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++requestVersionRef.current;
    const controller = new AbortController();
    requestAbortControllerRef.current?.abort();
    requestAbortControllerRef.current = controller;
    const timer = window.setTimeout(() => {
      setLoading(true); setItems([]); setTotal(0); setRiskCounts(null); setRecommendationTrustCounts(null); setRiskExcludedCount(0); setBudgetExcludedCount(0); setPerformanceExcludedCount(0); setPhysicalEvidenceExcludedCount(0); setFreshnessExcludedCount(0); setIncompleteExcludedCount(0); setIncompleteMissingFields([]); setPriceExcludedCount(0); setTrustExcludedCount(0); setSpecExcludedCount(0); setSpecFilterDiagnostics([]); setExpandedPickerId(null); setComparePickerIds([]); setLoadingMore(false); setLoadMoreError(null); setError(null);
      void requestParts(0, 50, controller.signal)
        .then((payload) => { if (!cancelled && requestVersionRef.current === requestVersion) { rememberPickerItems(payload.items); const shouldFallbackToReview = shouldAutoFallbackToReviewCandidates({ findingRuleId, initialCandidateMode, candidateMode, attempted: autoFallbackAttemptedRef.current, total: payload.total, riskCounts: payload.riskCounts }); if (shouldFallbackToReview) { autoFallbackAttemptedRef.current = true; setPresetMessage("호환 가능 여부를 판단하기 어려운 부품도 함께 보여드려요. 적용 전에 주요 사양을 살펴봐 주세요."); setCandidateMode("no_blocker"); return; } setItems(payload.items); setTotal(payload.total); setRiskCounts(payload.riskCounts ?? null); setRecommendationTrustCounts(payload.recommendationTrustCounts ?? null); setRiskExcludedCount(payload.riskExcludedCount ?? 0); setBudgetExcludedCount(payload.budgetExcludedCount ?? 0); setPerformanceExcludedCount(payload.performanceExcludedCount ?? 0); setPhysicalEvidenceExcludedCount(payload.physicalEvidenceExcludedCount ?? 0); setFreshnessExcludedCount(payload.freshnessExcludedCount ?? 0); setIncompleteExcludedCount(payload.incompleteExcludedCount ?? 0); setIncompleteMissingFields(payload.incompleteMissingFields ?? []); setPriceExcludedCount(payload.priceExcludedCount ?? 0); setTrustExcludedCount(payload.trustExcludedCount ?? 0); setSpecExcludedCount(payload.specExcludedCount ?? 0); setSpecFilterDiagnostics(payload.specFilterDiagnostics ?? []); setError(null); } })
        .catch((reason: unknown) => { if (!cancelled && requestVersionRef.current === requestVersion) setError(reason instanceof Error ? reason.message : "부품을 불러오지 못했습니다."); })
        .finally(() => { if (!cancelled && requestVersionRef.current === requestVersion) setLoading(false); });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (requestAbortControllerRef.current === controller) {
        controller.abort();
        requestAbortControllerRef.current = null;
      }
    };
  }, [category, build, profile, gamingResolution, gamingRefreshRate, query, brand, quality, priceStatus, freshness, sort, listingPolicy, candidateMode, riskFilter, performanceFilter, physicalEvidenceFilter, trustFilter, candidateBudget, specFilter, retryNonce, findingRuleId, initialCandidateMode]);

  useEffect(() => {
    setItems([]);
    setTotal(0);
    setRiskCounts(null);
    setRecommendationTrustCounts(null);
    setError(null);
    setExpandedPickerId(null);
    setComparePickerIds([]);
  }, [brand, candidateBudget, candidateMode, freshness, performanceFilter, physicalEvidenceFilter, priceStatus, query, quality, riskFilter, sort, specFilter, trustFilter]);

  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    const requestVersion = requestVersionRef.current;
    const offset = items.length;
    setLoadingMore(true); setLoadMoreError(null);
    try {
      const payload = await requestParts(offset, 50);
      if (!mountedRef.current || requestVersionRef.current !== requestVersion) return;
      rememberPickerItems(payload.items);
      setItems((current) => { const known = new Set(current.map((part) => part.id)); return [...current, ...payload.items.filter((part) => !known.has(part.id))]; });
      setTotal(payload.total); setRiskCounts(payload.riskCounts ?? null); setRecommendationTrustCounts(payload.recommendationTrustCounts ?? null); setRiskExcludedCount(payload.riskExcludedCount ?? 0); setBudgetExcludedCount(payload.budgetExcludedCount ?? 0); setPerformanceExcludedCount(payload.performanceExcludedCount ?? 0); setPhysicalEvidenceExcludedCount(payload.physicalEvidenceExcludedCount ?? 0); setFreshnessExcludedCount(payload.freshnessExcludedCount ?? 0); setIncompleteExcludedCount(payload.incompleteExcludedCount ?? 0); setIncompleteMissingFields(payload.incompleteMissingFields ?? []); setPriceExcludedCount(payload.priceExcludedCount ?? 0); setTrustExcludedCount(payload.trustExcludedCount ?? 0); setSpecExcludedCount(payload.specExcludedCount ?? 0); setSpecFilterDiagnostics(payload.specFilterDiagnostics ?? []);
    } catch (reason: unknown) {
      if (mountedRef.current && requestVersionRef.current === requestVersion) setLoadMoreError(reason instanceof Error ? reason.message : "추가 부품을 불러오지 못했습니다.");
    } finally {
      if (mountedRef.current && requestVersionRef.current === requestVersion) setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (candidateMode === "all") setPhysicalEvidenceFilter("all");
  }, [candidateMode]);

  function togglePickerCompare(part: PickerPart) {
    setComparePickerIds((current) => current.includes(part.id) ? current.filter((id) => id !== part.id) : current.length >= 3 ? current : [...current, part.id]);
  }

  async function copyPickerComparison() {
    try {
      await navigator.clipboard.writeText(alternativeComparisonTextFor(pickerComparisonCandidatesFor(comparePickerParts, partSummary, formatWon, similarityEvidenceText), pickerComparisonExportContext));
      if (mountedRef.current) onToast("부품 비교표를 클립보드에 복사했어요.");
    } catch {
      if (mountedRef.current) onToast("부품 비교표 복사에 실패했어요. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }
  function downloadPickerComparison() {
    const blob = new Blob([alternativeComparisonCsvFor(pickerComparisonCandidatesFor(comparePickerParts, partSummary, formatWon, similarityEvidenceText), pickerComparisonExportContext)], { type: "text/csv;charset=utf-8" }); const url = window.URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pc-supporter-candidate-comparison-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); window.URL.revokeObjectURL(url); onToast("부품 비교표 CSV를 저장했어요.");
  }
  function downloadPickerComparisonJson() {
    const blob = new Blob([alternativeComparisonJsonFor(pickerComparisonCandidatesFor(comparePickerParts, partSummary, formatWon, similarityEvidenceText), pickerComparisonExportContext)], { type: "application/json;charset=utf-8" }); const url = window.URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pc-supporter-candidate-comparison-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.URL.revokeObjectURL(url); onToast("부품 비교표 JSON을 저장했어요.");
  }

  useEffect(() => { document.body.classList.add("modal-open"); return () => document.body.classList.remove("modal-open"); }, []);
  const candidateModeLabel = candidateMode === "safe" ? "호환 가능한 부품" : candidateMode === "no_blocker" ? "호환 문제가 없는 부품" : candidateMode === "precision" ? "전체 후보" : "전체 카탈로그";
  const priceStatusLabel = PRICE_AVAILABILITY_LABELS[priceStatus];
  const freshnessFilterLabel = freshness === "all" ? "전체 갱신 상태" : DATA_FRESHNESS_LABELS[freshness];
  const performanceFilterLabel = performanceFilter === "similar" ? "동급·유사 성능 부품" : performanceFilter === "verified" ? "성능 점수 등록 부품" : performanceFilter === "benchmark" ? "벤치마크 정보 포함 부품" : "전체 성능 부품";
  const physicalEvidenceFilterLabelText = physicalEvidenceFilter === "verified" ? "장착 규격 일치" : physicalEvidenceFilter === "review" ? "장착 사양 미등록" : "전체 장착 규격";
  const trustFilterLabel = trustFilter === "high" ? "추천 점수 높음 부품" : trustFilter === "medium_plus" ? "추천 점수 보통 이상 부품" : "전체 추천 점수";
  const riskFilterLabel = riskFilter === "safe" ? "안전 부품" : riskFilter === "review" ? "확인 필요 부품" : riskFilter === "unsafe" ? "차단 부품" : "전체 위험도";
  const candidateEmptyMessage = (() => {
    if (priceStatus !== "all" && total === 0) return priceStatusLabel + "에 해당하는 부품이 없어요. 가격 조건을 바꿔 보세요.";
    if (candidateMode !== "all" && physicalEvidenceFilter !== "all" && total === 0) return physicalEvidenceFilterLabelText + " 조건에 맞는 부품이 없어요. 장착 규격 조건을 바꿔 보세요.";
    if (candidateMode !== "all" && performanceFilter !== "all" && total === 0) return performanceFilterLabel + " 조건에 맞는 부품이 없어요. 성능 조건을 바꿔 보세요.";
    if (candidateMode === "safe") return findingTitle ? findingTitle + "를 해결할 수 있는 호환 부품이 없어요." : "현재 구성과 호환되는 부품이 없어요.";
    if (candidateMode === "no_blocker") return "현재 구성에 호환 문제가 없는 부품이 없어요.";
    if (candidateMode === "precision") return findingTitle ? findingTitle + "를 해결할 수 있는 부품이 없어요." : "비교할 부품이 없어요.";
    return query.trim() ? "검색 결과가 없어요. 다른 모델명으로 검색해 보세요." : "검색 결과가 없어요.";
  })();
  const candidateLoadingMessage = candidateMode === "all" ? "부품 목록을 불러오는 중..." : "호환 부품을 찾는 중...";
  const candidateModeHelp = candidateMode === "precision"
    ? "모든 후보를 현재 구성에 맞춰 비교해요. 호환 불가한 부품은 적용할 수 없어요."
    : candidateMode === "no_blocker"
      ? "호환 문제가 없는 부품과 사양이 부족한 부품을 함께 보여드려요."
      : candidateMode === "safe"
        ? "현재 구성과 호환되는 부품을 보여드려요."
        : "카탈로그에서 부품을 찾아요.";
  const candidateRiskSummary = candidateMode === "all" || !riskCounts ? "" : "호환 가능 " + riskCounts.safe.toLocaleString("ko-KR") + "개 · 사양 부족 " + riskCounts.review.toLocaleString("ko-KR") + "개 · " + (candidateMode === "precision" ? "호환 불가 " : "제외 ") + riskCounts.unsafe.toLocaleString("ko-KR") + "개";
  const candidateRiskFilterSummary = candidateMode !== "all" && riskFilter !== "all" ? `${riskFilterLabel} · ${total.toLocaleString("ko-KR")}개 표시${riskExcludedCount > 0 ? ` · 다른 위험도 ${riskExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}` : "";
  const candidateBudgetValue = candidateBudget.trim() ? Number(candidateBudget) : undefined;
  const candidateBudgetSummary = candidateMode !== "all" && candidateBudgetValue !== undefined && Number.isInteger(candidateBudgetValue) && candidateBudgetValue > 0 ? `교체 예산 ${candidateBudgetValue.toLocaleString("ko-KR")}원 · ${total.toLocaleString("ko-KR")}개 표시${budgetExcludedCount > 0 ? ` · 예산 초과·가격 미확인 ${budgetExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}` : "";
  const candidatePerformanceSummary = candidateMode !== "all" && performanceFilter !== "all" ? `${performanceFilterLabel} · ${total.toLocaleString("ko-KR")}개 표시${performanceExcludedCount > 0 ? ` · 성능 기준 미충족 ${performanceExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}` : "";
  const candidatePhysicalEvidenceSummary = candidateMode !== "all" && physicalEvidenceFilter !== "all" ? `${physicalEvidenceFilterLabelText} · ${total.toLocaleString("ko-KR")}개 표시${physicalEvidenceExcludedCount > 0 ? ` · 장착 정보 기준 미충족 ${physicalEvidenceExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}` : "";

  const candidatePriceSummary = priceStatus !== "all" ? `${priceStatusLabel} · ${total.toLocaleString("ko-KR")}개 표시${priceExcludedCount > 0 ? ` · 다른 가격 상태 ${priceExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}` : "";
  const candidateFreshnessSummary = freshness !== "all" ? `${freshnessFilterLabel} · ${total.toLocaleString("ko-KR")}개 표시${freshnessExcludedCount > 0 ? ` · 다른 갱신 상태 ${freshnessExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}` : "";
  const benchmarkCoverageSummary = performanceFilter === "benchmark"
    ? category === "cpu" && benchmarkCoverage
      ? `Cinebench R23 완전 자료 ${benchmarkCoverage.cpu.cinebenchR23Complete.toLocaleString("ko-KR")} / 전체 CPU ${benchmarkCoverage.cpu.total.toLocaleString("ko-KR")}개`
      : category === "gpu" && benchmarkCoverage
        ? `3DMark 완전 자료 ${benchmarkCoverage.gpu.threeDMarkComplete.toLocaleString("ko-KR")} / 전체 GPU ${benchmarkCoverage.gpu.total.toLocaleString("ko-KR")}개 · Time Spy ${benchmarkCoverage.gpu.threeDMarkTimeSpy.toLocaleString("ko-KR")}개 · Port Royal ${benchmarkCoverage.gpu.threeDMarkPortRoyal.toLocaleString("ko-KR")}개`
      : "현재 카테고리에는 연결된 벤치마크 정보가 없는 범주라 비교할 부품이 없을 수 있어요."
    : "";
  const specFilterLabel = pickerSpecFilterSummaryFor(category, specFilter);
  const specFilterSummary = specFilterLabel ? `${specFilterLabel} · ${total.toLocaleString("ko-KR")}개 표시${specExcludedCount > 0 ? ` · 스펙 조건 미충족 ${specExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}` : "";
  const specFilterDiagnosticSummary = specFilterLabel ? pickerSpecFilterDiagnosticSummaryFor(specFilterDiagnostics) : "";
  const canOfferReviewCandidates = shouldOfferReviewCandidates({ candidateMode, riskFilter, total, riskCounts: riskCounts ?? undefined });
  const hasNarrowCandidateFilter = candidateMode !== "all" && (quality !== "all" || freshness !== "all" || priceStatus !== "all" || riskFilter !== "all" || performanceFilter !== "all" || physicalEvidenceFilter !== "all" || trustFilter !== "all" || candidateBudget.trim().length > 0 || hasActiveSpecFilter);
  const canOfferReviewCandidatesInEmpty = candidateMode === "safe" && riskFilter === "all" && total === 0 && (riskCounts?.review ?? 0) > 0;
  const cachedCatalog = useMemo(() => mergeCatalogPickerCache(cachedParts, [...partMap.values()]), [cachedParts, partMap]);
  const cachedSort = sort === "name" || sort === "updated" || sort === "price_desc" ? sort : "price_asc";
  const cachedFallback = useMemo(() => catalogPickerCachedFallbackFor(cachedCatalog, {
    category,
    query,
    brand,
    quality,
    freshness,
    priceStatus,
    listingPolicy,
    sort: cachedSort,
    specFilter: pickerSpecFilterPayloadFor(category, specFilter),
    limit: 50
  }), [cachedCatalog, category, query, brand, quality, freshness, priceStatus, listingPolicy, cachedSort, specFilter]);
  const showCachedFallback = Boolean(error) && candidateMode === "all" && cachedFallback.total > 0;
  const visibleItems = showCachedFallback ? cachedFallback.items : items;
  const visibleTotal = showCachedFallback ? cachedFallback.total : total;
  const cachedLatestUpdatedAt = cachedCatalog.reduce<string | undefined>((latest, part) => !latest || part.updatedAt > latest ? part.updatedAt : latest, undefined);
  const comparePickerParts = visibleItems.filter((part) => comparePickerIds.includes(part.id));
  useEffect(() => {
    if (!showCachedFallback) return;
    setItems(cachedFallback.items);
    setTotal(cachedFallback.total);
  }, [showCachedFallback, cachedFallback]);
  useEffect(() => {
    if (!error) return;
    const retryWhenOnline = () => {
      if (navigator.onLine) setRetryNonce((current) => current + 1);
    };
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [error]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={modalRef} tabIndex={-1} className="picker-modal" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div className="modal-header"><div><p className="eyebrow">PART CATALOG</p><h2 id="picker-title">{CATEGORY_LABELS[category]} 선택</h2><p>다나와 카탈로그와 직접 확인한 정보를 기준으로 검색해요.</p>{findingTitle && <p className="picker-intent-label">문제 해결 부품 · {findingTitle}</p>}</div><button className="icon-button" type="button" onClick={onClose} aria-label="부품 선택 닫기"><FiXCircle /></button></div>
      <label className="search-box"><FiSearch /><input data-modal-autofocus enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${CATEGORY_LABELS[category]} 모델명 검색`} /></label>
      <div className="picker-brand-filter-panel" aria-label="부품 선택기 제조사 필터" data-testid="picker-brand-filter"><label><span>MANUFACTURER FILTER · 제조사</span><input aria-label="부품 선택기 제조사 필터" list="picker-brand-options" type="search" value={brand} onChange={(event) => setBrand(event.target.value.slice(0, 80))} placeholder="예: ASUS · AMD · GIGABYTE" /></label><datalist id="picker-brand-options">{brandOptions.map((option) => <option value={option.brand} label={`${option.count}개`} key={option.brand} />)}</datalist>{brandOptions.length > 0 && <div className="picker-brand-suggestions" role="group" aria-label="부품 선택기 제조사 빠른 선택">{brandOptions.slice(0, 6).map((option) => <button className={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR") ? "selected" : ""} type="button" aria-pressed={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR")} onClick={() => setBrand(option.brand)} key={option.brand}>{option.brand}<small>{option.count}</small></button>)}</div>}{brand.trim() && <button className="text-button" type="button" onClick={() => setBrand("")}>제조사 초기화</button>}</div>
      <div className="picker-filters"><label><span>구매 조건</span><select value={listingPolicy} onChange={(event) => setListingPolicy(event.target.value as ListingPolicy)}><option value="retail_only">{LISTING_POLICY_LABELS.retail_only}</option><option value="include_bulk">벌크 포함</option><option value="all">{LISTING_POLICY_LABELS.all}</option></select></label><label><span>정렬</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="price_asc">가격 낮은 순</option><option value="price_desc">가격 높은 순</option><option value="name">이름 순</option>{candidateMode !== "all" && <></>}</select></label><label><span>부품</span><select value={candidateMode} onChange={(event) => { const next = event.target.value as typeof candidateMode; setCandidateMode(next); if (next === "all") { setPerformanceFilter("all"); setTrustFilter("all"); if (sort === "similarity" || sort === "value") setSort("price_asc"); } }}><option value="all">전체 카탈로그</option><option value="precision">전체 부품 검사</option><option value="no_blocker">차단 오류 없는 부품</option><option value="safe">확인된 안전 부품</option></select></label><label className="picker-risk-filter"><span>호환 상태</span><select aria-label="부품 호환 상태" value={riskFilter} disabled={candidateMode === "all"} onChange={(event) => setRiskFilter(event.target.value as PickerRiskFilter)}><option value="all">전체 위험도</option><option value="safe">안전</option><option value="review">확인 필요</option><option value="unsafe">차단</option></select></label><label className="picker-performance-filter"><span>성능 기준</span><select aria-label="대체 부품 성능 기준" value={performanceFilter} disabled={candidateMode === "all"} onChange={(event) => setPerformanceFilter(event.target.value as PickerPerformanceFilter)}><option value="all">전체 성능 부품</option><option value="similar">동급·유사만</option><option value="verified">성능 점수 등록</option><option value="benchmark">벤치마크 포함</option></select></label><label className="picker-budget-filter"><span>교체 예산 <em>선택</em></span><input type="number" min="1" step="10000" value={candidateBudget} disabled={candidateMode === "all"} onChange={(event) => setCandidateBudget(event.target.value)} placeholder="예: 300000" /></label>{category === "gpu" && <label className="picker-spec-filter"><span>최소 VRAM</span><PickerSpecSelect ariaLabel="부품 선택기 최소 VRAM" value={specFilter.minVramGb} options={GPU_VRAM_FILTER_OPTIONS} onChange={(value) => setSpecFilter((current) => ({ ...current, minVramGb: value }))} /></label>}{(category === "memory" || category === "ssd" || category === "hdd") && <label className="picker-spec-filter"><span>{category === "memory" ? "최소 모듈 용량" : "최소 용량"}</span><PickerSpecSelect ariaLabel="부품 선택기 최소 용량" value={specFilter.minCapacityGb} options={category === "memory" ? MEMORY_CAPACITY_FILTER_OPTIONS : STORAGE_CAPACITY_FILTER_OPTIONS} onChange={(value) => setSpecFilter((current) => ({ ...current, minCapacityGb: value }))} /></label>}{category === "memory" && <label className="picker-spec-filter"><span>최소 속도</span><PickerSpecSelect ariaLabel="부품 선택기 최소 메모리 속도" value={specFilter.minMemorySpeedMhz} options={MEMORY_SPEED_FILTER_OPTIONS} onChange={(value) => setSpecFilter((current) => ({ ...current, minMemorySpeedMhz: value }))} /></label>}{category === "psu" && <label className="picker-spec-filter"><span>최소 정격</span><PickerSpecSelect ariaLabel="부품 선택기 최소 정격 출력" value={specFilter.minWattageW} options={PSU_WATTAGE_FILTER_OPTIONS} onChange={(value) => setSpecFilter((current) => ({ ...current, minWattageW: value }))} /></label>}{(category === "ssd" || category === "hdd") && <label className="picker-spec-filter"><span>연결 방식</span><PickerSpecSelect ariaLabel="부품 선택기 연결 방식" value={specFilter.storageInterface} options={STORAGE_INTERFACE_FILTER_OPTIONS} onChange={(value) => setSpecFilter((current) => ({ ...current, storageInterface: value as PickerSpecFilter["storageInterface"] }))} /></label>}</div>
      <div className="picker-compatibility-filters" aria-label="호환 핵심 스펙 필터"><div className="picker-compatibility-filter-heading"><div><strong>호환 핵심 조건</strong><small>비워 두면 조건을 적용하지 않습니다.</small></div><div className="picker-compatibility-filter-actions"><button className="text-button picker-preset-button" type="button" onClick={clearSpecFilters} disabled={!hasActiveSpecFilter}>조건 초기화</button><button className="text-button picker-preset-button" type="button" onClick={applyCompatibilityPreset} disabled={compatibilityPreset.labels.length === 0}>현재 구성 기준 적용</button></div></div>{presetMessage && <p className="picker-preset-message" role="status">{presetMessage}</p>}{["cpu", "cooler", "motherboard"].includes(category) && <label className="picker-spec-filter"><span>소켓</span><PickerSpecTextInput ariaLabel="부품 선택기 소켓" value={specFilter.socket} placeholder="예: AM5" onChange={(value) => setSpecFilter((current) => ({ ...current, socket: value }))} /></label>}{["cpu", "motherboard", "memory"].includes(category) && <label className="picker-spec-filter"><span>메모리 세대</span><PickerSpecTextInput ariaLabel="부품 선택기 메모리 세대" value={specFilter.memoryType} placeholder="예: DDR5" onChange={(value) => setSpecFilter((current) => ({ ...current, memoryType: value }))} /></label>}{["case", "motherboard", "memory", "ssd", "psu"].includes(category) && <label className="picker-spec-filter"><span>폼팩터</span><PickerSpecTextInput ariaLabel="부품 선택기 폼팩터" value={specFilter.formFactor} placeholder="예: ATX · DIMM" onChange={(value) => setSpecFilter((current) => ({ ...current, formFactor: value }))} /></label>}{category === "motherboard" && <><label className="picker-spec-filter"><span>PCIe 슬롯 정보</span><PickerSpecSelect ariaLabel="부품 선택기 PCIe 슬롯 사양" value={specFilter.pcieSlotInfo} options={PCIE_SLOT_INFO_FILTER_OPTIONS} onChange={(value) => setSpecFilter((current) => ({ ...current, pcieSlotInfo: value as PickerSpecFilter["pcieSlotInfo"] }))} /></label><label className="picker-spec-filter"><span>PCIe 슬롯 폭</span><PickerSpecSelect ariaLabel="부품 선택기 PCIe 슬롯 폭" value={specFilter.pcieSlotWidth} options={PCIE_SLOT_WIDTH_FILTER_OPTIONS} onChange={(value) => setSpecFilter((current) => ({ ...current, pcieSlotWidth: value }))} /></label><label className="picker-spec-filter"><span>해당 슬롯 수 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 PCIe 슬롯 수" value={specFilter.minPcieSlotCount} placeholder="예: 1" onChange={(value) => setSpecFilter((current) => ({ ...current, minPcieSlotCount: value }))} /></label><label className="picker-spec-filter"><span>RAM 슬롯 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 RAM 슬롯" value={specFilter.minMemorySlots} placeholder="예: 4" onChange={(value) => setSpecFilter((current) => ({ ...current, minMemorySlots: value }))} /></label><label className="picker-spec-filter"><span>M.2 슬롯 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 M.2 슬롯" value={specFilter.minM2Slots} placeholder="예: 2" onChange={(value) => setSpecFilter((current) => ({ ...current, minM2Slots: value }))} /></label><label className="picker-spec-filter"><span>SATA 포트 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 SATA 포트" value={specFilter.minSataPorts} placeholder="예: 4" onChange={(value) => setSpecFilter((current) => ({ ...current, minSataPorts: value }))} /></label></>}{category === "case" && <><label className="picker-spec-filter"><span>GPU 허용 길이 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 GPU 허용 길이" value={specFilter.minMaxGpuLengthMm} placeholder="예: 330" onChange={(value) => setSpecFilter((current) => ({ ...current, minMaxGpuLengthMm: value }))} /></label><label className="picker-spec-filter"><span>쿨러 허용 높이 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 쿨러 허용 높이" value={specFilter.minMaxCoolerHeightMm} placeholder="예: 160" onChange={(value) => setSpecFilter((current) => ({ ...current, minMaxCoolerHeightMm: value }))} /></label><label className="picker-spec-filter"><span>HDD 베이 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 HDD 베이" value={specFilter.minHddBays} placeholder="예: 2" onChange={(value) => setSpecFilter((current) => ({ ...current, minHddBays: value }))} /></label><label className="picker-spec-filter"><span>PSU 허용 길이 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 PSU 허용 길이" value={specFilter.minMaxPsuLengthMm} placeholder="예: 180" onChange={(value) => setSpecFilter((current) => ({ ...current, minMaxPsuLengthMm: value }))} /></label></>}{category === "cooler" && <label className="picker-spec-filter"><span>냉각 용량 ≥</span><PickerSpecNumberInput ariaLabel="부품 선택기 최소 냉각 용량" value={specFilter.minCoolingW} placeholder="예: 180" onChange={(value) => setSpecFilter((current) => ({ ...current, minCoolingW: value }))} /></label>}{category === "gpu" && <label className="picker-spec-filter"><span>GPU 길이 ≤</span><PickerSpecNumberInput ariaLabel="부품 선택기 최대 GPU 길이" value={specFilter.maxLengthMm} placeholder="예: 300" onChange={(value) => setSpecFilter((current) => ({ ...current, maxLengthMm: value }))} /></label>}{category === "psu" && <label className="picker-spec-filter"><span>PSU 깊이 ≤</span><PickerSpecNumberInput ariaLabel="부품 선택기 최대 PSU 깊이" value={specFilter.maxPsuDepthMm} placeholder="예: 160" onChange={(value) => setSpecFilter((current) => ({ ...current, maxPsuDepthMm: value }))} /></label>}{compatibilityPreset.omitted.length > 0 && <p className="picker-preset-omitted">적용하지 않은 조건: {compatibilityPreset.omitted.join(" · ")}</p>}</div>
      {canOfferReviewCandidates && <button className="button button-small picker-review-candidates-action" type="button" onClick={() => { setCandidateMode("no_blocker"); setPresetMessage("호환 여부를 알 수 없는 부품도 함께 보여드려요."); }}>확인 필요 부품도 보기 · {riskCounts?.review.toLocaleString("ko-KR")}개</button>}

      <label className="picker-price-status-filter"><span>가격 상태</span><select aria-label="부품 가격 등록 여부" value={priceStatus} onChange={(event) => setPriceStatus(event.target.value as PickerPriceStatusFilter)}><option value="all">{PRICE_AVAILABILITY_LABELS.all}</option><option value="known">{PRICE_AVAILABILITY_LABELS.known}</option><option value="unknown">{PRICE_AVAILABILITY_LABELS.unknown}</option></select></label>
      {(category === "gpu" || category === "case" || category === "psu") && <label className="picker-physical-evidence-filter"><span>장착 정보</span><select aria-label="부품 장착 정보" value={physicalEvidenceFilter} disabled={candidateMode === "all"} onChange={(event) => setPhysicalEvidenceFilter(event.target.value as PickerPhysicalEvidenceFilter)}><option value="all">전체 장착 정보</option><option value="verified">규격 일치</option><option value="review">사양 미등록</option></select></label>}
      <p className="picker-mode-note"><FiInfo /><span>{candidateModeHelp}</span>{candidateRiskSummary && <span className="picker-risk-summary">{candidateRiskSummary}</span>}{candidateRiskFilterSummary && <span className="picker-risk-filter-summary">{candidateRiskFilterSummary}</span>}{candidatePerformanceSummary && <span className="picker-performance-summary">{candidatePerformanceSummary}</span>}{candidatePriceSummary && <span className="picker-price-summary">{candidatePriceSummary}</span>}{candidateBudgetSummary && <span className="picker-budget-summary">{candidateBudgetSummary}</span>}{specFilterSummary && <span className="picker-spec-summary">{specFilterSummary}</span>}</p>
      <PickerIncompleteDataNotice category={category} count={candidateMode === "safe" ? incompleteExcludedCount : 0} fields={incompleteMissingFields} />
      {candidatePhysicalEvidenceSummary && <p className="picker-physical-evidence-summary">{candidatePhysicalEvidenceSummary}</p>}
      {specFilterDiagnosticSummary && <p className="picker-spec-diagnostic-summary">{specFilterDiagnosticSummary}</p>}
      {loading ? <div className="picker-state"><FiLoader className="spin" /><span>{candidateLoadingMessage}</span></div> : error ? <PickerFetchErrorNotice subject={`${CATEGORY_LABELS[category]} ${candidateMode === "all" ? "" : `${candidateModeLabel} `}목록`} message={error} onRetry={() => setRetryNonce((current) => current + 1)} retrying={loading} /> : items.length === 0 ? <PickerEmptyState message={candidateEmptyMessage} canRelaxFilters={hasNarrowCandidateFilter} canShowReviewCandidates={canOfferReviewCandidatesInEmpty} reviewCandidateCount={riskCounts?.review ?? 0} onRelaxFilters={clearCandidateFilters} onShowReviewCandidates={() => { setCandidateMode("no_blocker"); setPresetMessage("호환 여부를 알 수 없는 부품도 함께 보여드려요."); }} /> : <div className="picker-list">{items.map((part) => { const alreadySelected = selected.some((selection) => selection.partId === part.id); const candidateTotalPrice = part.recommendedQuantity !== undefined && isKnownPrice(part.priceWon) ? part.priceWon * part.recommendedQuantity : part.priceWon; const expanded = expandedPickerId === part.id; const compared = comparePickerIds.includes(part.id); const physicalReview = part.physicalEvidence?.status === "review"; const sourceUrl = safeExternalUrl(part.danawaUrl); return <article className={expanded ? "picker-item-card expanded" : "picker-item-card"} key={part.id}><button className={alreadySelected ? "picker-item already" : "picker-item"} type="button" onClick={() => onSelect(part)}><span className="picker-item-icon"><PartVisual part={part} /></span><span className="picker-item-main"><strong>{part.name}</strong><small>{part.recommendedQuantity !== undefined ? `추천 킷 ${part.recommendedQuantity}개 · ` : ""}{partSummary(part)}</small>{part.performanceSummary && <small className="picker-similarity">{part.performanceSummary}</small>}{candidateMode !== "all" && part.physicalEvidence && part.physicalEvidence.status !== "not_applicable" && <small className={`picker-physical-evidence-line ${part.physicalEvidence.status}`}>{pickerPhysicalEvidenceText(part.physicalEvidence)}</small>}{(part.candidateRisk === "review" || part.candidateRisk === "unsafe") && part.candidateReasons && part.candidateReasons.length > 0 && <small className="picker-review-reasons">{part.candidateRisk === "unsafe" ? "차단 있음: " : "확인 필요: "}{part.candidateReasons.slice(0, 2).join(" · ")}</small>}<span className="data-badges">{part.listingType && part.listingType !== "retail" && <em className="listing-badge">{LISTING_TYPE_LABELS[part.listingType]}</em>}{part.missingFields.length > 0 && <em className="missing-badge">사양 미등록 {part.missingFields.length}개</em>}</span></span><span className="picker-item-side"><strong>{formatWon(candidateTotalPrice)}</strong>{part.recommendedQuantity !== undefined && <small>1킷 {formatWon(part.priceWon)}</small>}{alreadySelected ? <span><FiCheck /> 선택됨</span> : <span>선택 <FiExternalLink /></span>}</span></button><div className="picker-item-actions"><PartWatchButton part={part} onWatch={onWatchPart} />{sourceUrl && <a className="picker-source-link" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${part.name} 다나와 상품 페이지 보기`}>다나와 보기 <FiExternalLink /></a>}<button className={compared ? "text-button picker-compare-toggle selected" : "text-button picker-compare-toggle"} type="button" aria-pressed={compared} onClick={() => togglePickerCompare(part)}>{compared ? "비교 중" : "비교"}</button><button className="text-button picker-item-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedPickerId(expanded ? null : part.id)}>{expanded ? "상세·이유 닫기" : "상세·이유"} <FiChevronDown /></button></div>{expanded && <PickerPartDetail part={part} PartEvidence={PartEvidence} />}</article>; })}</div>}
      {showCachedFallback && <PickerCachedCatalogNotice visibleCount={visibleItems.length} total={visibleTotal} latestUpdatedAt={cachedLatestUpdatedAt} cachedAt={cachedSnapshot.cachedAt} />}
      {showCachedFallback && <PickerCachedCatalogList items={visibleItems} selected={selected} expandedPickerId={expandedPickerId} comparePickerIds={comparePickerIds} onSelect={onSelect} onToggleCompare={togglePickerCompare} onToggleExpanded={(partId) => setExpandedPickerId(expandedPickerId === partId ? null : partId)} partSummary={partSummary} formatWon={formatWon} PartVisual={PartVisual} PartEvidence={PartEvidence} />}
      {comparePickerParts.length >= 2 && <PickerComparison parts={comparePickerParts} currentSelections={currentSelections} category={category} affectedPartIds={affectedPartIds} onSelect={onSelect} onPreview={onPreview} onCompareScenarios={onCompareScenarios} onCopy={() => void copyPickerComparison()} onDownload={downloadPickerComparison} onJsonDownload={downloadPickerComparisonJson} onShare={(candidates, context) => onShareComparison(candidates, { ...(context?.name ? { name: context.name } : {}), category: context?.category ?? CATEGORY_LABELS[category], ...(context?.currentPartName ? { currentPartName: context.currentPartName, ...(context?.currentPartSummary ? { currentPartSummary: context.currentPartSummary } : {}), ...(context?.currentPartPrice ? { currentPartPrice: context.currentPartPrice } : {}) } : {}) })} onRevoke={onRevokeComparison} partSummary={partSummary} formatWon={formatWon} similarityEvidenceText={similarityEvidenceText} />}
      {items.length < total && <button className="button button-light full-width picker-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <><FiLoader className="spin" /> 추가 부품 불러오는 중...</> : <>더 많은 부품 불러오기 ({items.length.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")})</>}</button>}{loadMoreError && <div className="catalog-more-error"><span>{loadMoreError}</span><button className="text-button" type="button" onClick={() => void loadMore()}>다시 불러오기</button></div>}
      <div className="modal-footer"><span><FiDatabase /> {candidateMode === "all" ? "표시 항목 " : `${candidateModeLabel} `}{items.length.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}개</span><button className="button button-light" type="button" onClick={onClose}>닫기</button></div>
    </section>
  </div>;
}
