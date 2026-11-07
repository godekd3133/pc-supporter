import { type CompatibilityResult } from "../../shared/types";
import { InFlightDeduper, compatibilityResultCacheKey, compatibilityResultCache, type CompatibilityResponseCacheValue } from "../compatibility-cache";
import { parseBuild, parseRecommendationPreferences } from "../../shared/domain/build-input";
import { prepareCompatibilityRequest } from "../compatibility-request";
import { ENGINE_VERSION } from "../../shared/domain/engine";
import { compatibilityResultForPublicTransport } from "../../shared/domain/compatibility-evaluator";
import { publicApiPayloadProjection } from "../public-api-projection";
import { trackUsageEvent } from "../usage-events";
import { parseBudgetLadderShareInput, budgetLadderShareExpired, budgetLadderShareExpiresAtFor, publicBudgetLadderShare } from "../budget-ladder-share";
import { loadCatalogSnapshotTimestamp } from "../catalog-snapshot";
import { createShareOwnerCredential } from "../build-share";
import { readSavedBudgetLadders, appendSavedBudgetLadder, deleteSavedBudgetLadder, deleteOwnerShareSessionGrantsForResource, appendSavedGeneratorVariants, deleteSavedGeneratorVariants, readSavedGeneratorVariants } from "../repository";
import { randomUUID } from "node:crypto";
import { type SavedBudgetLadderRecord, budgetLadderShareLineageEntryFor, type BudgetLadderShareLineageResponse } from "../../shared/budget-ladder-share";
import { ownerManagedShareResponse } from "../owner-session-routes";
import { parseGeneratorVariantsShareInput, publicGeneratorVariantsShare } from "../generator-variants-share";
import { shareExpiresAtFor, shareExpired } from "../share-lifecycle";
import { type Express } from "express";
import { evaluateBuildWithAccessories, sendJsonWithEtag, routeParam, createRateLimitMiddleware, privateNoStore, publicCompatibilityRateLimit, ownerShareCanManageRequest, persistOwnerShareResource } from "./route-support";

type CompatibilityApiOutcome =
  | { status: "ok"; result: CompatibilityResult; body: string; cacheLookup: "HIT" | "MISS" }
  | { status: "error"; statusCode: number; body: Record<string, unknown> };

const compatibilityRequestDeduper = new InFlightDeduper<CompatibilityApiOutcome>();
const budgetLadderCreateRateLimit = createRateLimitMiddleware("budget-ladder-create", { limit: 10, windowMs: 60_000 });
const budgetLadderShareRateLimit = createRateLimitMiddleware("budget-ladder-share", { limit: 120, windowMs: 60_000 });
const generatorVariantsCreateRateLimit = createRateLimitMiddleware("generator-variants-create", { limit: 10, windowMs: 60_000 });
const generatorVariantsShareRateLimit = createRateLimitMiddleware("generator-variants-share", { limit: 120, windowMs: 60_000 });

export function registerRecommendationsRoutes(app: Express) {
app.post("/api/compatibility/check", publicCompatibilityRateLimit, async (request, response) => {
  const parsed = parseBuild(request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "견적 입력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const build = parsed.build;
  const recommendationPreferences = parseRecommendationPreferences(request.body?.recommendationPreferences);
  const preparation = await prepareCompatibilityRequest(build, recommendationPreferences, ENGINE_VERSION);
  const { catalog, accessories, catalogUpdatedAt: catalogSnapshotAt, accessoryUpdatedAt, catalogRevision } = preparation.snapshot;
  const requestKey = preparation.requestKey;
  const outcome = await compatibilityRequestDeduper.getOrCompute(requestKey, async (): Promise<CompatibilityApiOutcome> => {
    if (preparation.error) return { status: "error", statusCode: preparation.error.statusCode, body: preparation.error.body };
    const cacheKey = compatibilityResultCacheKey({
      build,
      recommendationPreferences,
      catalogSnapshotAt,
      accessoryUpdatedAt,
      catalogRevision,
      engineVersion: ENGINE_VERSION,
      gamingPerformanceEvidenceUpdatedAt: preparation.gamingPerformanceEvidenceUpdatedAt
    });
    const cached = await compatibilityResultCache.getOrCompute(cacheKey, () => {
      const fullResult = evaluateBuildWithAccessories(build, catalog, accessories, catalogSnapshotAt, recommendationPreferences);
      const result = compatibilityResultForPublicTransport(fullResult);
      return { result, body: JSON.stringify(result) } satisfies CompatibilityResponseCacheValue;
    });
    return { status: "ok", result: cached.value.result, body: cached.value.body, cacheLookup: cached.lookup === "COALESCED" ? "HIT" : cached.lookup };
  });
  if (outcome.value.status === "error") {
    response.status(outcome.value.statusCode).json(outcome.value.body);
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-PC-Supporter-Compatibility-Cache", outcome.lookup === "COALESCED" ? "COALESCED" : outcome.value.cacheLookup);
  response.setHeader("X-PC-Supporter-Compatibility-Checked-At", outcome.value.result.checkedAt);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  const publicBody = JSON.stringify(publicApiPayloadProjection(outcome.value.result));
  response.setHeader("Content-Length", String(Buffer.byteLength(publicBody)));
  trackUsageEvent("check", { path: "/api/compatibility/check" });
  response.end(publicBody);
});

app.post("/api/budget-ladders", budgetLadderCreateRateLimit, privateNoStore, async (request, response) => {
  const parsed = parseBudgetLadderShareInput(request.body);
  if (parsed.errors.length > 0 || !parsed.name || !parsed.payload) {
    response.status(400).json({ error: parsed.errors[0] ?? "예산 구간 비교를 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const now = new Date().toISOString();
  const { catalogUpdatedAt: catalogSnapshotAt } = await loadCatalogSnapshotTimestamp();
  const ownerCredential = createShareOwnerCredential();
  const existingLadders = parsed.parentId ? await readSavedBudgetLadders() : [];
  const parent = parsed.parentId ? existingLadders.find((item) => item.id === parsed.parentId) : undefined;
  if (parsed.parentId && (!parent || budgetLadderShareExpired(parent))) {
    response.status(400).json({ error: "원본 예산 비교 저장본을 찾을 수 없거나 만료되었습니다." });
    return;
  }
  const id = randomUUID();
  const lineageId = parent?.lineageId ?? parent?.id ?? id;
  const versionNumber = parent ? Math.max(...existingLadders.filter((item) => (item.lineageId ?? item.id) === lineageId).map((item) => item.versionNumber ?? 1), parent.versionNumber ?? 1) + 1 : 1;
  const expiresAt = budgetLadderShareExpiresAtFor(parsed.expiresInDays, Date.parse(now));
  const saved: SavedBudgetLadderRecord = {
    id,
    name: parsed.name,
    payload: parsed.payload,
    ...(parsed.parentId ? { parentId: parsed.parentId } : {}),
    lineageId,
    versionNumber,
    ...(parsed.request ? { request: parsed.request } : {}),
    catalogSnapshotAt,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ownerTokenHash: ownerCredential.hash
  };
  const created = await persistOwnerShareResource(request, response, "budget-ladder", saved, async () => {
    await appendSavedBudgetLadder(saved);
    return saved;
  }, () => deleteSavedBudgetLadder(saved.id));
  if (!created) return;
  trackUsageEvent("share", { path: "/api/budget-ladders" });
  response.status(201).json(ownerManagedShareResponse(publicBudgetLadderShare(created.persisted, catalogSnapshotAt), ownerCredential.token, created.ownerManaged));
});

app.get("/api/budget-ladders/:id", budgetLadderShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const ladder = (await readSavedBudgetLadders()).find((item) => item.id === id);
  if (!ladder) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  if (budgetLadderShareExpired(ladder)) {
    response.status(404).json({ error: "예산 구간 비교 링크가 만료되었습니다." });
    return;
  }
  const { catalogUpdatedAt: catalogSnapshotAt } = await loadCatalogSnapshotTimestamp();
  response.json(publicBudgetLadderShare(ladder, catalogSnapshotAt));
});

app.get("/api/budget-ladders/:id/lineage", budgetLadderShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const ladders = await readSavedBudgetLadders();
  const current = ladders.find((item) => item.id === id);
  if (!current) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  if (budgetLadderShareExpired(current)) {
    response.status(404).json({ error: "예산 구간 비교 링크가 만료되었습니다." });
    return;
  }
  const lineageId = current.lineageId ?? current.id;
  const entries = ladders
    .filter((item) => (item.lineageId ?? item.id) === lineageId)
    .map((item) => budgetLadderShareLineageEntryFor(item))
    .sort((left, right) => left.versionNumber - right.versionNumber || left.createdAt.localeCompare(right.createdAt));
  const payload: BudgetLadderShareLineageResponse = { lineageId, currentId: current.id, entries };
  response.json(payload);
});

app.delete("/api/budget-ladders/:id", budgetLadderShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const ladder = (await readSavedBudgetLadders()).find((item) => item.id === id);
  if (!ladder) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!await ownerShareCanManageRequest(request, "budget-ladder", ladder, ownerToken)) {
    response.status(401).json({ error: "이 예산 구간 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedBudgetLadder(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  await deleteOwnerShareSessionGrantsForResource("budget-ladder", id ?? "");
  response.json({ deleted: true });
});

app.post("/api/generator-variants", generatorVariantsCreateRateLimit, privateNoStore, async (request, response) => {
  const parsed = parseGeneratorVariantsShareInput(request.body);
  if (parsed.errors.length > 0 || !parsed.name || !parsed.payload) {
    response.status(400).json({ error: parsed.errors[0] ?? "자동 구성 비교를 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const now = new Date().toISOString();
  const { catalogUpdatedAt: catalogSnapshotAt } = await loadCatalogSnapshotTimestamp();
  const ownerCredential = createShareOwnerCredential();
  const expiresAt = shareExpiresAtFor(parsed.expiresInDays, Date.parse(now));
  const saved: import("../../shared/generator-variants-share").SavedGeneratorVariantsRecord = {
    id: randomUUID(),
    name: parsed.name,
    payload: parsed.payload,
    ...(parsed.request ? { request: parsed.request } : {}),
    catalogSnapshotAt,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ownerTokenHash: ownerCredential.hash
  };
  const created = await persistOwnerShareResource(request, response, "generator-variants", saved, async () => {
    await appendSavedGeneratorVariants(saved);
    return saved;
  }, () => deleteSavedGeneratorVariants(saved.id));
  if (!created) return;
  trackUsageEvent("share", { path: "/api/generator-variants" });
  response.status(201).json(ownerManagedShareResponse(publicGeneratorVariantsShare(created.persisted, catalogSnapshotAt), ownerCredential.token, created.ownerManaged));
});

app.get("/api/generator-variants/:id", generatorVariantsShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const saved = (await readSavedGeneratorVariants()).find((record) => record.id === id);
  if (!saved) {
    response.status(404).json({ error: "저장된 자동 구성 비교를 찾을 수 없습니다." });
    return;
  }
  if (shareExpired(saved.expiresAt)) {
    response.status(404).json({ error: "자동 구성 비교 링크가 만료되었습니다." });
    return;
  }
  const { catalogUpdatedAt: catalogSnapshotAt } = await loadCatalogSnapshotTimestamp();
  sendJsonWithEtag(request, response, publicGeneratorVariantsShare(saved, catalogSnapshotAt), saved.updatedAt);
});

app.delete("/api/generator-variants/:id", generatorVariantsShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const saved = (await readSavedGeneratorVariants()).find((record) => record.id === id);
  if (!saved) {
    response.status(404).json({ error: "저장된 자동 구성 비교를 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!await ownerShareCanManageRequest(request, "generator-variants", saved, ownerToken)) {
    response.status(401).json({ error: "이 자동 구성 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedGeneratorVariants(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 자동 구성 비교를 찾을 수 없습니다." });
    return;
  }
  await deleteOwnerShareSessionGrantsForResource("generator-variants", id ?? "");
  response.json({ deleted: true });
});
}
