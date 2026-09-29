import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESSORY_CATEGORIES, PART_CATEGORIES } from "../shared/types";
import type { AccessoryCategory, PartCategory } from "../shared/types";
import { offlineSourceRevisionFor, projectOfflineAccessory, projectOfflinePart, sha256, stableJson } from "./offline-snapshot";

const REQUIRED_FILES = ["catalog.json", "accessories.json"] as const;
const ALLOWED_OVERRIDE_FILES = [
  "m2-slot-overrides.json",
  "benchmark-overrides.json",
  "gpu-physical-overrides.json",
  "case-rgb-load-overrides.json",
  "catalog-spec-overrides.json",
  "cooling-fan-load-overrides.json"
] as const;
const ALLOWED_SOURCE_FILES = [...REQUIRED_FILES, ...ALLOWED_OVERRIDE_FILES];

function fail(message: string): never {
  throw new Error(`오프라인 snapshot 내보내기 중단: ${message}`);
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) fail(`인식할 수 없는 인수입니다: ${argument ?? ""}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} 값이 필요합니다.`);
    if (values.has(argument)) fail(`${argument} 인수를 중복 지정할 수 없습니다.`);
    values.set(argument, value);
    index += 1;
  }
  const dataDirectory = values.get("--data-dir");
  const outputDirectory = values.get("--output-dir");
  const rawPartCategories = values.get("--part-categories");
  const rawAccessoryCategories = values.get("--accessory-categories");
  const allowedOptions = ["--data-dir", "--output-dir", "--part-categories", "--accessory-categories"];
  const unknown = [...values.keys()].find((key) => !allowedOptions.includes(key));
  if (unknown) fail(`인식할 수 없는 옵션입니다: ${unknown}`);
  if (!dataDirectory || !outputDirectory || !rawPartCategories || !rawAccessoryCategories) {
    fail("--data-dir, --output-dir, --part-categories, --accessory-categories를 모두 명시해야 합니다.");
  }
  return {
    dataDirectory: resolve(dataDirectory),
    outputDirectory: resolve(outputDirectory),
    partCategories: parseCategories(rawPartCategories, PART_CATEGORIES, "--part-categories"),
    accessoryCategories: parseCategories(rawAccessoryCategories, ACCESSORY_CATEGORIES, "--accessory-categories")
  };
}

function parseCategories<T extends string>(value: string, allowed: readonly T[], label: string): T[] {
  const categories = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (categories.length === 0 || categories.some((category) => !allowed.includes(category as T))) fail(`${label}에 지원 범주를 하나 이상 쉼표로 구분해 입력해야 합니다.`);
  if (new Set(categories).size !== categories.length) fail(`${label}에 중복 범주가 있습니다.`);
  return categories as T[];
}

function overlaps(left: string, right: string) {
  const rel = relative(left, right);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

async function canonicalPathWithoutSymlinks(path: string, allowMissingTail: boolean) {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const segments = absolutePath.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  let missingTail: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = join(current, segments[index]!);
    try {
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink()) fail(`입력·출력 경로에는 심볼릭 링크를 사용할 수 없습니다: ${candidate}`);
      current = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missingTail = segments.slice(index);
      break;
    }
  }
  if (missingTail.length > 0) {
    if (!allowMissingTail) fail(`입력 디렉터리가 없습니다: ${absolutePath}`);
    const ancestor = await realpath(current);
    return resolve(ancestor, ...missingTail);
  }
  return realpath(current);
}

async function assertRegularFile(directory: string, fileName: string, required: boolean) {
  const path = resolve(directory, fileName);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) fail(`${fileName}은 비어 있지 않은 일반 파일이어야 합니다.`);
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail(`${fileName} 파일을 찾을 수 없습니다.`);
    throw error;
  }
}

async function assertRequiredCatalogFiles(dataDirectory: string) {
  const rawItems: Record<string, unknown[]> = {};
  for (const fileName of REQUIRED_FILES) {
    const bytes = await readFile(resolve(dataDirectory, fileName));
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`${fileName} JSON 형식이 올바르지 않습니다.`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) fail(`${fileName}은 비어 있지 않은 JSON 배열이어야 합니다. 빈 파일로 starter 데이터를 source에 쓰지 않도록 빌드를 중단했습니다.`);
    rawItems[fileName] = parsed;
  }
  return rawItems;
}

function withoutDatabaseEnvironment() {
  for (const key of ["DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGOPTIONS", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE"]) {
    delete process.env[key];
  }
  process.env.PC_SUPPORTER_BUILD_MODE = "remote";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const canonicalDataDirectory = await canonicalPathWithoutSymlinks(options.dataDirectory, false);
  const canonicalOutputDirectory = await canonicalPathWithoutSymlinks(options.outputDirectory, true);
  if (overlaps(canonicalDataDirectory, canonicalOutputDirectory) || overlaps(canonicalOutputDirectory, canonicalDataDirectory)) fail("입력 데이터와 출력 snapshot 경로는 서로 분리되어야 합니다.");
  options.dataDirectory = canonicalDataDirectory;
  options.outputDirectory = canonicalOutputDirectory;
  const dataStat = await lstat(options.dataDirectory);
  if (!dataStat.isDirectory()) fail("--data-dir은 명시된 일반 디렉터리여야 합니다.");
  for (const fileName of ALLOWED_SOURCE_FILES) await assertRegularFile(options.dataDirectory, fileName, REQUIRED_FILES.includes(fileName as (typeof REQUIRED_FILES)[number]));
  const sourceItems = await assertRequiredCatalogFiles(options.dataDirectory);
  if (!sourceItems["catalog.json"] || !sourceItems["accessories.json"]) fail("핵심·주변 부품 배열을 확인하지 못했습니다.");
  try {
    await lstat(options.outputDirectory);
    fail("--output-dir이 이미 있습니다. 기존 결과를 덮어쓰지 않도록 새 디렉터리를 지정해 주세요.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // The effective loader is constrained to these two canonical catalog files
  // and the six known catalog/spec override files above. It never loads builds,
  // usage, crawl, share, owner/recovery token, or session state.
  process.env.PC_SUPPORTER_DATA_DIR = options.dataDirectory;
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  withoutDatabaseEnvironment();
  const { loadCatalogSnapshot } = await import("../server/catalog-snapshot");
  const effective = await loadCatalogSnapshot();
  const partCategorySet = new Set<PartCategory>(options.partCategories);
  const accessoryCategorySet = new Set<AccessoryCategory>(options.accessoryCategories);
  const parts = effective.catalog.filter((part) => partCategorySet.has(part.category)).map(projectOfflinePart);
  const accessories = effective.accessories.filter((item) => accessoryCategorySet.has(item.category)).map(projectOfflineAccessory);
  for (const category of options.partCategories) if (!parts.some((part) => part.category === category)) fail(`effective snapshot에 ${category} 부품이 없습니다.`);
  for (const category of options.accessoryCategories) if (!accessories.some((item) => item.category === category)) fail(`effective snapshot에 ${category} 주변 부품이 없습니다.`);

  const catalogBytes = Buffer.from(`${stableJson(parts)}\n`, "utf8");
  const accessoryBytes = Buffer.from(`${stableJson(accessories)}\n`, "utf8");
  const partSha256 = sha256(catalogBytes);
  const accessorySha256 = sha256(accessoryBytes);
  const revision = offlineSourceRevisionFor({
    catalogRevision: effective.catalogRevision,
    snapshotAt: effective.catalogUpdatedAt,
    accessorySnapshotAt: effective.accessoryUpdatedAt,
    partCategories: options.partCategories,
    accessoryCategories: options.accessoryCategories,
    catalogSha256: partSha256,
    accessorySha256
  });
  const sourceManifest = {
    schemaVersion: 1,
    kind: "pc-supporter-effective-catalog-snapshot",
    revision,
    snapshotAt: effective.catalogUpdatedAt,
    accessorySnapshotAt: effective.accessoryUpdatedAt,
    catalogRevision: effective.catalogRevision,
    parts: { file: "catalog.json", sha256: partSha256, categories: options.partCategories },
    accessories: { file: "accessories.json", sha256: accessorySha256, categories: options.accessoryCategories }
  };
  const temporaryDirectory = `${options.outputDirectory}.tmp-${randomUUID()}`;
  try {
    await mkdir(dirname(options.outputDirectory), { recursive: true });
    await mkdir(temporaryDirectory, { recursive: false });
    await writeFile(resolve(temporaryDirectory, "catalog.json"), catalogBytes, { flag: "wx" });
    await writeFile(resolve(temporaryDirectory, "accessories.json"), accessoryBytes, { flag: "wx" });
    await writeFile(resolve(temporaryDirectory, "manifest.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`, { flag: "wx" });
    await rename(temporaryDirectory, options.outputDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  console.log(`Effective offline snapshot exported: ${options.outputDirectory}`);
  console.log(`Revision ${revision}; catalog ${parts.length}; accessories ${accessories.length}; categories ${options.partCategories.join(",")} / ${options.accessoryCategories.join(",")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { ALLOWED_SOURCE_FILES, parseArgs, parseCategories, assertRequiredCatalogFiles };
