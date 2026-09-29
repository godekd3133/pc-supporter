import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import {
  catalogSpecOverrideMapFromUnknown,
  importCatalogOverrideMapsWithClient,
  m2SlotOverrideMapFromUnknown,
  type CatalogOverrideImportResult,
  type CatalogOverrideMaps
} from "../server/catalog-override-store";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

type ImportMode = "dry-run" | "apply";

type ImportOptions = {
  mode: ImportMode;
  catalogSpecPath: string;
  m2SlotPath: string;
  expectedCatalogSpecSha256?: string;
  expectedM2SlotSha256?: string;
};

type SourceMap<T> = {
  path: string;
  sha256: string;
  records: number;
  value: T;
};

type ImportPool = {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
};

export type ImportCommandDependencies = {
  env?: Record<string, string | undefined>;
  readSource?: (path: string) => Promise<Uint8Array>;
  createPool?: (connectionString: string) => Promise<ImportPool> | ImportPool;
  loadEnvironment?: () => Promise<void>;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
};

export type ImportCommandReport = {
  ok: true;
  mode: ImportMode;
  connectedToDatabase: boolean;
  catalogSpecOverrides: { source: string; sha256: string; records: number; status?: CatalogOverrideImportResult["catalogSpecOverrides"] };
  m2SlotOverrides: { source: string; sha256: string; records: number; status?: CatalogOverrideImportResult["m2SlotOverrides"] };
};

function optionValue(args: string[], flag: string) {
  const matches = args.flatMap((argument, index) => argument === flag ? [index] : []);
  if (matches.length > 1) throw new Error(`${flag}는 한 번만 지정할 수 있습니다.`);
  if (matches.length === 0) return undefined;
  const value = args[matches[0] + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} 경로 또는 값이 필요합니다.`);
  return value;
}

export function parseImportOptions(args: string[]): ImportOptions {
  const knownFlags = new Set([
    "--dry-run", "--apply", "--catalog-spec-file", "--m2-slot-file",
    "--catalog-spec-sha256", "--m2-slot-sha256"
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--") && !knownFlags.has(argument)) throw new Error("알 수 없는 인자가 있습니다. 지원되는 옵션을 확인하세요.");
    if (knownFlags.has(argument) && argument !== "--apply" && argument !== "--dry-run") index += 1;
  }
  if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("--apply와 --dry-run은 함께 사용할 수 없습니다.");
  const catalogSpecPath = optionValue(args, "--catalog-spec-file");
  const m2SlotPath = optionValue(args, "--m2-slot-file");
  if (!catalogSpecPath || !m2SlotPath) throw new Error("두 원본 전체 map의 경로를 모두 명시해야 합니다.");
  if (resolve(catalogSpecPath) === resolve(m2SlotPath)) throw new Error("두 map은 서로 다른 원본 파일이어야 합니다.");

  const expectedCatalogSpecSha256 = optionValue(args, "--catalog-spec-sha256")?.toLowerCase();
  const expectedM2SlotSha256 = optionValue(args, "--m2-slot-sha256")?.toLowerCase();
  if (!args.includes("--apply") && (expectedCatalogSpecSha256 || expectedM2SlotSha256)) {
    throw new Error("원본 검토 SHA-256 인자는 --apply와 함께 사용해야 합니다.");
  }
  if (args.includes("--apply")) {
    if (!expectedCatalogSpecSha256 || !SHA256_PATTERN.test(expectedCatalogSpecSha256)
      || !expectedM2SlotSha256 || !SHA256_PATTERN.test(expectedM2SlotSha256)) {
      throw new Error("--apply에는 두 원본 파일의 검토한 SHA-256 값을 모두 지정해야 합니다.");
    }
  }

  return {
    mode: args.includes("--apply") ? "apply" : "dry-run",
    catalogSpecPath: resolve(catalogSpecPath),
    m2SlotPath: resolve(m2SlotPath),
    ...(expectedCatalogSpecSha256 ? { expectedCatalogSpecSha256 } : {}),
    ...(expectedM2SlotSha256 ? { expectedM2SlotSha256 } : {})
  };
}

function parseSourceMap<T>(bytes: Uint8Array, path: string, sourceLabel: string, parse: (value: unknown, label: string) => T): SourceMap<T> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`${sourceLabel}의 JSON 형식이 올바르지 않습니다.`);
  }
  const value = parse(parsed, sourceLabel);
  return { path, sha256, records: Object.keys(value).length, value };
}

async function readSourceMap<T>(readSource: (path: string) => Promise<Uint8Array>, path: string, sourceLabel: string, parse: (value: unknown, label: string) => T) {
  let bytes: Uint8Array;
  try {
    bytes = await readSource(path);
  } catch {
    throw new Error(`${sourceLabel} 원본 파일을 읽을 수 없습니다.`);
  }
  return parseSourceMap(bytes, path, sourceLabel, parse);
}

function assertReviewedHash(source: SourceMap<unknown>, expected: string | undefined, label: string) {
  if (!expected || source.sha256 !== expected) throw new Error(`${label} 원본이 검토한 SHA-256과 일치하지 않습니다. dry-run 결과를 다시 확인하세요.`);
}

async function defaultCreatePool(connectionString: string): Promise<ImportPool> {
  const { Pool } = await import("pg");
  return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
}

function safePostgresError(error: unknown) {
  if (error instanceof Error && /덮어쓰지 않았습니다|payload는 객체 map|singleton 행이 둘 이상/.test(error.message)) return error;
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "42P01") return new Error("대상 override table이 없습니다. schema DDL은 실행하지 않았습니다.");
  return new Error("PostgreSQL override import가 실패했습니다. 원본 JSON은 변경하지 않았습니다.");
}

export async function executeCatalogOverrideImport(args: string[], dependencies: ImportCommandDependencies = {}): Promise<ImportCommandReport> {
  const options = parseImportOptions(args);
  const readSource = dependencies.readSource ?? (async (path) => readFile(path));
  const catalogSpecSource = await readSourceMap(readSource, options.catalogSpecPath, "catalog-spec-overrides.json", catalogSpecOverrideMapFromUnknown);
  const m2SlotSource = await readSourceMap(readSource, options.m2SlotPath, "m2-slot-overrides.json", m2SlotOverrideMapFromUnknown);
  const report: ImportCommandReport = {
    ok: true,
    mode: options.mode,
    connectedToDatabase: false,
    catalogSpecOverrides: { source: "catalog-spec-overrides.json", sha256: catalogSpecSource.sha256, records: catalogSpecSource.records },
    m2SlotOverrides: { source: "m2-slot-overrides.json", sha256: m2SlotSource.sha256, records: m2SlotSource.records }
  };

  if (options.mode === "dry-run") return report;
  assertReviewedHash(catalogSpecSource, options.expectedCatalogSpecSha256, "catalog-spec-overrides.json");
  assertReviewedHash(m2SlotSource, options.expectedM2SlotSha256, "m2-slot-overrides.json");
  if (!dependencies.env) {
    if (dependencies.loadEnvironment) await dependencies.loadEnvironment();
    else await import("dotenv/config");
  }
  const databaseUrl = (dependencies.env ?? process.env).DATABASE_URL;
  if (!databaseUrl?.trim()) throw new Error("--apply에는 DATABASE_URL이 필요합니다.");

  const createPool = dependencies.createPool ?? defaultCreatePool;
  let pool: ImportPool;
  try {
    pool = await createPool(databaseUrl);
  } catch {
    throw new Error("PostgreSQL connection pool을 열 수 없습니다. connection 정보를 출력하지 않았습니다.");
  }

  let client: PoolClient | undefined;
  let released = false;
  try {
    client = await pool.connect();
    const result = await importCatalogOverrideMapsWithClient(client, {
      catalogSpecOverrides: catalogSpecSource.value,
      m2SlotOverrides: m2SlotSource.value
    } satisfies CatalogOverrideMaps);
    client.release();
    released = true;
    report.connectedToDatabase = true;
    report.catalogSpecOverrides.status = result.catalogSpecOverrides;
    report.m2SlotOverrides.status = result.m2SlotOverrides;
    return report;
  } catch (error: unknown) {
    if (client && !released) client.release(true);
    throw safePostgresError(error);
  } finally {
    try {
      await pool.end();
    } catch {
      // Do not echo driver details that could contain connection information.
    }
  }
}

export async function runCatalogOverrideCli(args: string[], dependencies: ImportCommandDependencies = {}) {
  const writeStdout = dependencies.writeStdout ?? ((text: string) => { process.stdout.write(text); });
  const writeStderr = dependencies.writeStderr ?? ((text: string) => { process.stderr.write(text); });
  try {
    const report = await executeCatalogOverrideImport(args, dependencies);
    writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error: unknown) {
    writeStderr(`${error instanceof Error ? error.message : "Catalog override import failed."}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCatalogOverrideCli(process.argv.slice(2)).then((exitCode) => { process.exitCode = exitCode; });
}
