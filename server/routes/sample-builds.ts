// 견본견적 API — shared/sample-builds.ts의 이름 기반 견본을 현재 카탈로그로 해석해
// 부품 선택과 가격, 해석에 쓰인 부품 레코드를 함께 돌려준다.
import { type Express } from "express";
import type { Part, PartCategory } from "../../shared/types";
import { SAMPLE_BUILDS, resolveSampleBuildFromIndex, type ResolvedSampleBuild, type SampleBuildsPayload } from "../../shared/sample-builds";
import { loadCatalogSnapshot } from "../catalog-snapshot";
import { createRateLimitMiddleware, sendJsonWithEtag } from "./route-support";

const sampleBuildsReadRateLimit = createRateLimitMiddleware("sample-builds-read", { limit: 120, windowMs: 60_000 });

// 카탈로그 배열이 바뀌지 않으면 해석 결과도 같다 — 배열 참조별로 기억한다.
const resolvedByCatalog = new WeakMap<readonly Part[], { samples: ResolvedSampleBuild[]; parts: Part[] }>();

export function resolveAllSampleBuilds(catalog: readonly Part[]) {
  const cached = resolvedByCatalog.get(catalog);
  if (cached) return cached;
  const partsByCategory = new Map<PartCategory, Part[]>();
  for (const part of catalog) {
    const list = partsByCategory.get(part.category);
    if (list) list.push(part);
    else partsByCategory.set(part.category, [part]);
  }
  const partsById = new Map<string, Part>();
  const samples = SAMPLE_BUILDS.map((sample) => {
    const { resolved, parts } = resolveSampleBuildFromIndex(sample, partsByCategory);
    for (const part of parts) partsById.set(part.id, part);
    return resolved;
  });
  const value = { samples, parts: [...partsById.values()] };
  resolvedByCatalog.set(catalog, value);
  return value;
}

export function registerSampleBuildRoutes(app: Express) {
  app.get("/api/sample-builds", sampleBuildsReadRateLimit, async (request, response) => {
    const snapshot = await loadCatalogSnapshot();
    const { samples, parts } = resolveAllSampleBuilds(snapshot.catalog);
    const payload: SampleBuildsPayload = { samples, parts, catalogUpdatedAt: snapshot.catalogUpdatedAt };
    sendJsonWithEtag(request, response, payload, snapshot.catalogUpdatedAt);
  });
}
