// 참조 견적(referenceBuilds) 적용 전후로 예산대별 자동 구성 결과를 비교하는
// 점검용 스크립트. 로컬 data/catalog.json + benchmark-overrides.json을 쓴다.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BuildGenerationRequest, Part } from "../shared/types";
import { applyBenchmarkOverrides, type BenchmarkOverrideMap } from "../server/benchmark-overrides";
import { generateBuildDraft } from "../server/engine";
import type { EngineGenerationOptions } from "../server/engine";

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function summarize(mode: string, request: BuildGenerationRequest, catalog: Part[], options: EngineGenerationOptions) {
  try {
    const draft = generateBuildDraft(catalog, request, [], options);
    const name = (category: string) => draft.lines.find((line) => line.category === category)?.name ?? "-";
    const price = (category: string) => draft.lines.find((line) => line.category === category)?.priceWon ?? 0;
    return `${(request.budgetWon / 10_000).toString().padStart(4)}만 ${mode} | CPU ${name("cpu")} (${Math.round(price("cpu") / 10_000)}만) | GPU ${name("gpu")} (${Math.round(price("gpu") / 10_000)}만) | 총 ${Math.round(draft.totalPriceWon / 10_000)}만 | ${draft.status}`;
  } catch (error) {
    return `${(request.budgetWon / 10_000).toString().padStart(4)}만 ${mode} | 실패: ${(error instanceof Error ? error.message : String(error)).slice(0, 90)}`;
  }
}

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const catalog = JSON.parse(await readFile(resolve(root, "data/catalog.json"), "utf8")) as Part[];
  const overridesRaw = await readOptionalFile(resolve(root, "data/benchmark-overrides.json"));
  const effectiveCatalog = overridesRaw ? applyBenchmarkOverrides(catalog, JSON.parse(overridesRaw) as BenchmarkOverrideMap) : catalog;
  const budgets = [800_000, 1_000_000, 1_400_000, 1_500_000, 1_800_000, 2_100_000, 2_400_000, 2_900_000, 3_500_000, 4_000_000];
  for (const budgetWon of budgets) {
    const request: BuildGenerationRequest = { profile: "gaming", priority: "balanced", budgetWon, includeGpu: true };
    for (const mode of ["off", "on"] as const) {
      console.log(summarize(mode, request, effectiveCatalog, mode === "on" ? {} : { referenceBuilds: [] }));
    }
  }
  const officeRequest: BuildGenerationRequest = { profile: "office", priority: "balanced", budgetWon: 900_000, includeGpu: false };
  for (const mode of ["off", "on"] as const) {
    console.log(summarize(mode, officeRequest, effectiveCatalog, mode === "on" ? {} : { referenceBuilds: [] }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
