export const PART_CATEGORIES = [
  "cpu",
  "cooler",
  "motherboard",
  "memory",
  "gpu",
  "ssd",
  "hdd",
  "case",
  "psu"
] as const;

export type PartCategory = (typeof PART_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  cpu: "CPU",
  cooler: "CPU 쿨러",
  motherboard: "메인보드",
  memory: "RAM",
  gpu: "그래픽카드",
  ssd: "SSD",
  hdd: "HDD",
  case: "케이스",
  psu: "파워서플라이"
};

export type DataQuality = "seed" | "live" | "manual" | "incomplete";

export type ListingType = "retail" | "bulk" | "parallel_import" | "overseas" | "used" | "accessory" | "unknown";

export type ListingPolicy = "retail_only" | "include_bulk" | "all";

export type PriceAvailabilityFilter = "all" | "known" | "unknown";

export const PRICE_AVAILABILITY_LABELS: Record<PriceAvailabilityFilter, string> = {
  all: "전체 가격 상태",
  known: "가격 확인 상품만",
  unknown: "가격 미확인 상품만"
};

export const LISTING_TYPE_LABELS: Record<ListingType, string> = {
  retail: "신품·정식 유통",
  bulk: "벌크",
  parallel_import: "병행수입",
  overseas: "해외구매",
  used: "중고·리퍼",
  accessory: "액세서리",
  unknown: "유통 조건 확인"
};

export const LISTING_POLICY_LABELS: Record<ListingPolicy, string> = {
  retail_only: "신품·정식 유통",
  include_bulk: "벌크 포함",
  all: "전체 조건"
};

export type RecommendationPriority = "balanced" | "budget" | "performance";

export const RECOMMENDATION_PRIORITY_LABELS: Record<RecommendationPriority, string> = {
  balanced: "균형형",
  budget: "가성비 우선",
  performance: "성능 우선"
};

export type RecommendationProfile = "general" | "gaming" | "creator" | "development" | "office";

export const RECOMMENDATION_PROFILE_LABELS: Record<RecommendationProfile, string> = {
  general: "일반형",
  gaming: "게이밍",
  creator: "작업·크리에이터",
  development: "개발·AI",
  office: "사무·일반"
};

export type GamingResolution = "1080p" | "1440p" | "4k";

export const GAMING_RESOLUTION_LABELS: Record<GamingResolution, string> = {
  "1080p": "FHD · 1080p",
  "1440p": "QHD · 1440p",
  "4k": "4K · 2160p"
};

// 게임·옵션·업스케일러에 따라 달라지는 실제 FPS가 아닌, 서비스의 보수적인 VRAM 확인 기준입니다.
export const GAMING_RESOLUTION_VRAM_TARGETS: Record<GamingResolution, number> = {
  "1080p": 8,
  "1440p": 12,
  "4k": 16
};

export type GamingRefreshRate = 60 | 144 | 240;

export const GAMING_REFRESH_RATE_LABELS: Record<GamingRefreshRate, string> = {
  60: "60Hz · 기본",
  144: "144Hz · 고주사율",
  240: "240Hz · 초고주사율"
};

export type GpuTargetFit = "met" | "partial" | "unknown";

export interface GpuTargetEvidence {
  resolution: GamingResolution;
  refreshRate?: GamingRefreshRate;
  targetVramGb: number;
  currentVramGb?: number;
  candidateVramGb?: number;
  currentFit: GpuTargetFit;
  candidateFit?: GpuTargetFit;
  summary: string;
}

export interface RecommendationPreferences {
  priority: RecommendationPriority;
  profile: RecommendationProfile;
  budgetWon?: number;
  listingPolicy?: ListingPolicy;
  gamingResolution?: GamingResolution;
  gamingRefreshRate?: GamingRefreshRate;
}

export type PciePowerConnectorKind = "pcie_6pin" | "pcie_8pin_6plus2" | "12vhpwr" | "12v2x6";

export interface PciePowerRequirement {
  kind: PciePowerConnectorKind;
  count: number;
}

export type M2LaneSharingScope = "pcie" | "sata" | "usb4" | "m2";

export type M2SlotConnectionType = "cpu" | "chipset" | "unknown";

export interface M2SlotProfile {
  slotId: string;
  interfaces?: Array<"NVMe" | "SATA">;
  pcieGeneration?: number;
  connection?: M2SlotConnectionType;
  sharedWith?: string[];
}

export interface M2SlotOverride {
  partId: string;
  slots: M2SlotProfile[];
  sourceNote?: string;
  sourceUrl?: string;
  updatedAt: string;
}

export type PhysicalSourceCheckStatus = "reachable" | "redirected" | "http_error" | "unreachable" | "blocked" | "identity_mismatch";

export type PhysicalSourceIdentityStatus = "matched" | "not_found" | "manual_required" | "not_checked";

export interface PhysicalSourceCheck {
  requestedUrl: string;
  checkedAt: string;
  status: PhysicalSourceCheckStatus;
  identityStatus: PhysicalSourceIdentityStatus;
  redirectCount: number;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  detail?: string;
}

export interface PhysicalSourceCheckBatchItem {
  partId: string;
  partName: string;
  category: PhysicalOverrideCategory;
  sourceUrl: string;
  sourceCheck: PhysicalSourceCheck;
  persisted: boolean;
}

export interface PhysicalSourceCheckBatchResponse {
  checkedAt: string;
  persisted: boolean;
  totalCandidates: number;
  checkedCount: number;
  reviewCount: number;
  passedCount: number;
  persistedCount: number;
  persistFailureCount: number;
  items: PhysicalSourceCheckBatchItem[];
  skipped: Array<{ partId: string; partName?: string; reason: string }>;
}

export type PhysicalSourceCheckTransition = "initial" | "unchanged" | "changed";

export interface PhysicalSourceCheckHistoryEntry {
  id: string;
  partId: string;
  recordedAt: string;
  sourceCheck: PhysicalSourceCheck;
  transition: PhysicalSourceCheckTransition;
}

export interface GpuPhysicalOverride {
  partId: string;
  gpuSlotOccupancy?: number;
  gpuCableBendClearanceMm?: number;
  caseSidePanelClearanceMm?: number;
  psuIndependentPcieCableRuns?: number;
  psuPcieCableTopology?: "independent" | "shared";
  manufacturerModel: string;
  manufacturerRevision?: string;
  sourceNote: string;
  sourceUrl?: string;
  sourceCheck?: PhysicalSourceCheck;
  updatedAt: string;
}

export interface RgbDeviceLoadProvenance {
  manufacturerModel: string;
  sourceNote: string;
  sourceUrl?: string;
  updatedAt: string;
}

export interface FanLoadProvenance {
  manufacturerModel: string;
  sourceNote: string;
  sourceUrl?: string;
  updatedAt: string;
}

export interface CoolingFanLoadOverride extends FanLoadProvenance {
  accessoryId: string;
  fanCurrentA: number;
}

export interface CaseRgbLoadOverride extends RgbDeviceLoadProvenance {
  partId: string;
  rgbDeviceCurrentA?: number;
  rgbDevicePowerW?: number;
}

export type PhysicalOverrideCategory = "gpu" | "case" | "psu";

export type PhysicalReviewStatus = "pending" | "partial" | "stale" | "reviewed";

export type PhysicalReviewPriority = "high" | "medium" | "low";

export interface PhysicalReviewQueueItem {
  partId: string;
  partName: string;
  category: PhysicalOverrideCategory;
  dataQuality: DataQuality;
  priceWon?: number;
  updatedAt?: string;
  reviewStatus: PhysicalReviewStatus;
  freshness: DataFreshness;
  evidenceUpdatedAt?: string;
  priority: PhysicalReviewPriority;
  priorityScore: number;
  reviewReason: string;
  focusFields: string[];
}

export interface PhysicalReviewQueue {
  generatedAt: string;
  category?: PhysicalOverrideCategory;
  query?: string;
  offset: number;
  limit: number;
  total: number;
  allQueueTotal: number;
  queueTotal: number;
  priority?: PhysicalReviewPriority;
  registeredCount: number;
  reviewedCount: number;
  partialCount: number;
  staleCount: number;
  pendingCount: number;
  freshCount: number;
  agingCount: number;
  staleFreshnessCount: number;
  unknownFreshnessCount: number;
  coveragePercent: number;
  items: PhysicalReviewQueueItem[];
}

export interface PhysicalReviewCoverageCategory {
  category: PhysicalOverrideCategory;
  total: number;
  registeredCount: number;
  reviewedCount: number;
  partialCount: number;
  staleCount: number;
  pendingCount: number;
  freshCount: number;
  agingCount: number;
  staleFreshnessCount: number;
  unknownFreshnessCount: number;
  queueCount: number;
  coveragePercent: number;
}

export interface PhysicalReviewCoverage {
  generatedAt: string;
  categories: PhysicalReviewCoverageCategory[];
  total: number;
  registeredCount: number;
  reviewedCount: number;
  partialCount: number;
  staleCount: number;
  pendingCount: number;
  freshCount: number;
  agingCount: number;
  staleFreshnessCount: number;
  unknownFreshnessCount: number;
  queueCount: number;
  coveragePercent: number;
}

export type PhysicalReviewWorkAction = "register_evidence" | "complete_missing_fields" | "refresh_evidence";

export interface PhysicalReviewWorkField {
  key: string;
  label: string;
  type: "number" | "select" | "text" | "url";
  required: boolean;
  instruction: string;
}

export interface PhysicalReviewWorkItem {
  partId: string;
  partName: string;
  category: PhysicalOverrideCategory;
  dataQuality: DataQuality;
  priceWon?: number;
  updatedAt?: string;
  reviewStatus: PhysicalReviewStatus;
  freshness: DataFreshness;
  evidenceUpdatedAt?: string;
  priority: PhysicalReviewPriority;
  priorityScore: number;
  reviewReason: string;
  focusFields: string[];
  nextAction: PhysicalReviewWorkAction;
  nextActionLabel: string;
  gpuSlotOccupancy?: number;
  gpuCableBendClearanceMm?: number;
  caseSidePanelClearanceMm?: number;
  psuIndependentPcieCableRuns?: number;
  psuPcieCableTopology?: "independent" | "shared";
  manufacturerModel?: string;
  manufacturerRevision?: string;
  sourceNote?: string;
  sourceUrl?: string;
  sourceCheck?: PhysicalSourceCheck;
}

export interface PhysicalReviewWorkPackageSummary {
  total: number;
  queueTotal: number;
  includedCount: number;
  remainingCount: number;
  reviewedCount: number;
  partialCount: number;
  staleCount: number;
  pendingCount: number;
  coveragePercent: number;
}

export interface PhysicalReviewWorkPackage {
  schemaVersion: 1;
  kind: "gpu-physical-review-package";
  generatedAt: string;
  category?: PhysicalOverrideCategory;
  priority?: PhysicalReviewPriority;
  query?: string;
  offset: number;
  limit: number;
  nextOffset?: number;
  fields: PhysicalReviewWorkField[];
  summary: PhysicalReviewWorkPackageSummary;
  items: PhysicalReviewWorkItem[];
}

export type M2MappingStatus = "mapped" | "stale" | "incomplete" | "unmapped";

export type M2CoverageFilter = M2MappingStatus | "all" | "needs_review";

export type M2ReviewPriority = "high" | "medium" | "low";

export interface M2SlotCoverageItem {
  partId: string;
  name: string;
  brand?: string;
  m2Slots?: number;
  m2Interfaces?: Array<"NVMe" | "SATA">;
  m2PcieGenerations?: number[];
  dataQuality: DataQuality;
  priceWon?: number;
  updatedAt?: string;
  mappingStatus: M2MappingStatus;
  reviewPriority: M2ReviewPriority;
  reviewPriorityScore: number;
  reviewReason: string;
}

export interface M2SlotCoverageBucket {
  slotCount: number;
  total: number;
  mapped: number;
  stale: number;
  incomplete: number;
  unmapped: number;
}

export interface M2SlotCoverage {
  generatedAt: string;
  filter: M2CoverageFilter;
  query?: string;
  offset: number;
  limit: number;
  totals: {
    eligibleMotherboards: number;
    multiSlotMotherboards: number;
    mapped: number;
    stale: number;
    incomplete: number;
    unmapped: number;
    coveragePercent: number;
    mixedGenerationMotherboards: number;
    unmappedMixedGenerationMotherboards: number;
  };
  bySlotCount: M2SlotCoverageBucket[];
  items: M2SlotCoverageItem[];
}

export interface M2SlotReviewTemplateItem {
  partId: string;
  partName?: string;
  slots: M2SlotProfile[];
  sourceNote?: string;
  sourceUrl?: string;
}

export interface M2SlotReviewTemplate {
  generatedAt: string;
  filter: M2CoverageFilter;
  offset: number;
  limit: number;
  items: M2SlotReviewTemplateItem[];
}

export type RgbDeviceVoltage = "5V" | "12V" | "mixed";

export type GpuVendor = "nvidia" | "amd" | "intel";

export type MemoryProfile = "XMP" | "EXPO";

export type RadiatorMountPosition = "front" | "top" | "bottom" | "side" | "rear";

export interface RadiatorSupport {
  position: RadiatorMountPosition;
  sizesMm: number[];
}

export interface PartSpecs {
  socket?: string;
  supportedSockets?: string[];
  memoryType?: string;
  memoryProfiles?: MemoryProfile[];
  memoryFormFactor?: "DIMM" | "SO-DIMM";
  memoryModuleCountPerKit?: number;
  memoryTiming?: string;
  memoryCasLatency?: number;
  memoryEffectiveLatencyNs?: number;
  memoryRcdLatency?: number;
  memoryTrpLatency?: number;
  memoryTrasLatency?: number;
  memoryVoltageV?: number;
  cores?: number;
  threads?: number;
  boostClockGhz?: number;
  cinebenchR23Single?: number;
  cinebenchR23Multi?: number;
  benchmarkProvenance?: BenchmarkProvenance;
  maxMemoryGb?: number;
  memorySlots?: number;
  maxMemorySpeedMhz?: number;
  speedMhz?: number;
  capacityGb?: number;
  sequentialReadMbps?: number;
  sequentialWriteMbps?: number;
  ssdController?: string;
  ssdNandType?: string;
  ssdTbwTb?: number;
  ssdReadIops?: number;
  ssdWriteIops?: number;
  tdpW?: number;
  pptW?: number;
  integratedGraphics?: boolean;
  vrmCapacityW?: number;
  m2Slots?: number;
  m2Interfaces?: Array<"NVMe" | "SATA">;
  m2PcieGenerations?: number[];
  m2PcieGeneration?: number;
  m2SlotProfiles?: M2SlotProfile[];
  pcieX16Slots?: number;
  pcieX8Slots?: number;
  pcieSlotWidth?: number;
  pciePowerOptions?: PciePowerRequirement[][];
  pciePowerAdapterOptions?: PciePowerRequirement[][];
  pciePowerConnectors?: Partial<Record<PciePowerConnectorKind, number>>;
  m2LaneSharing?: boolean;
  m2LaneSharingScopes?: M2LaneSharingScope[];
  m2LaneSharingNote?: string;
  sataPorts?: number;
  interface?: string;
  formFactor?: string;
  powerW?: number;
  recommendedPsuW?: number;
  vramGb?: number;
  gpuVendor?: GpuVendor;
  gpuArchitectureFamily?: string;
  gpuMemoryType?: string;
  gpuBoostClockMhz?: number;
  gpuStreamProcessors?: number;
  gpuMemoryBandwidthGbps?: number;
  gpu3dmarkTimeSpyScore?: number;
  gpu3dmarkPortRoyalScore?: number;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  gpuSlotOccupancy?: number;
  gpuCableBendClearanceMm?: number;
  /** Runtime-only provenance applied from the physical review store. */
  physicalEvidenceSourceNote?: string;
  physicalEvidenceSourceUrl?: string;
  physicalEvidenceManufacturerModel?: string;
  physicalEvidenceManufacturerRevision?: string;
  physicalEvidenceUpdatedAt?: string;
  /** Runtime-only source URL reachability and model identity check. */
  physicalEvidenceSourceCheck?: PhysicalSourceCheck;
  maxGpuLengthMm?: number;
  maxCoolerHeightMm?: number;
  maxPsuLengthMm?: number;
  coolerType?: "air" | "liquid";
  radiatorSizeMm?: number;
  radiatorSizesMm?: number[];
  radiatorPosition?: RadiatorMountPosition;
  radiatorSupports?: RadiatorSupport[];
  hddBays?: number;
  ssdBays?: number;
  supportedFormFactors?: string[];
  maxCoolingW?: number;
  wattageW?: number;
  psuDepthMm?: number;
  efficiency?: string;
  psuFormFactor?: string;
  psuCableType?: "fixed" | "semi_modular" | "fully_modular";
  psuRailType?: "single" | "multi";
  psuIndependentPcieCableRuns?: number;
  psuPcieCableTopology?: "independent" | "shared";
  caseSidePanelClearanceMm?: number;
  motherboardFormFactors?: string[];
  supportedPsuFormFactors?: string[];
  coolerIncluded?: boolean;
  fanCount?: number;
  fanCurrentA?: number;
  fanLoadProvenance?: FanLoadProvenance;
  fanPortCount?: number;
  rgbPortCount?: number;
  rgb5vPortCount?: number;
  rgb12vPortCount?: number;
  rgbDeviceCount?: number;
  rgbDeviceVoltage?: RgbDeviceVoltage;
  /** Per RGB/ARGB/LED device load, only when an explicit source value exists. */
  rgbDeviceCurrentA?: number;
  rgbDevicePowerW?: number;
  rgbDeviceLoadProvenance?: RgbDeviceLoadProvenance;
  rgbControllerIncluded?: boolean;
  outputW?: number;
  capacityVa?: number;
  outletCount?: number;
  capacityG?: number;
  thermalConductivityWmK?: number;
}

export interface Part {
  id: string;
  category: PartCategory;
  name: string;
  brand?: string;
  model?: string;
  imageUrl?: string;
  danawaUrl?: string;
  source: "seed" | "danawa" | "manual";
  sourceProductCode?: string;
  sourceCategoryId?: string;
  listingType?: ListingType;
  priceWon?: number;
  rawSpecText?: string;
  specs: PartSpecs;
  dataQuality: DataQuality;
  missingFields: string[];
  updatedAt: string;
  /** Runtime-only freshness classification added by catalog API responses. */
  dataFreshness?: DataFreshness;
}

export interface PartRefreshResponse {
  part: Part;
  previousDataQuality: DataQuality;
  previousMissingFields: string[];
  changedFields: string[];
  refreshedAt: string;
}

export interface AccessoryRefreshResponse {
  item: AccessoryItem;
  previousDataQuality: DataQuality;
  previousMissingFields: string[];
  changedFields: string[];
  refreshedAt: string;
}

export type CatalogChangeKind = "part" | "accessory";

export interface CatalogChangeValueDiff {
  field: string;
  previous?: string;
  next?: string;
}

export interface CatalogChangeRecord {
  id: string;
  kind: CatalogChangeKind;
  itemId: string;
  itemName: string;
  category: PartCategory | AccessoryCategory;
  sourceProductCode?: string;
  changedAt: string;
  changedFields: string[];
  previousDataQuality: DataQuality;
  nextDataQuality: DataQuality;
  previousMissingFields: string[];
  nextMissingFields: string[];
  previousPriceWon?: number;
  nextPriceWon?: number;
  priceDeltaWon?: number;
  valueDiffs?: CatalogChangeValueDiff[];
}

export interface CatalogChangeSummary {
  inspectedProducts: number;
  changedProducts: number;
  priceChangedProducts: number;
  qualityChangedProducts: number;
  missingFieldChangedProducts: number;
  specChangedProducts: number;
}

export type AlternativeRisk = "safe" | "review" | "unsafe";

export interface AlternativeRiskCounts {
  safe: number;
  review: number;
  unsafe: number;
}

export type CandidateDecisionStatus = "recommended" | "review" | "avoid";

export interface CandidateDecisionSummary {
  status: CandidateDecisionStatus;
  label: string;
  summary: string;
  reasons: string[];
}

export type ValueLabel = "가성비 우수" | "가성비 균형" | "가격 대비 낮음";

export interface ValueEvidence {
  scoreScale: 200;
  currentPriceWon: number;
  candidatePriceWon: number;
  priceDeltaWon: number;
  priceChangePercent: number;
  similarityScore: number;
}

export interface CompatiblePartCandidate extends Part {
  /** Runtime-only freshness classification for catalog and candidate views. */
  dataFreshness?: DataFreshness;
  /** Runtime-only one-glance decision guidance for a compatibility candidate. */
  decision?: CandidateDecisionSummary;
  candidateRisk: AlternativeRisk;
  candidateReasons: string[];
  remainingBlockers: number;
  remainingWarnings: number;
  remainingUnknown: number;
  recommendedQuantity?: number;
  similarityScore?: number;
  similarityLabel?: "동급" | "유사" | "대안";
  similarityEvidence?: SimilarityEvidence;
  performanceSummary?: string;
  valueScore?: number;
  valueLabel?: ValueLabel;
  valueEvidence?: ValueEvidence;
  recommendationTrust?: RecommendationTrustEvidence;
  physicalEvidence?: PhysicalEvidenceSummary;
}

export const ACCESSORY_CATEGORIES = [
  "storage_accessory",
  "cooling_fan",
  "thermal_grease",
  "m2_heatsink",
  "gpu_support",
  "gpu_cooler",
  "memory_cooler",
  "thermal_pad",
  "fan_hub",
  "ups"
] as const;

export type AccessoryCategory = (typeof ACCESSORY_CATEGORIES)[number];

export const ACCESSORY_CATEGORY_LABELS: Record<AccessoryCategory, string> = {
  storage_accessory: "저장장치 주변기기",
  cooling_fan: "쿨링팬",
  thermal_grease: "써멀그리스",
  m2_heatsink: "M.2 SSD 방열판",
  gpu_support: "그래픽카드 지지대",
  gpu_cooler: "그래픽카드 쿨러",
  memory_cooler: "RAM 쿨러",
  thermal_pad: "써멀패드",
  fan_hub: "팬 허브·컨트롤러",
  ups: "UPS"
};

export type AccessoryPriceFilter = "all" | "priced" | "under_10000" | "10000_50000" | "over_50000";

export const ACCESSORY_PRICE_FILTER_LABELS: Record<AccessoryPriceFilter, string> = {
  all: "전체 가격",
  priced: "가격 확인 상품만",
  under_10000: "1만원 이하",
  "10000_50000": "1~5만원",
  over_50000: "5만원 초과"
};

export interface AccessoryItem {
  id: string;
  category: AccessoryCategory;
  name: string;
  brand?: string;
  model?: string;
  imageUrl?: string;
  danawaUrl?: string;
  source: "danawa" | "manual";
  sourceProductCode?: string;
  sourceCategoryId?: string;
  listingType: "accessory";
  priceWon?: number;
  rawSpecText?: string;
  specs: PartSpecs;
  dataQuality: DataQuality;
  missingFields: string[];
  updatedAt: string;
  /** Runtime-only freshness classification added by accessory API responses. */
  dataFreshness?: DataFreshness;
}

export type DataFreshness = "fresh" | "aging" | "stale" | "unknown";

export const DATA_FRESHNESS_LABELS: Record<DataFreshness, string> = {
  fresh: "최근 확인",
  aging: "갱신 권장",
  stale: "오래된 정보",
  unknown: "시점 확인 필요"
};

export type RecommendationTrustLevel = "high" | "medium" | "low";

export type RecommendationTrustFilter = "all" | "medium_plus" | "high";

export interface RecommendationTrustEvidence {
  level: RecommendationTrustLevel;
  score: number;
  compatibility: "verified" | "review";
  candidateBlockerCount: number;
  candidateWarningCount: number;
  candidateUnknownCount: number;
  fullBuildStatus: "clean" | "remaining_issues";
  remainingBlockerCount: number;
  remainingWarningCount: number;
  remainingUnknownCount: number;
  freshness: DataFreshness;
  dataQuality: DataQuality;
  comparedDimensions: number;
  totalDimensions: number;
  missingFieldCount: number;
  priceKnown: boolean;
  sourceAvailable: boolean;
  benchmarkBacked: boolean;
  benchmarkSourceKind?: BenchmarkSourceKind;
  reasons: string[];
}

export interface BuildDataHealthItem {
  id: string;
  name: string;
  category: PartCategory | AccessoryCategory;
  dataQuality: DataQuality;
  missingFields: string[];
  priceKnown: boolean;
  updatedAt?: string;
  freshness: DataFreshness;
}

export interface BuildDataHealth {
  selectedCount: number;
  selectedQuantity: number;
  freshCount: number;
  agingCount: number;
  staleCount: number;
  unknownFreshnessCount: number;
  incompleteCount: number;
  unpricedCount: number;
  oldestUpdatedAt?: string;
  overall: "verified" | "mixed" | "needs_refresh";
  items: BuildDataHealthItem[];
}

export interface AccessoryRecommendation {
  id: string;
  category: AccessoryCategory;
  item: AccessoryItem;
  priority: "recommended" | "optional";
  confidence: "high" | "medium" | "low";
  reason: string;
  fitBasis: string;
}

export function isKnownPrice(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export interface PartSelection {
  partId: string;
  quantity: number;
}

export interface AccessorySelection {
  accessoryId: string;
  quantity: number;
  targetPartId?: string;
  targetAccessoryId?: string;
}

export interface BuildSelection {
  cpu?: PartSelection;
  cooler?: PartSelection;
  motherboard?: PartSelection;
  memory: PartSelection[];
  gpu?: PartSelection;
  ssd: PartSelection[];
  hdd: PartSelection[];
  case?: PartSelection;
  psu?: PartSelection;
  accessories?: AccessorySelection[];
  m2SlotSelection?: Record<string, string>;
  rgbControllerAccessoryId?: string;
  useIntegratedGraphics: boolean;
}

export interface BuildGenerationRequest {
  profile: RecommendationProfile;
  budgetWon: number;
  includeGpu: boolean;
  priority?: RecommendationPriority;
  gamingResolution?: GamingResolution;
  gamingRefreshRate?: GamingRefreshRate;
  memoryCapacityGb?: number;
  storageCapacityGb?: number;
  hddCapacityGb?: number;
  hddCount?: number;
  includeNonRetail?: boolean;
  listingPolicy?: ListingPolicy;
}

export interface BuildGenerationDiagnosticFact {
  label: string;
  value: string;
}

export interface BuildGenerationDiagnostic {
  id: string;
  title: string;
  summary: string;
  facts: BuildGenerationDiagnosticFact[];
  recommendation?: string;
}

export interface BuildGenerationRecoveryOption {
  id: string;
  label: string;
  summary: string;
  changedFields: string[];
  request: BuildGenerationRequest;
  preview: {
    totalPriceWon: number;
    budgetDeltaWon: number;
    withinBudget: boolean;
    priceComplete: boolean;
    status: BuildGenerationResult["status"];
    blockerCount: number;
    warningCount: number;
    unknownCount: number;
  };
}

export interface GeneratedBuildLine {
  category: PartCategory;
  partId: string;
  name: string;
  quantity: number;
  priceWon: number;
  specSummary?: string;
}

export interface BuildGenerationResult {
  selection: BuildSelection;
  profile: RecommendationProfile;
  priority: RecommendationPriority;
  gamingResolution: GamingResolution;
  gamingRefreshRate: GamingRefreshRate;
  memoryCapacityGb: number;
  gpuTarget?: GpuTargetEvidence;
  analysis?: BuildAnalysis;
  budgetWon: number;
  includeNonRetail: boolean;
  listingPolicy: ListingPolicy;
  storageCapacityGb: number;
  hddCapacityGb?: number;
  hddCount: number;
  totalPriceWon: number;
  budgetDeltaWon: number;
  withinBudget: boolean;
  priceComplete: boolean;
  status: "compatible" | "incompatible" | "needs_review";
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  lines: GeneratedBuildLine[];
  rationale: string[];
  warnings: string[];
}

export type FindingSeverity = "blocker" | "warning" | "unknown" | "info";

export type FindingActionType = "replace_part" | "change_quantity" | "verify_spec";

export interface FindingFact {
  label: string;
  actual?: string;
  expected?: string;
}

export interface FindingAction {
  type: FindingActionType;
  targetCategory?: PartCategory;
  label: string;
}

export type AccessoryCompatibilityStatus = "compatible" | "incompatible" | "needs_review";

export type AccessoryCompatibilitySeverity = "blocker" | "warning" | "unknown";

export type AccessoryConnectivityPlanStatus = "pass" | "review" | "blocked";

export type AccessoryPowerRailRole = "fan" | "rgb" | "shared" | "unknown";

export interface AccessoryPowerRail {
  voltage: "5V" | "12V";
  maxPowerW?: number;
  maxCurrentA?: number;
  role: AccessoryPowerRailRole;
}

export interface AccessoryConnectivityPlanFan {
  accessoryId: string;
  name: string;
  quantity: number;
  unitCount: number;
  totalFanCount: number;
  connectorTypes: string[];
  currentA?: number;
  currentProvenance?: FanLoadProvenance;
}

export interface AccessoryConnectivityPlanPortAssignment {
  accessoryId: string;
  name: string;
  portStart: number;
  portEnd: number;
  fanCount: number;
}

export interface AccessoryConnectivityPlan {
  id: string;
  hubId: string;
  hubName: string;
  hubFanOutputs: string[];
  hubFanPortCount?: number;
  externalPower?: string;
  maxFanCurrentA?: number;
  powerRails?: AccessoryPowerRail[];
  fanCount: number;
  assignedFanCount?: number;
  unassignedFanCount?: number;
  unassignedFanNames?: string[];
  portAssignments: AccessoryConnectivityPlanPortAssignment[];
  portStatus: AccessoryConnectivityPlanStatus;
  portIssue: "none" | "unknown" | "over_limit";
  totalCurrentA?: number;
  currentHeadroomA?: number;
  connectorStatus: AccessoryConnectivityPlanStatus;
  currentStatus: AccessoryConnectivityPlanStatus;
  status: AccessoryConnectivityPlanStatus;
  connectorIssue: "none" | "unknown" | "molex_mismatch" | "control_mode";
  currentIssue: "none" | "unknown" | "over_limit";
  fans: AccessoryConnectivityPlanFan[];
  summary: string;
}

export interface AccessoryFanHubTargetCandidate {
  hubId: string;
  hubName: string;
  status: AccessoryConnectivityPlanStatus;
  score: number;
  portHeadroom?: number;
  connectorStatus: AccessoryConnectivityPlanStatus;
  currentStatus: AccessoryConnectivityPlanStatus;
  externalPower?: string;
  reason: string;
}

export interface AccessoryFanHubTargetRecommendation {
  fanId: string;
  fanName: string;
  fanCount: number;
  recommendedHubId?: string;
  suggestedHubId?: string;
  candidates: AccessoryFanHubTargetCandidate[];
  summary: string;
}

export interface AccessoryRgbConnectionPlan {
  id: string;
  controllerId: string;
  controllerName: string;
  controllerOutputs: string[];
  externalPower?: string;
  deviceCount: number;
  caseDeviceCount?: number;
  additionalFanDeviceCount?: number;
  devices?: Array<{
    id: string;
    name: string;
    kind: "case" | "cooling_fan";
    count: number;
    voltage?: "5V" | "12V" | "mixed";
  }>;
  deviceVoltage?: string;
  requiredVoltages: string[];
  outputCount?: number;
  powerRails?: AccessoryPowerRail[];
  rgbLoadStatus: "known" | "unknown" | "over_limit";
  rgbPerDeviceCurrentA?: number;
  rgbPerDevicePowerW?: number;
  rgbTotalCurrentA?: number;
  rgbTotalPowerW?: number;
  rgbCurrentHeadroomA?: number;
  rgbPowerHeadroomW?: number;
  rgbLoadProvenance?: RgbDeviceLoadProvenance;
  status: AccessoryConnectivityPlanStatus;
  issue: "none" | "unknown" | "voltage_mismatch" | "output_shortage" | "power_unknown" | "rgb_load_unknown" | "rgb_capacity_unknown" | "rgb_power_over_limit";
  summary: string;
}

export interface AccessoryCompatibilityFinding {
  id: string;
  ruleId: string;
  severity: AccessoryCompatibilitySeverity;
  accessoryId: string;
  accessoryName: string;
  relatedPartIds: string[];
  title: string;
  message: string;
  facts: FindingFact[];
  action?: string;
}

export interface AccessoryCompatibilityResult {
  status: AccessoryCompatibilityStatus;
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  findings: AccessoryCompatibilityFinding[];
  connectionPlans?: AccessoryConnectivityPlan[];
  fanHubTargetRecommendations?: AccessoryFanHubTargetRecommendation[];
  rgbConnectionPlans?: AccessoryRgbConnectionPlan[];
}

export type SimilarityConfidence = "high" | "limited" | "unknown";

export type SimilarityBasis = "benchmark" | "spec" | "mixed";

export interface SimilarityDimensionEvidence {
  key: string;
  label: string;
  currentValue: string;
  candidateValue: string;
  score: number;
  weight: number;
}

export interface SimilarityEvidence {
  comparedDimensions: number;
  totalDimensions: number;
  confidence: SimilarityConfidence;
  basis?: SimilarityBasis;
  dimensions?: SimilarityDimensionEvidence[];
  notes?: string[];
}

export type PhysicalEvidenceStatus = "verified" | "review" | "not_applicable";

export interface PhysicalEvidenceSource {
  category: PhysicalOverrideCategory;
  note: string;
  manufacturerModel?: string;
  manufacturerRevision?: string;
  updatedAt?: string;
  sourceCheck?: PhysicalSourceCheck;
  url?: string;
}

export interface PhysicalEvidenceSummary {
  status: PhysicalEvidenceStatus;
  summary: string;
  sources?: PhysicalEvidenceSource[];
}

export interface Suggestion {
  part: Part;
  recommendedQuantity?: number;
  currentPriceWon?: number;
  score: number;
  reason: string;
  remainingBlockers: number;
  remainingWarnings: number;
  priceDeltaWon?: number;
  fixesCurrentIssue: boolean;
  similarityScore: number;
  similarityLabel: "동급" | "유사" | "대안";
  similarityEvidence: SimilarityEvidence;
  performanceSummary: string;
  profileSummary: string;
  remainingUnknown: number;
  valueScore?: number;
  valueLabel?: ValueLabel;
  valueEvidence?: ValueEvidence;
  recommendationTrust?: RecommendationTrustEvidence;
  physicalEvidence?: PhysicalEvidenceSummary;
}

export interface UpgradeRecommendation {
  category: PartCategory;
  currentPartId: string;
  currentPartName: string;
  quantity: number;
  part: Part;
  upgradeScore: number;
  improvementPercent: number;
  improvedDimensions: string[];
  performanceSummary: string;
  similarityScore: number;
  similarityLabel: "동급" | "유사" | "대안";
  similarityEvidence: SimilarityEvidence;
  currentPriceWon?: number;
  priceDeltaWon?: number;
  gpuTarget?: GpuTargetEvidence;
  compatibilityEvidence: UpgradeCompatibilityEvidence;
  expansionEvidence?: UpgradeExpansionEvidence;
  budgetEvidence?: UpgradeBudgetEvidence;
  reason: string;
  recommendationTrust?: RecommendationTrustEvidence;
  physicalEvidence?: PhysicalEvidenceSummary;
}

export interface UpgradeCompatibilityEvidence {
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  powerHeadroomW?: number;
  coolerHeadroomW?: number;
  gpuClearanceMm?: number;
  coolerClearanceMm?: number;
  psuClearanceMm?: number;
  memoryHeadroomGb?: number;
  memorySlotHeadroom?: number;
  m2Headroom?: number;
  sataHeadroom?: number;
  hddBayHeadroom?: number;
}

export interface UpgradeExpansionEvidence {
  baselineScore?: number;
  candidateScore?: number;
  scoreDelta?: number;
  baselineKnownDimensionCount: number;
  baselineTotalDimensionCount: number;
  candidateKnownDimensionCount: number;
  candidateTotalDimensionCount: number;
  baselineLevel: "complete" | "limited" | "unavailable";
  candidateLevel: "complete" | "limited" | "unavailable";
  baselineSummary: string;
  candidateSummary: string;
}

export interface UpgradeBudgetEvidence {
  budgetWon: number;
  currentCoreTotalPriceWon?: number;
  afterCoreTotalPriceWon?: number;
  budgetDeltaWon?: number;
  withinBudget?: boolean;
  priceComplete: boolean;
}

export interface UpgradeBundleRecommendation {
  changes: UpgradeRecommendation[];
  totalUpgradeScore: number;
  totalImprovementPercent: number;
  totalPriceDeltaWon?: number;
  expansionEvidence?: UpgradeExpansionEvidence;
  budgetEvidence?: UpgradeBudgetEvidence;
  compatibilityEvidence: Pick<UpgradeCompatibilityEvidence, "blockerCount" | "warningCount" | "unknownCount">;
  reason: string;
}

export interface UpgradeBundleChangeReference {
  category: PartCategory;
  partId: string;
}

export type UpgradeBundlePartSummary = Omit<Part, "specs" | "rawSpecText">;

export type UpgradeBundleCandidatePayload = Omit<UpgradeRecommendation, "part"> & {
  part: UpgradeBundlePartSummary;
};

export type UpgradeBundleTransportItem = Omit<UpgradeBundleRecommendation, "changes"> & {
  id: string;
  changes: UpgradeBundleChangeReference[];
};

export interface UpgradeBundlePayload {
  version: 1;
  candidates: UpgradeBundleCandidatePayload[];
  bundles: UpgradeBundleTransportItem[];
}

export interface UpgradeBundleSearchSummary {
  candidateCount: number;
  candidateCategoryCount: number;
  candidatePairCount: number;
  evaluatedPairCount: number;
  candidateTripleCount?: number;
  evaluatedTripleCount?: number;
  beamWidth?: number;
  safeBundleCount: number;
  returnedBundleCount: number;
}

export type RecommendationChangeKind = "replace_part" | "change_quantity";

export interface RecommendationChange {
  kind: RecommendationChangeKind;
  category: PartCategory;
  fromPartId?: string;
  fromPartName?: string;
  toPart: Part;
  fromQuantity?: number;
  toQuantity?: number;
  priceDeltaWon?: number;
  similarityScore: number;
  similarityLabel: "동급" | "유사" | "대안";
  similarityEvidence?: SimilarityEvidence;
  performanceSummary: string;
  valueScore?: number;
  valueLabel?: ValueLabel;
  valueEvidence?: ValueEvidence;
  recommendationTrust?: RecommendationTrustEvidence;
  physicalEvidence?: PhysicalEvidenceSummary;
}

export interface RecommendationPlan {
  title: string;
  label: "최소 변경" | "가성비" | "성능 유지" | "완전 호환";
  changes: RecommendationChange[];
  resolvedFindings: number;
  resolvedFindingTitles: string[];
  remainingFindingTitles?: string[];
  remainingFindingRuleIds?: string[];
  resolvedBlockers: number;
  resolvedUnknown: number;
  remainingBlockers: number;
  remainingWarnings: number;
  remainingUnknown: number;
  afterTotalPriceWon: number;
  priceDeltaWon?: number;
  budgetWon?: number;
  budgetDeltaWon?: number;
  withinBudget?: boolean;
  priceComplete: boolean;
  similarityScore: number;
  similarityLabel: "동급" | "유사" | "대안";
  similarityEvidence?: SimilarityEvidence;
  reason: string;
  profileSummary: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: FindingSeverity;
  title: string;
  message: string;
  affectedPartIds: string[];
  facts: FindingFact[];
  actions: FindingAction[];
  suggestions?: Suggestion[];
}

export interface BuildMetrics {
  totalMemoryGb?: number;
  memoryHeadroomGb?: number;
  memorySlotsUsed?: number;
  memorySlotsTotal?: number;
  memorySlotHeadroom?: number;
  m2Used?: number;
  m2SlotsTotal?: number;
  m2Headroom?: number;
  sataUsed?: number;
  sataPortsTotal?: number;
  sataHeadroom?: number;
  hddUsed?: number;
  hddBaysTotal?: number;
  hddBayHeadroom?: number;
  cpuPowerW?: number;
  gpuPowerW?: number;
  recommendedPsuW?: number;
  psuWattageW?: number;
  powerHeadroomW?: number;
  coolerCapacityW?: number;
  coolerHeadroomW?: number;
  gpuLengthMm?: number;
  gpuThicknessMm?: number;
  maxGpuLengthMm?: number;
  psuDepthMm?: number;
  maxPsuLengthMm?: number;
  psuClearanceMm?: number;
  gpuClearanceMm?: number;
  coolerHeightMm?: number;
  maxCoolerHeightMm?: number;
  coolerClearanceMm?: number;
  m2SlotAssignments?: M2SlotAssignment[];
  m2SlotAssignmentMode?: "automatic" | "manual";
}

export interface M2SlotAssignment {
  slotId: string;
  partId: string;
  partName: string;
  interface?: "NVMe" | "SATA";
  ssdPcieGeneration?: number;
  slotPcieGeneration?: number;
  linkGeneration?: number;
  connection?: M2SlotConnectionType;
  sharedWith?: string[];
}

export type BuildAnalysisConfidence = "high" | "limited" | "unknown";

export interface BuildAnalysisFactor {
  category: PartCategory;
  label: string;
  score?: number;
  weight: number;
  basis: string;
}

export type BuildAnalysisBalanceStatus = "balanced" | "cpu_limited" | "gpu_limited";

export interface BuildAnalysisBalance {
  cpuScore: number;
  gpuScore: number;
  gap: number;
  status: BuildAnalysisBalanceStatus;
  summary: string;
}

export interface BuildAnalysisInsight {
  category: PartCategory;
  score: number;
  title: string;
  summary: string;
}

export interface BuildBottleneck {
  id: string;
  severity: "critical" | "warning" | "info";
  category?: PartCategory;
  title: string;
  message: string;
  actual?: string;
  limit?: string;
  action?: string;
}

export interface BuildAnalysis {
  profile: RecommendationProfile;
  overallScore?: number;
  scoreLabel: "상위권" | "균형형" | "보완 권장" | "계산 불가";
  scoreBasis: string;
  confidence: BuildAnalysisConfidence;
  factors: BuildAnalysisFactor[];
  balance?: BuildAnalysisBalance;
  strengths: BuildAnalysisInsight[];
  focusAreas: BuildAnalysisInsight[];
  bottlenecks: BuildBottleneck[];
  nextActions: string[];
  gpuTarget?: GpuTargetEvidence;
}

export type CompatibilityLinkStatus = "compatible" | "issue" | "unknown" | "not_applicable";

export interface CompatibilityLink {
  id: string;
  fromCategory: PartCategory;
  toCategory: PartCategory;
  label: string;
  status: CompatibilityLinkStatus;
  ruleIds: string[];
  summary: string;
}

export type RecommendationSearchMode = "exhaustive" | "bounded";

export interface RecommendationSearchSummary {
  mode: RecommendationSearchMode;
  candidateSetCount: number;
  candidateCount: number;
  evaluatedCandidateCount: number;
  maxEvaluatedCandidatesPerSet: number;
}

export interface CompatibilityResult {
  status: "compatible" | "incompatible" | "needs_review";
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  findings: Finding[];
  repairPlans?: RecommendationPlan[];
  recommendationPreferences?: RecommendationPreferences;
  recommendationSearch?: RecommendationSearchSummary;
  metrics: BuildMetrics;
  analysis: BuildAnalysis;
  dataHealth?: BuildDataHealth;
  gpuFit?: import("./gpu-fit").GpuFitSummary;
  accessoryCompatibility?: AccessoryCompatibilityResult;
  accessoryRecommendations?: AccessoryRecommendation[];
  upgradeRecommendations?: UpgradeRecommendation[];
  upgradeBundles?: UpgradeBundleRecommendation[];
  upgradeBundlePayload?: UpgradeBundlePayload;
  upgradeBundleSearch?: UpgradeBundleSearchSummary;
  coreTotalPriceWon?: number;
  corePriceComplete?: boolean;
  accessoryTotalPriceWon?: number;
  accessoryPriceComplete?: boolean;
  links: CompatibilityLink[];
  totalPriceWon: number;
  priceComplete: boolean;
  engineVersion: string;
  catalogSnapshotAt: string;
  checkedAt: string;
}

export interface SavedBuildCheckFindingSummary {
  id: string;
  ruleId: string;
  severity: FindingSeverity;
  title: string;
  message: string;
  affectedPartIds: string[];
  facts: FindingFact[];
}

export interface SavedBuildAccessoryFindingSummary {
  id: string;
  ruleId: string;
  severity: AccessoryCompatibilitySeverity;
  accessoryId: string;
  accessoryName: string;
  relatedPartIds: string[];
  title: string;
  message: string;
  facts: FindingFact[];
  action?: string;
}

export interface SavedBuildAccessoryCompatibilitySnapshot {
  status: AccessoryCompatibilityStatus;
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  findings?: SavedBuildAccessoryFindingSummary[];
}

export interface SavedBuildCheckSnapshot {
  status: CompatibilityResult["status"];
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  totalPriceWon: number;
  priceComplete: boolean;
  coreTotalPriceWon: number;
  corePriceComplete: boolean;
  accessoryTotalPriceWon: number;
  accessoryPriceComplete: boolean;
  accessoryCompatibility?: SavedBuildAccessoryCompatibilitySnapshot;
  findings?: SavedBuildCheckFindingSummary[];
  analysisScore?: number;
  analysisScoreLabel: BuildAnalysis["scoreLabel"];
  analysisConfidence: BuildAnalysis["confidence"];
  actionCenterState?: "blocked" | "review" | "ready";
  actionCenterSummary?: string;
  actionCenterTotalCount?: number;
  assemblyVerification?: import("./assembly-verification").AssemblyVerificationSavedSnapshot;
  assemblyVerificationHistory?: import("./assembly-verification").AssemblyVerificationSavedSnapshot[];
  engineVersion: string;
  catalogSnapshotAt: string;
  checkedAt: string;
}

export interface SavedBuild {
  id: string;
  name: string;
  selection: BuildSelection;
  recommendationPreferences?: RecommendationPreferences;
  versionGroupId?: string;
  versionNumber?: number;
  derivedFromBuildId?: string;
  summary?: SavedBuildSummary;
  checkSnapshot?: SavedBuildCheckSnapshot;
  checkHistory?: SavedBuildCheckSnapshot[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface SavedBuildCoreLineSummary {
  category: PartCategory;
  name: string;
  quantity: number;
}

export interface SavedBuildAccessoryLineSummary {
  category?: AccessoryCategory;
  name: string;
  quantity: number;
}

export interface SavedBuildSummary {
  totalPriceWon: number;
  coreTotalPriceWon: number;
  accessoryTotalPriceWon: number;
  priceComplete: boolean;
  accessoryCount: number;
  accessoryQuantity: number;
  coreLines: SavedBuildCoreLineSummary[];
  accessoryLines: SavedBuildAccessoryLineSummary[];
}

export interface CrawlStatus {
  status: "idle" | "running" | "completed" | "failed";
  mode: "sample" | "all";
  startedAt?: string;
  finishedAt?: string;
  categoriesCompleted: number;
  categoriesTotal: number;
  pagesVisited: number;
  pagesExpected: number;
  listedProducts: number;
  productsSeen: number;
  productsUpdated: number;
  detailFetched: number;
  detailFailed: number;
  failedProducts: number;
  missingProducts: number;
  incompleteSpecs: number;
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  changeSummary?: CatalogChangeSummary;
  manifestPath?: string;
  workerPid?: number;
  message?: string;
  error?: string;
}

export interface CrawlCategoryReport {
  category: PartCategory;
  categoryId: string;
  pagesExpected: number;
  pagesVisited: number;
  listedProducts: number;
  uniqueProducts: number;
  detailFetched: number;
  detailFailed: number;
  missingProducts: number;
  incompleteSpecs: number;
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  error?: string;
}

export interface CrawlManifest {
  mode: "sample" | "all";
  startedAt: string;
  finishedAt?: string;
  generatedAt: string;
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  totalExpectedProducts: number;
  totalUniqueProducts: number;
  totalDetailFetched: number;
  totalDetailFailed: number;
  totalMissingProducts: number;
  totalIncompleteSpecs: number;
  changeSummary?: CatalogChangeSummary;
  categories: CrawlCategoryReport[];
}

export interface AccessoryCrawlStatus {
  status: "idle" | "running" | "completed" | "failed";
  mode: "sample" | "all";
  details: boolean;
  onlyIncomplete: boolean;
  category?: AccessoryCategory;
  startedAt?: string;
  finishedAt?: string;
  categoriesCompleted: number;
  categoriesTotal: number;
  pagesVisited: number;
  pagesExpected: number;
  listedProducts: number;
  productsSeen: number;
  expectedProducts: number;
  productsUpdated: number;
  detailFetched: number;
  detailFailed: number;
  missingProducts: number;
  incompleteSpecs: number;
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  changeSummary?: CatalogChangeSummary;
  manifestPath?: string;
  workerPid?: number;
  message?: string;
  error?: string;
}

export interface AccessoryCrawlCategoryReport {
  category: AccessoryCategory;
  categoryId: string;
  totalProductCount?: number;
  offset?: number;
  requestedLimit?: number;
  pagesExpected: number;
  pagesVisited: number;
  listedProducts: number;
  uniqueProducts: number;
  detailFetched: number;
  detailFailed: number;
  missingProducts: number;
  incompleteSpecs: number;
  listCoverage: "partial" | "complete";
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
}

export interface AccessoryCrawlManifest {
  mode: "sample" | "all";
  details: boolean;
  onlyIncomplete: boolean;
  category?: AccessoryCategory;
  startedAt: string;
  finishedAt?: string;
  generatedAt: string;
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  totalExpectedProducts: number;
  totalUniqueProducts: number;
  totalDetailFetched: number;
  totalDetailFailed: number;
  totalMissingProducts: number;
  totalIncompleteSpecs: number;
  changeSummary?: CatalogChangeSummary;
  categories: AccessoryCrawlCategoryReport[];
}

export interface AccessoryCoverageLastRun {
  mode: "sample" | "all";
  details: boolean;
  onlyIncomplete: boolean;
  offset?: number;
  requestedLimit?: number;
  pagesExpected: number;
  pagesVisited: number;
  listedProducts: number;
  uniqueProducts: number;
  detailFetched: number;
  detailFailed: number;
  missingProducts: number;
  incompleteSpecs: number;
  listCoverage: "partial" | "complete";
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  completedAt: string;
}

export interface AccessoryCategoryCoverage {
  category: AccessoryCategory;
  categoryId: string;
  totalProductCount?: number;
  storedProductCount: number;
  liveProducts: number;
  incompleteProducts: number;
  pricedProducts: number;
  pagesExpected: number;
  pagesVisited: number;
  listedProducts: number;
  uniqueProducts: number;
  detailFetched: number;
  detailFailed: number;
  missingProducts: number;
  incompleteSpecs: number;
  listCoverage: "partial" | "complete";
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  storedSpecCoverage: "partial" | "complete";
  mode: "sample" | "all";
  details: boolean;
  onlyIncomplete: boolean;
  lastCrawledAt: string;
  lastRun?: AccessoryCoverageLastRun;
}

export interface AccessoryCoverageSnapshot {
  updatedAt: string;
  categories: AccessoryCategoryCoverage[];
}

export interface CatalogBenchmarkCoverage {
  cpu: {
    total: number;
    cinebenchR23Single: number;
    cinebenchR23Multi: number;
    cinebenchR23Complete: number;
  };
  gpu: {
    total: number;
    threeDMarkTimeSpy: number;
    threeDMarkPortRoyal: number;
    threeDMarkComplete: number;
  };
  sourceCoverage: {
    cpu: BenchmarkSourceCoverage;
    gpu: BenchmarkSourceCoverage;
  };
}

export type BenchmarkScoreKey = "cinebenchR23Single" | "cinebenchR23Multi" | "gpu3dmarkTimeSpyScore" | "gpu3dmarkPortRoyalScore";

export type BenchmarkSourceKind = "official" | "independent_review" | "community_measurement" | "other";

export const BENCHMARK_SOURCE_KIND_LABELS: Record<BenchmarkSourceKind, string> = {
  official: "제조사·공식 측정표",
  independent_review: "독립 리뷰·벤치마크 DB",
  community_measurement: "사용자 실측",
  other: "기타·출처 유형 미분류"
};

export type BenchmarkSourceCoverageKey = BenchmarkSourceKind | "unclassified";

export interface BenchmarkSourceCoverage {
  benchmarked: number;
  complete: number;
  official: number;
  independent_review: number;
  community_measurement: number;
  other: number;
  unclassified: number;
}

export interface BenchmarkProvenance {
  sourceKind: BenchmarkSourceKind;
  sourceNote: string;
  sourceUrl?: string;
  updatedAt: string;
}

export type BenchmarkOverrideOperation = "create" | "update" | "unchanged";

export interface PersistenceDiagnostics {
  databaseConfigured: boolean;
  storageMode: "postgres" | "file";
  fallbackReason?: "database_unavailable";
}

export interface BenchmarkOverride {
  partId: string;
  scores: Partial<Record<BenchmarkScoreKey, number>>;
  sourceNote: string;
  sourceKind?: BenchmarkSourceKind;
  sourceUrl?: string;
  updatedAt: string;
}

export type BenchmarkReviewStatus = "missing" | "partial" | "stale";

export interface BenchmarkReviewItem {
  partId: string;
  partName: string;
  category: "cpu" | "gpu";
  status: BenchmarkReviewStatus;
  reviewPriorityScore: number;
  reviewReason: string;
  missingScores: BenchmarkScoreKey[];
  presentScores: Partial<Record<BenchmarkScoreKey, number>>;
  dataQuality: DataQuality;
  missingFields: string[];
  priceKnown: boolean;
  priceWon?: number;
  updatedAt: string;
  benchmarkUpdatedAt?: string;
  benchmarkFreshness: DataFreshness;
  sourceUrl?: string;
  benchmarkSourceKind?: BenchmarkSourceKind;
}

export interface BenchmarkSourceReviewItem {
  partId: string;
  partName: string;
  category: "cpu" | "gpu";
  reviewPriorityScore: number;
  reviewReason: string;
  missingScores: BenchmarkScoreKey[];
  presentScores: Partial<Record<BenchmarkScoreKey, number>>;
  dataQuality: DataQuality;
  missingFields: string[];
  priceKnown: boolean;
  priceWon?: number;
  updatedAt: string;
  benchmarkUpdatedAt?: string;
  benchmarkFreshness: DataFreshness;
  sourceUrl?: string;
  benchmarkSourceKind?: BenchmarkSourceKind;
}

export interface BenchmarkReviewQueue {
  generatedAt: string;
  limit: number;
  items: BenchmarkReviewItem[];
  sourceItems: BenchmarkSourceReviewItem[];
  sourceTotals: {
    cpu: { benchmarked: number; unclassified: number };
    gpu: { benchmarked: number; unclassified: number };
  };
  totals: {
    cpu: { total: number; complete: number; partial: number; missing: number; stale: number };
    gpu: { total: number; complete: number; partial: number; missing: number; stale: number };
  };
}

export interface ServiceMeta {
  catalogCount: number;
  accessoryCount: number;
  accessoryCategoryCounts: Record<AccessoryCategory, number>;
  accessoryQualityCounts: Record<DataQuality, number>;
  accessoryPriceCoverage: {
    priced: number;
    unpriced: number;
  };
  accessoryUpdatedAt: string;
  accessoryCoverage: AccessoryCoverageSnapshot;
  benchmarkCoverage: CatalogBenchmarkCoverage;
  persistence: PersistenceDiagnostics;
  categoryCounts: Record<PartCategory, number>;
  qualityCounts: Record<DataQuality, number>;
  priceCoverage: {
    priced: number;
    unpriced: number;
  };
  catalogUpdatedAt: string;
  crawler: CrawlStatus;
  engineVersion: string;
  storageMode: "postgres" | "file";
  adminAuthEnabled: boolean;
}
