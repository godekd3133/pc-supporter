import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./index";
import { BuildGenerationError, generateBuildDraft, minimumFeasibleBuildPriceFor } from "./engine";
import { seedCatalog } from "./seed-catalog";
import type { BuildGenerationRequest } from "../shared/types";
import { emptyEngineTargetFiltersConfig } from "../shared/engine-target-filters";
import { engineTargetFilterFacetOptionsFor, engineTargetFilterSummaryFor, invalidateEngineTargetFiltersCache, loadEngineTargetFiltersConfig, normalizeEngineTargetFiltersInput, saveEngineTargetFiltersConfig } from "./engine-target-filters";

let tempDir: string;
let previousPath: string | undefined;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pc-supporter-engine-filters-"));
  previousPath = process.env.ENGINE_TARGET_FILTERS_PATH;
  process.env.ENGINE_TARGET_FILTERS_PATH = join(tempDir, "engine-target-filters.json");
});

afterAll(() => {
  if (previousPath === undefined) delete process.env.ENGINE_TARGET_FILTERS_PATH;
  else process.env.ENGINE_TARGET_FILTERS_PATH = previousPath;
  invalidateEngineTargetFiltersCache();
  rmSync(tempDir, { recursive: true, force: true });
});

const request: BuildGenerationRequest = {
  profile: "office",
  priority: "balanced",
  budgetWon: 1_500_000,
  includeGpu: false,
  memoryCapacityGb: 16,
  storageCapacityGb: 500,
  hddCount: 0,
  listingPolicy: "retail_only"
};

describe("engine target filters persistence", () => {
  it("파일이 없으면 비어 있는 활성 설정을 돌려준다", () => {
    invalidateEngineTargetFiltersCache();
    expect(loadEngineTargetFiltersConfig()).toEqual(emptyEngineTargetFiltersConfig());
  });

  it("저장 후 다시 읽으면 같은 설정이 나온다", async () => {
    const config = { schemaVersion: 1 as const, enabled: true, categories: { ssd: { brands: ["Samsung"], specValues: { interface: ["NVMe"] } } } };
    await saveEngineTargetFiltersConfig(config);
    expect(loadEngineTargetFiltersConfig()).toEqual(config);
  });

  it("깨진 파일은 빈 설정으로 fail-open한다", () => {
    invalidateEngineTargetFiltersCache();
    writeFileSync(process.env.ENGINE_TARGET_FILTERS_PATH!, "{broken json", "utf8");
    expect(loadEngineTargetFiltersConfig()).toEqual(emptyEngineTargetFiltersConfig());
    writeFileSync(process.env.ENGINE_TARGET_FILTERS_PATH!, JSON.stringify({ enabled: "yes" }), "utf8");
    expect(loadEngineTargetFiltersConfig()).toEqual(emptyEngineTargetFiltersConfig());
  });

  it("입력 정규화는 config 래퍼와 직접 객체 모두 받는다", () => {
    const wrapped = normalizeEngineTargetFiltersInput({ config: { enabled: false, categories: { gpu: { brands: ["MSI"] } } } });
    expect(wrapped.valid).toBe(true);
    expect(wrapped.config.enabled).toBe(false);
    expect(wrapped.config.categories.gpu?.brands).toEqual(["MSI"]);
    const direct = normalizeEngineTargetFiltersInput({ enabled: true, categories: {} });
    expect(direct.valid).toBe(true);
    expect(normalizeEngineTargetFiltersInput("nope").valid).toBe(false);
  });
});

describe("engineTargetFilterSummaryFor", () => {
  it("범주별 전체·후보·통과 수를 계산한다", () => {
    const config = { schemaVersion: 1 as const, enabled: true, categories: { ssd: { specValues: { interface: ["SATA"] } } } };
    const summary = engineTargetFilterSummaryFor(seedCatalog, config);
    const ssd = summary.ssd!;
    expect(ssd.totalCount).toBe(2);
    expect(ssd.eligibleCount).toBeGreaterThanOrEqual(1);
    expect(ssd.matchingCount).toBe(1);
    expect(ssd.activeFacets).toBe(1);
    // 규칙이 없는 범주는 후보 수가 그대로 유지된다.
    expect(summary.memory!.matchingCount).toBe(summary.memory!.eligibleCount);
  });

  it("비활성화된 설정은 필터를 적용하지 않는다", () => {
    const config = { schemaVersion: 1 as const, enabled: false, categories: { ssd: { specValues: { interface: ["SATA"] } } } };
    const summary = engineTargetFilterSummaryFor(seedCatalog, config);
    expect(summary.ssd!.matchingCount).toBe(summary.ssd!.eligibleCount);
  });
});

describe("engineTargetFilterFacetOptionsFor", () => {
  it("범주별 브랜드와 값 옵션에 카탈로그 수를 붙여 준다", () => {
    const facets = engineTargetFilterFacetOptionsFor(seedCatalog);
    const ssd = facets.ssd;
    expect(ssd.partCount).toBe(2);
    expect(ssd.brandOptions.map((option) => option.value)).toEqual(expect.arrayContaining(["SK hynix", "Samsung"]));
    const interfaceOptions = ssd.facetOptions.interface!.options;
    expect(interfaceOptions).toEqual(expect.arrayContaining([
      { value: "NVMe", count: 1 },
      { value: "SATA", count: 1 }
    ]));
    // PCIe 세대 값은 시드에 없다 → 옵션 없이 미등록 수만 표시한다.
    expect(ssd.facetOptions.m2PcieGeneration!.options).toEqual([]);
    expect(ssd.facetOptions.m2PcieGeneration!.missingCount).toBe(2);
  });
});

describe("generateBuildDraft with target filters", () => {
  it("저장된 타겟 필터가 생성 후보 풀에 적용된다", () => {
    const targetFilters = { schemaVersion: 1 as const, enabled: true, categories: { ssd: { specValues: { interface: ["SATA"] } } } };
    const draft = generateBuildDraft(seedCatalog, request, [], { targetFilters });
    expect(draft.selection.ssd?.[0]?.partId).toBe("ssd-sata-1tb");
    // 다른 범주는 필터 없이 그대로 선택된다.
    expect(draft.selection.memory?.[0]?.partId).toBeTruthy();
  });

  it("후보가 모두 걸러진 범주는 조용한 fallback 없이 명시적으로 실패한다", () => {
    const targetFilters = { schemaVersion: 1 as const, enabled: true, categories: { ssd: { brands: ["존재하지않는브랜드"] } } };
    expect(() => generateBuildDraft(seedCatalog, request, [], { targetFilters })).toThrow(BuildGenerationError);
    try {
      generateBuildDraft(seedCatalog, request, [], { targetFilters });
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(BuildGenerationError);
      if (error instanceof BuildGenerationError) expect(error.message).toContain("SSD");
    }
  });

  it("최소 실행 가능 견적가도 같은 필터를 적용한다", () => {
    const unfiltered = minimumFeasibleBuildPriceFor(seedCatalog, request);
    const sataOnly = minimumFeasibleBuildPriceFor(seedCatalog, request, {
      targetFilters: { schemaVersion: 1, enabled: true, categories: { ssd: { specValues: { interface: ["SATA"] } } } }
    });
    expect(sataOnly).toBeDefined();
    // 시드에서 SATA SSD(99,000원)는 NVMe(109,000원)보다 싸므로 하한이 같거나 낮아진다.
    expect(sataOnly!).toBeLessThanOrEqual(unfiltered!);
  });
});

describe("admin engine-filters API", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    invalidateEngineTargetFiltersCache();
    server = await new Promise<Server>((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("GET → PUT → GET 순서로 설정을 읽고 저장한다", async () => {
    const initial = await fetch(`${baseUrl}/api/admin/engine-filters`).then((res) => res.json());
    expect(initial.config).toEqual(emptyEngineTargetFiltersConfig());
    expect(initial.summary.ssd).toBeDefined();

    const config = { schemaVersion: 1, enabled: true, categories: { ssd: { brands: ["Samsung"], specValues: { interface: ["NVMe"] } } } };
    const saved = await fetch(`${baseUrl}/api/admin/engine-filters`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config })
    }).then((res) => res.json());
    expect(saved.saved).toBe(true);
    expect(saved.config).toEqual(config);

    const reloaded = await fetch(`${baseUrl}/api/admin/engine-filters`).then((res) => res.json());
    expect(reloaded.config).toEqual(config);
    expect(loadEngineTargetFiltersConfig()).toEqual(config);
  });

  it("잘못된 설정은 저장하지 않고 400을 돌려준다", async () => {
    const response = await fetch(`${baseUrl}/api/admin/engine-filters`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { categories: { ssd: { specValues: { unknownField: ["x"] } } } } })
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ saved: false });
  });

  it("preview는 저장 없이 통과 수를 계산한다", async () => {
    const response = await fetch(`${baseUrl}/api/admin/engine-filters/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { enabled: true, categories: { ssd: { specValues: { interface: ["SATA"] } } } } })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.ssd).toBeDefined();
    // 저장된 필터는 위 PUT의 NVMe 조건 — preview가 파일을 바꾸지 않았는지 확인한다.
    expect(loadEngineTargetFiltersConfig().categories.ssd?.specValues?.interface).toEqual(["NVMe"]);
  });

  it("facets는 범주별 옵션과 수량을 돌려준다", async () => {
    const response = await fetch(`${baseUrl}/api/admin/engine-filters/facets`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.categories.ssd.brandOptions.length).toBeGreaterThan(0);
    expect(body.categories.ssd.facetOptions.interface.options.length).toBeGreaterThan(0);
  });
});
