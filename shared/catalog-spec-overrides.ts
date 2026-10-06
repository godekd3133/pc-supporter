import type { PartCategory, PartSpecs, PhysicalSourceCheck, RadiatorMountRequirement, RadiatorSupport } from "./types";

export type CatalogSpecOverrideValueType = "number" | "string" | "string_list" | "number_list" | "radiator_support_list" | "boolean";
export type CatalogSpecOverrideValue = string | number | boolean | string[] | number[] | RadiatorSupport[];

export interface CatalogSpecOverride {
  partId: string;
  category: PartCategory;
  fields: Partial<Record<CatalogSpecOverrideFieldKey, CatalogSpecOverrideValue>>;
  manufacturerModel: string;
  sourceNote: string;
  sourceUrl: string;
  updatedAt: string;
  sourceCheck?: PhysicalSourceCheck;
}

export type CatalogSpecOverrideOperation = "create" | "update" | "unchanged";

export type CatalogSpecOverrideFieldKey =
  | "socket"
  | "tdpW"
  | "cores"
  | "threads"
  | "supportedSockets"
  | "maxCoolingW"
  | "coolerType"
  | "radiatorSizeMm"
  | "radiatorThicknessMm"
  | "radiatorFanThicknessMm"
  | "radiatorWidthMm"
  | "radiatorLengthMm"
  | "memoryHeightMm"
  | "radiatorPosition"
  | "memoryType"
  | "m2Slots"
  | "pcieX16Slots"
  | "pcieX8Slots"
  | "pcieX4Slots"
  | "pcieX1Slots"
  | "maxMemoryGb"
  | "memorySlots"
  | "sataPorts"
  | "motherboardFormFactors"
  | "vrmCapacityW"
  | "capacityGb"
  | "speedMhz"
  | "memoryFormFactor"
  | "memoryModuleCountPerKit"
  | "memoryProfiles"
  | "powerW"
  | "recommendedPsuW"
  | "lengthMm"
  | "widthMm"
  | "thicknessMm"
  | "vramGb"
  | "interface"
  | "formFactor"
  | "m2PcieGeneration"
  | "maxGpuLengthMm"
  | "maxCoolerHeightMm"
  | "maxPsuLengthMm"
  | "radiatorSizesMm"
  | "radiatorSupports"
  | "supportedPsuFormFactors"
  | "ssdBays"
  | "hddBays"
  | "fanCount"
  | "lowProfileOnly"
  | "lowProfileBracket"
  | "wattageW"
  | "psuFormFactor"
  | "psuDepthMm"
  | "efficiency";

const FIELD_TYPES: Partial<Record<CatalogSpecOverrideFieldKey, CatalogSpecOverrideValueType>> = {
  socket: "string",
  tdpW: "number",
  cores: "number",
  threads: "number",
  supportedSockets: "string_list",
  maxCoolingW: "number",
  coolerType: "string",
  radiatorSizeMm: "number",
  radiatorThicknessMm: "number",
  radiatorFanThicknessMm: "number",
  radiatorWidthMm: "number",
  radiatorLengthMm: "number",
  memoryHeightMm: "number",
  radiatorPosition: "string",
  memoryType: "string",
  m2Slots: "number",
  pcieX16Slots: "number",
  pcieX8Slots: "number",
  pcieX4Slots: "number",
  pcieX1Slots: "number",
  maxMemoryGb: "number",
  memorySlots: "number",
  sataPorts: "number",
  motherboardFormFactors: "string_list",
  vrmCapacityW: "number",
  capacityGb: "number",
  speedMhz: "number",
  memoryFormFactor: "string",
  memoryModuleCountPerKit: "number",
  memoryProfiles: "string_list",
  powerW: "number",
  recommendedPsuW: "number",
  lengthMm: "number",
  widthMm: "number",
  thicknessMm: "number",
  vramGb: "number",
  interface: "string",
  formFactor: "string",
  m2PcieGeneration: "number",
  maxGpuLengthMm: "number",
  maxCoolerHeightMm: "number",
  maxPsuLengthMm: "number",
  radiatorSizesMm: "number_list",
  radiatorSupports: "radiator_support_list",
  supportedPsuFormFactors: "string_list",
  ssdBays: "number",
  hddBays: "number",
  fanCount: "number",
  lowProfileOnly: "boolean",
  lowProfileBracket: "boolean",
  wattageW: "number",
  psuFormFactor: "string",
  psuDepthMm: "number",
  efficiency: "string"
};

const CATEGORY_FIELDS: Record<PartCategory, CatalogSpecOverrideFieldKey[]> = {
  cpu: ["socket", "tdpW", "cores", "threads"],
  cooler: ["supportedSockets", "maxCoolingW", "coolerType", "radiatorSizeMm", "radiatorPosition", "radiatorThicknessMm", "radiatorFanThicknessMm", "radiatorWidthMm", "radiatorLengthMm", "maxCoolerHeightMm"],
  motherboard: ["socket", "memoryType", "m2Slots", "pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots", "maxMemoryGb", "memorySlots", "sataPorts", "motherboardFormFactors", "vrmCapacityW"],
  memory: ["memoryType", "capacityGb", "speedMhz", "memoryFormFactor", "memoryModuleCountPerKit", "memoryProfiles", "memoryHeightMm"],
  gpu: ["powerW", "recommendedPsuW", "lengthMm", "widthMm", "thicknessMm", "vramGb", "lowProfileBracket"],
  ssd: ["interface", "capacityGb", "formFactor", "m2PcieGeneration", "lengthMm"],
  hdd: ["interface", "capacityGb", "formFactor", "lengthMm"],
  case: ["maxGpuLengthMm", "maxCoolerHeightMm", "maxPsuLengthMm", "radiatorSizesMm", "radiatorSupports", "supportedPsuFormFactors", "ssdBays", "motherboardFormFactors", "hddBays", "fanCount", "lowProfileOnly"],
  psu: ["wattageW", "psuFormFactor", "psuDepthMm", "efficiency"]
};

export function catalogSpecOverrideFieldTypeFor(category: PartCategory, field: string): CatalogSpecOverrideValueType | undefined {
  if (!CATEGORY_FIELDS[category].includes(field as CatalogSpecOverrideFieldKey)) return undefined;
  return FIELD_TYPES[field as CatalogSpecOverrideFieldKey];
}

export function catalogSpecOverrideFieldKeysFor(category: PartCategory) {
  return CATEGORY_FIELDS[category].filter((field) => FIELD_TYPES[field] !== undefined);
}

const CASE_SUPPORT_FIELDS = new Set(["radiatorSizesMm", "radiatorSupports", "supportedPsuFormFactors", "ssdBays"]);
const RADIATOR_POSITIONS = new Set(["front", "top", "bottom", "side", "rear", "psu_shroud"]);
const PSU_FORM_FACTORS = new Set(["ATX", "SFX", "SFX-L"]);
const RADIATOR_DIMENSION_LIMITS = ["maxRadiatorThicknessMm", "maxAssemblyThicknessMm", "maxMemoryHeightMm", "maxRadiatorWidthMm", "maxRadiatorLengthMm", "maxGpuLengthMm"] as const;
const RADIATOR_REQUIREMENT_KEYS = new Set<string>([...RADIATOR_DIMENSION_LIMITS, "sizesMm", "exclusiveUpperBound", "configurationNote"]);

export function isCatalogCaseSupportOverrideField(field: string) {
  return CASE_SUPPORT_FIELDS.has(field);
}

/** Empty parsed support lists mean the source did not supply this information. */
export function catalogSpecOverrideFieldIsMissing(specs: PartSpecs, field: string) {
  const value = (specs as Record<string, unknown>)[field];
  const type = FIELD_TYPES[field as CatalogSpecOverrideFieldKey];
  const listField = type === "string_list" || type === "number_list" || type === "radiator_support_list";
  return value === undefined || listField && Array.isArray(value) && value.length === 0;
}

function positiveIntegerList(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16
    || Array.from(value).some((item) => typeof item !== "number" || !Number.isInteger(item) || item <= 0 || item > 100_000)
    || new Set(value).size !== value.length) return undefined;
  return [...value];
}

function radiatorRequirementsFor(value: unknown, supportedSizesMm: number[]): RadiatorMountRequirement[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return undefined;
  const requirements: RadiatorMountRequirement[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !RADIATOR_REQUIREMENT_KEYS.has(key))) return undefined;
    const candidate = item as Record<string, unknown>;
    const requirement: RadiatorMountRequirement = {};
    if (Object.hasOwn(candidate, "sizesMm")) {
      const sizesMm = positiveIntegerList(candidate.sizesMm);
      if (!sizesMm || sizesMm.some((size) => !supportedSizesMm.includes(size))) return undefined;
      requirement.sizesMm = sizesMm;
    }
    let dimensionCount = 0;
    for (const field of RADIATOR_DIMENSION_LIMITS) {
      if (!Object.hasOwn(candidate, field)) continue;
      const limit = candidate[field];
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0 || limit > 100_000) return undefined;
      requirement[field] = limit;
      dimensionCount += 1;
    }
    if (Object.hasOwn(candidate, "configurationNote")) {
      if (typeof candidate.configurationNote !== "string") return undefined;
      const note = candidate.configurationNote.trim();
      if (!note || note.length > 500) return undefined;
      requirement.configurationNote = note;
    }
    if (dimensionCount === 0 && !requirement.configurationNote) return undefined;
    if (Object.hasOwn(candidate, "exclusiveUpperBound")) {
      if (typeof candidate.exclusiveUpperBound !== "boolean" || candidate.exclusiveUpperBound && dimensionCount === 0) return undefined;
      requirement.exclusiveUpperBound = candidate.exclusiveUpperBound;
    }
    const fingerprint = JSON.stringify(requirement);
    if (seen.has(fingerprint)) return undefined;
    seen.add(fingerprint);
    requirements.push(requirement);
  }
  return requirements;
}

/** Shared by runtime overrides and the private catalog importer. */
export function catalogCaseSupportOverrideValueFor(field: string, value: unknown): CatalogSpecOverrideValue | undefined {
  if (field === "ssdBays") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : undefined;
  }
  if (field === "radiatorSizesMm") return positiveIntegerList(value);
  if (field === "supportedPsuFormFactors") {
    if (!Array.isArray(value) || value.length < 1 || value.length > 16
      || Array.from(value).some((item) => typeof item !== "string" || !PSU_FORM_FACTORS.has(item))
      || new Set(value).size !== value.length) return undefined;
    return [...value];
  }
  if (field !== "radiatorSupports" || !Array.isArray(value) || value.length < 1 || value.length > 16) return undefined;
  const positions = new Set<string>();
  const supports: RadiatorSupport[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some((key) => key !== "position" && key !== "sizesMm" && key !== "requirements")) return undefined;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.position !== "string" || !RADIATOR_POSITIONS.has(candidate.position) || positions.has(candidate.position)) return undefined;
    const sizesMm = positiveIntegerList(candidate.sizesMm);
    if (!sizesMm) return undefined;
    const requirements = Object.hasOwn(candidate, "requirements") ? radiatorRequirementsFor(candidate.requirements, sizesMm) : undefined;
    if (Object.hasOwn(candidate, "requirements") && !requirements) return undefined;
    positions.add(candidate.position);
    supports.push({ position: candidate.position as RadiatorSupport["position"], sizesMm, ...(requirements ? { requirements } : {}) });
  }
  return supports;
}
