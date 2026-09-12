import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const recommendShareId = "shared-budget-ladder-refresh-recommend-abort";
const metaShareId = "shared-budget-ladder-refresh-meta-abort";
const timestamp = "2026-09-11T00:00:00.000Z";

function signalProcessGroup(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

const chromePath = await firstAvailable([
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean));
if (!chromePath) throw new Error("Chrome 또는 Chromium 실행 파일을 찾지 못했습니다.");

const port = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-budget-ladder-refresh-abort-probe-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--remote-allow-origins=*",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  `${baseUrl}/`
], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
let chromeExited = false;
const chromeExit = new Promise((resolve) => chrome.once("exit", () => { chromeExited = true; resolve(); }));
let client;

try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForValue(client, "location.pathname === '/'", "홈 화면");

  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    const recommendShareId = ${JSON.stringify(recommendShareId)};
    const metaShareId = ${JSON.stringify(metaShareId)};
    const timestamp = ${JSON.stringify(timestamp)};
    const request = { profile: "gaming", budgetWon: 1500000, includeGpu: true, priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: "retail_only" };
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const payload = { type: "pc-supporter-budget-ladder", version: 1, exportedAt: timestamp, items: [
      { id: "economy", label: "절약형", description: "probe", budgetWon: 1200000, status: "호환 가능", totalPriceWon: 1100000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 80, lines: [] },
      { id: "target", label: "목표 예산", description: "probe", budgetWon: 1500000, status: "호환 가능", totalPriceWon: 1450000, budgetDeltaWon: 50000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 82, lines: [] },
      { id: "headroom", label: "여유형", description: "probe", budgetWon: 1800000, status: "호환 가능", totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 84, lines: [] }
    ], changes: [] };
    const snapshotFor = (id, name) => ({ id, name, payload, request, catalogSnapshotAt: timestamp, catalogCurrentSnapshotAt: timestamp, catalogChangedSinceShare: false, createdAt: timestamp, updatedAt: timestamp });
    const buildResult = (body) => ({ selection, profile: "gaming", priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: body?.budgetWon ?? 1500000, includeNonRetail: false, listingPolicy: "retail_only", storageCapacityGb: 1000, hddCount: 0, totalPriceWon: 1400000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, lines: [], rationale: [], warnings: [] });
    const state = { phase: "recommend", recommendCalls: 0, recommendAbortedCalls: 0, metaCalls: 0, metaSignalCalls: 0, metaAbortedCalls: 0 };
    const liveMeta = await originalFetch("/api/meta").then((metaResponse) => metaResponse.json());
    const metaPayload = { ...liveMeta, catalogUpdatedAt: timestamp };
    const delayed = (kind, value) => new Promise((resolve, reject) => {
      const signal = value.init?.signal;
      const abort = () => {
        state[kind + "AbortedCalls"] += 1;
        const error = new Error("요청이 취소되었습니다.");
        error.name = "AbortError";
        reject(error);
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response(value.payload)); }, 2000);
    });
    window.sessionStorage.removeItem("pc-supporter-api-cache:v1:/api/meta");
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/budget-ladders/" + recommendShareId || requestUrl.pathname === "/api/budget-ladders/" + metaShareId) {
        const id = requestUrl.pathname.split("/").at(-1);
        return response(snapshotFor(id, id === recommendShareId ? "재생성 추천 취소 A" : "재생성 메타 취소 B"));
      }
      if (requestUrl.pathname.endsWith("/lineage")) return response({ lineageId: "shared-budget-ladder-refresh-abort-lineage", currentId: requestUrl.pathname.split("/").at(-2), entries: [] });
      if (requestUrl.pathname === "/api/builds/recommend") {
        state.recommendCalls += 1;
        if (state.phase === "recommend") return delayed("recommend", { init, payload: buildResult(typeof init?.body === "string" ? JSON.parse(init.body) : undefined) });
        return response(buildResult(typeof init?.body === "string" ? JSON.parse(init.body) : undefined));
      }
      if (requestUrl.pathname === "/api/meta") {
        state.metaCalls += 1;
        if (init?.signal) state.metaSignalCalls += 1;
        if (state.phase === "meta") return delayed("meta", { init, payload: metaPayload });
        return response(metaPayload);
      }
      return originalFetch(input, init);
    };
    const push = (id) => { history.pushState({}, "", "/budget-ladder/" + id); window.dispatchEvent(new PopStateEvent("popstate")); };
    const pushHome = () => { history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); };
    const waitForHeading = async (name) => { for (let index = 0; index < 160 && !(document.querySelector("h1")?.textContent ?? "").includes(name); index += 1) await wait(25); return (document.querySelector("h1")?.textContent ?? "").includes(name); };
    const clickRefresh = () => [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && (candidate.textContent ?? "").includes("현재 기준 재생성"));
    try {
      push(recommendShareId);
      const recommendMounted = await waitForHeading("재생성 추천 취소 A");
      const recommendButton = clickRefresh();
      if (!(recommendButton instanceof HTMLButtonElement)) return { stage: "missing-recommend-refresh", recommendMounted, ...state };
      recommendButton.click();
      for (let index = 0; index < 160 && state.recommendCalls < 1; index += 1) await wait(25);
      const recommendStarted = state.recommendCalls >= 1;
      pushHome();
      for (let index = 0; index < 240 && !document.querySelector(".home-page"); index += 1) await wait(25);
      const recommendHome = Boolean(document.querySelector(".home-page"));
      await wait(2500);

      state.phase = "meta";
      window.sessionStorage.removeItem("pc-supporter-api-cache:v1:/api/meta");
      push(metaShareId);
      const metaMounted = await waitForHeading("재생성 메타 취소 B");
      const metaButton = clickRefresh();
      if (!(metaButton instanceof HTMLButtonElement)) return { stage: "missing-meta-refresh", recommendMounted, recommendStarted, recommendHome, metaMounted, path: location.pathname, ...state };
      metaButton.click();
      for (let index = 0; index < 160 && state.metaSignalCalls < 1; index += 1) await wait(25);
      const metaStarted = state.metaSignalCalls >= 1;
      pushHome();
      for (let index = 0; index < 240 && !document.querySelector(".home-page"); index += 1) await wait(25);
      const metaHome = Boolean(document.querySelector(".home-page"));
      return { stage: "checked", recommendStarted, recommendHome, metaStarted, metaHome, path: location.pathname, home: metaHome, ...state };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.recommendStarted !== true || result.recommendHome !== true || result.recommendAbortedCalls < 1 || result.metaStarted !== true || result.metaHome !== true || result.metaAbortedCalls < 1 || result.path !== "/" || result.home !== true || result.recommendCalls !== 3) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
