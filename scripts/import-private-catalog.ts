import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ACCESSORY_CATEGORIES, PART_CATEGORIES, type AccessoryCategory, type AccessoryItem, type CoolingFanLoadOverride, type Part, type PartCategory } from "../shared/types";
import { assertCompleteReplacementSnapshot, accessoryReplacementCoverageFor, coreReplacementCoverageFor } from "../shared/private-catalog-import";
import { requiredDirectoryArgument } from "./private-catalog-import-args";

const DATA_QUALITY_VALUES = new Set(["seed", "live", "manual", "incomplete"]);
const SOURCE_VALUES = new Set(["seed", "danawa", "manual"]);
const MAX_IMPORT_RECORDS = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function usage() {
  return [
    "사용법: npm run import:private-catalog -- --source-dir /path/to/private-data --dry-run",
    "적용:   npm run import:private-catalog -- --source-dir /path/to/private-data --apply [--replace-danawa] [--include-accessories] [--replace-accessories]",
    "",
    "--dry-run          JSON 형식과 중복 ID만 검증하고 저장하지 않습니다.",
    "--apply            현재 PC_SUPPORTER_DATA_DIR 또는 DATABASE_URL 대상에 반영합니다.",
    "--replace-danawa   수집 snapshot의 9개 핵심 범주에서 기존 Danawa 행을 교체합니다.",
    "--include-accessories  같은 source 디렉터리의 accessories.json도 함께 검증·반영합니다.",
    "--replace-accessories  10개 주변 부품 범주의 기존 Danawa 행을 교체합니다.",
    "--include-cooling-fan-overrides  같은 source 디렉터리의 cooling-fan-load-overrides.json을 검증·반영합니다."
  ].join("\n");
}

function parseParts(value: unknown, sourcePath: string): Part[] {
  if (!Array.isArray(value)) throw new Error(`${sourcePath}: 최상위 값은 부품 배열이어야 합니다.`);
  if (value.length > MAX_IMPORT_RECORDS) throw new Error(`${sourcePath}: 한 번에 ${MAX_IMPORT_RECORDS.toLocaleString("ko-KR")}개를 초과해 가져올 수 없습니다.`);

  const ids = new Set<string>();
  return value.map((raw, index): Part => {
    const label = `${sourcePath} [${index}]`;
    if (!isRecord(raw)) throw new Error(`${label}: 객체 레코드가 필요합니다.`);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const category = typeof raw.category === "string" ? raw.category.trim() : "";
    const source = typeof raw.source === "string" ? raw.source.trim() : "";
    const dataQuality = typeof raw.dataQuality === "string" ? raw.dataQuality.trim() : "";
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt.trim() : "";
    if (!id || id.length > 240) throw new Error(`${label}: id가 없거나 너무 깁니다.`);
    if (ids.has(id)) throw new Error(`${label}: 중복 id ${id}가 있습니다.`);
    ids.add(id);
    if (!name || name.length > 500) throw new Error(`${label}: name이 없거나 너무 깁니다.`);
    if (!PART_CATEGORIES.includes(category as PartCategory)) throw new Error(`${label}: 알 수 없는 category ${category || "(empty)"}입니다.`);
    if (!SOURCE_VALUES.has(source)) throw new Error(`${label}: 알 수 없는 source ${source || "(empty)"}입니다.`);
    if (!DATA_QUALITY_VALUES.has(dataQuality)) throw new Error(`${label}: 알 수 없는 dataQuality ${dataQuality || "(empty)"}입니다.`);
    if (!Number.isFinite(Date.parse(updatedAt))) throw new Error(`${label}: updatedAt가 ISO 날짜가 아닙니다.`);
    if (!isRecord(raw.specs)) throw new Error(`${label}: specs 객체가 필요합니다.`);
    if (!Array.isArray(raw.missingFields) || raw.missingFields.some((field) => typeof field !== "string")) throw new Error(`${label}: missingFields 문자열 배열이 필요합니다.`);
    if (source === "danawa" && (typeof raw.sourceProductCode !== "string" || !raw.sourceProductCode.trim())) throw new Error(`${label}: Danawa source에는 sourceProductCode가 필요합니다.`);
    return raw as unknown as Part;
  });
}

function countsFor(parts: Part[]) {
  const categoryCounts = Object.fromEntries(PART_CATEGORIES.map((category) => [category, 0])) as Record<PartCategory, number>;
  const qualityCounts = { seed: 0, live: 0, manual: 0, incomplete: 0 };
  for (const part of parts) {
    categoryCounts[part.category] += 1;
    qualityCounts[part.dataQuality] += 1;
  }
  return { categoryCounts, qualityCounts };
}

function parseAccessories(value: unknown, sourcePath: string): AccessoryItem[] {
  if (!Array.isArray(value)) throw new Error(`${sourcePath}: 최상위 값은 주변 부품 배열이어야 합니다.`);
  if (value.length > MAX_IMPORT_RECORDS) throw new Error(`${sourcePath}: 한 번에 ${MAX_IMPORT_RECORDS.toLocaleString("ko-KR")}개를 초과해 가져올 수 없습니다.`);

  const ids = new Set<string>();
  return value.map((raw, index): AccessoryItem => {
    const label = `${sourcePath} [${index}]`;
    if (!isRecord(raw)) throw new Error(`${label}: 객체 레코드가 필요합니다.`);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const category = typeof raw.category === "string" ? raw.category.trim() : "";
    const source = typeof raw.source === "string" ? raw.source.trim() : "";
    const dataQuality = typeof raw.dataQuality === "string" ? raw.dataQuality.trim() : "";
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt.trim() : "";
    if (!id || id.length > 240) throw new Error(`${label}: id가 없거나 너무 깁니다.`);
    if (ids.has(id)) throw new Error(`${label}: 중복 id ${id}가 있습니다.`);
    ids.add(id);
    if (!name || name.length > 500) throw new Error(`${label}: name이 없거나 너무 깁니다.`);
    if (!ACCESSORY_CATEGORIES.includes(category as AccessoryCategory)) throw new Error(`${label}: 알 수 없는 accessory category ${category || "(empty)"}입니다.`);
    if (source !== "danawa" && source !== "manual") throw new Error(`${label}: accessory source는 danawa 또는 manual이어야 합니다.`);
    if (!DATA_QUALITY_VALUES.has(dataQuality)) throw new Error(`${label}: 알 수 없는 dataQuality ${dataQuality || "(empty)"}입니다.`);
    if (raw.listingType !== "accessory") throw new Error(`${label}: listingType은 accessory여야 합니다.`);
    if (!Number.isFinite(Date.parse(updatedAt))) throw new Error(`${label}: updatedAt가 ISO 날짜가 아닙니다.`);
    if (!isRecord(raw.specs)) throw new Error(`${label}: specs 객체가 필요합니다.`);
    if (!Array.isArray(raw.missingFields) || raw.missingFields.some((field) => typeof field !== "string")) throw new Error(`${label}: missingFields 문자열 배열이 필요합니다.`);
    if (source === "danawa" && (typeof raw.sourceProductCode !== "string" || !raw.sourceProductCode.trim())) throw new Error(`${label}: Danawa source에는 sourceProductCode가 필요합니다.`);
    return raw as unknown as AccessoryItem;
  });
}

function accessoryCountsFor(items: AccessoryItem[]) {
  const categoryCounts = Object.fromEntries(ACCESSORY_CATEGORIES.map((category) => [category, 0])) as Record<AccessoryCategory, number>;
  const qualityCounts = { seed: 0, live: 0, manual: 0, incomplete: 0 };
  for (const item of items) {
    categoryCounts[item.category] += 1;
    qualityCounts[item.dataQuality] += 1;
  }
  return { categoryCounts, qualityCounts };
}

function parseCoolingFanLoadOverrideSource(value: unknown, sourcePath: string): unknown[] {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : undefined;
  if (!items) throw new Error(`${sourcePath}: 최상위 값은 쿨링팬 override 배열 또는 items 배열을 가진 객체여야 합니다.`);
  if (items.length < 1) throw new Error(`${sourcePath}: items는 최소 1개가 필요합니다.`);
  if (items.length > 500) throw new Error(`${sourcePath}: 한 번에 최대 500개 쿨링팬 override만 가져올 수 있습니다.`);
  return items.map((raw, index) => {
    const label = `${sourcePath} [${index}]`;
    if (!isRecord(raw)) throw new Error(`${label}: 객체 레코드가 필요합니다.`);
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt.trim() : "";
    if (!Number.isFinite(Date.parse(updatedAt))) throw new Error(`${label}: updatedAt가 ISO 날짜가 아닙니다.`);
    const explicitAccessoryId = typeof raw.accessoryId === "string" ? raw.accessoryId.trim() : "";
    const accessoryId = explicitAccessoryId || (typeof raw.partId === "string" ? raw.partId.trim() : "");
    return { ...raw, accessoryId, updatedAt };
  });
}

function validateCoolingFanLoadOverrideImport(
  sourceItems: unknown[],
  accessories: AccessoryItem[],
  existingOverrides: Record<string, CoolingFanLoadOverride>,
  validateBatch: typeof import("../server/cooling-fan-load-overrides").validateCoolingFanLoadOverrideBatch,
  sourcePath: string
) {
  const validation = validateBatch({ items: sourceItems }, accessories, existingOverrides);
  if (validation.errors.length > 0) throw new Error(`${sourcePath}: 쿨링팬 override 검증에 실패했습니다. ${validation.errors.join(" / ")}`);
  const sourceByAccessoryId = new Map(sourceItems.map((item) => {
    const record = item as Record<string, unknown>;
    return [String(record.accessoryId), String(record.updatedAt)] as const;
  }));
  return validation.validOverrides.map((override) => ({
    ...override,
    updatedAt: sourceByAccessoryId.get(override.accessoryId) ?? override.updatedAt
  }));
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const knownFlags = new Set(["--dry-run", "--apply", "--replace-danawa", "--include-accessories", "--replace-accessories", "--include-cooling-fan-overrides", "--source-dir"]);
for (const [index, arg] of args.entries()) {
  if (arg.startsWith("--") && !knownFlags.has(arg)) throw new Error(`알 수 없는 옵션 ${arg}입니다.\n\n${usage()}`);
  if (arg === "--source-dir" && index === args.length - 1) throw new Error(`--source-dir 값이 필요합니다.\n\n${usage()}`);
}

const dryRun = args.includes("--dry-run");
const apply = args.includes("--apply");
const replaceDanawa = args.includes("--replace-danawa");
const includeAccessories = args.includes("--include-accessories");
const replaceAccessories = args.includes("--replace-accessories");
const includeCoolingFanOverrides = args.includes("--include-cooling-fan-overrides");
if (dryRun === apply) throw new Error(`${usage()}\n\n--dry-run 또는 --apply 중 하나만 지정해야 합니다.`);
if (replaceAccessories && !includeAccessories) throw new Error(`--replace-accessories는 --include-accessories와 함께 사용해야 합니다.\n\n${usage()}`);
const sourceDirectory = requiredDirectoryArgument(args, "--source-dir");
const coolingFanOverridesModule = includeCoolingFanOverrides ? await import("../server/cooling-fan-load-overrides") : undefined;
const sourcePath = resolve(sourceDirectory, "catalog.json");
const raw = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
const parts = parseParts(raw, sourcePath);
const sourceFingerprint = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const sourceCounts = countsFor(parts);
const accessoryPath = resolve(sourceDirectory, "accessories.json");
const sourceAccessories = includeAccessories || includeCoolingFanOverrides
  ? parseAccessories(JSON.parse(await readFile(accessoryPath, "utf8")) as unknown, accessoryPath)
  : undefined;
const accessories = includeAccessories ? sourceAccessories : undefined;
const accessoryFingerprint = accessories ? createHash("sha256").update(JSON.stringify(accessories)).digest("hex") : undefined;
const accessoryCounts = accessories ? accessoryCountsFor(accessories) : undefined;
const coolingFanOverridePath = resolve(sourceDirectory, "cooling-fan-load-overrides.json");
const rawCoolingFanOverrides = includeCoolingFanOverrides
  ? parseCoolingFanLoadOverrideSource(JSON.parse(await readFile(coolingFanOverridePath, "utf8")) as unknown, coolingFanOverridePath)
  : undefined;
const validatedCoolingFanOverrides = rawCoolingFanOverrides && sourceAccessories && coolingFanOverridesModule
  ? validateCoolingFanLoadOverrideImport(rawCoolingFanOverrides, sourceAccessories, {}, coolingFanOverridesModule.validateCoolingFanLoadOverrideBatch, coolingFanOverridePath)
  : undefined;
const coolingFanOverrideFingerprint = validatedCoolingFanOverrides
  ? createHash("sha256").update(JSON.stringify(validatedCoolingFanOverrides)).digest("hex")
  : undefined;
const coreReplacementCoverage = coreReplacementCoverageFor(parts);
const accessoryReplacementCoverage = accessories ? accessoryReplacementCoverageFor(accessories) : undefined;
if (replaceDanawa) assertCompleteReplacementSnapshot("--replace-danawa", coreReplacementCoverage);
if (replaceAccessories && accessoryReplacementCoverage) assertCompleteReplacementSnapshot("--replace-accessories", accessoryReplacementCoverage);

if (dryRun) {
  console.log(JSON.stringify({ ok: true, mode: "dry-run", sourcePath, sourceFingerprint, sourceRecords: parts.length, ...sourceCounts, coreReplacementCoverage, ...(accessories ? { accessoryPath, accessoryFingerprint, accessoryRecords: accessories.length, accessoryCounts, accessoryReplacementCoverage } : {}), ...(validatedCoolingFanOverrides ? { coolingFanOverridePath, coolingFanOverrideFingerprint, coolingFanOverrideRecords: validatedCoolingFanOverrides.length } : {}), replaceDanawa, includeAccessories, replaceAccessories, includeCoolingFanOverrides, message: "검증만 수행했으며 대상 저장소는 변경하지 않았습니다." }, null, 2));
  process.exit(0);
}

const { catalogMeta, upsertCatalog } = await import("../server/catalog");
const { loadAccessories, upsertAccessories } = await import("../server/accessories");
const { persistenceDiagnostics } = await import("../server/repository");
const { withCatalogIngestionLease } = await import("../server/catalog-ingestion-coordinator");
const { before, merged, mergedAccessories, mergedCoolingFanOverrides, after } = await withCatalogIngestionLease(async () => {
  const before = await catalogMeta();
  const merged = await upsertCatalog(parts, replaceDanawa ? { replaceDanawaCategories: [...PART_CATEGORIES] } : {});
  const mergedAccessories = accessories
    ? await upsertAccessories(accessories, replaceAccessories ? { replaceDanawaCategories: [...ACCESSORY_CATEGORIES] } : {})
    : undefined;
  let mergedCoolingFanOverrides: CoolingFanLoadOverride[] | undefined;
  if (rawCoolingFanOverrides && coolingFanOverridesModule) {
    const existingOverrides = await coolingFanOverridesModule.readCoolingFanLoadOverrides();
    const targetAccessories = await loadAccessories();
    mergedCoolingFanOverrides = validateCoolingFanLoadOverrideImport(
      rawCoolingFanOverrides,
      targetAccessories,
      existingOverrides,
      coolingFanOverridesModule.validateCoolingFanLoadOverrideBatch,
      coolingFanOverridePath
    );
    await coolingFanOverridesModule.saveCoolingFanLoadOverrides(mergedCoolingFanOverrides);
  }
  const after = await catalogMeta();
  return { before, merged, mergedAccessories, mergedCoolingFanOverrides, after };
});
console.log(JSON.stringify({
  ok: true,
  mode: "apply",
  sourcePath,
  sourceFingerprint,
  sourceRecords: parts.length,
  ...sourceCounts,
  coreReplacementCoverage,
  ...(accessories ? { accessoryPath, accessoryFingerprint, accessoryRecords: accessories.length, accessoryCounts } : {}),
  ...(validatedCoolingFanOverrides ? { coolingFanOverridePath, coolingFanOverrideFingerprint, coolingFanOverrideRecords: validatedCoolingFanOverrides.length } : {}),
  ...(accessoryReplacementCoverage ? { accessoryReplacementCoverage } : {}),
  replaceDanawa,
  includeAccessories,
  replaceAccessories,
  includeCoolingFanOverrides,
  targetStorageMode: (await persistenceDiagnostics()).storageMode,
  before: { catalogCount: before.catalogCount, categoryCounts: before.categoryCounts, qualityCounts: before.qualityCounts },
  after: { catalogCount: after.catalogCount, categoryCounts: after.categoryCounts, qualityCounts: after.qualityCounts },
  mergedRecords: merged.length,
  ...(mergedAccessories ? { mergedAccessoryRecords: mergedAccessories.length } : {}),
  ...(mergedCoolingFanOverrides ? { mergedCoolingFanOverrideRecords: mergedCoolingFanOverrides.length } : {}),
  message: "private catalog snapshot을 대상 저장소에 반영했습니다. 실제 가격·재고 최신성은 manifest와 원문 검수로 별도 확인해야 합니다."
}, null, 2));
