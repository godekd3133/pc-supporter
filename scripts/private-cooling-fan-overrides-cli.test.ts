import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const importerMocks = vi.hoisted(() => ({
  catalogMeta: vi.fn(),
  upsertCatalog: vi.fn(),
  loadAccessories: vi.fn(),
  upsertAccessories: vi.fn(),
  withCatalogIngestionLease: vi.fn()
}));

vi.mock("../server/catalog", () => ({
  catalogMeta: importerMocks.catalogMeta,
  upsertCatalog: importerMocks.upsertCatalog
}));

vi.mock("../server/accessories", () => ({
  loadAccessories: importerMocks.loadAccessories,
  upsertAccessories: importerMocks.upsertAccessories
}));

vi.mock("../server/catalog-ingestion-coordinator", () => ({
  withCatalogIngestionLease: importerMocks.withCatalogIngestionLease
}));

class ScriptExit extends Error {
  constructor(readonly code: number) {
    super(`script exited with ${code}`);
  }
}

const originalArgv = [...process.argv];
const envKeys = ["DATABASE_URL", "NODE_ENV", "PC_SUPPORTER_DATA_DIR"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>;
let temporaryDirectories: string[] = [];

async function sourceDirectory(options: { accessories?: boolean; overrides?: unknown } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pc-supporter-private-import-"));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, "catalog.json"), "[]", "utf8");
  if (options.accessories) {
    await writeFile(join(directory, "accessories.json"), JSON.stringify([{
      id: "synthetic-fan",
      category: "cooling_fan",
      name: "합성 쿨링팬",
      source: "manual",
      listingType: "accessory",
      specs: {},
      dataQuality: "manual",
      missingFields: [],
      updatedAt: "2026-09-29T00:00:00.000Z"
    }]), "utf8");
  }
  if (options.overrides !== undefined) {
    await writeFile(join(directory, "cooling-fan-load-overrides.json"), JSON.stringify(options.overrides), "utf8");
  }
  return directory;
}

async function runImporter(directory: string, flags: string[]) {
  vi.resetModules();
  process.env.NODE_ENV = "test";
  process.env.PC_SUPPORTER_DATA_DIR = join(directory, "target-data");
  process.argv = [originalArgv[0] ?? "node", "scripts/import-private-catalog.ts", "--source-dir", directory, ...flags];
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const exit = vi.spyOn(process, "exit").mockImplementation((code?: number | string) => {
    throw new ScriptExit(Number(code ?? 0));
  });
  let exitCode: number | undefined;
  let logs: unknown[][] = [];
  try {
    try {
      await import("./import-private-catalog");
    } catch (error: unknown) {
      if (error instanceof ScriptExit) exitCode = error.code;
      else throw error;
    }
    logs = output.mock.calls.map((call) => [...call]);
    return { logs, exitCode };
  } finally {
    output.mockRestore();
    exit.mockRestore();
  }
}

afterEach(async () => {
  process.argv = [...originalArgv];
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  importerMocks.catalogMeta.mockReset();
  importerMocks.upsertCatalog.mockReset();
  importerMocks.loadAccessories.mockReset();
  importerMocks.upsertAccessories.mockReset();
  importerMocks.withCatalogIngestionLease.mockReset();
  vi.resetModules();
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories = [];
});

describe("private catalog cooling-fan override import", () => {
  it("ignores the optional override file unless explicitly included", async () => {
    const directory = await sourceDirectory({ overrides: { deliberately: "invalid" } });
    const { logs, exitCode } = await runImporter(directory, ["--dry-run"]);

    expect(exitCode).toBe(0);
    expect(logs).toHaveLength(1);
    const report = JSON.parse(String(logs[0]?.[0])) as Record<string, unknown>;
    expect(report).toMatchObject({ mode: "dry-run", includeCoolingFanOverrides: false });
    expect(report).not.toHaveProperty("coolingFanOverridePath");
  });

  it("dry-run validates an explicitly included override file against synthetic accessory source data", async () => {
    const directory = await sourceDirectory({
      accessories: true,
      overrides: {
        exportedAt: "2026-09-29T01:00:00.000Z",
        items: [{
          accessoryId: "synthetic-fan",
          category: "cooling_fan",
          fanCurrentA: 0.23,
          manufacturerModel: "SYNTHETIC-FAN-120",
          sourceNote: "synthetic source fixture",
          updatedAt: "2026-09-28T01:00:00.000Z"
        }]
      }
    });
    const { logs, exitCode } = await runImporter(directory, ["--dry-run", "--include-cooling-fan-overrides"]);

    expect(exitCode).toBe(0);
    expect(logs).toHaveLength(1);
    const report = JSON.parse(String(logs[0]?.[0])) as Record<string, unknown>;
    expect(report).toMatchObject({ mode: "dry-run", includeCoolingFanOverrides: true, coolingFanOverrideRecords: 1 });
    expect(report.coolingFanOverrideFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(report.coolingFanOverridePath).toBe(join(directory, "cooling-fan-load-overrides.json"));
  });

  it("apply revalidates against the target catalog and saves only under the shared coordinator lease", async () => {
    const directory = await sourceDirectory({
      accessories: true,
      overrides: {
        items: [{
          accessoryId: "synthetic-fan",
          fanCurrentA: 0.23,
          manufacturerModel: "SYNTHETIC-FAN-120",
          sourceNote: "synthetic source fixture",
          updatedAt: "2026-09-28T01:00:00.000Z"
        }]
      }
    });
    const targetFan = {
      id: "synthetic-fan",
      category: "cooling_fan",
      name: "합성 쿨링팬",
      source: "manual",
      listingType: "accessory",
      specs: {},
      dataQuality: "manual",
      missingFields: [],
      updatedAt: "2026-09-29T00:00:00.000Z"
    };
    importerMocks.catalogMeta.mockResolvedValue({ catalogCount: 0, categoryCounts: {}, qualityCounts: {} });
    importerMocks.upsertCatalog.mockResolvedValue([]);
    importerMocks.loadAccessories.mockResolvedValue([targetFan]);
    importerMocks.upsertAccessories.mockResolvedValue([]);
    importerMocks.withCatalogIngestionLease.mockImplementation(async (operation: () => Promise<unknown>) => operation());

    const { logs } = await runImporter(directory, ["--apply", "--include-cooling-fan-overrides"]);
    expect(logs).toHaveLength(1);
    expect(importerMocks.withCatalogIngestionLease).toHaveBeenCalledTimes(1);
    expect(importerMocks.upsertCatalog).toHaveBeenCalledTimes(1);
    expect(importerMocks.upsertAccessories).not.toHaveBeenCalled();
    expect(importerMocks.loadAccessories).toHaveBeenCalledTimes(1);
    const report = JSON.parse(String(logs[0]?.[0])) as Record<string, unknown>;
    expect(report).toMatchObject({ mode: "apply", includeCoolingFanOverrides: true, mergedCoolingFanOverrideRecords: 1, targetStorageMode: "postgres" });
    const { readCoolingFanLoadOverrides } = await import("../server/cooling-fan-load-overrides");
    const persisted = await readCoolingFanLoadOverrides();
    expect(persisted["synthetic-fan"]?.updatedAt).toBe("2026-09-28T01:00:00.000Z");
  });

  it("rejects invalid override evidence without applying anything", async () => {
    const directory = await sourceDirectory({
      accessories: true,
      overrides: { items: [{ accessoryId: "synthetic-fan", fanCurrentA: 0, manufacturerModel: "", sourceNote: "", updatedAt: "2026-09-29T00:00:00.000Z" }] }
    });
    await expect(runImporter(directory, ["--dry-run", "--include-cooling-fan-overrides"]))
      .rejects.toThrow("쿨링팬 override 검증에 실패했습니다.");
  });
});
