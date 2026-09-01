import type { AccessorySelection, BuildGenerationDiagnostic, BuildGenerationRequest, BuildSelection, GamingRefreshRate, GamingResolution, ListingPolicy, PartSelection, RecommendationPriority, RecommendationProfile } from "../shared/types";
import { PART_CATEGORIES } from "../shared/types";
import { BUDGET_LADDER_BANDS, type BudgetLadderChange, type BudgetLadderExportItem, type BudgetLadderExportLine, type BudgetLadderExportPayload } from "../shared/budget-ladder";
import type { BudgetLadderShareCreateInput, BudgetLadderShareSnapshot, SavedBudgetLadderRecord } from "../shared/budget-ladder-share";
import { normalizeShareExpiryAt, shareExpiryDaysFrom, shareExpiryValueProvided, shareExpired, shareExpiresAtFor } from "./share-lifecycle";

const PROFILE_VALUES: RecommendationProfile[] = ["general", "gaming", "creator", "development", "office"];
const PRIORITY_VALUES: RecommendationPriority[] = ["balanced", "budget", "performance"];
const RESOLUTION_VALUES: GamingResolution[] = ["1080p", "1440p", "4k"];
const REFRESH_RATE_VALUES: GamingRefreshRate[] = [60, 144, 240];
const LISTING_POLICY_VALUES: ListingPolicy[] = ["retail_only", "include_bulk", "all"];
const EXPORT_STATUS_VALUES: BudgetLadderExportItem["status"][] = ["호환 가능", "확인 필요", "검토 필요", "생성 실패"];
const MAX_TEXT_LENGTH = 1_000;

export interface BudgetLadderShareInputResult {
  name?: string;
  payload?: BudgetLadderExportPayload;
  request?: BuildGenerationRequest;
  parentId?: string;
  expiresInDays?: 7 | 30;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function diagnosticsFromUnknown(value: unknown): BuildGenerationDiagnostic[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const diagnostics = value.slice(0, 2).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textValue(item.id, 120);
    const title = textValue(item.title, 240);
    const summary = textValue(item.summary, 500);
    if (!id || !title || !summary || !Array.isArray(item.facts)) return [];
    const facts = item.facts.slice(0, 4).flatMap((fact) => {
      if (!isRecord(fact)) return [];
      const label = textValue(fact.label, 120);
      const factValue = textValue(fact.value, 300);
      return label && factValue ? [{ label, value: factValue }] : [];
    });
    if (facts.length !== Math.min(4, item.facts.length)) return [];
    const recommendation = textValue(item.recommendation, 500);
    return [{ id, title, summary, facts, ...(recommendation ? { recommendation } : {}) }];
  });
  return diagnostics.length > 0 ? diagnostics : undefined;
}

function partSelectionFromUnknown(value: unknown, field: string): { selection?: PartSelection; error?: string } {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return { error: `${field} 선택 형식이 올바르지 않습니다.` };
  const partId = textValue(value.partId, 120);
  const quantity = boundedInteger(value.quantity, 1, 99);
  if (!partId || quantity === undefined) return { error: `${field} 선택의 부품 ID·수량이 올바르지 않습니다.` };
  return { selection: { partId, quantity } };
}

function selectionArrayFromUnknown(value: unknown, field: string): { selections?: PartSelection[]; error?: string } {
  if (value === undefined || value === null) return { selections: [] };
  if (!Array.isArray(value) || value.length > 99) return { error: `${field} 선택 목록 형식이 올바르지 않습니다.` };
  const parsed = value.map((item) => partSelectionFromUnknown(item, field));
  const errors = parsed.flatMap((result) => result.error ? [result.error] : []);
  const selections = parsed.flatMap((result) => result.selection ? [result.selection] : []);
  if (errors.length > 0 || selections.length !== value.length) return { error: errors[0] ?? `${field} 선택 목록 형식이 올바르지 않습니다.` };
  return { selections };
}

function buildSelectionFromUnknown(value: unknown): { selection?: BuildSelection; error?: string } {
  if (value === undefined) return {};
  if (!isRecord(value) || typeof value.useIntegratedGraphics !== "boolean") return { error: "예산 비교 선택 payload의 기본 형식이 올바르지 않습니다." };
  const singleFields = ["cpu", "cooler", "motherboard", "gpu", "case", "psu"] as const;
  const singles = Object.fromEntries(singleFields.map((field) => [field, partSelectionFromUnknown(value[field], field)]));
  const singleError = singleFields.map((field) => singles[field].error).find((error): error is string => Boolean(error));
  if (singleError) return { error: singleError };
  const arrays = Object.fromEntries(((["memory", "ssd", "hdd"] as const).map((field) => [field, selectionArrayFromUnknown(value[field], field)])));
  const arrayError = (["memory", "ssd", "hdd"] as const).map((field) => arrays[field].error).find((error): error is string => Boolean(error));
  if (arrayError) return { error: arrayError };
  const accessories = value.accessories === undefined || value.accessories === null ? [] : Array.isArray(value.accessories) && value.accessories.length <= 99 ? value.accessories.flatMap((item): AccessorySelection[] => {
    if (!isRecord(item)) return [];
    const accessoryId = textValue(item.accessoryId, 120);
    const quantity = boundedInteger(item.quantity, 1, 99);
    const targetPartId = item.targetPartId === undefined || item.targetPartId === null || item.targetPartId === "" ? undefined : textValue(item.targetPartId, 120);
    const targetAccessoryId = item.targetAccessoryId === undefined || item.targetAccessoryId === null || item.targetAccessoryId === "" ? undefined : textValue(item.targetAccessoryId, 120);
    return accessoryId && quantity !== undefined && (item.targetPartId === undefined || item.targetPartId === null || item.targetPartId === "" || targetPartId) && (item.targetAccessoryId === undefined || item.targetAccessoryId === null || item.targetAccessoryId === "" || targetAccessoryId) ? [{ accessoryId, quantity, ...(targetPartId ? { targetPartId } : {}), ...(targetAccessoryId ? { targetAccessoryId } : {}) }] : [];
  }) : undefined;
  if (accessories === undefined || (Array.isArray(value.accessories) && accessories.length !== value.accessories.length)) return { error: "accessories 선택 payload 형식이 올바르지 않습니다." };
  let m2SlotSelection: Record<string, string> | undefined;
  if (value.m2SlotSelection !== undefined && value.m2SlotSelection !== null) {
    if (!isRecord(value.m2SlotSelection) || Object.keys(value.m2SlotSelection).length > 99) return { error: "m2SlotSelection 선택 payload 형식이 올바르지 않습니다." };
    const entries = Object.entries(value.m2SlotSelection).flatMap(([slotId, partId]) => typeof partId === "string" && partId.trim() && slotId.trim() ? [[slotId.trim().slice(0, 80), partId.trim().slice(0, 120)] as [string, string]] : []);
    if (entries.length !== Object.keys(value.m2SlotSelection).length) return { error: "m2SlotSelection 선택 payload 형식이 올바르지 않습니다." };
    m2SlotSelection = Object.fromEntries(entries);
  }
  const rgbControllerAccessoryId = value.rgbControllerAccessoryId === undefined || value.rgbControllerAccessoryId === null || value.rgbControllerAccessoryId === "" ? undefined : textValue(value.rgbControllerAccessoryId, 120);
  if (value.rgbControllerAccessoryId !== undefined && value.rgbControllerAccessoryId !== null && value.rgbControllerAccessoryId !== "" && !rgbControllerAccessoryId) return { error: "rgbControllerAccessoryId 선택 payload 형식이 올바르지 않습니다." };
  return {
    selection: {
      ...(singles.cpu.selection ? { cpu: singles.cpu.selection } : {}),
      ...(singles.cooler.selection ? { cooler: singles.cooler.selection } : {}),
      ...(singles.motherboard.selection ? { motherboard: singles.motherboard.selection } : {}),
      ...(singles.gpu.selection ? { gpu: singles.gpu.selection } : {}),
      ...(singles.case.selection ? { case: singles.case.selection } : {}),
      ...(singles.psu.selection ? { psu: singles.psu.selection } : {}),
      memory: arrays.memory.selections ?? [],
      ssd: arrays.ssd.selections ?? [],
      hdd: arrays.hdd.selections ?? [],
      accessories,
      ...(m2SlotSelection && Object.keys(m2SlotSelection).length > 0 ? { m2SlotSelection } : {}),
      ...(rgbControllerAccessoryId ? { rgbControllerAccessoryId } : {}),
      useIntegratedGraphics: value.useIntegratedGraphics
    }
  };
}

function requestFromUnknown(value: unknown): { request?: BuildGenerationRequest; error?: string } {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return { error: "예산 비교 생성 조건 형식이 올바르지 않습니다." };
  const profile = PROFILE_VALUES.includes(value.profile as RecommendationProfile) ? value.profile as RecommendationProfile : undefined;
  const budgetWon = boundedInteger(value.budgetWon, 1, 100_000_000);
  const includeGpu = typeof value.includeGpu === "boolean" ? value.includeGpu : undefined;
  const priority = value.priority === undefined ? undefined : PRIORITY_VALUES.includes(value.priority as RecommendationPriority) ? value.priority as RecommendationPriority : undefined;
  const gamingResolution = value.gamingResolution === undefined ? undefined : RESOLUTION_VALUES.includes(value.gamingResolution as GamingResolution) ? value.gamingResolution as GamingResolution : undefined;
  const gamingRefreshRate = value.gamingRefreshRate === undefined ? undefined : REFRESH_RATE_VALUES.includes(Number(value.gamingRefreshRate) as GamingRefreshRate) ? Number(value.gamingRefreshRate) as GamingRefreshRate : undefined;
  const memoryCapacityGb = value.memoryCapacityGb === undefined ? undefined : [16, 32, 64, 128].includes(Number(value.memoryCapacityGb)) ? Number(value.memoryCapacityGb) : undefined;
  const storageCapacityGb = value.storageCapacityGb === undefined ? undefined : boundedInteger(value.storageCapacityGb, 1, 100_000);
  const hddCapacityGb = value.hddCapacityGb === undefined ? undefined : boundedInteger(value.hddCapacityGb, 1, 100_000);
  const hddCount = value.hddCount === undefined ? undefined : boundedInteger(value.hddCount, 0, 8);
  const includeNonRetail = value.includeNonRetail === undefined ? undefined : typeof value.includeNonRetail === "boolean" ? value.includeNonRetail : undefined;
  const listingPolicy = value.listingPolicy === undefined ? undefined : LISTING_POLICY_VALUES.includes(value.listingPolicy as ListingPolicy) ? value.listingPolicy as ListingPolicy : undefined;
  if (!profile || budgetWon === undefined || includeGpu === undefined) return { error: "예산 비교 생성 조건에 목적·예산·외장 그래픽 포함 여부가 필요합니다." };
  if (value.priority !== undefined && priority === undefined) return { error: "예산 비교 생성 조건의 우선순위가 올바르지 않습니다." };
  if (value.gamingResolution !== undefined && gamingResolution === undefined) return { error: "예산 비교 생성 조건의 게임 해상도가 올바르지 않습니다." };
  if (value.gamingRefreshRate !== undefined && gamingRefreshRate === undefined) return { error: "예산 비교 생성 조건의 주사율이 올바르지 않습니다." };
  if (value.memoryCapacityGb !== undefined && memoryCapacityGb === undefined) return { error: "예산 비교 생성 조건의 RAM 용량이 올바르지 않습니다." };
  if (value.storageCapacityGb !== undefined && storageCapacityGb === undefined) return { error: "예산 비교 생성 조건의 SSD 용량이 올바르지 않습니다." };
  if (value.hddCapacityGb !== undefined && hddCapacityGb === undefined) return { error: "예산 비교 생성 조건의 HDD 용량이 올바르지 않습니다." };
  if (value.hddCount !== undefined && hddCount === undefined) return { error: "예산 비교 생성 조건의 HDD 개수가 올바르지 않습니다." };
  if (value.includeNonRetail !== undefined && includeNonRetail === undefined) return { error: "예산 비교 생성 조건의 유통 범위가 올바르지 않습니다." };
  if (value.listingPolicy !== undefined && listingPolicy === undefined) return { error: "예산 비교 생성 조건의 구매 조건이 올바르지 않습니다." };
  return {
    request: {
      profile,
      budgetWon,
      includeGpu,
      ...(priority ? { priority } : {}),
      ...(gamingResolution ? { gamingResolution } : {}),
      ...(gamingRefreshRate ? { gamingRefreshRate } : {}),
      ...(memoryCapacityGb ? { memoryCapacityGb } : {}),
      ...(storageCapacityGb ? { storageCapacityGb } : {}),
      ...(hddCapacityGb ? { hddCapacityGb } : {}),
      ...(hddCount !== undefined ? { hddCount } : {}),
      ...(includeNonRetail !== undefined ? { includeNonRetail } : {}),
      ...(listingPolicy ? { listingPolicy } : {})
    }
  };
}

function linesFromUnknown(value: unknown): { lines?: BudgetLadderExportLine[]; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > PART_CATEGORIES.length) return { error: "예산 비교 부품 목록 형식이 올바르지 않습니다." };
  const lines = value.flatMap((item) => {
    if (!isRecord(item) || !PART_CATEGORIES.includes(item.category as typeof PART_CATEGORIES[number])) return [];
    const text = textValue(item.text, 400);
    const partId = item.partId === undefined || item.partId === null || item.partId === "" ? undefined : textValue(item.partId, 120);
    const quantity = item.quantity === undefined || item.quantity === null || item.quantity === "" ? undefined : boundedInteger(item.quantity, 1, 99);
    if (!text || (item.partId !== undefined && item.partId !== null && item.partId !== "" && !partId) || (item.quantity !== undefined && item.quantity !== null && item.quantity !== "" && quantity === undefined)) return [];
    if ((partId && quantity === undefined) || (quantity !== undefined && !partId)) return [];
    return [{ category: item.category as typeof PART_CATEGORIES[number], text, ...(partId ? { partId } : {}), ...(quantity !== undefined ? { quantity } : {}) }];
  });
  if (lines.length !== value.length || new Set(lines.map((line) => line.category)).size !== lines.length) return { error: "예산 비교 부품 목록에 중복되거나 비어 있는 범주가 있습니다." };
  return { lines };
}

function exportItemFromUnknown(value: unknown): { item?: BudgetLadderExportItem; error?: string } {
  if (!isRecord(value)) return { error: "예산 비교 구간 형식이 올바르지 않습니다." };
  const id = BUDGET_LADDER_BANDS.some((band) => band.id === value.id) ? value.id as BudgetLadderExportItem["id"] : undefined;
  const band = BUDGET_LADDER_BANDS.find((candidate) => candidate.id === id);
  const budgetWon = boundedInteger(value.budgetWon, 1, 100_000_000);
  const status = EXPORT_STATUS_VALUES.includes(value.status as BudgetLadderExportItem["status"]) ? value.status as BudgetLadderExportItem["status"] : undefined;
  if (!id || !band || budgetWon === undefined || !status) return { error: "예산 비교 구간의 ID·예산·상태가 올바르지 않습니다." };
  const totalPriceWon = value.totalPriceWon === undefined ? undefined : boundedInteger(value.totalPriceWon, 0, 100_000_000_000);
  const budgetDeltaWon = value.budgetDeltaWon === undefined ? undefined : boundedNumber(value.budgetDeltaWon, -100_000_000_000, 100_000_000_000);
  const blockerCount = value.blockerCount === undefined ? undefined : boundedInteger(value.blockerCount, 0, 99);
  const warningCount = value.warningCount === undefined ? undefined : boundedInteger(value.warningCount, 0, 99);
  const unknownCount = value.unknownCount === undefined ? undefined : boundedInteger(value.unknownCount, 0, 99);
  const analysisScore = value.analysisScore === undefined ? undefined : boundedInteger(value.analysisScore, 0, 100);
  const withinBudget = value.withinBudget === undefined ? undefined : typeof value.withinBudget === "boolean" ? value.withinBudget : undefined;
  const priceComplete = value.priceComplete === undefined ? undefined : typeof value.priceComplete === "boolean" ? value.priceComplete : undefined;
  if (value.totalPriceWon !== undefined && totalPriceWon === undefined) return { error: `${band.label} 구간의 예상 합계가 올바르지 않습니다.` };
  if (value.budgetDeltaWon !== undefined && budgetDeltaWon === undefined) return { error: `${band.label} 구간의 예산 변화가 올바르지 않습니다.` };
  if (value.blockerCount !== undefined && blockerCount === undefined || value.warningCount !== undefined && warningCount === undefined || value.unknownCount !== undefined && unknownCount === undefined) return { error: `${band.label} 구간의 위험 카운트가 올바르지 않습니다.` };
  if (value.analysisScore !== undefined && analysisScore === undefined) return { error: `${band.label} 구간의 분석 점수가 올바르지 않습니다.` };
  if (value.withinBudget !== undefined && withinBudget === undefined || value.priceComplete !== undefined && priceComplete === undefined) return { error: `${band.label} 구간의 상태 값이 올바르지 않습니다.` };
  const parsedLines = linesFromUnknown(value.lines);
  if (parsedLines.error) return { error: `${band.label} ${parsedLines.error}` };
  const parsedSelection = buildSelectionFromUnknown(value.selection);
  if (parsedSelection.error) return { error: `${band.label} ${parsedSelection.error}` };
  const error = textValue(value.error, 500);
  const diagnostics = diagnosticsFromUnknown(value.diagnostics);
  if (value.diagnostics !== undefined && diagnostics === undefined) return { error: `${band.label} 구간의 실패 근거 형식이 올바르지 않습니다.` };
  if (status !== "생성 실패" && totalPriceWon === undefined) return { error: `${band.label} 구간의 성공 결과에 예상 합계가 없습니다.` };
  return {
    item: {
      id,
      label: band.label,
      description: band.description,
      budgetWon,
      status,
      ...(totalPriceWon !== undefined ? { totalPriceWon } : {}),
      ...(budgetDeltaWon !== undefined ? { budgetDeltaWon } : {}),
      ...(withinBudget !== undefined ? { withinBudget } : {}),
      ...(priceComplete !== undefined ? { priceComplete } : {}),
      ...(blockerCount !== undefined ? { blockerCount } : {}),
      ...(warningCount !== undefined ? { warningCount } : {}),
      ...(unknownCount !== undefined ? { unknownCount } : {}),
      ...(analysisScore !== undefined ? { analysisScore } : {}),
      ...(parsedLines.lines ? { lines: parsedLines.lines } : {}),
      ...(parsedSelection.selection ? { selection: parsedSelection.selection } : {}),
      ...(error ? { error } : {}),
      ...(diagnostics ? { diagnostics } : {})
    }
  };
}

function changeFromUnknown(value: unknown): { change?: BudgetLadderChange; error?: string } {
  if (!isRecord(value)) return { error: "예산 비교 diff 형식이 올바르지 않습니다." };
  const fromIndex = BUDGET_LADDER_BANDS.findIndex((band) => band.id === value.fromId);
  const toIndex = BUDGET_LADDER_BANDS.findIndex((band) => band.id === value.toId);
  if (fromIndex < 0 || toIndex !== fromIndex + 1) return { error: "예산 비교 diff는 인접 구간만 저장할 수 있습니다." };
  const budgetDeltaWon = boundedInteger(value.budgetDeltaWon, -100_000_000_000, 100_000_000_000);
  const totalPriceDeltaWon = boundedInteger(value.totalPriceDeltaWon, -100_000_000_000, 100_000_000_000);
  const blockerDelta = boundedInteger(value.blockerDelta, -99, 99);
  const warningDelta = boundedInteger(value.warningDelta, -99, 99);
  const unknownDelta = boundedInteger(value.unknownDelta, -99, 99);
  const sameConfiguration = typeof value.sameConfiguration === "boolean" ? value.sameConfiguration : undefined;
  if (budgetDeltaWon === undefined || totalPriceDeltaWon === undefined || blockerDelta === undefined || warningDelta === undefined || unknownDelta === undefined || sameConfiguration === undefined) return { error: "예산 비교 diff의 변화 값이 올바르지 않습니다." };
  const analysisScoreDelta = value.analysisScoreDelta === undefined ? undefined : boundedInteger(value.analysisScoreDelta, -100, 100);
  if (value.analysisScoreDelta !== undefined && analysisScoreDelta === undefined) return { error: "예산 비교 diff의 분석 점수 변화가 올바르지 않습니다." };
  if (!Array.isArray(value.changedLines) || value.changedLines.length > PART_CATEGORIES.length) return { error: "예산 비교 diff의 부품 변경 목록이 올바르지 않습니다." };
  const changedLines = value.changedLines.flatMap((item) => {
    if (!isRecord(item) || !PART_CATEGORIES.includes(item.category as typeof PART_CATEGORIES[number])) return [];
    const label = textValue(item.label, 120);
    const before = textValue(item.before, 400);
    const after = textValue(item.after, 400);
    return label && before && after ? [{ category: item.category as typeof PART_CATEGORIES[number], label, before, after }] : [];
  });
  if (changedLines.length !== value.changedLines.length || new Set(changedLines.map((line) => line.category)).size !== changedLines.length) return { error: "예산 비교 diff의 부품 변경 목록이 올바르지 않습니다." };
  const from = BUDGET_LADDER_BANDS[fromIndex];
  const to = BUDGET_LADDER_BANDS[toIndex];
  return {
    change: {
      fromId: from.id,
      toId: to.id,
      fromLabel: from.label,
      toLabel: to.label,
      budgetDeltaWon,
      totalPriceDeltaWon,
      blockerDelta,
      warningDelta,
      unknownDelta,
      ...(analysisScoreDelta !== undefined ? { analysisScoreDelta } : {}),
      sameConfiguration,
      changedLines
    }
  };
}

function payloadFromUnknown(value: unknown): { payload?: BudgetLadderExportPayload; error?: string } {
  if (!isRecord(value) || value.type !== "pc-supporter-budget-ladder" || value.version !== 1 || typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt)) || !Array.isArray(value.items) || value.items.length !== BUDGET_LADDER_BANDS.length || !Array.isArray(value.changes) || value.changes.length > BUDGET_LADDER_BANDS.length - 1) return { error: "예산 비교 snapshot 형식이 올바르지 않습니다." };
  const parsedItems = value.items.map(exportItemFromUnknown);
  const itemErrors = parsedItems.flatMap((result) => result.error ? [result.error] : []);
  const items = parsedItems.flatMap((result) => result.item ? [result.item] : []);
  if (itemErrors.length > 0 || items.length !== BUDGET_LADDER_BANDS.length || new Set(items.map((item) => item.id)).size !== items.length) return { error: itemErrors[0] ?? "예산 비교 구간이 중복되었거나 누락되었습니다." };
  const expectedIds = BUDGET_LADDER_BANDS.map((band) => band.id);
  if (items.map((item) => item.id).sort().join(",") !== expectedIds.slice().sort().join(",")) return { error: "예산 비교 snapshot에는 절약형·목표 예산·여유형이 모두 필요합니다." };
  const parsedChanges = value.changes.map(changeFromUnknown);
  const changeErrors = parsedChanges.flatMap((result) => result.error ? [result.error] : []);
  const changes = parsedChanges.flatMap((result) => result.change ? [result.change] : []);
  if (changeErrors.length > 0 || changes.length !== value.changes.length) return { error: changeErrors[0] ?? "예산 비교 diff 형식이 올바르지 않습니다." };
  return { payload: { type: "pc-supporter-budget-ladder", version: 1, exportedAt: new Date(value.exportedAt).toISOString(), items, changes } };
}

export function parseBudgetLadderShareInput(input: unknown): BudgetLadderShareInputResult {
  if (!isRecord(input)) return { errors: ["예산 비교 공유 저장 형식이 올바르지 않습니다."] };
  const source = input as BudgetLadderShareCreateInput;
  const name = textValue(source.name, 80) ?? "PC Supporter 예산 구간 비교";
  const parsedPayload = payloadFromUnknown(source.payload);
  if (parsedPayload.error) return { name, errors: [parsedPayload.error] };
  const parsedRequest = requestFromUnknown(source.request);
  if (parsedRequest.error) return { name, errors: [parsedRequest.error] };
  const parentId = source.parentId === undefined || source.parentId === null || source.parentId === "" ? undefined : textValue(source.parentId, 120);
  if (source.parentId !== undefined && source.parentId !== null && source.parentId !== "" && !parentId) return { name, errors: ["예산 비교 원본 snapshot ID가 올바르지 않습니다."] };
  const expiresInDays = shareExpiryDaysFrom(source.expiresInDays);
  if (shareExpiryValueProvided(source.expiresInDays) && expiresInDays === undefined) return { name, errors: ["예산 비교 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다."] };
  const targetBudgetWon = parsedPayload.payload?.items.find((item) => item.id === "target")?.budgetWon;
  const normalizedRequest = parsedRequest.request && targetBudgetWon !== undefined ? { ...parsedRequest.request, budgetWon: targetBudgetWon } : parsedRequest.request;
  return { name, payload: parsedPayload.payload, ...(normalizedRequest ? { request: normalizedRequest } : {}), ...(parentId ? { parentId } : {}), ...(expiresInDays !== undefined ? { expiresInDays } : {}), errors: [] };
}

export function savedBudgetLadderFromUnknown(value: unknown): SavedBudgetLadderRecord | undefined {
  if (!isRecord(value)) return undefined;
  const parsed = parseBudgetLadderShareInput(value);
  const expiresAt = normalizeShareExpiryAt(value.expiresAt);
  const id = textValue(value.id, 120);
  const createdAt = textValue(value.createdAt, 80);
  const updatedAt = textValue(value.updatedAt, 80);
  const catalogSnapshotAt = textValue(value.catalogSnapshotAt, 80);
  const parentId = textValue(value.parentId, 120);
  const lineageId = textValue(value.lineageId, 120) ?? id;
  const versionNumber = value.versionNumber === undefined ? 1 : boundedInteger(value.versionNumber, 1, 1_000_000);
  const ownerTokenHash = typeof value.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(value.ownerTokenHash) ? value.ownerTokenHash : undefined;
  if (parsed.errors.length > 0 || !id || !createdAt || !updatedAt || !catalogSnapshotAt || !expiresAt.valid || !parsed.payload || !lineageId || versionNumber === undefined || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt)) || !Number.isFinite(Date.parse(catalogSnapshotAt))) return undefined;
  const targetBudgetWon = parsed.payload.items.find((item) => item.id === "target")?.budgetWon;
  const normalizedRequest = parsed.request && targetBudgetWon !== undefined ? { ...parsed.request, budgetWon: targetBudgetWon } : parsed.request;
  return {
    id,
    name: parsed.name ?? "PC Supporter 예산 구간 비교",
    payload: parsed.payload,
    ...(parentId ? { parentId } : {}),
    lineageId,
    versionNumber,
    ...(normalizedRequest ? { request: normalizedRequest } : {}),
    catalogSnapshotAt: new Date(catalogSnapshotAt).toISOString(),
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    ...(expiresAt.value ? { expiresAt: expiresAt.value } : {}),
    ...(ownerTokenHash ? { ownerTokenHash } : {})
  };
}

export function budgetLadderShareExpired(snapshot: Pick<BudgetLadderShareSnapshot, "expiresAt">, now = Date.now()) {
  return shareExpired(snapshot.expiresAt, now);
}

export function budgetLadderShareExpiresAtFor(expiresInDays: 7 | 30 | undefined, now: number | Date = Date.now()) {
  return shareExpiresAtFor(expiresInDays, now);
}

export function publicBudgetLadderShare(record: SavedBudgetLadderRecord, currentCatalogSnapshotAt?: string): BudgetLadderShareSnapshot {
  const { ownerTokenHash: _ownerTokenHash, ...snapshot } = record;
  if (!currentCatalogSnapshotAt) return snapshot;
  const current = new Date(currentCatalogSnapshotAt).toISOString();
  return { ...snapshot, catalogCurrentSnapshotAt: current, catalogChangedSinceShare: current !== snapshot.catalogSnapshotAt };
}
