import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { ACCESSORY_CATEGORIES, PART_CATEGORIES } from "../shared/types";
import type { AccessoryCategory, AccessoryItem, Part, PartCategory } from "../shared/types";
import { OFFLINE_CATALOG_KIND, OFFLINE_CATALOG_SCHEMA_VERSION } from "../shared/offline-catalog";
import type { OfflineCatalogSnapshot } from "../shared/offline-catalog";

const MAX_MANIFEST_BYTES = 32_000;
const MAX_SOURCE_FILE_BYTES = 128 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

type SourceManifest = {
  schemaVersion: 1;
  kind: "pc-supporter-effective-catalog-snapshot";
  revision: string;
  snapshotAt: string;
  accessorySnapshotAt: string;
  catalogRevision: number;
  parts: { file: "catalog.json"; sha256: string; categories: PartCategory[] };
  accessories: { file: "accessories.json"; sha256: string; categories: AccessoryCategory[] };
};

const PART_KEYS = new Set([
  "id", "category", "name", "brand", "model", "danawaUrl", "source", "sourceProductCode", "sourceCategoryId",
  "listingType", "priceWon", "rawSpecText", "specs", "dataQuality", "missingFields", "updatedAt", "priceCheckedAt"
]);
const ACCESSORY_KEYS = new Set([...PART_KEYS, "listingType"]);
const OMITTED_ITEM_KEYS = new Set(["imageUrl", "dataFreshness"]);
const OMITTED_SPEC_KEYS = new Set([
  "benchmarkProvenance", "physicalEvidenceSourceNote", "fanLoadProvenance", "rgbDeviceLoadProvenance",
  "cinebenchR23Single", "cinebenchR23Multi", "gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"
]);
const SPEC_STRING_KEYS = new Set([
  "socket", "memoryType", "memoryTiming", "ssdController", "ssdNandType", "m2LaneSharingNote", "interface",
  "formFactor", "gpuArchitectureFamily", "gpuMemoryType", "coolerType", "radiatorPosition", "efficiency",
  "psuFormFactor", "psuCableType", "psuRailType", "psuPcieCableTopology", "gpuVendor", "rgbDeviceVoltage",
  "physicalEvidenceSourceUrl", "physicalEvidenceManufacturerModel", "physicalEvidenceManufacturerRevision", "physicalEvidenceUpdatedAt"
]);
const SPEC_NUMBER_KEYS = new Set([
  "memoryModuleCountPerKit", "memoryCasLatency", "memoryEffectiveLatencyNs", "memoryRcdLatency", "memoryTrpLatency",
  "memoryTrasLatency", "memoryVoltageV", "cores", "threads", "boostClockGhz", "l3CacheMb", "maxMemoryGb",
  "memorySlots", "maxMemorySpeedMhz", "speedMhz", "capacityGb",
  "adapterStorageDeviceCount", "adapterPcieSlotWidth", "sequentialReadMbps", "sequentialWriteMbps", "ssdTbwTb",
  "ssdReadIops", "ssdWriteIops", "tdpW", "pptW", "vrmCapacityW", "m2Slots", "m2PcieGeneration", "pcieX16Slots",
  "pcieX8Slots", "pcieX4Slots", "pcieX1Slots", "pcieSlotWidth", "sataPorts", "powerW", "recommendedPsuW",
  "vramGb", "gpuBoostClockMhz", "gpuStreamProcessors", "gpuMemoryBandwidthGbps", "lengthMm", "widthMm",
  "thicknessMm", "gpuSlotOccupancy", "gpuCableBendClearanceMm",
  "maxGpuLengthMm", "maxCoolerHeightMm", "maxPsuLengthMm", "radiatorSizeMm", "hddBays", "ssdBays", "maxCoolingW",
  "wattageW", "psuDepthMm", "psuIndependentPcieCableRuns", "caseSidePanelClearanceMm", "fanCount", "fanCurrentA",
  "fanPortCount", "rgbPortCount", "rgb5vPortCount", "rgb12vPortCount", "rgbDeviceCount", "rgbDeviceCurrentA",
  "rgbDevicePowerW", "outputW", "capacityVa", "outletCount", "capacityG", "thermalConductivityWmK"
]);
const SPEC_BOOLEAN_KEYS = new Set(["integratedGraphics", "wifi", "m2LaneSharing", "coolerIncluded", "rgbControllerIncluded"]);
const SPEC_STRING_ARRAY_KEYS = new Set([
  "supportedSockets", "memoryProfiles", "m2Interfaces", "m2LaneSharingScopes", "supportedFormFactors",
  "motherboardFormFactors", "supportedPsuFormFactors"
]);
const SPEC_NUMBER_ARRAY_KEYS = new Set(["m2PcieGenerations", "radiatorSizesMm"]);
const OMITTED_PROVENANCE_KEYS = new Set(["sourceNote", "baseSpecValues"]);

function projectSourceCheck(value: unknown, label: string) {
  if (!isRecord(value)) fail(`${label} 객체가 필요합니다.`);
  onlyKnownKeys(value, new Set(["requestedUrl", "checkedAt", "status", "identityStatus", "redirectCount", "finalUrl", "httpStatus", "contentType"]), new Set(["detail"]), label);
  const statuses = ["reachable", "redirected", "http_error", "unreachable", "blocked", "identity_mismatch"];
  const identities = ["matched", "not_found", "manual_required", "not_checked"];
  if (!isTimestamp(value.checkedAt) || typeof value.status !== "string" || !statuses.includes(value.status) || typeof value.identityStatus !== "string" || !identities.includes(value.identityStatus) || typeof value.redirectCount !== "number" || !Number.isSafeInteger(value.redirectCount) || value.redirectCount < 0) fail(`${label} 상태 필드가 올바르지 않습니다.`);
  if (value.httpStatus !== undefined && (typeof value.httpStatus !== "number" || !Number.isSafeInteger(value.httpStatus))) fail(`${label}.httpStatus 값이 올바르지 않습니다.`);
  if (value.contentType !== undefined && typeof value.contentType !== "string") fail(`${label}.contentType 값이 올바르지 않습니다.`);
  const requestedUrl = safeExternalUrl(value.requestedUrl, `${label}.requestedUrl`);
  if (!requestedUrl) fail(`${label}.requestedUrl 값이 필요합니다.`);
  return {
    requestedUrl,
    checkedAt: value.checkedAt,
    status: value.status,
    identityStatus: value.identityStatus,
    redirectCount: value.redirectCount,
    ...(value.finalUrl !== undefined ? { finalUrl: safeExternalUrl(value.finalUrl, `${label}.finalUrl`) } : {}),
    ...(value.httpStatus === undefined ? {} : { httpStatus: value.httpStatus }),
    ...(typeof value.contentType === "string" ? { contentType: stringValue(value.contentType, `${label}.contentType`, 120) } : {})
  };
}

function projectCatalogSpecProvenance(value: unknown) {
  if (!isRecord(value)) fail("specs.catalogSpecProvenance 객체가 필요합니다.");
  onlyKnownKeys(value, new Set(["manufacturerModel", "sourceUrl", "updatedAt", "sourceCheck", "fields", "baseDataQuality", "baseMissingFields", "baseUpdatedAt"]), OMITTED_PROVENANCE_KEYS, "specs.catalogSpecProvenance");
  if (!isTimestamp(value.updatedAt) || !Array.isArray(value.fields) || !value.fields.every((field) => typeof field === "string" && field.length <= 160)) fail("specs.catalogSpecProvenance 필드가 올바르지 않습니다.");
  const quality = ["seed", "live", "manual", "incomplete"];
  if (value.baseDataQuality !== undefined && !(typeof value.baseDataQuality === "string" && quality.includes(value.baseDataQuality))) fail("specs.catalogSpecProvenance.baseDataQuality 값이 올바르지 않습니다.");
  if (value.baseMissingFields !== undefined && (!Array.isArray(value.baseMissingFields) || !value.baseMissingFields.every((field) => typeof field === "string" && field.length <= 160))) fail("specs.catalogSpecProvenance.baseMissingFields 배열이 올바르지 않습니다.");
  if (value.baseUpdatedAt !== undefined && !isTimestamp(value.baseUpdatedAt)) fail("specs.catalogSpecProvenance.baseUpdatedAt 값이 올바르지 않습니다.");
  const sourceUrl = safeExternalUrl(value.sourceUrl, "specs.catalogSpecProvenance.sourceUrl");
  if (!sourceUrl) fail("specs.catalogSpecProvenance.sourceUrl 값이 필요합니다.");
  return {
    manufacturerModel: stringValue(value.manufacturerModel, "specs.catalogSpecProvenance.manufacturerModel", 300),
    sourceUrl,
    updatedAt: value.updatedAt,
    ...(value.sourceCheck === undefined ? {} : { sourceCheck: projectSourceCheck(value.sourceCheck, "specs.catalogSpecProvenance.sourceCheck") }),
    fields: value.fields,
    ...(value.baseDataQuality === undefined ? {} : { baseDataQuality: value.baseDataQuality }),
    ...(value.baseMissingFields === undefined ? {} : { baseMissingFields: value.baseMissingFields }),
    ...(value.baseUpdatedAt === undefined ? {} : { baseUpdatedAt: value.baseUpdatedAt })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`오프라인 카탈로그 빌드 중단: ${message}`);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function stringValue(value: unknown, label: string, maximumLength = 1000): string {
  if (typeof value !== "string" || value.length > maximumLength) fail(`${label} 문자열 형식이 올바르지 않습니다.`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, maximumLength = 1000) {
  return record[key] === undefined ? undefined : stringValue(record[key], key, maximumLength);
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`specs.${key} 숫자 형식이 올바르지 않습니다.`);
  return value;
}

function onlyKnownKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, omitted: ReadonlySet<string>, label: string) {
  const unknown = Object.keys(record).find((key) => !allowed.has(key) && !omitted.has(key));
  if (unknown) fail(`${label}에 허용되지 않은 필드가 있습니다: ${unknown}`);
}

function jsonObjectList(value: unknown, label: string, allowedKeys: readonly string[]) {
  if (!Array.isArray(value)) fail(`${label} 배열 형식이 올바르지 않습니다.`);
  const keySet = new Set(allowedKeys);
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${label}[${index}] 객체 형식이 올바르지 않습니다.`);
    onlyKnownKeys(entry, keySet, new Set(), `${label}[${index}]`);
    return Object.fromEntries(Object.entries(entry).map(([key, item]) => {
      if (typeof item === "string") return [key, stringValue(item, `${label}[${index}].${key}`, 200)];
      if (typeof item === "number" && Number.isFinite(item)) return [key, item];
      if (Array.isArray(item) && item.every((nested) => typeof nested === "string" || typeof nested === "number" && Number.isFinite(nested))) return [key, item];
      fail(`${label}[${index}].${key} 값 형식이 올바르지 않습니다.`);
    }));
  });
}

function projectSpecs(value: unknown): Part["specs"] {
  if (!isRecord(value)) fail("specs 객체가 필요합니다.");
  const allowed = new Set([
    ...SPEC_STRING_KEYS, ...SPEC_NUMBER_KEYS, ...SPEC_BOOLEAN_KEYS, ...SPEC_STRING_ARRAY_KEYS, ...SPEC_NUMBER_ARRAY_KEYS,
    "pciePowerOptions", "pciePowerAdapterOptions", "pciePowerConnectors", "m2SlotProfiles", "radiatorSupports",
    "catalogSpecProvenance", "physicalEvidenceSourceCheck"
  ]);
  onlyKnownKeys(value, allowed, OMITTED_SPEC_KEYS, "specs");
  const output: Record<string, unknown> = {};
  for (const key of SPEC_STRING_KEYS) {
    if (value[key] !== undefined) output[key] = stringValue(value[key], `specs.${key}`, 4000);
  }
  for (const key of SPEC_NUMBER_KEYS) {
    const number = optionalFiniteNumber(value, key);
    if (number !== undefined) output[key] = number;
  }
  for (const key of SPEC_BOOLEAN_KEYS) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") fail(`specs.${key} boolean 형식이 올바르지 않습니다.`);
      output[key] = value[key];
    }
  }
  for (const key of SPEC_STRING_ARRAY_KEYS) {
    if (value[key] !== undefined) {
      if (!Array.isArray(value[key]) || !value[key].every((entry) => typeof entry === "string" && entry.length <= 200)) fail(`specs.${key} 배열 형식이 올바르지 않습니다.`);
      output[key] = value[key];
    }
  }
  for (const key of SPEC_NUMBER_ARRAY_KEYS) {
    if (value[key] !== undefined) {
      if (!Array.isArray(value[key]) || !value[key].every((entry) => typeof entry === "number" && Number.isFinite(entry))) fail(`specs.${key} 배열 형식이 올바르지 않습니다.`);
      output[key] = value[key];
    }
  }
  for (const key of ["pciePowerOptions", "pciePowerAdapterOptions"] as const) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key])) fail(`specs.${key} 배열 형식이 올바르지 않습니다.`);
    output[key] = value[key].map((group, groupIndex) => jsonObjectList(group, `specs.${key}[${groupIndex}]`, ["kind", "count"]));
  }
  if (value.pciePowerConnectors !== undefined) {
    if (!isRecord(value.pciePowerConnectors)) fail("specs.pciePowerConnectors 객체 형식이 올바르지 않습니다.");
    const connectors = new Set(["pcie_6pin", "pcie_8pin_6plus2", "12vhpwr", "12v2x6"]);
    onlyKnownKeys(value.pciePowerConnectors, connectors, new Set(), "specs.pciePowerConnectors");
    for (const count of Object.values(value.pciePowerConnectors)) if (typeof count !== "number" || !Number.isFinite(count)) fail("specs.pciePowerConnectors 값 형식이 올바르지 않습니다.");
    output.pciePowerConnectors = value.pciePowerConnectors;
  }
  if (value.m2SlotProfiles !== undefined) output.m2SlotProfiles = jsonObjectList(value.m2SlotProfiles, "specs.m2SlotProfiles", ["slotId", "interfaces", "pcieGeneration", "connection", "sharedWith"]);
  if (value.radiatorSupports !== undefined) output.radiatorSupports = jsonObjectList(value.radiatorSupports, "specs.radiatorSupports", ["position", "sizesMm"]);
  if (value.catalogSpecProvenance !== undefined) output.catalogSpecProvenance = projectCatalogSpecProvenance(value.catalogSpecProvenance);
  if (value.physicalEvidenceSourceCheck !== undefined) output.physicalEvidenceSourceCheck = projectSourceCheck(value.physicalEvidenceSourceCheck, "specs.physicalEvidenceSourceCheck");
  return output as Part["specs"];
}

function safeExternalUrl(value: unknown, label: string) {
  if (value === undefined) return undefined;
  const text = stringValue(value, label, 2000);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    fail(`${label} 절대 URL 형식이 올바르지 않습니다.`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) fail(`${label}은 인증 정보가 없는 HTTP(S) URL이어야 합니다.`);
  if (url.hash) fail(`${label} fragment는 오프라인 snapshot에 포함할 수 없습니다.`);
  const query = [...url.searchParams.entries()];
  let productCode: string | undefined;
  if (query.length > 0) {
    if (query.length !== 1 || query[0]?.[0] !== "pcode" || !/^\d{1,20}$/.test(query[0][1])) {
      fail(`${label}에는 인증정보가 없는 숫자 pcode query만 사용할 수 있습니다.`);
    }
    productCode = query[0]![1];
  }
  const sanitized = new URL(`${url.origin}${url.pathname}`);
  if (productCode) sanitized.searchParams.set("pcode", productCode);
  return sanitized.toString();
}

function projectCatalogItem<T extends Part | AccessoryItem>(value: unknown, type: "part" | "accessory"): T {
  if (!isRecord(value)) fail(`${type} 항목은 객체여야 합니다.`);
  onlyKnownKeys(value, type === "part" ? PART_KEYS : ACCESSORY_KEYS, OMITTED_ITEM_KEYS, type);
  const id = stringValue(value.id, `${type}.id`, 160).trim();
  const name = stringValue(value.name, `${type}.name`, 600).trim();
  const updatedAt = stringValue(value.updatedAt, `${type}.updatedAt`, 64);
  if (!id || !name || !isTimestamp(updatedAt)) fail(`${type}의 id, name, updatedAt이 올바르지 않습니다.`);
  if (value.priceWon !== undefined && (typeof value.priceWon !== "number" || !Number.isSafeInteger(value.priceWon) || value.priceWon < 0)) fail(`${type}.priceWon 값이 올바르지 않습니다.`);
  if (!Array.isArray(value.missingFields) || !value.missingFields.every((field) => typeof field === "string" && field.length <= 160)) fail(`${type}.missingFields 배열이 올바르지 않습니다.`);
  if (!(PART_CATEGORIES as readonly unknown[]).includes(value.category) && type === "part") fail("part.category 값이 올바르지 않습니다.");
  if (!(ACCESSORY_CATEGORIES as readonly unknown[]).includes(value.category) && type === "accessory") fail("accessory.category 값이 올바르지 않습니다.");
  if (!(["seed", "danawa", "manual"] as unknown[]).includes(value.source) && type === "part") fail("part.source 값이 올바르지 않습니다.");
  if (!(value.source === "danawa" || value.source === "manual") && type === "accessory") fail("accessory.source 값이 올바르지 않습니다.");
  if (!( ["seed", "live", "manual", "incomplete"] as unknown[]).includes(value.dataQuality)) fail(`${type}.dataQuality 값이 올바르지 않습니다.`);
  if (type === "accessory" && value.listingType !== "accessory") fail("accessory.listingType 값이 올바르지 않습니다.");
  const output: Record<string, unknown> = {
    id,
    category: value.category,
    name,
    ...(optionalString(value, "brand", 200) !== undefined ? { brand: value.brand } : {}),
    ...(optionalString(value, "model", 300) !== undefined ? { model: value.model } : {}),
    ...(safeExternalUrl(value.danawaUrl, `${type}.danawaUrl`) ? { danawaUrl: value.danawaUrl } : {}),
    source: value.source,
    ...(optionalString(value, "sourceProductCode", 160) !== undefined ? { sourceProductCode: value.sourceProductCode } : {}),
    ...(optionalString(value, "sourceCategoryId", 160) !== undefined ? { sourceCategoryId: value.sourceCategoryId } : {}),
    ...(type === "part" && value.listingType !== undefined ? { listingType: value.listingType } : {}),
    ...(type === "accessory" ? { listingType: "accessory" } : {}),
    ...(value.priceWon !== undefined ? { priceWon: value.priceWon } : {}),
    ...(optionalString(value, "rawSpecText", 12_000) !== undefined ? { rawSpecText: value.rawSpecText } : {}),
    specs: projectSpecs(value.specs),
    dataQuality: value.dataQuality,
    missingFields: value.missingFields,
    updatedAt,
    ...(value.priceCheckedAt !== undefined ? { priceCheckedAt: stringValue(value.priceCheckedAt, `${type}.priceCheckedAt`, 64) } : {})
  };
  return output as T;
}

function parseCategoryAllowlist<T extends string>(value: unknown, allowed: readonly T[], label: string): T[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((entry) => typeof entry === "string" && allowed.includes(entry as T))) fail(`${label}은 지원 범주가 하나 이상인 배열이어야 합니다.`);
  if (new Set(value).size !== value.length) fail(`${label}에 중복 범주가 있습니다.`);
  return value as T[];
}

function parseSourceManifest(value: unknown): SourceManifest {
  if (!isRecord(value)) fail("manifest.json은 객체여야 합니다.");
  onlyKnownKeys(value, new Set(["schemaVersion", "kind", "revision", "snapshotAt", "accessorySnapshotAt", "catalogRevision", "parts", "accessories"]), new Set(), "manifest.json");
  if (value.schemaVersion !== 1 || value.kind !== "pc-supporter-effective-catalog-snapshot" || typeof value.revision !== "string" || !/^catalog-\d+-[a-f0-9]{16}$/.test(value.revision) || !isTimestamp(value.snapshotAt) || !isTimestamp(value.accessorySnapshotAt) || !Number.isSafeInteger(value.catalogRevision) || (value.catalogRevision as number) < 0) {
    fail("manifest.json은 export-offline-snapshot으로 만든 effective snapshot 계약이어야 합니다.");
  }
  const sourcePart = value.parts;
  const sourceAccessory = value.accessories;
  if (!isRecord(sourcePart) || sourcePart.file !== "catalog.json" || typeof sourcePart.sha256 !== "string" || !HASH_PATTERN.test(sourcePart.sha256)) fail("manifest.parts에는 catalog.json과 SHA-256이 필요합니다.");
  if (!isRecord(sourceAccessory) || sourceAccessory.file !== "accessories.json" || typeof sourceAccessory.sha256 !== "string" || !HASH_PATTERN.test(sourceAccessory.sha256)) fail("manifest.accessories에는 accessories.json과 SHA-256이 필요합니다.");
  onlyKnownKeys(sourcePart, new Set(["file", "sha256", "categories"]), new Set(), "manifest.parts");
  onlyKnownKeys(sourceAccessory, new Set(["file", "sha256", "categories"]), new Set(), "manifest.accessories");
  return {
    schemaVersion: 1,
    kind: "pc-supporter-effective-catalog-snapshot",
    revision: value.revision,
    snapshotAt: value.snapshotAt,
    accessorySnapshotAt: value.accessorySnapshotAt,
    catalogRevision: value.catalogRevision as number,
    parts: { file: "catalog.json", sha256: sourcePart.sha256, categories: parseCategoryAllowlist(sourcePart.categories, PART_CATEGORIES, "manifest.parts.categories") },
    accessories: { file: "accessories.json", sha256: sourceAccessory.sha256, categories: parseCategoryAllowlist(sourceAccessory.categories, ACCESSORY_CATEGORIES, "manifest.accessories.categories") }
  };
}

function sha256(input: string | Uint8Array) {
  return createHash("sha256").update(input).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function offlineSourceRevisionFor(input: {
  catalogRevision: number;
  snapshotAt: string;
  accessorySnapshotAt: string;
  partCategories: readonly PartCategory[];
  accessoryCategories: readonly AccessoryCategory[];
  catalogSha256: string;
  accessorySha256: string;
}) {
  const digest = sha256(stableJson({
    schemaVersion: 1,
    kind: "pc-supporter-effective-catalog-snapshot",
    catalogRevision: input.catalogRevision,
    snapshotAt: input.snapshotAt,
    accessorySnapshotAt: input.accessorySnapshotAt,
    parts: { file: "catalog.json", sha256: input.catalogSha256, categories: [...input.partCategories] },
    accessories: { file: "accessories.json", sha256: input.accessorySha256, categories: [...input.accessoryCategories] }
  }));
  return `catalog-${input.catalogRevision}-${digest.slice(0, 16)}`;
}

async function readListedFile(root: string, fileName: string, maximumBytes = MAX_SOURCE_FILE_BYTES) {
  const path = resolve(root, fileName);
  if (resolve(path, "..") !== root) fail(`허용된 snapshot 디렉터리 밖의 경로입니다: ${fileName}`);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) fail(`${fileName}은 일반 파일이어야 합니다.`);
  if (info.size <= 0 || info.size > maximumBytes) fail(`${fileName} 크기가 허용 범위를 벗어났습니다.`);
  const actualPath = await realpath(path);
  if (actualPath !== path) fail(`${fileName}의 실제 경로가 명시된 snapshot 디렉터리와 다릅니다.`);
  return readFile(path);
}

function parseArray(bytes: Uint8Array, fileName: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(`${fileName} JSON을 읽지 못했습니다.`);
  }
  if (!Array.isArray(value) || value.length === 0) fail(`${fileName}은 데이터가 있는 JSON 배열이어야 합니다.`);
  return value;
}

function requireCategoryCoverage(items: Array<{ category: string }>, categories: readonly string[], label: string) {
  for (const category of categories) {
    if (!items.some((item) => item.category === category)) fail(`${label} ${category} 범주에 포함할 항목이 없습니다.`);
  }
}

export async function readAllowedOfflineSnapshot(sourceDirectory: string, now = new Date()) {
  const sourceRoot = await realpath(resolve(sourceDirectory));
  const rootInfo = await lstat(sourceRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("명시된 snapshot source는 일반 디렉터리여야 합니다.");
  const manifestBytes = await readListedFile(sourceRoot, "manifest.json", MAX_MANIFEST_BYTES);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    fail("manifest.json JSON을 읽지 못했습니다.");
  }
  const sourceManifest = parseSourceManifest(rawManifest);

  // These are the only data files opened. The manifest cannot name another
  // file or directory, and the source folder is never enumerated or copied.
  const [catalogBytes, accessoryBytes] = await Promise.all([
    readListedFile(sourceRoot, sourceManifest.parts.file),
    readListedFile(sourceRoot, sourceManifest.accessories.file)
  ]);
  if (sha256(catalogBytes) !== sourceManifest.parts.sha256) fail("catalog.json SHA-256이 manifest와 일치하지 않습니다.");
  if (sha256(accessoryBytes) !== sourceManifest.accessories.sha256) fail("accessories.json SHA-256이 manifest와 일치하지 않습니다.");
  const expectedRevision = offlineSourceRevisionFor({
    catalogRevision: sourceManifest.catalogRevision,
    snapshotAt: sourceManifest.snapshotAt,
    accessorySnapshotAt: sourceManifest.accessorySnapshotAt,
    partCategories: sourceManifest.parts.categories,
    accessoryCategories: sourceManifest.accessories.categories,
    catalogSha256: sourceManifest.parts.sha256,
    accessorySha256: sourceManifest.accessories.sha256
  });
  if (sourceManifest.revision !== expectedRevision) fail("snapshot revision이 데이터 해시·시각·범주 정보와 일치하지 않습니다.");

  const rawParts = parseArray(catalogBytes, "catalog.json");
  const rawAccessories = parseArray(accessoryBytes, "accessories.json");
  const partCategorySet = new Set(sourceManifest.parts.categories);
  const accessoryCategorySet = new Set(sourceManifest.accessories.categories);
  const parts = rawParts.map((item) => {
    if (!isRecord(item) || typeof item.category !== "string" || !(PART_CATEGORIES as readonly string[]).includes(item.category)) fail("catalog.json에 지원하지 않는 부품 범주가 있습니다.");
    if (!partCategorySet.has(item.category as PartCategory)) fail("catalog.json 항목 범주가 manifest 허용 범위와 일치하지 않습니다.");
    return projectCatalogItem<Part>(item, "part");
  });
  const accessories = rawAccessories.map((item) => {
    if (!isRecord(item) || typeof item.category !== "string" || !(ACCESSORY_CATEGORIES as readonly string[]).includes(item.category)) fail("accessories.json에 지원하지 않는 주변 부품 범주가 있습니다.");
    if (!accessoryCategorySet.has(item.category as AccessoryCategory)) fail("accessories.json 항목 범주가 manifest 허용 범위와 일치하지 않습니다.");
    return projectCatalogItem<AccessoryItem>(item, "accessory");
  });
  requireCategoryCoverage(parts, sourceManifest.parts.categories, "핵심 부품");
  requireCategoryCoverage(accessories, sourceManifest.accessories.categories, "주변 부품");
  if (new Set(parts.map((item) => item.id)).size !== parts.length) fail("선택한 핵심 부품의 ID가 중복됩니다.");
  if (new Set(accessories.map((item) => item.id)).size !== accessories.length) fail("선택한 주변 부품의 ID가 중복됩니다.");

  const sourceHashes = { catalog: sha256(catalogBytes), accessories: sha256(accessoryBytes) };
  const generatedAt = now.toISOString();
  const manifest = {
    schemaVersion: OFFLINE_CATALOG_SCHEMA_VERSION,
    kind: OFFLINE_CATALOG_KIND,
    revision: sourceManifest.revision,
    snapshotAt: sourceManifest.snapshotAt,
    accessorySnapshotAt: sourceManifest.accessorySnapshotAt,
    catalogRevision: sourceManifest.catalogRevision,
    privateRecommendationEvidenceIncluded: false,
    generatedAt,
    selectedCategories: { parts: sourceManifest.parts.categories, accessories: sourceManifest.accessories.categories },
    counts: { parts: parts.length, accessories: accessories.length },
    sourceHashes,
    bundleHashes: { parts: sha256(stableJson(parts)), accessories: sha256(stableJson(accessories)) }
  } satisfies OfflineCatalogSnapshot["manifest"];
  return { manifest, parts, accessories } satisfies OfflineCatalogSnapshot;
}

export { sha256, stableJson };
export const projectOfflinePart = (value: unknown) => projectCatalogItem<Part>(value, "part");
export const projectOfflineAccessory = (value: unknown) => projectCatalogItem<AccessoryItem>(value, "accessory");
