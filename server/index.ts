import "dotenv/config";
import { validateAccessoryTargetPartIds, validateBuildPartIds, validateBuildSelection } from "./build-validation";
import { emptyBuild, parseBuild, parseBuildGenerationRequest, parseRecommendationPreferences } from "../shared/domain/build-input";
import express, { type Response, type Request, type NextFunction } from "express";
import { startDurablePriceRefreshScheduler, priceRefreshIntervalMsFromEnv, priceRefreshOptionsFromEnv } from "./price-refresh-scheduler";
import { backgroundJobStore } from "./background-job-store";
import { securityHeaders } from "./security-headers";
import { requestTelemetry } from "./request-telemetry";
import { recordHttpRequestMetric } from "./request-metrics";
import { corsOriginIsAllowed } from "./origin-policy";
import compression from "compression";
import { requireOwnerSessionUnsafeOrigin, requireOwnerSessionCreationContext, type OwnerSessionResource, createOwnerSessionRouter } from "./owner-session-routes";
import { publicApiPayloadProjection } from "./public-api-projection";
import { shareExpired } from "./share-lifecycle";
import { savedBuildMonitorSubscriptionDue, SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT } from "../shared/saved-build-monitor-subscription";
import { withSavedBuildMonitorLease, readSavedWatchlists, readSavedComparisons, readSavedBuildVersionComparisons, readSavedBudgetLadders, readSavedGeneratorVariants, persistenceDiagnostics, initializePersistence, pruneRateLimitWindows, RATE_LIMIT_BUCKET_CLEANUP_INTERVAL_MS, closePersistence } from "./repository";
import { type OwnerSessionResourceType } from "../shared/owner-session-contract";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { ensureDataDirectory } from "./storage";
import { syncAllRuntimeConfigsFromDatabase, syncRuntimeConfigFromDatabase } from "./runtime-config-sync";
import { loadCatalog, invalidateCatalogCache } from "./catalog";
import { type Server as HttpServer } from "node:http";
import { startPriceRefreshQueueWorker } from "./price-refresh-worker";
import { startInstanceEventBus, INSTANCE_ID, stopInstanceEventBus } from "./instance-events";
import { clearCompatibilityEngineCaches } from "./engines/compatibility-engine";
import { invalidateAccessoryCache } from "./accessories";
import { appendGenerationFailureRecord } from "./generation-failure-log";
import { withCatalogIngestionLease as executeCatalogIngestionJob } from "./catalog-ingestion-coordinator";
import { runCrawlJob, isCrawlRunning } from "./engines/crawler-engine";
import { priceRefreshSchedulerEnabled, priceRefreshScheduler, requestCanViewAdminMeta, createRateLimitMiddleware, loadBuilds, loadSavedBuildMonitorResources, executeSavedBuildMonitorRun, savedBuildMonitorSchedulerStats, ownerSessionStoreApi } from "./routes/route-support";
import { registerAdminRoutes } from "./routes/admin";
import { registerBuildsRoutes } from "./routes/builds";
import { registerRecommendationsRoutes } from "./routes/recommendations";
import { registerCatalogRoutes } from "./routes/catalog";
import { registerSystemRoutes } from "./routes/system";
export { validateM2SlotOverrideBatch } from "./routes/admin";
export { buildM2SlotCoverage } from "./routes/admin";
export { buildM2SlotReviewTemplate } from "./routes/admin";
export { MAX_BUILD_SELECTIONS_PER_LIST } from "./routes/route-support";
export { MAX_BUILD_ID_LENGTH } from "./routes/route-support";
export { MAX_BUILD_M2_SLOTS } from "./routes/route-support";

export { validateAccessoryTargetPartIds, validateBuildPartIds, validateBuildSelection } from "./build-validation";
export { emptyBuild, parseBuild, parseBuildGenerationRequest, parseRecommendationPreferences } from "../shared/domain/build-input";
export type { BuildParseResult, BuildGenerationRequestParseResult } from "../shared/domain/build-input";

const app = express();
const port = Number(process.env.PORT ?? 4174);
const serverHost = process.env.SERVER_HOST?.trim() || "0.0.0.0";
type ProcessRole = "combined" | "api" | "worker";
const processRole = process.env.PC_SUPPORTER_PROCESS_ROLE?.trim() || "combined";
if (processRole !== "combined" && processRole !== "api" && processRole !== "worker") {
  throw new Error("PC_SUPPORTER_PROCESS_ROLE must be combined, api, or worker.");
}
if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required; the JSON file persistence mode has been removed.");
}
const durablePriceRefreshScheduler = startDurablePriceRefreshScheduler({
  intervalMs: priceRefreshIntervalMsFromEnv(),
  enqueue: (idempotencyKey, slot) => backgroundJobStore.enqueue({
    kind: "price-refresh",
    payload: {
      ...priceRefreshOptionsFromEnv(),
      trigger: "scheduled",
      scheduledIntervalMs: slot.intervalMs,
      scheduledSlot: slot.slot
    },
    idempotencyKey
  })
});

function isLoopbackProxyAddress(address: string) {
  const normalized = address.replace(/^::ffff:/i, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

// Caddy runs on the same host; trust only loopback so direct clients cannot spoof X-Forwarded-For.
app.set("trust proxy", isLoopbackProxyAddress);

app.use(securityHeaders());
app.use(requestTelemetry((record) => {
  recordHttpRequestMetric(record);
  console.log(JSON.stringify(record));
}));

function isApiPath(path: string) {
  return path === "/api" || path.startsWith("/api/");
}

function isOwnerSessionUnsafePath(path: string, method: string) {
  const upperMethod = method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(upperMethod)) return false;
  if (path === "/api/owner-sessions" || path.startsWith("/api/owner-sessions/")) return true;
  if (path === "/api/builds" || path === "/api/watchlists" || path === "/api/comparisons"
    || path === "/api/version-comparisons" || path === "/api/budget-ladders" || path === "/api/generator-variants") {
    return upperMethod === "POST";
  }
  if (["/api/builds/recommend", "/api/builds/recommend/variants", "/api/builds/recommend/budget-ladder", "/api/builds/recommend/floor", "/api/builds/check-preview"].includes(path)) return false;
  if (/^\/api\/builds\/[^/]+(?:\/.*)?$/.test(path)) return true;
  if (/^\/api\/watchlists\/[^/]+$/.test(path)) return upperMethod === "PATCH" || upperMethod === "DELETE";
  if (/^\/api\/watchlists\/[^/]+\/alerts\/(?:read|dismiss)$/.test(path)) return upperMethod === "POST";
  return /^\/api\/(?:comparisons|version-comparisons|budget-ladders|generator-variants)\/[^/]+$/.test(path) && upperMethod === "DELETE";
}

const ownerSessionShareCreationPaths = new Set([
  "/api/builds",
  "/api/watchlists",
  "/api/comparisons",
  "/api/version-comparisons",
  "/api/budget-ladders",
  "/api/generator-variants"
]);

app.use((request, response, next) => {
  const origin = request.header("Origin");
  if (origin && corsOriginIsAllowed(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type, If-Modified-Since, If-None-Match, Idempotency-Key, X-Share-Owner-Token, X-PC-Owner-Mode");
    response.setHeader("Access-Control-Expose-Headers", "ETag, Last-Modified, Retry-After, X-Request-Id");
    response.setHeader("Access-Control-Max-Age", "600");
    response.vary("Origin");
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
  }
  next();
});

// JSON 응답을 gzip으로 압축한다 — 카탈로그 목록/견적 검사 결과처럼 큰
// 본문의 전송량을 줄인다. SSE 스트림은 없으므로 전체 라우트에 적용한다.
app.use(compression());
app.use(express.json({ limit: "1mb" }));

app.use((request, response, next) => {
  if (isOwnerSessionUnsafePath(request.path, request.method)) {
    requireOwnerSessionUnsafeOrigin(request, response, next);
    return;
  }
  next();
});

app.use((request, response, next) => {
  if (request.method.toUpperCase() === "POST" && ownerSessionShareCreationPaths.has(request.path)) {
    requireOwnerSessionCreationContext(request, response, next);
    return;
  }
  next();
});

// Public responses must not expose internal recommendation scores or evidence.
// Admin evidence APIs retain their full payloads for authorized review.
app.use((request, response, next) => {
  const authenticatedAdminMeta = request.path === "/api/meta" && requestCanViewAdminMeta(request);
  if (!isApiPath(request.path) || request.path === "/api/admin" || request.path.startsWith("/api/admin/") || authenticatedAdminMeta) {
    next();
    return;
  }
  const json = response.json.bind(response) as (body?: unknown) => Response;
  response.json = ((body?: unknown) => json(publicApiPayloadProjection(body))) as Response["json"];
  next();
});

type JsonBodyParserError = Error & {
  type?: string;
  status?: number;
  statusCode?: number;
};

function jsonBodyErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction) {
  const parserError = error as JsonBodyParserError;
  const status = parserError.status ?? parserError.statusCode;
  if (parserError.type === "entity.parse.failed" || error instanceof SyntaxError && status === 400) {
    response.status(400).json({ error: "요청 본문 JSON 형식이 올바르지 않습니다.", code: "INVALID_JSON" });
    return;
  }
  if (parserError.type === "entity.too.large" || status === 413) {
    response.status(413).json({ error: "요청 본문이 너무 큽니다.", code: "REQUEST_BODY_TOO_LARGE" });
    return;
  }
  next(error);
}

// Keep parser failures in the JSON API contract without swallowing unrelated route errors.
app.use(jsonBodyErrorHandler);
const ownerSessionMigrationRateLimit = createRateLimitMiddleware("owner-session-migrate", { limit: 10, windowMs: 60_000 });

let savedBuildMonitorSchedulerRunning = false;

async function runDueSavedBuildMonitorsUnlocked(now: string) {
  const dueBuilds = (await loadBuilds())
    .filter((build) => !shareExpired(build.expiresAt) && savedBuildMonitorSubscriptionDue(build.monitorState, now))
    .slice(0, SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT);
  if (dueBuilds.length === 0) return 0;
  const resources = await loadSavedBuildMonitorResources();
  for (const build of dueBuilds) {
    await executeSavedBuildMonitorRun(build, resources, now).catch((error: unknown) => {
      console.warn(`저장 견적 백그라운드 점검 실패 (${build.id}): ${error instanceof Error ? error.message : String(error)}`);
      });
  }
  return dueBuilds.length;
}

async function runDueSavedBuildMonitors(now = new Date().toISOString()) {
  if (savedBuildMonitorSchedulerRunning) return;
  savedBuildMonitorSchedulerRunning = true;
  try {
    savedBuildMonitorSchedulerStats.lastAttemptedAt = now;
    const lease = await withSavedBuildMonitorLease(() => runDueSavedBuildMonitorsUnlocked(now));
    savedBuildMonitorSchedulerStats.lastBackend = lease.backend;
    if (!lease.acquired) {
      savedBuildMonitorSchedulerStats.lastSkippedAt = now;
      savedBuildMonitorSchedulerStats.skippedCount += 1;
      return;
    }
    savedBuildMonitorSchedulerStats.lastAcquiredAt = now;
    savedBuildMonitorSchedulerStats.lastProcessedCount = lease.value;
    savedBuildMonitorSchedulerStats.lastFinishedAt = new Date().toISOString();
    savedBuildMonitorSchedulerStats.lastError = undefined;
  } catch (error: unknown) {
    savedBuildMonitorSchedulerStats.lastError = error instanceof Error ? error.message : "scheduler 실행에 실패했습니다.";
    console.warn(`저장 견적 scheduler 실행 실패: ${savedBuildMonitorSchedulerStats.lastError}`);
  } finally {
    savedBuildMonitorSchedulerRunning = false;
  }
}

registerAdminRoutes(app);
registerBuildsRoutes(app);
registerRecommendationsRoutes(app);
registerCatalogRoutes(app);
registerSystemRoutes(app);

async function readOwnerSessionResources(resourceType: OwnerSessionResourceType): Promise<OwnerSessionResource[]> {
  switch (resourceType) {
    case "build": return loadBuilds();
    case "watchlist": return readSavedWatchlists();
    case "comparison": return readSavedComparisons();
    case "version-comparison": return readSavedBuildVersionComparisons();
    case "budget-ladder": return readSavedBudgetLadders();
    case "generator-variants": return readSavedGeneratorVariants();
  }
}

app.use("/api/owner-sessions", createOwnerSessionRouter({
  ...ownerSessionStoreApi,
  migrationRateLimit: ownerSessionMigrationRateLimit,
  readResources: readOwnerSessionResources
}));

const distPath = resolve(process.cwd(), "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (isApiPath(request.path)) {
      next();
      return;
    }
    response.sendFile(resolve(distPath, "index.html"));
  });
}

app.use((request, response, next) => {
  if (!isApiPath(request.path)) {
    next();
    return;
  }
  response.status(404).json({ error: "요청한 API 경로를 찾을 수 없습니다.", code: "API_NOT_FOUND" });
});

async function apiErrorHandler(error: unknown, request: Request, response: Response, next: NextFunction) {
  if (!isApiPath(request.path) || response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof URIError) {
    response.status(400).json({ error: "API 요청 경로 형식이 올바르지 않습니다.", code: "API_INVALID_PATH" });
    return;
  }
  const persistence = await persistenceDiagnostics();
  const statusCode = persistence.ready ? 500 : 503;
  // 500/503은 클라이언트에만 코드를 남기면 원인을 추적할 수 없다 — 요청 ID와 함께
  // 서버 로그에 남겨 "견적 실패" 보고를 특정 요청으로 되돌릴 수 있게 한다.
  console.error(JSON.stringify({
    event: "api.error",
    at: new Date().toISOString(),
    requestId: response.locals.requestId,
    method: request.method,
    path: request.path,
    statusCode,
    persistenceReady: persistence.ready,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    stack: error instanceof Error && error.stack ? error.stack.split("\n").slice(0, 8).join("\n") : undefined
  }));
  if (!persistence.ready) {
    response.setHeader("Retry-After", "1");
    response.status(503).json({ error: "저장소에 연결할 수 없어 요청을 처리하지 못했습니다.", code: "PERSISTENCE_UNAVAILABLE" });
    return;
  }
  response.status(500).json({ error: "서버에서 API 요청을 처리하지 못했습니다.", code: "INTERNAL_SERVER_ERROR" });
}

app.use(apiErrorHandler);

export { app };

async function start() {
  await ensureDataDirectory();
  try {
    await initializePersistence();
    // 공유 설정을 DB에서 내려 로컬 파일 복제본을 맞춘 뒤 카탈로그를 읽는다 —
    // 오버라이드 복제본이 카탈로드 로드 전에 반영돼야 첫 요청부터 최신 스펙이 나간다.
    await syncAllRuntimeConfigsFromDatabase();
    await loadCatalog();
  } catch (error: unknown) {
    const persistence = await persistenceDiagnostics();
    if (!persistence.databaseConfigured || persistence.ready) throw error;
    console.error(`Configured PostgreSQL is unavailable; starting API to report readiness: ${error instanceof Error ? error.message : String(error)}`);
  }
  let apiServer: HttpServer | undefined;
  let priceRefreshWorker: ReturnType<typeof startPriceRefreshQueueWorker> | undefined;
  const backgroundTimers: NodeJS.Timeout[] = [];
  const trackBackgroundTimer = (timer: NodeJS.Timeout) => {
    timer.unref();
    backgroundTimers.push(timer);
    return timer;
  };
  if (processRole !== "worker") {
    apiServer = app.listen(port, serverHost, () => {
      console.log(`PC Supporter API listening on http://127.0.0.1:${port} (${processRole})`);
    });
    // 소켓 계층 타임아웃 — 프록시/로드밸런서 idle 제한(60s)보다 길게 잡아
    // 연결이 먼저 끊기지 않게 하고, 붙은 요청이 워커를 무한히 잡지 않게 한다.
    apiServer.keepAliveTimeout = 65_000;
    apiServer.headersTimeout = 66_000;
    apiServer.requestTimeout = Math.max(30_000, Number(process.env.PC_SUPPORTER_REQUEST_TIMEOUT_MS ?? 120_000));
  }

  if (processRole !== "api") {
    trackBackgroundTimer(setTimeout(() => {
      void pruneRateLimitWindows().catch((error: unknown) => console.warn("공유 rate-limit 만료 항목 정리에 실패했습니다.", error));
    }, 10_000));
    trackBackgroundTimer(setInterval(() => {
      void pruneRateLimitWindows().catch((error: unknown) => console.warn("공유 rate-limit 만료 항목 정리에 실패했습니다.", error));
    }, RATE_LIMIT_BUCKET_CLEANUP_INTERVAL_MS));
  }

  if (processRole !== "api" && process.env.BUILD_MONITOR_SCHEDULER_ENABLED !== "false") {
    trackBackgroundTimer(setTimeout(() => void runDueSavedBuildMonitors(), 5_000));
    trackBackgroundTimer(setInterval(() => void runDueSavedBuildMonitors(), 60_000));
  }

  // 인스턴스 이벤트 버스 — 다른 노드의 카탈로그/주변 부품 쓰기가 알려지면
  // 로컬 인메모리 캐시를 비우고, 견적 실패 기록은 모든 노드의 로그에 합친다.
  startInstanceEventBus((event) => {
    if (event.kind === "cache-invalidate:catalog") {
      invalidateCatalogCache();
      clearCompatibilityEngineCaches();
      return;
    }
    if (event.kind === "cache-invalidate:accessories") {
      invalidateAccessoryCache();
      clearCompatibilityEngineCaches();
      return;
    }
    if (event.kind === "generation-failure" && event.source !== INSTANCE_ID) {
      appendGenerationFailureRecord(event.data as Parameters<typeof appendGenerationFailureRecord>[0]);
      return;
    }
    // 다른 인스턴스가 저장한 설정 — 공유 원본(runtime_configs)에서 가져와
    // 로컬 파일 복제본에 기록한다. 자신이 발행한 이벤트의 루프백은 건너뛴다.
    if (event.kind === "config:file" && event.source !== INSTANCE_ID) {
      const name = (event.data as { name?: string } | undefined)?.name;
      if (name) void syncRuntimeConfigFromDatabase(name);
    }
  });

  const priceRefreshEnabled = priceRefreshSchedulerEnabled();
  const ownsBackgroundWork = processRole !== "api";
  const runsDurableWorker = ownsBackgroundWork;
  if (runsDurableWorker) {
    priceRefreshWorker = startPriceRefreshQueueWorker();
    void priceRefreshWorker.start().catch((error: unknown) => {
      console.error(`Price-refresh worker stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
  }
  if (priceRefreshEnabled && runsDurableWorker) {
    durablePriceRefreshScheduler.start();
    trackBackgroundTimer(setTimeout(() => {
      void durablePriceRefreshScheduler.enqueueCurrentSlot()?.catch((error) => console.error("Initial price-refresh enqueue failed", error));
    }, 5_000));
  }

  // The older catalog crawl uses broad/sample discovery settings. It stays opt-in and
  // serializes with the price-refresh scheduler through the catalog-ingestion lease.
  const legacyCrawlEnabled = ownsBackgroundWork && process.env.DANAWA_CRAWL_SCHEDULER_ENABLED === "true";
  const intervalHours = Number(process.env.DANAWA_CRAWL_INTERVAL_HOURS ?? 24);
  if (legacyCrawlEnabled && process.env.DANAWA_CRAWL_ON_START === "true") {
    void executeCatalogIngestionJob(() => runCrawlJob({ all: process.env.DANAWA_CRAWL_ALL === "true" }))
      .catch((error: unknown) => console.warn("초기 카탈로그 수집이 시작되지 않았습니다.", error));
  }
  if (legacyCrawlEnabled && Number.isFinite(intervalHours) && intervalHours > 0) {
    trackBackgroundTimer(setInterval(() => {
      if (!isCrawlRunning()) {
        void executeCatalogIngestionJob(() => runCrawlJob({ all: process.env.DANAWA_CRAWL_ALL === "true" }))
          .catch((error: unknown) => console.warn("예약된 카탈로그 수집이 시작되지 않았습니다.", error));
      }
    }, intervalHours * 60 * 60 * 1000));
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`PC Supporter ${processRole} received ${signal}; draining requests and background work.`);
    for (const timer of backgroundTimers) clearTimeout(timer);
    priceRefreshScheduler.stop();
    durablePriceRefreshScheduler.stop();
    try {
      if (apiServer) {
        await new Promise<void>((resolveClose, rejectClose) => {
          apiServer!.close((error) => error ? rejectClose(error) : resolveClose());
          apiServer!.closeIdleConnections?.();
        });
      }
      await stopInstanceEventBus();
      await priceRefreshScheduler.waitForIdle();
      await durablePriceRefreshScheduler.waitForIdle();
      if (priceRefreshWorker) await priceRefreshWorker.stop();
      while (savedBuildMonitorSchedulerRunning) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
    } catch (error: unknown) {
      process.exitCode = 1;
      console.error(`PC Supporter ${processRole} shutdown drain failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await closePersistence().catch((error: unknown) => {
        process.exitCode = 1;
        console.error(`PC Supporter persistence pool did not close cleanly: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  };
  const onShutdown = (signal: NodeJS.Signals) => {
    void shutdown(signal).catch((error: unknown) => {
      process.exitCode = 1;
      console.error(`PC Supporter shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  process.once("SIGTERM", () => onShutdown("SIGTERM"));
  process.once("SIGINT", () => onShutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  void start();
}
