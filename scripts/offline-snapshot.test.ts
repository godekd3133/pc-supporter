import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { offlineCatalogSnapshotFromUnknown } from "../shared/offline-catalog";
import type { AccessoryCategory, PartCategory } from "../shared/types";
import { offlineSourceRevisionFor, projectOfflinePart, readAllowedOfflineSnapshot } from "./offline-snapshot";
import { assertOfflineCatalogAssetBudget, promoteNativeAssetDirectories } from "./build-offline-app";
import { parseArgs as parseExportArgs } from "./export-offline-snapshot";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDirectory = resolve(repositoryRoot, "scripts/fixtures/offline-data");
const exportScript = resolve(repositoryRoot, "scripts/export-offline-snapshot.ts");
const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const canonicalTempRoot = await realpath(tmpdir());
  const path = await mkdtemp(resolve(canonicalTempRoot, "pc-supporter-offline-test-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("offline snapshot source boundary", () => {
  it("enforces the installed snapshot asset size budget before Vite bundling", () => {
    expect(() => assertOfflineCatalogAssetBudget(100, 100)).not.toThrow();
    expect(() => assertOfflineCatalogAssetBudget(101, 100)).toThrow("설치 카탈로그가 100바이트 예산을 초과했습니다");
    expect(() => assertOfflineCatalogAssetBudget(Number.NaN, 100)).toThrow("크기 검증 입력이 올바르지 않습니다");
  });

  it("rolls back every native asset directory if promotion fails midway", async () => {
    const parent = await temporaryDirectory();
    const firstSource = resolve(parent, "first-source");
    const secondSource = resolve(parent, "second-source");
    const firstTarget = resolve(parent, "android-public");
    const secondTarget = resolve(parent, "ios-public");
    await Promise.all([mkdir(firstSource), mkdir(secondSource), mkdir(firstTarget), mkdir(secondTarget)]);
    await Promise.all([
      writeFile(resolve(firstSource, "manifest.json"), "new-android"),
      writeFile(resolve(secondSource, "manifest.json"), "new-ios"),
      writeFile(resolve(firstTarget, "manifest.json"), "old-android"),
      writeFile(resolve(secondTarget, "manifest.json"), "old-ios")
    ]);

    const failSecondPromotion = async (source: string, target: string) => {
      if (target === secondTarget && source.includes(".offline-stage-")) throw new Error("synthetic iOS promotion failure");
      return rename(source, target);
    };
    await expect(promoteNativeAssetDirectories([
      { sourceDirectory: firstSource, outputDirectory: firstTarget },
      { sourceDirectory: secondSource, outputDirectory: secondTarget }
    ], { renameDirectory: failSecondPromotion })).rejects.toThrow("synthetic iOS promotion failure");

    await expect(readFile(resolve(firstTarget, "manifest.json"), "utf8")).resolves.toBe("old-android");
    await expect(readFile(resolve(secondTarget, "manifest.json"), "utf8")).resolves.toBe("old-ios");
    expect((await readdir(parent)).filter((name) => name.includes("offline-stage-") || name.includes("offline-backup-"))).toEqual([]);
  });

  it("requires explicit source, output, and category allowlists", () => {
    expect(() => parseExportArgs([])).toThrow("--data-dir");
    expect(() => parseExportArgs(["--data-dir", fixtureDirectory, "--output-dir", "/tmp/out", "--part-categories", "cpu", "--accessory-categories", "cooling_fan", "--copy-all", "yes"])).toThrow("인식할 수 없는 옵션");
    expect(() => parseExportArgs(["--data-dir", fixtureDirectory, "--output-dir", "/tmp/out", "--part-categories", "all", "--accessory-categories", "cooling_fan"])).toThrow("지원 범주");
  });

  it("projects catalog records without remote images and rejects owner or recovery fields", () => {
    const projected = projectOfflinePart({
      id: "fixture",
      category: "cpu",
      name: "Fixture CPU",
      source: "manual",
      dataQuality: "manual",
      missingFields: [],
      updatedAt: "2026-09-24T00:00:00.000Z",
      imageUrl: "https://example.invalid/image.png",
      specs: { cores: 6, cinebenchR23Multi: 99999, benchmarkProvenance: { sourceNote: "internal benchmark", sourceKind: "independent_review", sourceUrl: "https://example.invalid/review", updatedAt: "2026-09-24T00:00:00.000Z" }, catalogSpecProvenance: {
        manufacturerModel: "Fixture Model",
        sourceNote: "internal note",
        sourceUrl: "https://example.invalid/product",
        updatedAt: "2026-09-24T00:00:00.000Z",
        fields: ["cores"],
        baseSpecValues: { cores: 4 },
        baseDataQuality: "manual",
        baseMissingFields: [],
        baseUpdatedAt: "2026-09-23T00:00:00.000Z"
      } }
    });
    expect(projected).not.toHaveProperty("imageUrl");
    expect(projected.specs.catalogSpecProvenance).not.toHaveProperty("sourceNote");
    expect(projected.specs.catalogSpecProvenance).not.toHaveProperty("baseSpecValues");
    expect(projected.specs).not.toHaveProperty("benchmarkProvenance");
    expect(projected.specs).not.toHaveProperty("cinebenchR23Multi");
    expect(() => projectOfflinePart({ ...projected, ownerToken: "not-for-bundles" })).toThrow("허용되지 않은 필드");
    expect(() => projectOfflinePart({ ...projected, recoveryCode: "not-for-bundles" })).toThrow("허용되지 않은 필드");
    expect(() => projectOfflinePart({ ...projected, danawaUrl: "https://example.invalid/item?ownerToken=secret" })).toThrow("숫자 pcode query");
  });

  it("keeps only a numeric Danawa product code and rejects all other URL query values", () => {
    const basePart = {
      id: "url-fixture",
      category: "cpu",
      name: "URL Fixture CPU",
      source: "manual",
      dataQuality: "manual",
      missingFields: [],
      updatedAt: "2026-09-24T00:00:00.000Z",
      specs: { cores: 6 }
    };

    expect(projectOfflinePart({ ...basePart, danawaUrl: "https://prod.danawa.com/info/?pcode=12345678" }).danawaUrl)
      .toBe("https://prod.danawa.com/info/?pcode=12345678");
    for (const key of ["signature", "sig", "key", "auth", "ownerToken", "utm_source"]) {
      expect(() => projectOfflinePart({ ...basePart, danawaUrl: `https://example.invalid/item?${key}=fixture-secret` }))
        .toThrow("숫자 pcode query");
    }
  });

  it("exports only an effective, category-selected snapshot from the explicit fixture data directory", async () => {
    const parent = await temporaryDirectory();
    const outputDirectory = resolve(parent, "effective-snapshot");
    execFileSync(process.execPath, ["--import", "tsx", exportScript,
      "--data-dir", fixtureDirectory,
      "--output-dir", outputDirectory,
      "--part-categories", "cpu,motherboard,memory,ssd,case,psu",
      "--accessory-categories", "cooling_fan"], {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: "postgres://must-not-be-used.invalid/db", DOTENV_CONFIG_PATH: "/dev/null" },
      stdio: "pipe"
    });
    const files = (await readdir(outputDirectory)).sort();
    expect(files).toEqual(["accessories.json", "catalog.json", "manifest.json"]);
    const snapshot = await readAllowedOfflineSnapshot(outputDirectory, new Date("2026-09-29T00:00:00.000Z"));
    expect(snapshot.manifest.kind).toBe("pc-supporter-offline-catalog");
    expect(snapshot.manifest.catalogRevision).toBeGreaterThanOrEqual(0);
    expect(snapshot.parts.some((part) => part.id === "offline-fixture-cpu")).toBe(true);
    expect(snapshot.parts.every((part) => ["cpu", "motherboard", "memory", "ssd", "case", "psu"].includes(part.category))).toBe(true);
    expect(snapshot.accessories.length).toBeGreaterThan(0);
    expect(snapshot.accessories.every((item) => item.category === "cooling_fan")).toBe(true);
    expect(snapshot.accessories.some((item) => item.id === "offline-fixture-fan")).toBe(true);
    expect(snapshot.parts.every((part) => !part.imageUrl)).toBe(true);

    const parsed = offlineCatalogSnapshotFromUnknown(snapshot);
    expect(parsed?.manifest.revision).toBe(snapshot.manifest.revision);
    const manifestPath = resolve(outputDirectory, "manifest.json");
    const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      revision: string;
      snapshotAt: string;
      accessorySnapshotAt: string;
      catalogRevision: number;
      parts: { file: string; sha256: string; categories: PartCategory[] };
      accessories: { file: string; sha256: string; categories: AccessoryCategory[] };
    };
    const changedAllowlist = { ...sourceManifest, parts: { ...sourceManifest.parts, categories: ["cpu"] as PartCategory[] } };
    await writeFile(manifestPath, JSON.stringify(changedAllowlist), "utf8");
    await expect(readAllowedOfflineSnapshot(outputDirectory)).rejects.toThrow("snapshot revision");

    const changedAllowlistWithMatchingRevision = {
      ...changedAllowlist,
      revision: offlineSourceRevisionFor({
        catalogRevision: changedAllowlist.catalogRevision,
        snapshotAt: changedAllowlist.snapshotAt,
        accessorySnapshotAt: changedAllowlist.accessorySnapshotAt,
        partCategories: changedAllowlist.parts.categories,
        accessoryCategories: changedAllowlist.accessories.categories,
        catalogSha256: changedAllowlist.parts.sha256,
        accessorySha256: changedAllowlist.accessories.sha256
      })
    };
    await writeFile(manifestPath, JSON.stringify(changedAllowlistWithMatchingRevision), "utf8");
    await expect(readAllowedOfflineSnapshot(outputDirectory)).rejects.toThrow("catalog.json 항목 범주가 manifest 허용 범위와 일치하지 않습니다");
    await writeFile(manifestPath, JSON.stringify(sourceManifest), "utf8");
    await writeFile(resolve(outputDirectory, "catalog.json"), "[]\n", "utf8");
    await expect(readAllowedOfflineSnapshot(outputDirectory)).rejects.toThrow("SHA-256이 manifest와 일치하지 않습니다");
  });

  it("rejects a materialized snapshot with incorrect row counts or hashes", async () => {
    const sourceDirectory = await temporaryDirectory();
    const catalog = await readFile(resolve(fixtureDirectory, "catalog.json"));
    const accessories = await readFile(resolve(fixtureDirectory, "accessories.json"));
    await writeFile(resolve(sourceDirectory, "catalog.json"), catalog);
    await writeFile(resolve(sourceDirectory, "accessories.json"), accessories);
    await writeFile(resolve(sourceDirectory, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      kind: "pc-supporter-effective-catalog-snapshot",
      revision: "catalog-1-1234567890abcdef",
      snapshotAt: "2026-09-24T00:00:00.000Z",
      accessorySnapshotAt: "2026-09-24T00:00:00.000Z",
      catalogRevision: 1,
      parts: { file: "catalog.json", sha256: "0".repeat(64), categories: ["cpu"] },
      accessories: { file: "accessories.json", sha256: "0".repeat(64), categories: ["cooling_fan"] }
    }), "utf8");
    await expect(readAllowedOfflineSnapshot(sourceDirectory)).rejects.toThrow("SHA-256이 manifest와 일치하지 않습니다");
  });

  it("rejects an output path whose symlink ancestor resolves into the source data", async () => {
    const parent = await temporaryDirectory();
    const sourceLink = resolve(parent, "source-link");
    const outputDirectory = resolve(sourceLink, "should-not-be-created");
    await symlink(fixtureDirectory, sourceLink, "dir");
    const before = (await readdir(fixtureDirectory)).sort();
    expect(() => execFileSync(process.execPath, ["--import", "tsx", exportScript,
      "--data-dir", fixtureDirectory,
      "--output-dir", outputDirectory,
      "--part-categories", "cpu",
      "--accessory-categories", "cooling_fan"], {
      cwd: repositoryRoot,
      stdio: "pipe"
    })).toThrow();
    expect((await readdir(fixtureDirectory)).sort()).toEqual(before);
    expect(before).not.toContain("should-not-be-created");
  });
});
