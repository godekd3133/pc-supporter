import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, pressKey, waitForJson, waitForValue } from "./browser-smoke.mjs";
import { ensureEmbeddedPostgres } from "./ensure-embedded-postgres.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_ID = "01a0e8e6-9d63-7632-bcd8-a11ff4160218";
const MANAGED_PROCESS = "/Users/kimminkyu/.codex/hooks/managed-process.mjs";
const MANAGED_NODE = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node";
const forbiddenPorts = new Set([4174, 4176, 4178, 4179, 4180, 4199, 4200, 5173, 57343]);
const timeoutMs = 45_000;

async function freeUnreservedPort(usedPorts) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = await freePort();
    if (!forbiddenPorts.has(candidate) && !usedPorts.has(candidate)) {
      usedPorts.add(candidate);
      return candidate;
    }
  }
  throw new Error("격리 probe용 loopback 포트를 확보하지 못했습니다.");
}

async function startManaged(executable, args, env) {
  const child = spawn(MANAGED_NODE, [MANAGED_PROCESS, "--session-id", SESSION_ID, "--", "/usr/bin/env", ...Object.entries(env).map(([key, value]) => `${key}=${value}`), executable, ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  let timer;
  const outcome = await Promise.race([
    new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal }))),
    new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout({ timeout: true }), 8_000); })
  ]);
  clearTimeout(timer);
  assert(!outcome.timeout, `managed-process가 시작 응답을 반환하지 않았습니다: ${executable}`);
  assert.equal(outcome.code, 0, `managed-process 시작 실패: ${output}`);
  return output.trim();
}

async function waitForHealth(baseUrl, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return await response.json();
      lastError = new Error(`status=${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 150));
  }
  throw new Error(`${label} 준비 시간 초과: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForOk(url, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response;
      lastError = new Error(`status=${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 150));
  }
  throw new Error(`${label} 준비 시간 초과: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function maximumValidDraft(marker, limits) {
  const idFor = (kind, index = 0) => {
    const prefix = `${marker}_${kind}_${String(index).padStart(3, "0")}`;
    assert(prefix.length <= limits.maxIdLength);
    return prefix + "x".repeat(limits.maxIdLength - prefix.length);
  };
  const one = (kind) => ({ partId: idFor(kind), quantity: 99 });
  const many = (kind) => Array.from({ length: limits.maxSelections }, (_, index) => ({ partId: idFor(kind, index), quantity: 99 }));
  const selection = {
    cpu: one("cpu"),
    cooler: one("cooler"),
    motherboard: one("motherboard"),
    memory: many("memory"),
    gpu: one("gpu"),
    ssd: many("ssd"),
    hdd: many("hdd"),
    case: one("case"),
    psu: one("psu"),
    accessories: Array.from({ length: limits.maxSelections }, (_, index) => ({
      accessoryId: idFor("accessory", index),
      quantity: 99,
      targetPartId: idFor("ssd", index),
      targetAccessoryId: idFor("fan-hub", index)
    })),
    m2SlotSelection: Object.fromEntries(Array.from({ length: limits.maxM2Slots }, (_, index) => [`M2_${index + 1}`, idFor("m2", index)])),
    rgbControllerAccessoryId: idFor("rgb-controller"),
    useIntegratedGraphics: false
  };
  return selection;
}

function validateMaximumDraft(selection, limits) {
  for (const category of ["memory", "ssd", "hdd", "accessories"]) {
    assert.equal(selection[category].length, limits.maxSelections, `${category} 배열이 parser 최대치가 아닙니다.`);
    for (const item of selection[category]) {
      assert.equal(item.quantity, 99, `${category} quantity가 parser 최대치가 아닙니다.`);
      const ids = category === "accessories"
        ? [item.accessoryId, item.targetPartId, item.targetAccessoryId]
        : [item.partId];
      assert(ids.every((id) => id.length === limits.maxIdLength), `${category} ID가 parser 최대 길이가 아닙니다.`);
    }
  }
  assert.equal(Object.keys(selection.m2SlotSelection).length, limits.maxM2Slots);
  for (const category of ["cpu", "cooler", "motherboard", "gpu", "case", "psu"]) {
    assert.equal(selection[category].quantity, 99);
    assert.equal(selection[category].partId.length, limits.maxIdLength);
  }
}

async function main() {
  const usedPorts = new Set();
  const apiPort = await freeUnreservedPort(usedPorts);
  const previewPort = await freeUnreservedPort(usedPorts);
  const chromePort = await freeUnreservedPort(usedPorts);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const previewUrl = `http://127.0.0.1:${previewPort}`;
  const dataDirectory = await mkdtemp(resolve(tmpdir(), "pc-supporter-draft-probe-data-"));
  const scratchPostgres = await ensureEmbeddedPostgres("pcsupporter_draft_probe");
  const profileDirectory = await mkdtemp(resolve(tmpdir(), "pc-supporter-draft-probe-chrome-"));
  const limitsSource = await readFile(resolve(ROOT, "shared/build-input-limits.ts"), "utf8");
  const limitFor = (name) => {
    const value = limitsSource.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))?.[1];
    assert(value, `공유 입력 제한 상수를 읽지 못했습니다: ${name}`);
    return Number(value);
  };
  const limits = {
    maxSelections: limitFor("BUILD_INPUT_MAX_SELECTIONS_PER_LIST"),
    maxIdLength: limitFor("BUILD_INPUT_MAX_ID_LENGTH"),
    maxM2Slots: limitFor("BUILD_INPUT_MAX_M2_SLOTS")
  };
  const marker = `draft-probe-${Date.now().toString(36)}`;
  const selection = maximumValidDraft(marker, limits);
  validateMaximumDraft(selection, limits);
  const rawDraft = JSON.stringify(selection);
  const origin = previewUrl;
  const chromePath = await firstAvailable([
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean));
  assert(chromePath, "Chrome 또는 Chromium을 찾지 못했습니다.");

  let client;
  let chromeStarted = false;
  let chromeStopped = false;
  let managedApiStart = "";
  let managedPreviewStart = "";
  try {
    managedApiStart = await startManaged(resolve(ROOT, "node_modules/.bin/tsx"), ["server/index.ts"], {
      PORT: String(apiPort),
      SERVER_HOST: "127.0.0.1",
      PC_SUPPORTER_DATA_DIR: dataDirectory,
      DATABASE_URL: scratchPostgres.url,
      DANAWA_CRAWL_ON_START: "false",
      BUILD_MONITOR_SCHEDULER_ENABLED: "false",
      NODE_ENV: "test"
    });
    console.log(`isolated seed API ${apiUrl} data=${dataDirectory} ${managedApiStart}`);
    const health = await waitForHealth(apiUrl, "isolated seed API");
    assert(health?.ok === true, "격리 API health가 준비되지 않았습니다.");

    managedPreviewStart = await startManaged(resolve(ROOT, "node_modules/.bin/vite"), ["preview", "--host", "127.0.0.1", "--port", String(previewPort)], {
      VITE_API_PROXY_TARGET: apiUrl
    });
    console.log(`isolated production preview ${previewUrl} ${managedPreviewStart}`);
    await waitForOk(`${previewUrl}/`, "production preview HTML");

    const metaResponse = await fetch(`${previewUrl}/api/meta`, { signal: AbortSignal.timeout(5_000) });
    assert(metaResponse.ok, `격리 seed API meta 요청 실패: ${metaResponse.status}`);
    const meta = await metaResponse.json();
    assert.equal(meta.storageMode, "postgres", "probe API가 PostgreSQL 저장소를 사용하지 않습니다.");
    assert.equal(meta.qualityCounts?.live, 0, "probe API에 live catalog 데이터가 섞였습니다.");
    assert.equal(meta.accessoryQualityCounts?.live, 0, "probe API에 live accessory 데이터가 섞였습니다.");

    const chromeArgs = [
      "--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--remote-allow-origins=*", `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${profileDirectory}`, "about:blank"
    ];
    await startManaged(chromePath, chromeArgs, {});
    chromeStarted = true;
    const pages = await waitForJson(`http://127.0.0.1:${chromePort}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "probe Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    console.log("probe stage: Chrome CDP connected");
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Network.enable");
    await client.send("Network.setBypassServiceWorker", { bypass: true });
    await client.send("Network.setBlockedURLs", { urls: ["https://fonts.googleapis.com/*", "https://fonts.gstatic.com/*"] });

    const instrumentation = `(() => {
      if (location.origin !== ${JSON.stringify(origin)}) return;
      const key = "pc-supporter-draft";
      const marker = ${JSON.stringify(marker)};
      const expected = ${JSON.stringify(rawDraft)};
      const expectedPartIds = ${JSON.stringify([
        selection.cpu.partId,
        selection.cooler.partId,
        selection.motherboard.partId,
        selection.gpu.partId,
        selection.case.partId,
        selection.psu.partId,
        ...selection.memory.map((item) => item.partId),
        ...selection.ssd.map((item) => item.partId),
        ...selection.hdd.map((item) => item.partId)
      ])};
      const expectedAccessoryIds = ${JSON.stringify(selection.accessories.map((item) => item.accessoryId))};
      const storage = window.localStorage;
      const originalGetItem = Storage.prototype.getItem;
      const originalParse = JSON.parse;
      const state = { readCount: 0, parseCount: 0, marker, allowedLocalPosts: [], readRaw: () => Reflect.apply(originalGetItem, storage, [key]) };
      window.__initialDraftProbe = state;
      Storage.prototype.getItem = function (requestedKey) {
        if (this === storage && requestedKey === key) state.readCount += 1;
        return Reflect.apply(originalGetItem, this, [requestedKey]);
      };
      JSON.parse = function (value, ...args) {
        if (typeof value === "string" && value.includes(marker)) state.parseCount += 1;
        return Reflect.apply(originalParse, this, [value, ...args]);
      };
      storage.setItem(key, expected);
      const originalFetch = window.fetch.bind(window);
      state.blockedRequests = [];
      window.fetch = (input, init = {}) => {
        const requestUrl = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
        const method = String(init.method ?? input.method ?? "GET").toUpperCase();
        let allowedAppOpen = false;
        let allowedSyntheticBatchLookup = false;
        if (requestUrl.origin === location.origin && method === "POST" && requestUrl.pathname === "/api/events" && typeof init.body === "string") {
          try {
            const body = Reflect.apply(originalParse, JSON, [init.body]);
            allowedAppOpen = body && Object.keys(body).length === 1 && body.name === "app_open";
          } catch {
            allowedAppOpen = false;
          }
          if (allowedAppOpen) state.allowedLocalPosts.push(requestUrl.pathname);
        }
        if (requestUrl.origin === location.origin && method === "POST" && ["/api/parts/batch", "/api/accessories/batch"].includes(requestUrl.pathname) && typeof init.body === "string") {
          try {
            const body = Reflect.apply(originalParse, JSON, [init.body]);
            const expectedIds = requestUrl.pathname === "/api/parts/batch" ? expectedPartIds : expectedAccessoryIds;
            allowedSyntheticBatchLookup = body
              && Object.keys(body).length === 1
              && Array.isArray(body.ids)
              && body.ids.length === expectedIds.length
              && body.ids.every((id, index) => id === expectedIds[index] && id.startsWith(marker + "_"));
          } catch {
            allowedSyntheticBatchLookup = false;
          }
          if (allowedSyntheticBatchLookup) state.allowedLocalPosts.push(requestUrl.pathname);
        }
        if (requestUrl.origin !== location.origin || (method !== "GET" && !allowedAppOpen && !allowedSyntheticBatchLookup)) {
          state.blockedRequests.push({ method, origin: requestUrl.origin, path: requestUrl.pathname });
          return Promise.reject(new Error("Probe blocked non-local or non-GET request: " + method + " " + requestUrl.origin));
        }
        return originalFetch(input, init);
      };
    })()`;
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: instrumentation });
    await client.send("Page.navigate", { url: `${previewUrl}/build` });
    await waitForValue(client, "document.querySelector('.workspace-page') !== null && document.querySelector('.component-card .selected-line-info strong')?.textContent?.includes(window.__initialDraftProbe?.marker)", "합성 견적의 초기 편집 화면");
    await waitForValue(client, "window.__initialDraftProbe.allowedLocalPosts.length === 3", "합성 견적과 시작 이벤트의 격리 API 조회");
    console.log("probe stage: maximum draft rendered");

    const mounted = await client.evaluate(`(() => ({
      path: location.pathname,
      readCount: window.__initialDraftProbe.readCount,
      parseCount: window.__initialDraftProbe.parseCount,
      selectedLineCount: document.querySelectorAll('.component-card .selected-line-info strong').length,
      accessoryLineCount: document.querySelectorAll('.accessory-cart-line .accessory-cart-copy strong').length,
      graphicsMode: document.querySelector('.summary-sidebar .graphics-mode strong')?.textContent,
      blockedRequests: [...window.__initialDraftProbe.blockedRequests],
      allowedLocalPosts: [...window.__initialDraftProbe.allowedLocalPosts],
      apiRequests: performance.getEntriesByType('resource').filter((entry) => /\\/api\\//.test(entry.name)).map((entry) => entry.name)
    }))()`);
    assert.equal(mounted.path, "/build");
    assert(mounted.readCount >= 1 && mounted.readCount <= 8, `production mount는 draft storage를 읽어야 하며 과도하게 반복 읽으면 안 됩니다: ${mounted.readCount}`);
    assert(mounted.parseCount >= 1 && mounted.parseCount <= 8, `production mount는 draft schema를 검증해야 하며 과도하게 반복 파싱하면 안 됩니다: ${mounted.parseCount}`);
    assert.equal(mounted.selectedLineCount, 306, `핵심 부품 selection 수가 손실되었습니다: ${mounted.selectedLineCount}`);
    assert.equal(mounted.accessoryLineCount, limits.maxSelections, `주변 부품 selection 수가 손실되었습니다: ${mounted.accessoryLineCount}`);
    assert.equal(mounted.graphicsMode, "외장 그래픽카드", "GPU 선택이 화면에 보존되지 않았습니다.");
    assert.deepEqual(mounted.blockedRequests, [], "외부 또는 비-GET 요청이 차단됐습니다.");
    assert.deepEqual([...mounted.allowedLocalPosts].sort(), ["/api/accessories/batch", "/api/events", "/api/parts/batch"], "격리 API에서 app_open과 합성 ID hydration 이외의 POST가 발생했습니다.");
    console.log("probe stage: mount counts verified", JSON.stringify({ readCount: mounted.readCount, parseCount: mounted.parseCount, selectedLineCount: mounted.selectedLineCount, accessoryLineCount: mounted.accessoryLineCount }));

    const brandFocused = await client.evaluate("(() => { const brand = document.querySelector('.brand'); brand?.focus(); return document.activeElement === brand; })()");
    assert.equal(brandFocused, true, "브랜드 링크에 키보드 포커스를 둘 수 없습니다.");
    await pressKey(client, "Tab", "Tab", 9);
    const keyboardFocusMoved = await client.evaluate("document.activeElement !== document.querySelector('.brand') && document.activeElement instanceof HTMLElement");
    assert.equal(keyboardFocusMoved, true, "Tab 키로 포커스가 다음 인터랙션으로 이동하지 않았습니다.");

    const appRerenderDurationsMs = [];
    const rerenderCounts = [];
    for (let iteration = 1; iteration <= 2; iteration += 1) {
      const expectedSearch = `?draft-probe-rerender=${iteration}`;
      const startedAt = Date.now();
      await client.evaluate(`(() => { history.pushState({}, "", ${JSON.stringify(`/build${expectedSearch}`)}); window.dispatchEvent(new PopStateEvent("popstate")); })()`);
      await waitForValue(client, `location.pathname === '/build' && location.search === ${JSON.stringify(expectedSearch)} && document.querySelector('.workspace-page') !== null && document.querySelector('.app-shell')?.getAttribute('data-route-key') === ${JSON.stringify(`/build${expectedSearch}`)}`, `동일 편집 화면 App rerender ${iteration}`);
      appRerenderDurationsMs.push(Date.now() - startedAt);
      const counts = await client.evaluate("({ readCount: window.__initialDraftProbe.readCount, parseCount: window.__initialDraftProbe.parseCount })");
      assert.equal(counts.readCount, mounted.readCount, `App rerender ${iteration}에서 draft storage를 다시 읽었습니다.`);
      assert.equal(counts.parseCount, mounted.parseCount, `App rerender ${iteration}에서 draft schema를 다시 파싱했습니다.`);
      rerenderCounts.push(counts);
    }
    console.log("probe stage: keyboard focus and same-route App rerenders verified", JSON.stringify({ keyboardFocusMoved, appRerenderDurationsMs, rerenderCounts }));

    const afterRerenders = await client.evaluate(`(() => ({
      path: location.pathname,
      readCount: window.__initialDraftProbe.readCount,
      parseCount: window.__initialDraftProbe.parseCount,
      selectedLines: [...document.querySelectorAll('.component-card .selected-line-info strong')].map((node) => node.textContent ?? ""),
      accessoryLines: [...document.querySelectorAll('.accessory-cart-line .accessory-cart-copy strong')].map((node) => node.textContent ?? ""),
      graphicsMode: document.querySelector('.summary-sidebar .graphics-mode strong')?.textContent,
      blockedRequests: [...window.__initialDraftProbe.blockedRequests],
      allowedLocalPosts: [...window.__initialDraftProbe.allowedLocalPosts],
      persistedRaw: window.__initialDraftProbe.readRaw()
    }))()`);
    assert.equal(afterRerenders.path, "/build");
    assert.equal(afterRerenders.readCount, mounted.readCount, "App rerender 이후 draft localStorage를 다시 읽었습니다.");
    assert.equal(afterRerenders.parseCount, mounted.parseCount, "App rerender 이후 draft schema를 다시 파싱했습니다.");
    assert.equal(afterRerenders.graphicsMode, "외장 그래픽카드", "키보드 라우트 왕복 후 GPU 선택이 바뀌었습니다.");
    assert.deepEqual(afterRerenders.blockedRequests, [], "키보드 route 전환 중 외부 또는 비-GET 요청이 차단됐습니다.");
    assert.deepEqual([...afterRerenders.allowedLocalPosts].sort(), [...mounted.allowedLocalPosts].sort(), "route 전환이 새 로컬 API POST를 만들었습니다.");

    const categoryCounts = Object.fromEntries(["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "hdd", "case", "psu"].map((category) => [
      category,
      afterRerenders.selectedLines.filter((line) => line.startsWith(`${marker}_${category}_`)).length
    ]));
    assert.deepEqual(categoryCounts, { cpu: 1, cooler: 1, motherboard: 1, memory: limits.maxSelections, gpu: 1, ssd: limits.maxSelections, hdd: limits.maxSelections, case: 1, psu: 1 });
    assert.equal(afterRerenders.accessoryLines.filter((line) => line.startsWith(`${marker}_accessory_`)).length, limits.maxSelections);

    const persistedDraft = JSON.parse(afterRerenders.persistedRaw);
    assert.deepEqual(canonicalJson(persistedDraft), canonicalJson(selection), "mount·rerender 후 localStorage draft 내용이 원래 합성 draft와 달라졌습니다.");
    const report = JSON.stringify({
      ok: true,
      mode: "production-preview / isolated-seed-api",
      previewUrl,
      apiUrl,
      dataDirectory,
      storageMode: meta.storageMode,
      catalogQuality: meta.qualityCounts,
      accessoryQuality: meta.accessoryQualityCounts,
      draftBytes: Buffer.byteLength(rawDraft, "utf8"),
      selectionLimits: limits,
      mounted,
      keyboardFocusMoved,
      appRerenderDurationsMs,
      rerenderCounts,
      finalReadCount: afterRerenders.readCount,
      finalParseCount: afterRerenders.parseCount,
      categoryCounts
    }, null, 2);
    process.stdout.write(`${report}\n`);
  } finally {
    try {
      if (client) await client.send("Browser.close");
    } catch {
      // The session-managed browser may already have exited.
    }
    client?.close();
    if (chromeStarted) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          await fetch(`http://127.0.0.1:${chromePort}/json/version`, { signal: AbortSignal.timeout(250) });
          await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
        } catch {
          chromeStopped = true;
          break;
        }
      }
    }
    await scratchPostgres.stop();
    if (!chromeStarted || chromeStopped) await rm(profileDirectory, { recursive: true, force: true });
    else if (chromeStarted) console.warn(`세션 관리 Chrome이 아직 종료되지 않아 profile을 보존했습니다: ${profileDirectory}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
