import type { PartCategory, PhysicalSourceCheck } from "./types";

export type CatalogSpecOverrideValueType = "number" | "string" | "string_list" | "boolean";
export type CatalogSpecOverrideValue = string | number | boolean | string[];

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
  | "hddBays"
  | "fanCount"
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
  hddBays: "number",
  fanCount: "number",
  wattageW: "number",
  psuFormFactor: "string",
  psuDepthMm: "number",
  efficiency: "string"
};

const CATEGORY_FIELDS: Record<PartCategory, CatalogSpecOverrideFieldKey[]> = {
  cpu: ["socket", "tdpW", "cores", "threads"],
  cooler: ["supportedSockets", "maxCoolingW", "coolerType", "radiatorSizeMm"],
  motherboard: ["socket", "memoryType", "m2Slots", "pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots", "maxMemoryGb", "memorySlots", "sataPorts", "motherboardFormFactors"],
  memory: ["memoryType", "capacityGb", "speedMhz", "memoryFormFactor", "memoryModuleCountPerKit", "memoryProfiles"],
  gpu: ["powerW", "recommendedPsuW", "lengthMm", "widthMm", "thicknessMm", "vramGb"],
  ssd: ["interface", "capacityGb", "formFactor", "m2PcieGeneration", "lengthMm"],
  hdd: ["interface", "capacityGb", "formFactor", "lengthMm"],
  case: ["maxGpuLengthMm", "maxCoolerHeightMm", "maxPsuLengthMm", "motherboardFormFactors", "hddBays", "fanCount"],
  psu: ["wattageW", "psuFormFactor", "psuDepthMm", "efficiency"]
};

export function catalogSpecOverrideFieldTypeFor(category: PartCategory, field: string): CatalogSpecOverrideValueType | undefined {
  if (!CATEGORY_FIELDS[category].includes(field as CatalogSpecOverrideFieldKey)) return undefined;
  return FIELD_TYPES[field as CatalogSpecOverrideFieldKey];
}

export function catalogSpecOverrideFieldKeysFor(category: PartCategory) {
  return CATEGORY_FIELDS[category].filter((field) => FIELD_TYPES[field] !== undefined);
}
