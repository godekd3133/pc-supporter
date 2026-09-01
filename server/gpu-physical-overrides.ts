import type { GpuPhysicalOverride, Part, PhysicalSourceCheck } from "../shared/types";
import { GPU_PHYSICAL_OVERRIDES_PATH, readJson, writeJson } from "./storage";

export type GpuPhysicalOverrideMap = Record<string, GpuPhysicalOverride>;

export type GpuPhysicalOverrideOperation = "create" | "update" | "unchanged";

export type GpuPhysicalOverrideValidationItem = {
  partId: string;
  partName?: string;
  category?: Part["category"];
  valid: boolean;
  errors: string[];
  operation?: GpuPhysicalOverrideOperation;
  changedFields?: string[];
  override?: GpuPhysicalOverride;
};

export type GpuPhysicalOverrideBatchValidation = {
  items: GpuPhysicalOverrideValidationItem[];
  validOverrides: GpuPhysicalOverride[];
  errors: string[];
};

const MAX_SLOT_OCCUPANCY = 6;
const MAX_CLEARANCE_MM = 500;
const MAX_BATCH_SIZE = 500;
const MAX_MANUFACTURER_MODEL_LENGTH = 160;
const MAX_MANUFACTURER_REVISION_LENGTH = 120;

let overrideWriteQueue: Promise<void> = Promise.resolve();

export async function readGpuPhysicalOverrides(): Promise<GpuPhysicalOverrideMap> {
  return readJson<GpuPhysicalOverrideMap>(GPU_PHYSICAL_OVERRIDES_PATH, {});
}

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown, label: string, min: number, max: number, step?: number) {
  if (value === undefined || value === null || value === "") return { value: undefined as number | undefined };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (step !== undefined && Math.abs(parsed / step - Math.round(parsed / step)) > 1e-8)) {
    return { error: `${label}은 ${min}부터 ${max} 사이의 ${step === 0.5 ? "0.5" : "유효한"} 단위 숫자여야 합니다.` };
  }
  return { value: parsed };
}

function sourceUrlErrors(value: string) {
  if (!value) return [];
  if (value.length > 1000) return ["sourceUrl은 1,000자 이하로 입력해야 합니다."];
  try {
    return new URL(value).protocol === "https:" ? [] : ["sourceUrl은 HTTPS 주소만 사용할 수 있습니다."];
  } catch {
    return ["sourceUrl 형식이 올바르지 않습니다."];
  }
}

export function validateGpuPhysicalOverride(part: Part, input: unknown): { value?: GpuPhysicalOverride; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["override 본문은 객체여야 합니다."] };
  const body = input as Record<string, unknown>;
  const slot = optionalNumber(body.gpuSlotOccupancy, "GPU 물리 슬롯 점유", 1, MAX_SLOT_OCCUPANCY, 0.5);
  const gpuCable = optionalNumber(body.gpuCableBendClearanceMm, "GPU 케이블 굽힘 여유", 0, MAX_CLEARANCE_MM);
  const caseSide = optionalNumber(body.caseSidePanelClearanceMm, "케이스 측면 케이블 여유", 0, MAX_CLEARANCE_MM);
  const psuRuns = optionalNumber(body.psuIndependentPcieCableRuns, "PSU 독립 PCIe 케이블 런 수", 1, 8, 1);
  const rawPsuTopology = body.psuPcieCableTopology === undefined || body.psuPcieCableTopology === null || body.psuPcieCableTopology === "" ? undefined : normalizedString(body.psuPcieCableTopology);
  const psuTopology = rawPsuTopology === undefined ? undefined : rawPsuTopology === "independent" || rawPsuTopology === "shared" ? rawPsuTopology : undefined;
  if (slot.error) errors.push(slot.error);
  if (gpuCable.error) errors.push(gpuCable.error);
  if (caseSide.error) errors.push(caseSide.error);
  if (psuRuns.error) errors.push(psuRuns.error);
  if (rawPsuTopology !== undefined && psuTopology === undefined) errors.push("PSU PCIe 케이블 분배 구조는 independent 또는 shared 중 하나여야 합니다.");
  if (part.category === "gpu") {
    if (caseSide.value !== undefined) errors.push("GPU override에는 케이스 측면 케이블 여유를 입력할 수 없습니다.");
    if (psuRuns.value !== undefined || psuTopology !== undefined) errors.push("GPU override에는 PSU PCIe 케이블 구조를 입력할 수 없습니다.");
    if (slot.value === undefined && gpuCable.value === undefined) errors.push("GPU는 물리 슬롯 점유 또는 케이블 굽힘 여유 중 하나 이상이 필요합니다.");
  } else if (part.category === "case") {
    if (slot.value !== undefined || gpuCable.value !== undefined || psuRuns.value !== undefined || psuTopology !== undefined) errors.push("케이스 override에는 GPU·PSU 케이블 구조를 입력할 수 없습니다.");
    if (caseSide.value === undefined) errors.push("케이스는 측면 케이블 여유가 필요합니다.");
  } else if (part.category === "psu") {
    if (slot.value !== undefined || gpuCable.value !== undefined || caseSide.value !== undefined) errors.push("PSU override에는 GPU·케이스 물리 여유를 입력할 수 없습니다.");
    if (psuRuns.value === undefined && psuTopology === undefined) errors.push("PSU는 독립 PCIe 케이블 런 수 또는 분배 구조 중 하나 이상이 필요합니다.");
  } else {
    errors.push("GPU, 케이스 또는 PSU만 물리 호환 override 대상입니다.");
  }
  const sourceNote = normalizedString(body.sourceNote);
  if (!sourceNote) errors.push("검수 근거 sourceNote가 필요합니다.");
  if (sourceNote.length > 500) errors.push("sourceNote는 500자 이하로 입력해야 합니다.");
  const manufacturerModel = normalizedString(body.manufacturerModel);
  if (!manufacturerModel) errors.push("제조사 모델/SKU(manufacturerModel)가 필요합니다.");
  if (manufacturerModel.length > MAX_MANUFACTURER_MODEL_LENGTH) errors.push(`manufacturerModel은 ${MAX_MANUFACTURER_MODEL_LENGTH}자 이하로 입력해야 합니다.`);
  const manufacturerRevision = normalizedString(body.manufacturerRevision);
  if (manufacturerRevision.length > MAX_MANUFACTURER_REVISION_LENGTH) errors.push(`manufacturerRevision은 ${MAX_MANUFACTURER_REVISION_LENGTH}자 이하로 입력해야 합니다.`);
  const sourceUrl = normalizedString(body.sourceUrl);
  errors.push(...sourceUrlErrors(sourceUrl));
  if (errors.length > 0) return { errors };
  return {
    value: {
      partId: part.id,
      ...(slot.value !== undefined ? { gpuSlotOccupancy: slot.value } : {}),
      ...(gpuCable.value !== undefined ? { gpuCableBendClearanceMm: gpuCable.value } : {}),
      ...(caseSide.value !== undefined ? { caseSidePanelClearanceMm: caseSide.value } : {}),
      ...(psuRuns.value !== undefined ? { psuIndependentPcieCableRuns: psuRuns.value } : {}),
      ...(psuTopology !== undefined ? { psuPcieCableTopology: psuTopology } : {}),
      manufacturerModel,
      ...(manufacturerRevision ? { manufacturerRevision } : {}),
      sourceNote,
      ...(sourceUrl ? { sourceUrl } : {}),
      updatedAt: new Date().toISOString()
    },
    errors
  };
}

function normalizedBatchItems(input: unknown) {
  if (Array.isArray(input)) return input as unknown[];
  if (input && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as Record<string, unknown>).items)) {
    return (input as Record<string, unknown>).items as unknown[];
  }
  return undefined;
}

const OVERRIDE_FIELDS = [
  "gpuSlotOccupancy",
  "gpuCableBendClearanceMm",
  "caseSidePanelClearanceMm",
  "psuIndependentPcieCableRuns",
  "psuPcieCableTopology",
  "manufacturerModel",
  "manufacturerRevision",
  "sourceNote",
  "sourceUrl"
] as const;

export function validateGpuPhysicalOverrideBatch(input: unknown, catalog: Part[], existingOverrides: GpuPhysicalOverrideMap = {}): GpuPhysicalOverrideBatchValidation {
  const rawItems = normalizedBatchItems(input);
  if (!rawItems) return { items: [], validOverrides: [], errors: ["items는 GPU·케이스·PSU 물리 호환 override 배열이어야 합니다."] };
  if (rawItems.length < 1) return { items: [], validOverrides: [], errors: ["items는 최소 1개가 필요합니다."] };
  if (rawItems.length > MAX_BATCH_SIZE) return { items: [], validOverrides: [], errors: [`한 번에 최대 ${MAX_BATCH_SIZE}개 부품까지 처리할 수 있습니다.`] };

  const items: GpuPhysicalOverrideValidationItem[] = [];
  const validOverrides: GpuPhysicalOverride[] = [];
  const errors: string[] = [];
  const seenPartIds = new Set<string>();

  rawItems.forEach((rawItem, index) => {
    const itemErrors: string[] = [];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      items.push({ partId: `items[${index}]`, valid: false, errors: ["항목은 객체여야 합니다."] });
      return;
    }
    const candidate = rawItem as Record<string, unknown>;
    const partId = normalizedString(candidate.partId);
    if (!partId) {
      items.push({ partId: `items[${index}]`, valid: false, errors: ["partId가 필요합니다."] });
      return;
    }
    if (seenPartIds.has(partId)) itemErrors.push("같은 partId가 일괄 입력에서 중복되었습니다.");
    seenPartIds.add(partId);
    const part = catalog.find((item) => item.id === partId);
    if (!part) itemErrors.push("카탈로그에서 부품을 찾을 수 없습니다.");
    const category = normalizedString(candidate.category);
    if (category && part && category !== part.category) itemErrors.push(`category가 카탈로그 범주(${part.category})와 다릅니다.`);
    if (category && category !== "gpu" && category !== "case" && category !== "psu") itemErrors.push("category는 gpu, case 또는 psu여야 합니다.");

    const validation = part ? validateGpuPhysicalOverride(part, candidate) : { errors: [] as string[] };
    itemErrors.push(...validation.errors);
    const item: GpuPhysicalOverrideValidationItem = {
      partId,
      ...(part ? { partName: part.name, category: part.category } : {}),
      valid: itemErrors.length === 0,
      errors: itemErrors
    };
    if (itemErrors.length === 0 && part && validation.value) {
      const override = validation.value;
      const existing = existingOverrides[partId];
      const changedFields = OVERRIDE_FIELDS.filter((field) => !Object.is(existing?.[field], override[field])).map((field) => field);
      item.operation = existing ? changedFields.length > 0 ? "update" : "unchanged" : "create";
      item.changedFields = changedFields;
      item.override = override;
      validOverrides.push(override);
    }
    items.push(item);
  });

  errors.push(...items.flatMap((item) => item.errors.map((error) => `${item.partId}: ${error}`)));
  return { items, validOverrides: errors.length === 0 ? validOverrides : [], errors };
}

export function applyGpuPhysicalOverrides(parts: Part[], overrides: GpuPhysicalOverrideMap) {
  return parts.map((part) => {
    const override = overrides[part.id];
    if (!override) return part;
    const specs = { ...part.specs };
    if (part.category === "gpu") {
      if (override.gpuSlotOccupancy !== undefined) specs.gpuSlotOccupancy = override.gpuSlotOccupancy;
      if (override.gpuCableBendClearanceMm !== undefined) specs.gpuCableBendClearanceMm = override.gpuCableBendClearanceMm;
    }
    if (part.category === "case" && override.caseSidePanelClearanceMm !== undefined) specs.caseSidePanelClearanceMm = override.caseSidePanelClearanceMm;
    if (part.category === "psu") {
      if (override.psuIndependentPcieCableRuns !== undefined) specs.psuIndependentPcieCableRuns = override.psuIndependentPcieCableRuns;
      if (override.psuPcieCableTopology !== undefined) specs.psuPcieCableTopology = override.psuPcieCableTopology;
    }
    if (part.category === "gpu" || part.category === "case" || part.category === "psu") {
      specs.physicalEvidenceSourceNote = override.sourceNote;
      if (override.sourceUrl !== undefined) specs.physicalEvidenceSourceUrl = override.sourceUrl;
      else delete specs.physicalEvidenceSourceUrl;
      specs.physicalEvidenceManufacturerModel = override.manufacturerModel;
      if (override.manufacturerRevision !== undefined) specs.physicalEvidenceManufacturerRevision = override.manufacturerRevision;
      else delete specs.physicalEvidenceManufacturerRevision;
      if (override.sourceCheck !== undefined) specs.physicalEvidenceSourceCheck = override.sourceCheck;
      else delete specs.physicalEvidenceSourceCheck;
      specs.physicalEvidenceUpdatedAt = override.updatedAt;
    }
    return { ...part, specs };
  });
}

export function stripGpuPhysicalOverrides(part: Part): Part {
  if (part.specs.gpuSlotOccupancy === undefined && part.specs.gpuCableBendClearanceMm === undefined && part.specs.caseSidePanelClearanceMm === undefined && part.specs.psuIndependentPcieCableRuns === undefined && part.specs.psuPcieCableTopology === undefined && part.specs.physicalEvidenceSourceNote === undefined && part.specs.physicalEvidenceSourceUrl === undefined && part.specs.physicalEvidenceManufacturerModel === undefined && part.specs.physicalEvidenceManufacturerRevision === undefined && part.specs.physicalEvidenceUpdatedAt === undefined && part.specs.physicalEvidenceSourceCheck === undefined) return part;
  const specs = { ...part.specs };
  delete specs.gpuSlotOccupancy;
  delete specs.gpuCableBendClearanceMm;
  delete specs.caseSidePanelClearanceMm;
  delete specs.psuIndependentPcieCableRuns;
  delete specs.psuPcieCableTopology;
  delete specs.physicalEvidenceSourceNote;
  delete specs.physicalEvidenceSourceUrl;
  delete specs.physicalEvidenceManufacturerModel;
  delete specs.physicalEvidenceManufacturerRevision;
  delete specs.physicalEvidenceUpdatedAt;
  delete specs.physicalEvidenceSourceCheck;
  return { ...part, specs };
}

async function withOverrideWriteLock<T>(mutate: (overrides: GpuPhysicalOverrideMap) => { value: T; changed: boolean } | Promise<{ value: T; changed: boolean }>) {
  const operation = overrideWriteQueue.then(async () => {
    const overrides = await readGpuPhysicalOverrides();
    const result = await mutate(overrides);
    if (result.changed) await writeJson(GPU_PHYSICAL_OVERRIDES_PATH, overrides);
    return result.value;
  });
  overrideWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function saveGpuPhysicalOverride(value: GpuPhysicalOverride) {
  return withOverrideWriteLock((overrides) => {
    overrides[value.partId] = value;
    return { value, changed: true };
  });
}

export async function saveGpuPhysicalOverrides(values: GpuPhysicalOverride[]) {
  return withOverrideWriteLock((overrides) => {
    for (const value of values) overrides[value.partId] = value;
    return { value: values, changed: values.length > 0 };
  });
}

export async function saveGpuPhysicalSourceCheck(partId: string, sourceCheck: PhysicalSourceCheck) {
  return withOverrideWriteLock((overrides) => {
    const existing = overrides[partId];
    if (!existing) return { value: undefined, changed: false };
    const next = { ...existing, sourceCheck };
    overrides[partId] = next;
    return { value: next, changed: true };
  });
}

export async function deleteGpuPhysicalOverride(partId: string) {
  return withOverrideWriteLock((overrides) => {
    if (!overrides[partId]) return { value: false, changed: false };
    delete overrides[partId];
    return { value: true, changed: true };
  });
}
