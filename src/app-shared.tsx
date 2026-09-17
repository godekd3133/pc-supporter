// Extracted from App.tsx to keep the entry chunk lean. Loaded lazily.
import { buildCompatibilityInputFingerprint } from "../shared/build-fingerprint";
import type { BuildHistoryEntry } from "../shared/build-history";
import { buildPriceSnapshotFor } from "../shared/build-price-summary";
import type { CandidateApplicationEvidence } from "../shared/candidate-application";
import { catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";
import type { CatalogRefreshReport } from "../shared/catalog-refresh-report";
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import { CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistContains, catalogWatchlistFromJson } from "../shared/catalog-watchlist";
import type { PurchaseListRow } from "../shared/purchase-list";
import { similarityBasisLabelFor, similarityReferenceUsedCategoryFor } from "../shared/similarity-evidence";
import { type AccessoryItem, type AccessorySelection, type BuildSelection, type CompatibilityResult, type M2SlotProfile, type Part, type PartCategory, type PartSelection, type PhysicalEvidenceSource, type RecommendationPlan, type RecommendationPreferences, type SavedBuild, type SimilarityEvidence, type UpgradeBundleRecommendation, ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, DATA_QUALITY_LABELS, isKnownPrice, LISTING_TYPE_LABELS, PART_CATEGORIES } from "../shared/types";
import type { UnknownPriceItem } from "./BuildPriceSummary";
import { CatalogSpecProvenance } from "./CatalogSpecProvenance";
import { RetryAfterButton } from "./RetryAfterButton";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";
import { lazy, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FiBox, FiChevronDown, FiClock, FiCpu, FiDatabase, FiExternalLink, FiHardDrive, FiInfo, FiLoader, FiMonitor, FiRefreshCw, FiServer, FiTool, FiXCircle, FiZap } from "react-icons/fi";

export type SavedBuildOpenFocus = "purchase-list" | { type: "finding"; ruleId: string };

export type PartWatchHandler = (part: Part) => boolean;

export type BuildScenarioPreviewState = {
  status: "loading" | "ready" | "error";
  title: string;
  summary: string;
  category: PartCategory;
  part: Part;
  quantity?: number;
  affectedPartIds: string[];
  nextBuild: BuildSelection;
  candidateEvidence?: CandidateApplicationEvidence;
  result?: CompatibilityResult;
  error?: string;
};

export type CategoryMeta = {
  label: string;
  helper: string;
  required: boolean;
  multiple: boolean;
  Icon: IconType;
};

export const CATEGORY_META: Record<PartCategory, CategoryMeta> = {
  cpu: {
    label: "CPU",
    helper: "프로세서와 소켓 규격을 선택하세요.",
    required: true,
    multiple: false,
    Icon: FiCpu
  },
  cooler: {
    label: "CPU 쿨러",
    helper: "CPU 소켓과 냉각 여유를 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiTool
  },
  motherboard: {
    label: "메인보드",
    helper: "CPU, RAM, 저장장치 슬롯의 기준입니다.",
    required: true,
    multiple: false,
    Icon: FiServer
  },
  memory: {
    label: "RAM",
    helper: "메모리 규격, 총 용량, 슬롯 수를 검사합니다.",
    required: true,
    multiple: true,
    Icon: FiDatabase
  },
  gpu: {
    label: "그래픽카드",
    helper: "전력과 케이스 장착 길이를 검사합니다.",
    required: false,
    multiple: false,
    Icon: FiMonitor
  },
  ssd: {
    label: "SSD",
    helper: "M.2 슬롯과 SATA 포트 사용량을 검사합니다.",
    required: false,
    multiple: true,
    Icon: FiHardDrive
  },
  hdd: {
    label: "HDD",
    helper: "케이스 베이와 SATA 포트 사용량을 검사합니다.",
    required: false,
    multiple: true,
    Icon: FiHardDrive
  },
  case: {
    label: "케이스",
    helper: "메인보드, GPU, 쿨러, 저장장치 공간을 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiBox
  },
  psu: {
    label: "파워서플라이",
    helper: "시스템 전력 공급 여유와 데이터 상태를 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiZap
  }
};

export function formatWon(value: number | undefined) {
  return !isKnownPrice(value) ? "가격 확인 중" : `${value.toLocaleString("ko-KR")}원`;
}

export function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 확인 필요";
  if (value === 0) return "현재와 같은 가격";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

export function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatSpecValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "확인 필요";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "있음" : "없음";
  return String(value);
}

export function partIsWatched(part: Part) {
  if (typeof window === "undefined") return false;
  return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "part", itemId: part.id });
}

export function accessoryIsWatched(item: AccessoryItem) {
  if (typeof window === "undefined") return false;
  return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "accessory", itemId: item.id });
}

export function pciePowerKindLabel(kind: string) {
  if (kind === "12v2x6") return "16핀(12V2x6)";
  if (kind === "12vhpwr") return "16핀(12VHPWR)";
  if (kind === "pcie_8pin_6plus2") return "8핀(6+2)";
  if (kind === "pcie_6pin") return "6핀";
  return kind;
}

export function formatPciePowerOptions(options: Array<Array<{ kind: string; count: number }>> | undefined) {
  if (options === undefined) return undefined;
  if (options.length === 0) return "없음";
  return options.map((option) => option.map((requirement) => `${pciePowerKindLabel(requirement.kind)} ${requirement.count}개`).join(" + ")).join(" 또는 ");
}

export function formatPciePowerAdapterOptions(options: Array<Array<{ kind: string; count: number }>> | undefined) {
  const formatted = formatPciePowerOptions(options);
  return formatted ? `어댑터 경로 · ${formatted}` : undefined;
}

export function formatPciePowerConnectors(connectors: Record<string, number | undefined> | undefined) {
  if (!connectors) return undefined;
  const values = Object.entries(connectors)
    .filter(([, count]) => count !== undefined)
    .map(([kind, count]) => `${pciePowerKindLabel(kind)} ${count}개`);
  return values.length > 0 ? values.join(" + ") : "확인된 커넥터 없음";
}

export function formatM2SharingScopes(scopes: string[] | undefined) {
  if (!scopes || scopes.length === 0) return undefined;
  const labels: Record<string, string> = { pcie: "PCIe", sata: "SATA", usb4: "USB4", m2: "M.2 간" };
  return scopes.map((scope) => labels[scope] ?? scope).join(", ");
}

export function formatM2SlotProfiles(profiles: M2SlotProfile[] | undefined) {
  if (!profiles || profiles.length === 0) return undefined;
  const connectionLabels: Record<string, string> = { cpu: "CPU", chipset: "칩셋", unknown: "연결 확인" };
  return profiles.map((profile) => `${profile.slotId} · ${profile.interfaces?.join("/") ?? "인터페이스 확인"}${profile.pcieGeneration !== undefined ? ` · PCIe ${profile.pcieGeneration.toFixed(1)}` : ""}${profile.connection ? ` · ${connectionLabels[profile.connection] ?? profile.connection}` : ""}`).join(" / ");
}

export function formatRadiatorPosition(position: string | undefined) {
  return position === "front" ? "전면" : position === "top" ? "상단" : position === "bottom" ? "하단" : position === "side" ? "측면" : position === "rear" ? "후면" : undefined;
}

export function formatRadiatorSupports(supports: Array<{ position?: unknown; sizesMm?: unknown }> | undefined) {
  if (!supports || supports.length === 0) return undefined;
  return supports.map((support) => {
    const position = typeof support.position === "string" ? support.position : "확인 필요";
    const sizes = Array.isArray(support.sizesMm) ? support.sizesMm.filter((size): size is number => typeof size === "number" && Number.isFinite(size)).map((size) => `${size}mm`).join(", ") : "확인 필요";
    return `${formatRadiatorPosition(position) ?? position} · ${sizes}`;
  }).join(" / ");
}

export function selectionList(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

export function withSelectedPart(
  build: BuildSelection,
  category: PartCategory,
  selection: PartSelection | undefined
): BuildSelection {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const list = selectionList(build, category);
    const nextList = selection
      ? [...list, selection]
      : list;
    return {
      ...build,
      [category]: nextList,
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  return {
    ...build,
    [category]: selection,
    ...(category === "motherboard" ? { m2SlotSelection: undefined } : {}),
    ...(category === "gpu" && selection ? { useIntegratedGraphics: false } : {})
  } as BuildSelection;
}

export function replacePartInBuild(build: BuildSelection, category: PartCategory, partId: string, quantityOverride?: number) {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const current = selectionList(build, category);
    return {
      ...build,
      [category]: [{ partId, quantity: quantityOverride ?? current[0]?.quantity ?? 1 }],
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  return {
    ...build,
    [category]: { partId, quantity: quantityOverride ?? build[category]?.quantity ?? 1 },
    ...(category === "motherboard" ? { m2SlotSelection: undefined } : {})
  } as BuildSelection;
}

export function upgradeBundleBuildFor(build: BuildSelection, bundle: UpgradeBundleRecommendation) {
  return bundle.changes.reduce(
    (current, change) => replacePartInBuild(current, change.category, change.part.id, change.quantity),
    build
  );
}

export function replaceAffectedPartsInBuild(build: BuildSelection, category: PartCategory, partId: string, affectedPartIds: string[], quantityOverride?: number) {
  if (affectedPartIds.length === 0) return replacePartInBuild(build, category, partId, quantityOverride);
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const affected = new Set(affectedPartIds);
    const current = selectionList(build, category);
    const replaced = current.map((selection) => affected.has(selection.partId)
      ? { partId, quantity: quantityOverride ?? selection.quantity }
      : selection);
    return replaced.some((selection) => selection.partId === partId)
      ? {
          ...build,
          [category]: replaced,
          ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
        } as BuildSelection
      : replacePartInBuild(build, category, partId, quantityOverride);
  }
  return replacePartInBuild(build, category, partId, quantityOverride);
}

export function updateQuantity(build: BuildSelection, category: PartCategory, index: number, quantity: number) {
  const nextQuantity = Math.max(1, Math.min(99, Math.floor(quantity || 1)));
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const next = selectionList(build, category).map((selection, selectionIndex) =>
      selectionIndex === index ? { ...selection, quantity: nextQuantity } : selection
    );
    return {
      ...build,
      [category]: next,
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  const selection = selectionList(build, category)[0];
  return selection ? ({ ...build, [category]: { ...selection, quantity: nextQuantity } } as BuildSelection) : build;
}

export function removeSelection(build: BuildSelection, category: PartCategory, index: number) {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const next = selectionList(build, category).filter((_, selectionIndex) => selectionIndex !== index);
    return {
      ...build,
      [category]: next,
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  return {
    ...build,
    [category]: undefined,
    ...(category === "motherboard" ? { m2SlotSelection: undefined } : {}),
    ...(category === "gpu" ? { useIntegratedGraphics: true } : {})
  } as BuildSelection;
}

export function accessorySelections(build: BuildSelection): AccessorySelection[] {
  return build.accessories ?? [];
}

export function unknownPriceItemsFor(build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): UnknownPriceItem[] {
  const items = new Map<string, UnknownPriceItem>();
  for (const category of PART_CATEGORIES) {
    for (const selection of selectionList(build, category)) {
      const part = partMap.get(selection.partId);
      if (isKnownPrice(part?.priceWon)) continue;
      const item = {
        id: selection.partId,
        name: part?.name ?? selection.partId,
        kind: "part",
        sourceUrl: part?.danawaUrl,
        ...(part?.source === "danawa" && part.danawaUrl ? { refreshTarget: { kind: "part", id: part.id } } : {})
      } satisfies UnknownPriceItem;
      items.set(`part:${item.id}`, item);
    }
  }
  for (const selection of accessorySelections(build)) {
    const item = accessoryMap.get(selection.accessoryId);
    if (isKnownPrice(item?.priceWon)) continue;
    const unknownItem = {
      id: selection.accessoryId,
      name: item?.name ?? selection.accessoryId,
      kind: "accessory",
      sourceUrl: item?.danawaUrl,
      ...(item?.source === "danawa" && item.danawaUrl ? { refreshTarget: { kind: "accessory", id: item.id } } : {})
    } satisfies UnknownPriceItem;
    items.set(`accessory:${unknownItem.id}`, unknownItem);
  }
  return [...items.values()];
}

export function catalogRefreshReportForInput(report: CatalogRefreshReport | null, build: BuildSelection, preferences: RecommendationPreferences) {
  if (!report) return undefined;
  return report.inputFingerprint === buildCompatibilityInputFingerprint(build, preferences) ? report : undefined;
}

export function isM2TargetableAccessory(item: AccessoryItem | undefined) {
  if (!item) return false;
  return item.category === "m2_heatsink"
    || (item.category === "storage_accessory" && /m\.2/i.test(`${item.name} ${item.rawSpecText ?? ""}`));
}

export function isFanTargetableAccessory(item: AccessoryItem | undefined) {
  return item?.category === "cooling_fan";
}

export function selectedM2TargetOptions(build: BuildSelection, partMap: ReadonlyMap<string, Part>) {
  return build.ssd
    .map((selection) => ({ selection, part: partMap.get(selection.partId) }))
    .filter((entry): entry is { selection: PartSelection; part: Part } => Boolean(entry.part && entry.part.specs.formFactor?.toLocaleLowerCase("ko-KR").includes("m.2")));
}

export function defaultAccessoryTargetPartId(build: BuildSelection, item: AccessoryItem, partMap: ReadonlyMap<string, Part>) {
  if (!isM2TargetableAccessory(item)) return undefined;
  const targets = selectedM2TargetOptions(build, partMap);
  return targets.length === 1 ? targets[0].part.id : undefined;
}

export function defaultAccessoryTargetAccessoryId(build: BuildSelection, item: AccessoryItem, accessoryMap: ReadonlyMap<string, AccessoryItem>) {
  if (!isFanTargetableAccessory(item)) return undefined;
  const hubs = accessorySelections(build)
    .map((selection) => ({ selection, item: accessoryMap.get(selection.accessoryId) }))
    .filter((entry): entry is { selection: AccessorySelection; item: AccessoryItem } => entry.item?.category === "fan_hub");
  return hubs.length === 1 ? hubs[0].selection.accessoryId : undefined;
}

export function accessoryConnectionTargetFor(build: BuildSelection, selection: AccessorySelection, item: AccessoryItem | undefined, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>) {
  if (isM2TargetableAccessory(item)) {
    if (selection.targetPartId) return `SSD ${partMap.get(selection.targetPartId)?.name ?? `대상 확인 필요 · ${selection.targetPartId}`}`;
    return selectedM2TargetOptions(build, partMap).length > 0 ? "선택한 M.2 SSD 전체" : "M.2 SSD 미지정";
  }
  if (isFanTargetableAccessory(item)) {
    if (selection.targetAccessoryId) return `팬 허브 ${accessoryMap.get(selection.targetAccessoryId)?.name ?? `대상 확인 필요 · ${selection.targetAccessoryId}`}`;
    const hubs = accessorySelections(build)
      .map((hubSelection) => ({ selection: hubSelection, item: accessoryMap.get(hubSelection.accessoryId) }))
      .filter((entry): entry is { selection: AccessorySelection; item: AccessoryItem } => entry.item?.category === "fan_hub");
    if (hubs.length === 1) return `팬 허브 ${hubs[0].item.name}`;
    return hubs.length > 1 ? "팬 허브 지정 필요" : "팬 허브 미지정";
  }
  return undefined;
}

export function addAccessoryToBuild(build: BuildSelection, accessoryId: string, targetPartId?: string, targetAccessoryId?: string): BuildSelection {
  const current = accessorySelections(build);
  const existing = current.find((selection) => selection.accessoryId === accessoryId);
  return {
    ...build,
    accessories: existing
      ? current.map((selection) => selection.accessoryId === accessoryId
        ? { ...selection, quantity: Math.min(99, selection.quantity + 1), ...(selection.targetPartId || !targetPartId ? {} : { targetPartId }), ...(selection.targetAccessoryId || !targetAccessoryId ? {} : { targetAccessoryId }) }
        : selection)
      : [...current, { accessoryId, quantity: 1, ...(targetPartId ? { targetPartId } : {}), ...(targetAccessoryId ? { targetAccessoryId } : {}) }]
  };
}

export function updateAccessoryQuantity(build: BuildSelection, index: number, quantity: number): BuildSelection {
  const nextQuantity = Math.max(1, Math.min(99, Math.floor(quantity || 1)));
  return {
    ...build,
    accessories: accessorySelections(build).map((selection, selectionIndex) => selectionIndex === index ? { ...selection, quantity: nextQuantity } : selection)
  };
}

export function updateAccessoryTarget(build: BuildSelection, index: number, targetPartId: string | undefined): BuildSelection {
  return {
    ...build,
    accessories: accessorySelections(build).map((selection, selectionIndex) => {
      if (selectionIndex !== index) return selection;
      const next = { ...selection };
      if (targetPartId) next.targetPartId = targetPartId;
      else delete next.targetPartId;
      return next;
    })
  };
}

export function updateAccessoryHubTarget(build: BuildSelection, index: number, targetAccessoryId: string | undefined): BuildSelection {
  return {
    ...build,
    accessories: accessorySelections(build).map((selection, selectionIndex) => {
      if (selectionIndex !== index) return selection;
      const next = { ...selection };
      if (targetAccessoryId) next.targetAccessoryId = targetAccessoryId;
      else delete next.targetAccessoryId;
      return next;
    })
  };
}

export function updateRgbControllerTarget(build: BuildSelection, targetAccessoryId: string | undefined): BuildSelection {
  return {
    ...build,
    ...(targetAccessoryId ? { rgbControllerAccessoryId: targetAccessoryId } : { rgbControllerAccessoryId: undefined })
  };
}

export function removeAccessoryFromBuild(build: BuildSelection, index: number): BuildSelection {
  return {
    ...build,
    accessories: accessorySelections(build).filter((_, selectionIndex) => selectionIndex !== index)
  };
}

export function partSummary(part: Part | undefined) {
  if (!part) return "아직 선택하지 않았습니다.";
  const effectiveMemoryLatency = memoryEffectiveLatencyForDisplay(part);
  const values = [
    part.specs.socket,
    part.specs.memoryType,
    (part.category === "memory" || part.category === "motherboard") && part.specs.memoryProfiles?.length ? part.specs.memoryProfiles.join(" / ") : undefined,
    part.category === "memory" && part.specs.memoryModuleCountPerKit !== undefined ? `킷 ${part.specs.memoryModuleCountPerKit}개 모듈` : undefined,
    part.category === "memory" && part.specs.memoryTiming ? part.specs.memoryTiming : part.category === "memory" && part.specs.memoryCasLatency !== undefined ? `CL${part.specs.memoryCasLatency}` : undefined,
    part.category === "memory" && effectiveMemoryLatency !== undefined ? `실효 ${effectiveMemoryLatency.toFixed(2)}ns` : undefined,
    part.category === "memory" && part.specs.memoryVoltageV !== undefined ? `${part.specs.memoryVoltageV}V` : undefined,
    part.category === "cpu" && part.specs.cinebenchR23Multi !== undefined ? `R23 멀티 ${part.specs.cinebenchR23Multi.toLocaleString("ko-KR")}` : undefined,
    part.category === "gpu" && part.specs.vramGb !== undefined ? `VRAM ${part.specs.vramGb}GB` : undefined,
    part.category === "gpu" && part.specs.gpuMemoryType ? part.specs.gpuMemoryType : undefined,
    part.category === "gpu" && part.specs.gpuBoostClockMhz !== undefined ? `부스트 ${part.specs.gpuBoostClockMhz.toLocaleString("ko-KR")}MHz` : undefined,
    part.category === "gpu" && part.specs.pciePowerOptions !== undefined ? `보조전원 ${formatPciePowerOptions(part.specs.pciePowerOptions)}` : undefined,
    part.category === "gpu" && part.specs.pciePowerAdapterOptions !== undefined ? formatPciePowerAdapterOptions(part.specs.pciePowerAdapterOptions) : undefined,
    part.category === "gpu" && part.specs.gpuSlotOccupancy !== undefined ? `물리 슬롯 ${part.specs.gpuSlotOccupancy}` : undefined,
    part.category === "gpu" && part.specs.gpuCableBendClearanceMm !== undefined ? `케이블 여유 ${part.specs.gpuCableBendClearanceMm}mm` : undefined,
    part.category === "motherboard" && part.specs.m2PcieGenerations?.length ? `M.2 ${part.specs.m2PcieGenerations.map((generation) => `PCIe ${generation.toFixed(1)}`).join(" / ")}` : undefined,
    part.category === "motherboard" && part.specs.m2SlotProfiles?.length ? `슬롯별 M.2 매핑 ${part.specs.m2SlotProfiles.length}개` : undefined,
    part.category === "ssd" && part.specs.interface ? part.specs.interface : undefined,
    part.category === "ssd" && part.specs.capacityGb !== undefined ? `${part.specs.capacityGb}GB` : undefined,
    part.category === "ssd" && part.specs.m2PcieGeneration !== undefined ? `PCIe ${part.specs.m2PcieGeneration.toFixed(1)}` : undefined,
    part.category === "ssd" && part.specs.sequentialReadMbps !== undefined ? `읽기 ${part.specs.sequentialReadMbps.toLocaleString("ko-KR")}MB/s` : undefined,
    part.category === "ssd" && part.specs.ssdTbwTb !== undefined ? `TBW ${part.specs.ssdTbwTb}TB` : undefined,
    part.specs.wattageW ? `${part.specs.wattageW}W` : undefined,
    part.category === "psu" && part.specs.psuCableType ? `케이블 ${part.specs.psuCableType === "fully_modular" ? "풀모듈러" : part.specs.psuCableType === "semi_modular" ? "세미모듈러" : "일체형"}` : undefined,
    part.category === "psu" && part.specs.psuRailType ? `12V ${part.specs.psuRailType === "single" ? "싱글레일" : "다중레일"}` : undefined,
    part.category === "psu" && part.specs.psuIndependentPcieCableRuns !== undefined ? `독립 PCIe 런 ${part.specs.psuIndependentPcieCableRuns}개` : undefined,
    part.category === "psu" && part.specs.psuPcieCableTopology ? `PCIe ${part.specs.psuPcieCableTopology === "independent" ? "독립" : "분배"}` : undefined,
    part.category === "case" && part.specs.caseSidePanelClearanceMm !== undefined ? `케이블 측면 ${part.specs.caseSidePanelClearanceMm}mm` : undefined,
    part.specs.lengthMm ? `${part.specs.lengthMm}mm` : undefined,
    part.specs.formFactor
  ].filter(Boolean);
  return values.join(" · ") || "상세 스펙을 확인할 수 있습니다.";
}

export function purchaseListRowsFor(build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>) {
  const rows: PurchaseListRow[] = [];
  for (const category of PART_CATEGORIES) {
    for (const selection of selectionList(build, category)) {
      const part = partMap.get(selection.partId);
      const unitPriceWon = part?.priceWon;
      rows.push({
        id: `part:${category}:${selection.partId}`,
        sourceKind: "part",
        sourceId: selection.partId,
        sourceCategory: category,
        section: "핵심 부품",
        categoryLabel: CATEGORY_LABELS[category],
        name: part?.name ?? selection.partId,
        quantity: selection.quantity,
        ...(unitPriceWon !== undefined ? { unitPriceWon } : {}),
        ...(isKnownPrice(unitPriceWon) ? { totalPriceWon: unitPriceWon * selection.quantity } : {}),
        priceEvidence: part ? catalogPriceEvidenceFor(part) : "unknown",
        ...(part?.dataFreshness ? { dataFreshness: part.dataFreshness } : {}),
        ...(part?.source === "danawa" && part.danawaUrl ? { refreshable: true } : {}),
        listingType: part?.listingType ? LISTING_TYPE_LABELS[part.listingType] : LISTING_TYPE_LABELS.retail,
        ...(part?.danawaUrl ? { sourceUrl: safeExternalUrl(part.danawaUrl) } : {})
      });
    }
  }
  for (const [index, selection] of accessorySelections(build).entries()) {
    const item = accessoryMap.get(selection.accessoryId);
    const unitPriceWon = item?.priceWon;
    const connectionTarget = accessoryConnectionTargetFor(build, selection, item, partMap, accessoryMap);
    rows.push({
      id: `accessory:${selection.accessoryId}:${selection.targetPartId ?? ""}:${selection.targetAccessoryId ?? ""}:${index}`,
      sourceKind: "accessory",
      sourceId: selection.accessoryId,
      ...(item ? { sourceCategory: item.category } : {}),
      section: "주변 부품",
      categoryLabel: item ? ACCESSORY_CATEGORY_LABELS[item.category] : "주변 부품",
      name: item?.name ?? selection.accessoryId,
      quantity: selection.quantity,
      ...(unitPriceWon !== undefined ? { unitPriceWon } : {}),
      ...(isKnownPrice(unitPriceWon) ? { totalPriceWon: unitPriceWon * selection.quantity } : {}),
      priceEvidence: item ? catalogPriceEvidenceFor(item) : "unknown",
      ...(item?.dataFreshness ? { dataFreshness: item.dataFreshness } : {}),
      ...(item?.source === "danawa" && item.danawaUrl ? { refreshable: true } : {}),
      listingType: LISTING_TYPE_LABELS.accessory,
      ...(connectionTarget ? { connectionTarget } : {}),
      ...(item?.danawaUrl ? { sourceUrl: safeExternalUrl(item.danawaUrl) } : {})
    });
  }
  return rows;
}

export function memoryEffectiveLatencyForDisplay(part: Part) {
  if (part.category !== "memory") return undefined;
  const speedMhz = part.specs.speedMhz;
  const memoryCasLatency = part.specs.memoryCasLatency;
  if (speedMhz !== undefined && speedMhz > 0 && memoryCasLatency !== undefined) {
    return Number(((memoryCasLatency * 2000) / speedMhz).toFixed(2));
  }
  return part.specs.memoryEffectiveLatencyNs;
}

export function RequestErrorNotice({ message, onRetry, retrying, hasLastResult }: { message: string; onRetry: () => void; retrying: boolean; hasLastResult: boolean }) {
  return <div className="request-error" role="alert">
    <div className="request-error-copy"><FiXCircle /><div><strong>잠시 문제가 생겼어요.</strong></div></div>
    <RetryAfterButton className="button button-small button-light" message={message} onRetry={onRetry} retrying={retrying} idleContent={<><FiRefreshCw /> 다시 시도</>} retryingContent={<><FiLoader className="spin" /> 재시도 중...</>} testId="request-retry-button" />
  </div>;
}

export function PartEvidence({ part }: { part: Part }) {
  const [rawOpen, setRawOpen] = useState(false);
  const qualityLabel = DATA_QUALITY_LABELS[part.dataQuality];
  const priceEvidence = catalogPriceEvidenceFor(part);
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  return <div className="part-evidence" aria-label={`${part.name} 상세 스펙`}>
    <div className="part-evidence-meta"><span><FiDatabase /> {qualityLabel}</span><span className={`part-evidence-price ${priceEvidence}`} title={catalogPriceEvidenceDescriptionFor(part)}>{isKnownPrice(part.priceWon) ? `가격 ${formatWon(part.priceWon)}` : "가격 확인 필요"} · {catalogPriceEvidenceLabelFor(part)}</span><span>{part.updatedAt ? `갱신 ${new Date(part.updatedAt).toLocaleDateString("ko-KR")}` : "갱신 시점 없음"}</span></div>
    <CatalogSpecProvenance part={part} compact />
    <div className="part-evidence-grid">{suggestionSpecRows(part).map(([label, value]) => <div className="part-evidence-row" key={label}><span>{label}</span><strong>{formatSpecValue(value)}</strong></div>)}</div>
    {part.missingFields.length > 0 && <p className="part-evidence-missing"><FiInfo /> 확인되지 않은 항목: {part.missingFields.map((field) => catalogMissingFieldLabelFor(field)).join(", ")}</p>}
    <div className="part-evidence-actions">{part.rawSpecText && <button className="text-button" type="button" aria-expanded={rawOpen} onClick={() => setRawOpen((current) => !current)}>{rawOpen ? "수집된 스펙 닫기" : "수집된 스펙 보기"} <FiChevronDown /></button>}{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">다나와 보기 <FiExternalLink /></a>}</div>
    {rawOpen && part.rawSpecText && <pre className="part-evidence-raw">{part.rawSpecText}</pre>}
  </div>;
}

export function sharedPhysicalEvidenceSources(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).flatMap((source) => {
    const note = typeof source.note === "string" && source.note.trim() ? source.note.trim() : undefined;
    if (!note || !["gpu", "case", "psu"].includes(source.category)) return [];
    const manufacturerModel = source.manufacturerModel?.trim();
    const manufacturerRevision = source.manufacturerRevision?.trim();
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : undefined;
    const url = safeHttpsUrl(source.url);
    return [{ category: source.category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) } satisfies PhysicalEvidenceSource];
  });
}

export function sharedPhysicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

export function sharedPhysicalEvidenceSourceIdentity(source: PhysicalEvidenceSource) {
  return `${sharedPhysicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}`;
}

export function ChangeHistoryPanel({ entries, onRestore, restoring }: { entries: BuildHistoryEntry[]; onRestore: (entry: BuildHistoryEntry) => void; restoring: boolean }) {
  if (entries.length === 0) return null;
  return <section className="change-history-panel" aria-label="견적 변경 이력">
    <div className="change-history-heading"><div><p className="eyebrow">BUILD HISTORY</p><h2>변경 이력</h2><p>부품을 시험하거나 수량을 바꾼 뒤 이전 구성으로 되돌릴 수 있어요.</p></div><span className="change-history-icon"><FiClock /></span></div>
    <div className="change-history-list">{entries.slice(0, 6).map((entry, index) => <article className="change-history-item" key={entry.id}><div className="change-history-item-copy"><span>{index === 0 ? "최근 변경" : `${index + 1}단계 전`}</span><strong>{entry.label}</strong><small>{new Date(entry.changedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small></div><button className="button button-small button-light" type="button" onClick={() => onRestore(entry)} disabled={restoring}><FiRefreshCw /> {restoring ? "검사 중..." : "이전 구성 복원"}</button></article>)}</div>
    <p className="change-history-note"><FiInfo /> 복원은 선택 부품과 추천 기준을 함께 되돌린 뒤 현재 카탈로그 기준으로 자동 재검사합니다.</p>
  </section>;
}

export function scenarioStatusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

export function scenarioRiskText(result: CompatibilityResult) {
  return `차단 ${result.blockerCount}개 · 주의 ${result.warningCount}개 · 확인 필요 ${result.unknownCount}개`;
}

export function currentDraftComparisonFor(build: BuildSelection, preferences: RecommendationPreferences, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): SavedBuild {
  const price = buildPriceSnapshotFor(build, partMap, accessoryMap);
  const coreLines = PART_CATEGORIES.flatMap((category) => selectionList(build, category).map((selection) => ({
    category,
    name: partMap.get(selection.partId)?.name ?? selection.partId,
    quantity: selection.quantity
  })));
  const accessoryLines = accessorySelections(build).map((selection) => ({
    category: accessoryMap.get(selection.accessoryId)?.category,
    name: accessoryMap.get(selection.accessoryId)?.name ?? selection.accessoryId,
    quantity: selection.quantity
  }));
  return {
    id: "current-draft",
    name: "현재 편집기 견적",
    selection: build,
    recommendationPreferences: preferences,
    summary: {
      totalPriceWon: price.totalPriceWon,
      coreTotalPriceWon: price.coreTotalPriceWon,
      accessoryTotalPriceWon: price.accessoryTotalPriceWon,
      priceComplete: price.priceComplete,
      accessoryCount: accessoryLines.length,
      accessoryQuantity: accessoryLines.reduce((total, line) => total + line.quantity, 0),
      coreLines,
      accessoryLines
    },
    createdAt: "current-draft",
    updatedAt: "current-draft"
  };
}

export function repairPlanKey(plan: RecommendationPlan) {
  return plan.changes.map((change) => `${change.category}:${change.kind}:${change.toPart.id}:${change.toQuantity ?? ""}`).sort().join("|");
}

export function similarityEvidenceText(evidence?: SimilarityEvidence) {
  if (!evidence || evidence.totalDimensions === 0 || evidence.comparedDimensions === 0) return "공통 스펙 확인 불가";
  const confidenceLabel = evidence.confidence === "high" ? "정보 충분" : evidence.confidence === "limited" ? "정보 제한" : "확인 필요";
  const basisLabel = similarityBasisLabelFor(evidence);
  const referenceCategory = similarityReferenceUsedCategoryFor(evidence);
  const referenceLabel = referenceCategory ? ` · ${referenceCategory === "gpu" ? "GPU" : "CPU"} 계열 참조 사용` : "";
  return `${confidenceLabel}${basisLabel === "비교 정보 확인 필요" ? "" : ` · ${basisLabel}`} · 공통 스펙 ${evidence.comparedDimensions}/${evidence.totalDimensions}개${referenceLabel}`;
}

export function suggestionSpecRows(part: Part): Array<[string, unknown]> {
  const specs = part.specs;
  const rowsByCategory: Record<PartCategory, Array<[string, unknown]>> = {
    cpu: [["소켓", specs.socket], ["코어 / 스레드", specs.cores !== undefined && specs.threads !== undefined ? `${specs.cores} / ${specs.threads}` : undefined], ["부스트 클럭", specs.boostClockGhz !== undefined ? `${specs.boostClockGhz}GHz` : undefined], ["Cinebench R23 싱글", specs.cinebenchR23Single !== undefined ? specs.cinebenchR23Single.toLocaleString("ko-KR") : undefined], ["Cinebench R23 멀티", specs.cinebenchR23Multi !== undefined ? specs.cinebenchR23Multi.toLocaleString("ko-KR") : undefined], ["기준 전력", (specs.pptW ?? specs.tdpW) !== undefined ? `${specs.pptW ?? specs.tdpW}W` : undefined]],
    cooler: [["지원 소켓", specs.supportedSockets], ["냉각 지원", specs.maxCoolingW !== undefined ? `${specs.maxCoolingW}W` : undefined], ["최대 높이", specs.maxCoolerHeightMm !== undefined ? `${specs.maxCoolerHeightMm}mm` : undefined], ["라디에이터", specs.radiatorSizeMm !== undefined ? `${specs.radiatorSizeMm}mm` : undefined], ["라디에이터 위치", formatRadiatorPosition(specs.radiatorPosition)]],
    motherboard: [["소켓", specs.socket], ["메모리", specs.memoryType], ["메모리 프로파일", specs.memoryProfiles], ["메모리 슬롯 규격", specs.memoryFormFactor], ["최대 메모리", specs.maxMemoryGb !== undefined ? `${specs.maxMemoryGb}GB` : undefined], ["RAM 슬롯", specs.memorySlots], ["M.2 슬롯", specs.m2Slots], ["M.2 연결", specs.m2Interfaces], ["M.2 PCIe 세대", specs.m2PcieGenerations?.map((generation) => `PCIe ${generation.toFixed(1)}`)], ["M.2 슬롯별 연결", formatM2SlotProfiles(specs.m2SlotProfiles)], ["M.2 공유 범위", formatM2SharingScopes(specs.m2LaneSharingScopes)], ["PCIe x16 슬롯", specs.pcieX16Slots], ["PCIe x8 슬롯", specs.pcieX8Slots], ["PCIe x4 슬롯", specs.pcieX4Slots], ["PCIe x1 슬롯", specs.pcieX1Slots], ["5V ARGB 헤더", specs.rgb5vPortCount], ["12V RGB 헤더", specs.rgb12vPortCount], ["폼팩터", specs.formFactor]],
    memory: [["메모리", specs.memoryType], ["프로파일", specs.memoryProfiles], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined], ["모듈 수/킷", specs.memoryModuleCountPerKit !== undefined ? `${specs.memoryModuleCountPerKit}개` : undefined], ["속도", specs.speedMhz !== undefined ? `${specs.speedMhz}MHz` : undefined], ["메모리 타이밍", specs.memoryTiming], ["CAS 레이턴시", specs.memoryCasLatency !== undefined ? `CL${specs.memoryCasLatency}` : undefined], ["실효 CAS 지연(계산)", memoryEffectiveLatencyForDisplay(part) !== undefined ? `${memoryEffectiveLatencyForDisplay(part)!.toFixed(2)}ns` : undefined], ["전압", specs.memoryVoltageV !== undefined ? `${specs.memoryVoltageV}V` : undefined], ["규격", specs.formFactor]],
    gpu: [["GPU 계열", specs.gpuVendor && specs.gpuArchitectureFamily ? `${specs.gpuVendor.toUpperCase()} · ${specs.gpuArchitectureFamily}` : specs.gpuVendor?.toUpperCase()], ["GPU 메모리", specs.gpuMemoryType], ["VRAM", specs.vramGb !== undefined ? `${specs.vramGb}GB` : undefined], ["부스트 클럭", specs.gpuBoostClockMhz !== undefined ? `${specs.gpuBoostClockMhz.toLocaleString("ko-KR")}MHz` : undefined], ["스트림 프로세서", specs.gpuStreamProcessors !== undefined ? specs.gpuStreamProcessors.toLocaleString("ko-KR") : undefined], ["VRAM 대역폭", specs.gpuMemoryBandwidthGbps !== undefined ? `${specs.gpuMemoryBandwidthGbps.toLocaleString("ko-KR")}GB/s` : undefined], ["PCIe 장착 폭", specs.pcieSlotWidth !== undefined ? `x${specs.pcieSlotWidth}` : undefined], ["보조전원", formatPciePowerOptions(specs.pciePowerOptions)], ["어댑터 경로", formatPciePowerAdapterOptions(specs.pciePowerAdapterOptions)], ["소비전력", specs.powerW !== undefined ? `${specs.powerW}W` : undefined], ["권장 파워", specs.recommendedPsuW !== undefined ? `${specs.recommendedPsuW}W` : undefined], ["길이", specs.lengthMm !== undefined ? `${specs.lengthMm}mm` : undefined], ["두께", specs.thicknessMm !== undefined ? `${specs.thicknessMm}mm` : undefined], ["물리 슬롯 점유", specs.gpuSlotOccupancy !== undefined ? `${specs.gpuSlotOccupancy} 슬롯` : undefined], ["케이블 굽힘 여유", specs.gpuCableBendClearanceMm !== undefined ? `${specs.gpuCableBendClearanceMm}mm` : undefined]],
    ssd: [["인터페이스", specs.interface], ["폼팩터", specs.formFactor], ["PCIe 세대", specs.m2PcieGeneration !== undefined ? `PCIe ${specs.m2PcieGeneration.toFixed(1)}` : undefined], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined], ["순차 읽기", specs.sequentialReadMbps !== undefined ? `${specs.sequentialReadMbps}MB/s` : undefined], ["순차 쓰기", specs.sequentialWriteMbps !== undefined ? `${specs.sequentialWriteMbps}MB/s` : undefined], ["읽기 IOPS", specs.ssdReadIops !== undefined ? `${specs.ssdReadIops.toLocaleString("ko-KR")}` : undefined], ["쓰기 IOPS", specs.ssdWriteIops !== undefined ? `${specs.ssdWriteIops.toLocaleString("ko-KR")}` : undefined], ["컨트롤러", specs.ssdController], ["NAND", specs.ssdNandType], ["TBW", specs.ssdTbwTb !== undefined ? `${specs.ssdTbwTb}TB` : undefined]],
    hdd: [["인터페이스", specs.interface], ["폼팩터", specs.formFactor], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined]],
    case: [["지원 메인보드", specs.motherboardFormFactors], ["GPU 허용 길이", specs.maxGpuLengthMm !== undefined ? `${specs.maxGpuLengthMm}mm` : undefined], ["측면 케이블 여유", specs.caseSidePanelClearanceMm !== undefined ? `${specs.caseSidePanelClearanceMm}mm` : undefined], ["쿨러 허용 높이", specs.maxCoolerHeightMm !== undefined ? `${specs.maxCoolerHeightMm}mm` : undefined], ["PSU 허용 길이", specs.maxPsuLengthMm !== undefined ? `${specs.maxPsuLengthMm}mm` : undefined], ["지원 파워 규격", specs.supportedPsuFormFactors], ["위치별 라디에이터", formatRadiatorSupports(specs.radiatorSupports)], ["RGB 전압", specs.rgbDeviceVoltage], ["RGB 장치당 소비전류", specs.rgbDeviceCurrentA !== undefined ? `${specs.rgbDeviceCurrentA}A` : undefined], ["RGB 장치당 소비전력", specs.rgbDevicePowerW !== undefined ? `${specs.rgbDevicePowerW}W` : undefined], ["RGB 컨트롤러", specs.rgbControllerIncluded], ["HDD 베이", specs.hddBays]],
    psu: [["정격 출력", specs.wattageW !== undefined ? `${specs.wattageW}W` : undefined], ["PSU 깊이", specs.psuDepthMm !== undefined ? `${specs.psuDepthMm}mm` : undefined], ["PCIe 보조전원", formatPciePowerConnectors(specs.pciePowerConnectors)], ["케이블 구조", specs.psuCableType === "fully_modular" ? "풀모듈러" : specs.psuCableType === "semi_modular" ? "세미모듈러" : specs.psuCableType === "fixed" ? "케이블 일체형" : undefined], ["12V 레일", specs.psuRailType === "single" ? "싱글레일" : specs.psuRailType === "multi" ? "다중레일" : undefined], ["독립 PCIe 케이블 런", specs.psuIndependentPcieCableRuns !== undefined ? `${specs.psuIndependentPcieCableRuns}개` : undefined], ["PCIe 분배 구조", specs.psuPcieCableTopology === "independent" ? "독립 케이블" : specs.psuPcieCableTopology === "shared" ? "분배·공유 케이블" : undefined], ["효율", specs.efficiency], ["폼팩터", specs.psuFormFactor]]
  };
  return rowsByCategory[part.category].filter(([, value]) => value !== undefined && value !== "");
}

export function AccessoryVisual({ item }: { item: AccessoryItem }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = safeExternalUrl(item.imageUrl);
  if (imageUrl && !failed) return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <FiTool />;
}

export function CategoryIcon({ category }: { category: PartCategory }) {
  const Icon = CATEGORY_META[category].Icon;
  return <Icon />;
}

export function PartWatchButton({ part, onWatch }: { part: Part; onWatch: PartWatchHandler }) {
  const [watching, setWatching] = useState(() => partIsWatched(part));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_WATCHLIST_STORAGE_KEY) return;
      setWatching(catalogWatchlistContains(catalogWatchlistFromJson(event.newValue), { kind: "part", itemId: part.id }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [part.id]);
  function addToWatchlist() {
    if (onWatch(part)) setWatching(true);
  }
  return <button className={watching ? "text-button part-watch-button watched" : "text-button part-watch-button"} type="button" data-item-id={part.id} onClick={addToWatchlist} disabled={watching} aria-label={`${part.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "추적 중" : "가격 추적"}</button>;
}

export function PartVisual({ part }: { part: Part }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = safeExternalUrl(part.imageUrl);
  if (imageUrl && !failed) return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <CategoryIcon category={part.category} />;
}

export const SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY = "pc-supporter-saved-build-owner-tokens";

export function readSavedBuildOwnerTokens() {
  try {
    const raw = window.localStorage.getItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, string>;
    const entries = Object.entries(parsed);
    if (entries.length > LOCAL_SAVED_STATE_LIMIT) return {} as Record<string, string>;
    return Object.fromEntries(entries.filter(([id, token]) => typeof id === "string" && typeof token === "string" && token.length >= 40).slice(0, LOCAL_SAVED_STATE_LIMIT));
  } catch {
    return {} as Record<string, string>;
  }
}

export function writeSavedBuildOwnerTokens(tokens: Record<string, string>) {
  try {
    window.localStorage.setItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(0, LOCAL_SAVED_STATE_LIMIT))));
  } catch {
    // A full local storage bucket must not prevent the editor from working.
  }
}

export function rememberSavedBuildOwnerToken(id: string, token: string) {
  if (!id.trim() || !token.trim()) return;
  writeSavedBuildOwnerTokens({ [id]: token, ...readSavedBuildOwnerTokens() });
}

export function readSavedBuildOwnerToken(id: string) {
  return readSavedBuildOwnerTokens()[id];
}

export const LOCAL_SAVED_STATE_LIMIT = 20;

const SAVED_BUILD_IDS_STORAGE_KEY = "pc-supporter-saved-build-ids";

export function readSavedBuildIds() {
  try {
    const raw = window.localStorage.getItem(SAVED_BUILD_IDS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length > LOCAL_SAVED_STATE_LIMIT) return [] as string[];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, LOCAL_SAVED_STATE_LIMIT);
  } catch {
    return [] as string[];
  }
}

export function writeSavedBuildIds(ids: string[]) {
  try {
    const nextIds = [...new Set(ids)].slice(0, LOCAL_SAVED_STATE_LIMIT);
    window.localStorage.setItem(SAVED_BUILD_IDS_STORAGE_KEY, JSON.stringify(nextIds));
  } catch {
    // A full local storage bucket must not prevent the history screen from working.
  }
}
