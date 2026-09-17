// Shared build-selection mutation/query helpers. Pure functions used by the editor, picker, and lazy views.
import { buildCompatibilityInputFingerprint } from "../shared/build-fingerprint";
import { catalogPriceEvidenceFor } from "../shared/catalog-price-evidence";
import type { CatalogRefreshReport } from "../shared/catalog-refresh-report";
import type { PurchaseListRow } from "../shared/purchase-list";
import { type AccessoryItem, type AccessorySelection, type BuildSelection, type Part, type PartCategory, type PartSelection, type RecommendationPreferences, type UpgradeBundleRecommendation, ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, isKnownPrice, LISTING_TYPE_LABELS, PART_CATEGORIES } from "../shared/types";
import type { UnknownPriceItem } from "./BuildPriceSummary";
import { safeExternalUrl } from "./safe-source-url";

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
