import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, copyFile, lstat, mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readAllowedOfflineSnapshot } from "./offline-snapshot";
import { OFFLINE_CATALOG_ASSET_MAX_BYTES } from "../shared/offline-catalog";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_OUTPUT = "artifacts/pc-supporter-offline/web";
const MOBILE_OUTPUT = "artifacts/pc-supporter-offline/dist-mobile-offline";

function fail(message: string): never {
  throw new Error(`로컬 설치 빌드 중단: ${message}`);
}

export function assertOfflineCatalogAssetBudget(assetBytes: number, maximumBytes = OFFLINE_CATALOG_ASSET_MAX_BYTES) {
  if (!Number.isSafeInteger(assetBytes) || assetBytes < 0 || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) fail("offline snapshot 크기 검증 입력이 올바르지 않습니다.");
  if (assetBytes > maximumBytes) fail(`설치 카탈로그가 ${maximumBytes}바이트 예산을 초과했습니다 (${assetBytes}바이트). 범주 선택을 줄이거나 데이터를 나누어 다시 내보내 주세요.`);
}

export async function promoteNativeAssetDirectories(
  replacements: ReadonlyArray<{ sourceDirectory: string; outputDirectory: string }>,
  operations: { renameDirectory?: typeof rename } = {}
) {
  const renameDirectory = operations.renameDirectory ?? rename;
  const transactionId = randomUUID();
  let committed = false;
  const entries = replacements.map((replacement, index) => ({
    ...replacement,
    incomingDirectory: `${replacement.outputDirectory}.offline-stage-${transactionId}-${index}`,
    backupDirectory: `${replacement.outputDirectory}.offline-backup-${transactionId}-${index}`,
    hadOriginal: false,
    backupMoved: false,
    promoted: false
  }));
  try {
    for (const entry of entries) {
      const sourceInfo = await lstat(entry.sourceDirectory);
      if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) fail(`Capacitor staged asset 경로가 일반 디렉터리가 아닙니다: ${entry.sourceDirectory}`);
      const outputInfo = await lstat(entry.outputDirectory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (outputInfo && (!outputInfo.isDirectory() || outputInfo.isSymbolicLink())) fail(`기존 Capacitor asset 경로가 일반 디렉터리가 아닙니다: ${entry.outputDirectory}`);
      entry.hadOriginal = Boolean(outputInfo);
      await cp(entry.sourceDirectory, entry.incomingDirectory, { recursive: true, dereference: false, errorOnExist: true, force: false });
    }
    for (const entry of entries) {
      if (!entry.hadOriginal) continue;
      await renameDirectory(entry.outputDirectory, entry.backupDirectory);
      entry.backupMoved = true;
    }
    for (const entry of entries) {
      await renameDirectory(entry.incomingDirectory, entry.outputDirectory);
      entry.promoted = true;
    }
    committed = true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const entry of [...entries].reverse()) {
      if (entry.promoted) {
        try {
          await rm(entry.outputDirectory, { recursive: true, force: true });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (entry.backupMoved) {
        try {
          await renameDirectory(entry.backupDirectory, entry.outputDirectory);
          entry.backupMoved = false;
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
    }
    if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], "Capacitor asset promotion failed and rollback was incomplete.");
    throw error;
  } finally {
    for (const entry of entries) {
      await rm(entry.incomingDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (committed || (!entry.backupMoved && entry.promoted)) await rm(entry.backupDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function syncCapacitorAssetsInTemporaryProject(temporaryRoot: string, webAssetsDirectory: string, environment: NodeJS.ProcessEnv) {
  const projectDirectory = resolve(temporaryRoot, "capacitor-project");
  await mkdir(projectDirectory, { recursive: false });
  for (const platformDirectory of ["android", "ios"]) {
    await cp(resolve(PROJECT_ROOT, platformDirectory), resolve(projectDirectory, platformDirectory), { recursive: true, dereference: false, errorOnExist: true, force: false });
  }
  await Promise.all([
    copyFile(resolve(PROJECT_ROOT, "capacitor.config.ts"), resolve(projectDirectory, "capacitor.config.ts")),
    copyFile(resolve(PROJECT_ROOT, "package.json"), resolve(projectDirectory, "package.json")),
    symlink(resolve(PROJECT_ROOT, "node_modules"), resolve(projectDirectory, "node_modules"), "dir")
  ]);
  const stagedEnvironment = {
    ...environment,
    VITE_APP_DATA_MODE: "offline",
    PC_SUPPORTER_BUILD_MODE: "local-offline",
    PC_SUPPORTER_VITE_ENV_DIR: environment.PC_SUPPORTER_VITE_ENV_DIR,
    CAPACITOR_WEB_DIR: webAssetsDirectory,
    VITE_API_BASE_URL: ""
  };
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "cap", "sync"], { cwd: projectDirectory, env: stagedEnvironment, stdio: "inherit" });
  return [
    { platform: "Android", source: resolve(projectDirectory, "android/app/src/main/assets/public"), output: resolve(PROJECT_ROOT, "android/app/src/main/assets/public") },
    { platform: "iOS", source: resolve(projectDirectory, "ios/App/App/public"), output: resolve(PROJECT_ROOT, "ios/App/App/public") }
  ];
}

function parseArgs(argv: string[]) {
  let sourceDirectory: string | undefined;
  let target: "web" | "mobile" = "web";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--snapshot-dir") {
      if (sourceDirectory) fail("--snapshot-dir를 중복 지정할 수 없습니다.");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("--snapshot-dir에 export-offline-snapshot 출력 디렉터리를 지정해 주세요.");
      sourceDirectory = value;
      index += 1;
    } else if (argument === "--target") {
      const value = argv[index + 1];
      if (value !== "web" && value !== "mobile") fail("--target 값은 web 또는 mobile이어야 합니다.");
      target = value;
      index += 1;
    } else {
      fail(`인식할 수 없는 옵션입니다: ${argument ?? ""}`);
    }
  }
  if (!sourceDirectory) fail("--snapshot-dir를 명시해야 합니다. 임의의 data/ 경로는 검색하지 않습니다.");
  return { sourceDirectory: resolve(sourceDirectory), target };
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
  if (missingTail.length > 0 && !allowMissingTail) fail(`경로가 없습니다: ${absolutePath}`);
  const canonicalAncestor = await realpath(current);
  return missingTail.length > 0 ? resolve(canonicalAncestor, ...missingTail) : canonicalAncestor;
}

function pathsOverlap(left: string, right: string) {
  const relativePath = relative(left, right);
  return relativePath === "" || (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

async function assertReplaceableOutputDirectory(outputDirectory: string, target: "web" | "mobile") {
  const stat = await lstat(outputDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`기존 출력 경로가 일반 디렉터리가 아닙니다: ${outputDirectory}`);
  let report: unknown;
  try {
    report = JSON.parse(await readFile(resolve(outputDirectory, "offline-build-report.json"), "utf8"));
  } catch {
    fail(`기존 출력은 이 빌드가 만든 것으로 확인되지 않아 보존했습니다: ${outputDirectory}`);
  }
  if (!report || typeof report !== "object" || Array.isArray(report) || (report as { managedBy?: unknown }).managedBy !== "pc-supporter-offline-build-v1" || (report as { target?: unknown }).target !== target) {
    fail(`기존 출력 관리 표식이 다르므로 보존했습니다: ${outputDirectory}`);
  }
}

async function replaceManagedOutput(stagingOutput: string, outputDirectory: string) {
  const existing = await lstat(outputDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!existing) {
    await rename(stagingOutput, outputDirectory);
    return;
  }
  const backup = `${outputDirectory}.backup-${randomUUID()}`;
  await rename(outputDirectory, backup);
  try {
    await rename(stagingOutput, outputDirectory);
  } catch (error) {
    await rename(backup, outputDirectory);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshotDirectory = await canonicalPathWithoutSymlinks(options.sourceDirectory, false);
  const snapshot = await readAllowedOfflineSnapshot(snapshotDirectory);
  const snapshotContent = `${JSON.stringify(snapshot)}\n`;
  assertOfflineCatalogAssetBudget(Buffer.byteLength(snapshotContent, "utf8"));
  const outputRelative = options.target === "mobile" ? MOBILE_OUTPUT : WEB_OUTPUT;
  const outputDirectory = await canonicalPathWithoutSymlinks(resolve(PROJECT_ROOT, outputRelative), true);
  if (pathsOverlap(snapshotDirectory, outputDirectory) || pathsOverlap(outputDirectory, snapshotDirectory)) fail("snapshot source와 build output은 겹칠 수 없습니다.");
  await assertReplaceableOutputDirectory(outputDirectory, options.target);
  await mkdir(dirname(outputDirectory), { recursive: true });
  const verifiedOutputDirectory = await canonicalPathWithoutSymlinks(outputDirectory, true);
  if (verifiedOutputDirectory !== outputDirectory) fail("build output의 실제 경로가 확인 전과 달라졌습니다.");
  const stagingParent = resolve(dirname(outputDirectory), ".pc-supporter-offline-stage-" + randomUUID());
  await mkdir(stagingParent, { recursive: false });
  const stagingOutput = resolve(stagingParent, basename(outputDirectory));
  await mkdir(stagingOutput, { recursive: false });
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "pc-supporter-offline-build-"));
  const envDirectory = resolve(temporaryRoot, "empty-env");
  const bundlePath = resolve(temporaryRoot, "offline-catalog.json");
  await mkdir(envDirectory);
  await writeFile(bundlePath, snapshotContent, { flag: "wx" });
  const relativeWebDirectory = relative(PROJECT_ROOT, stagingOutput);
  const sanitizedProcessEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_")));
  const buildEnvironment = {
    ...sanitizedProcessEnvironment,
    VITE_APP_DATA_MODE: "offline",
    PC_SUPPORTER_BUILD_MODE: "local-offline",
    PC_SUPPORTER_BUILD_OUT_DIR: relativeWebDirectory,
    PC_SUPPORTER_OFFLINE_BUNDLE_FILE: bundlePath,
    PC_SUPPORTER_VITE_ENV_DIR: envDirectory,
    VITE_API_BASE_URL: ""
  };
  try {
    console.log(`Building local-offline ${options.target} bundle for snapshot ${snapshot.manifest.revision}`);
    console.log(`Output: ${outputDirectory}`);
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: PROJECT_ROOT, env: buildEnvironment, stdio: "inherit" });
    const indexPath = resolve(stagingOutput, "index.html");
    const indexInfo = await lstat(indexPath).catch(() => undefined);
    if (!indexInfo?.isFile()) fail("Vite build가 index.html을 만들지 못했습니다.");
    await writeFile(resolve(stagingOutput, "offline-manifest.json"), `${JSON.stringify(snapshot.manifest, null, 2)}\n`, "utf8");
    let capacitorSyncCompleted = false;
    if (options.target === "mobile") {
      const mobileEnvironment = {
        ...sanitizedProcessEnvironment,
        VITE_APP_DATA_MODE: "offline",
        PC_SUPPORTER_BUILD_MODE: "local-offline",
        PC_SUPPORTER_BUILD_OUT_DIR: relativeWebDirectory,
        PC_SUPPORTER_OFFLINE_BUNDLE_FILE: bundlePath,
        PC_SUPPORTER_VITE_ENV_DIR: envDirectory,
        CAPACITOR_WEB_DIR: stagingOutput,
        VITE_API_BASE_URL: ""
      };
      const nativeAssets = await syncCapacitorAssetsInTemporaryProject(temporaryRoot, stagingOutput, mobileEnvironment);
      const [expectedManifest, expectedCatalog, expectedIndex] = await Promise.all([
        readFile(resolve(stagingOutput, "offline-manifest.json")),
        readFile(resolve(stagingOutput, "offline-catalog.json")),
        readFile(resolve(stagingOutput, "index.html"))
      ]);
      for (const assets of nativeAssets) {
        const nativeManifestPath = resolve(assets.source, "offline-manifest.json");
        const nativeCatalogPath = resolve(assets.source, "offline-catalog.json");
        const nativeIndexPath = resolve(assets.source, "index.html");
        const nativeManifestInfo = await lstat(nativeManifestPath).catch(() => undefined);
        const nativeCatalogInfo = await lstat(nativeCatalogPath).catch(() => undefined);
        const nativeIndexInfo = await lstat(nativeIndexPath).catch(() => undefined);
        if (!nativeManifestInfo?.isFile() || !nativeCatalogInfo?.isFile() || !nativeIndexInfo?.isFile()) fail(`Capacitor sync가 로컬 manifest, 카탈로그, 앱 shell을 ${assets.platform} public assets에 복사하지 못했습니다.`);
        const nativeManifest = JSON.parse(await readFile(nativeManifestPath, "utf8")) as { revision?: string };
        if (nativeManifest.revision !== snapshot.manifest.revision) fail(`${assets.platform} public assets의 snapshot revision이 build manifest와 일치하지 않습니다.`);
        const [nativeManifestBytes, nativeCatalogBytes, nativeIndexBytes] = await Promise.all([readFile(nativeManifestPath), readFile(nativeCatalogPath), readFile(nativeIndexPath)]);
        if (!nativeManifestBytes.equals(expectedManifest) || !nativeCatalogBytes.equals(expectedCatalog) || !nativeIndexBytes.equals(expectedIndex)) {
          fail(`${assets.platform} public assets가 검사한 web bundle과 byte 단위로 일치하지 않습니다.`);
        }
      }
      await promoteNativeAssetDirectories(nativeAssets.map(({ source, output }) => ({ sourceDirectory: source, outputDirectory: output })));
      capacitorSyncCompleted = true;
    }
    const buildReport = {
      schemaVersion: 1,
      managedBy: "pc-supporter-offline-build-v1",
      appDataMode: "offline",
      target: options.target,
      artifactKind: options.target === "mobile" ? "capacitor-synced-native-web-assets" : "vite-web-assets",
      snapshotRevision: snapshot.manifest.revision,
      snapshotAt: snapshot.manifest.snapshotAt,
      privateRecommendationEvidenceIncluded: false,
      remoteApiBaseUrlConfigured: false,
      apiBehavior: "bundled-local-dispatcher; unsupported server paths return typed unavailable errors",
      capacitorSyncCompleted,
      nativePackageBuilt: false,
      debugApkOrIpaBuilt: false
    };
    await writeFile(resolve(stagingOutput, "offline-build-report.json"), `${JSON.stringify(buildReport, null, 2)}\n`, "utf8");
    await replaceManagedOutput(stagingOutput, outputDirectory);
    console.log(`Snapshot rows: ${snapshot.manifest.counts.parts} parts, ${snapshot.manifest.counts.accessories} accessories`);
    console.log(`Snapshot timestamps: catalog ${snapshot.manifest.snapshotAt}; accessories ${snapshot.manifest.accessorySnapshotAt}`);
    console.log(options.target === "mobile"
      ? "Capacitor synced and verified assets in a temporary native project; matching assets were promoted safely. This command does not build or install an APK/IPA."
      : "Web assets are built; this command does not install a PWA or native app.");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(stagingParent, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { parseArgs, WEB_OUTPUT, MOBILE_OUTPUT };
