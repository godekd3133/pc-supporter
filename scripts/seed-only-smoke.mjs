import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const port = Number(process.env.SEED_SMOKE_PORT ?? 4197);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-seed-smoke-"));
const childOutput = [];
let server;

function recordOutput(chunk) {
  childOutput.push(String(chunk));
  if (childOutput.length > 80) childOutput.shift();
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : ` details=${JSON.stringify(details)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function killServerTree(signal) {
  // npm → sh → tsx → node 자손까지 함께 종료하기 위해 detached 프로세스 그룹을 시그널한다.
  // 그룹이 없으면(Windows/이미 종료) 직접 자식만 시그널한다.
  if (process.platform !== "win32" && server?.pid) {
    try {
      process.kill(-server.pid, signal);
      return;
    } catch {
      // fall through to direct kill
    }
  }
  try {
    server?.kill(signal);
  } catch {
    // already gone
  }
}

async function jsonResponse(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10_000),
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : undefined;
  } catch {
    throw new Error(`${path}가 JSON을 반환하지 않았습니다. status=${response.status} body=${raw.slice(0, 300)}`);
  }
  assert(response.ok, `${path} 요청이 실패했습니다. status=${response.status}`, payload);
  return payload;
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`seed-only API가 시작 전에 종료되었습니다. exitCode=${server.exitCode}`);
    }
    try {
      const health = await jsonResponse("/api/health");
      assert(health?.ok === true, "health 응답의 ok가 true가 아닙니다.", health);
      return health;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`seed-only API health 대기 시간이 초과되었습니다. ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const compatibleBuild = {
  cpu: { partId: "cpu-7500f", quantity: 1 },
  cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
  motherboard: { partId: "mb-b650-4x3", quantity: 1 },
  memory: [{ partId: "memory-ddr5-32-6000-expo", quantity: 2 }],
  gpu: { partId: "gpu-rtx-4070", quantity: 1 },
  ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
  hdd: [],
  case: { partId: "case-full-airflow", quantity: 1 },
  psu: { partId: "psu-850w-atx-gold", quantity: 1 },
  accessories: [],
  useIntegratedGraphics: false
};

const incompatibleBuild = {
  ...compatibleBuild,
  cpu: { partId: "cpu-7800x3d", quantity: 1 },
  motherboard: { partId: "mb-b760-intel", quantity: 1 }
};

try {
  server = spawn(npmCommand, ["run", "start"], {
    env: {
      ...process.env,
      PORT: String(port),
      PC_SUPPORTER_DATA_DIR: dataDirectory,
      DATABASE_URL: "",
      DANAWA_CRAWL_ON_START: "false",
      BUILD_MONITOR_SCHEDULER_ENABLED: "false",
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });
  server.stdout.on("data", recordOutput);
  server.stderr.on("data", recordOutput);

  await waitForHealth();

  const meta = await jsonResponse("/api/meta");
  const expectedCategories = {
    cpu: 15,
    cooler: 10,
    motherboard: 15,
    memory: 14,
    gpu: 15,
    ssd: 12,
    hdd: 5,
    case: 12,
    psu: 15
  };
  assert(meta.storageMode === "file", "seed-only smoke가 file fallback을 사용하지 않았습니다.", meta.storageMode);
  assert(meta.catalogCount >= 115, "starter 핵심 부품 수가 기준보다 작습니다.", meta.catalogCount);
  assert(meta.accessoryCount >= 42, "starter 주변 부품 수가 기준보다 작습니다.", meta.accessoryCount);
  for (const [category, minimum] of Object.entries(expectedCategories)) {
    assert(meta.categoryCounts?.[category] >= minimum, `${category} starter 부품 수가 기준보다 작습니다.`, meta.categoryCounts?.[category]);
  }
  assert(meta.qualityCounts?.live === 0, "seed-only 환경에 live 핵심 데이터가 섞였습니다.", meta.qualityCounts);
  assert(meta.accessoryQualityCounts?.live === 0, "seed-only 환경에 live 주변 부품 데이터가 섞였습니다.", meta.accessoryQualityCounts);

  const gpuListing = await jsonResponse("/api/parts?category=gpu&quality=seed&limit=100");
  assert(gpuListing.items?.some((part) => part.id === "gpu-rtx-4070"), "seed GPU 목록에 대표 후보가 없습니다.", gpuListing);
  assert(gpuListing.items?.every((part) => part.dataQuality === "seed"), "seed GPU 필터가 다른 품질을 반환했습니다.", gpuListing.items);

  const fanListing = await jsonResponse("/api/accessories?category=cooling_fan&quality=seed&limit=100");
  assert(fanListing.items?.some((item) => item.id === "accessory-seed-fan-120-pwm"), "seed 주변 부품 목록에 대표 팬이 없습니다.", fanListing);
  assert(fanListing.items?.every((item) => item.dataQuality === "seed"), "seed 주변 부품 필터가 다른 품질을 반환했습니다.", fanListing.items);

  const seedRefreshResponse = await fetch(`${baseUrl}/api/accessories/accessory-seed-fan-120-pwm/refresh`, { method: "POST" });
  const seedRefreshPayload = await seedRefreshResponse.json();
  assert(seedRefreshResponse.status === 422 && seedRefreshPayload?.code === "ACCESSORY_REFRESH_UNSUPPORTED", "starter 주변 부품에 외부 원문 재확인이 잘못 허용되었습니다.", { status: seedRefreshResponse.status, payload: seedRefreshPayload });

  const compatibility = await jsonResponse("/api/compatibility/check", {
    method: "POST",
    body: JSON.stringify(compatibleBuild)
  });
  assert(Array.isArray(compatibility.findings), "호환성 응답에 finding 목록이 없습니다.", compatibility);
  assert(typeof compatibility.status === "string", "호환성 응답에 상태가 없습니다.", compatibility);

  const incompatible = await jsonResponse("/api/compatibility/check", {
    method: "POST",
    body: JSON.stringify(incompatibleBuild)
  });
  assert(incompatible.findings?.some((finding) => finding.severity === "blocker"), "의도적으로 잘못된 소켓 조합이 차단 finding을 만들지 못했습니다.", incompatible.findings);

  const alternatives = await jsonResponse("/api/parts/compatible", {
    method: "POST",
    body: JSON.stringify({
      category: "motherboard",
      build: incompatibleBuild,
      profile: "gaming",
      gamingResolution: "1440p",
      gamingRefreshRate: 144,
      mode: "safe",
      sort: "similarity",
      limit: 100
    })
  });
  assert(alternatives.items?.some((part) => part.id === "mb-b650-4x3"), "호환되지 않는 메인보드에 대한 안전 대체 후보가 없습니다.", alternatives);
  assert(alternatives.items?.every((part) => part.candidateRisk === "safe"), "safe 후보 응답에 안전하지 않은 후보가 포함되었습니다.", alternatives.items);
  assert(alternatives.items?.every((part) => part.recommendationTrust && part.decision), "대체 후보에 추천 근거 또는 판단 요약이 없습니다.", alternatives.items);

  const generated = await jsonResponse("/api/builds/recommend", {
    method: "POST",
    body: JSON.stringify({
      profile: "gaming",
      priority: "balanced",
      budgetWon: 1_500_000,
      includeGpu: true,
      gamingResolution: "1440p",
      gamingRefreshRate: 144,
      memoryCapacityGb: 32,
      storageCapacityGb: 1_000,
      hddCount: 0,
      listingPolicy: "retail_only"
    })
  });
  assert(Array.isArray(generated.lines) && generated.lines.length > 0, "seed-only 자동 구성 결과가 비어 있습니다.", generated);
  assert(generated.selection?.cpu?.partId && generated.selection?.motherboard?.partId, "seed-only 자동 구성에 CPU 또는 메인보드가 없습니다.", generated.selection);

  const persistedFiles = await readdir(dataDirectory);
  const persistedCatalog = JSON.parse(await readFile(join(dataDirectory, "catalog.json"), "utf8"));
  const persistedAccessories = JSON.parse(await readFile(join(dataDirectory, "accessories.json"), "utf8"));
  assert(persistedFiles.includes("catalog.json") && persistedFiles.includes("accessories.json"), "seed 요청 후 fallback catalog 파일이 materialize되지 않았습니다.", persistedFiles);
  assert(persistedCatalog.length >= 115 && persistedAccessories.length >= 42, "materialized seed 파일의 레코드 수가 부족합니다.", { catalog: persistedCatalog.length, accessories: persistedAccessories.length });

  console.log(JSON.stringify({
    ok: true,
    mode: "seed-only",
    catalogCount: meta.catalogCount,
    accessoryCount: meta.accessoryCount,
    categoryCounts: meta.categoryCounts,
    compatibleStatus: compatibility.status,
    incompatibleBlockers: incompatible.findings.filter((finding) => finding.severity === "blocker").length,
    alternativeCount: alternatives.items.length,
    generatedStatus: generated.status,
    generatedLineCount: generated.lines.length,
    persistedFiles
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (childOutput.length > 0) console.error(childOutput.join("").slice(-6_000));
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    killServerTree("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), sleep(2_000)]);
    if (server.exitCode === null) killServerTree("SIGKILL");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), sleep(2_000)]);
  }
  server?.stdout?.destroy();
  server?.stderr?.destroy();
  await rm(dataDirectory, { recursive: true, force: true });
}
