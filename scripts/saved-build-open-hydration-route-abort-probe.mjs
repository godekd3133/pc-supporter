import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const batchId = "saved-build-open-hydration-batch";
const compatibilityId = "saved-build-open-hydration-compatibility";
const timestamp = "2026-09-12T00:00:00.000Z";

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-saved-build-open-hydration-abort-probe-"));
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
  `${baseUrl}/history`
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
  await waitForValue(client, "location.pathname === '/history'", "저장 견적 이력 화면");

  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    const batchId = ${JSON.stringify(batchId)};
    const compatibilityId = ${JSON.stringify(compatibilityId)};
    const timestamp = ${JSON.stringify(timestamp)};
    const preferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144, budgetWon: 1500000 };
    const emptySelection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const batchSelection = { ...emptySelection, cpu: { partId: "saved-build-open-missing-cpu", quantity: 1 }, accessories: [{ accessoryId: "saved-build-open-missing-accessory", quantity: 1 }] };
    const savedFor = (id) => ({
      id,
      name: id === batchId ? "saved-build-open-batch" : "saved-build-open-compatibility",
      selection: id === batchId ? batchSelection : emptySelection,
      recommendationPreferences: preferences,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: null
    });
    const state = {
      phase: "batch",
      listCalls: 0,
      phases: {
        batch: { partsCalls: 0, partsSignalCalls: 0, partsAbortedCalls: 0, accessoryCalls: 0, accessorySignalCalls: 0, accessoryAbortedCalls: 0, compatibilityCalls: 0, compatibilitySignalCalls: 0, compatibilityAbortedCalls: 0 },
        compatibility: { partsCalls: 0, partsSignalCalls: 0, partsAbortedCalls: 0, accessoryCalls: 0, accessorySignalCalls: 0, accessoryAbortedCalls: 0, compatibilityCalls: 0, compatibilitySignalCalls: 0, compatibilityAbortedCalls: 0 }
      }
    };
    window.__savedBuildOpenHydrationProbe = state;
    window.__savedBuildOpenHydrationSetPhase = (phase) => { state.phase = phase; };
    const delayed = (kind, init, payload) => new Promise((resolve, reject) => {
      const current = state.phases[state.phase];
      const signal = init?.signal;
      const abort = () => {
        current[kind + "AbortedCalls"] += 1;
        const error = new Error("요청이 취소되었습니다.");
        error.name = "AbortError";
        reject(error);
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve(response(payload));
      }, 2000);
    });
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      const method = (init?.method ?? "GET").toUpperCase();
      if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) {
        state.listCalls += 1;
        const ids = requestUrl.searchParams.get("ids")?.split(",") ?? [];
        return response({ items: ids.filter((id) => id === batchId || id === compatibilityId).map(savedFor) });
      }
      const current = state.phases[state.phase];
      if (requestUrl.pathname === "/api/parts/batch" && method === "POST") {
        current.partsCalls += 1;
        if (init?.signal) current.partsSignalCalls += 1;
        return delayed("parts", init, { items: [] });
      }
      if (requestUrl.pathname === "/api/accessories/batch" && method === "POST") {
        current.accessoryCalls += 1;
        if (init?.signal) current.accessorySignalCalls += 1;
        return delayed("accessory", init, { items: [] });
      }
      if (requestUrl.pathname === "/api/compatibility/check" && method === "POST") {
        current.compatibilityCalls += 1;
        if (init?.signal) current.compatibilitySignalCalls += 1;
        return delayed("compatibility", init, { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, links: [], totalPriceWon: 0, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: timestamp, checkedAt: timestamp });
      }
      return originalFetch(input, init);
    };
    const setSavedIds = (ids) => {
      const serialized = JSON.stringify(ids);
      localStorage.setItem("pc-supporter-saved-build-ids", serialized);
      window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-ids", newValue: serialized, storageArea: localStorage }));
    };
    const push = (path) => { history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); };
    const waitFor = async (predicate, iterations = 160) => { for (let index = 0; index < iterations && !predicate(); index += 1) await wait(25); return predicate(); };
    const openResult = async (name) => {
      const button = [...document.querySelectorAll(".history-card .button-secondary")].find((candidate) => (candidate.textContent ?? "").includes("결과 다시 보기"));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return await waitFor(() => (window.__savedBuildOpenHydrationProbe.phases[window.__savedBuildOpenHydrationProbe.phase].compatibilityCalls > 0 || window.__savedBuildOpenHydrationProbe.phases[window.__savedBuildOpenHydrationProbe.phase].partsCalls > 0 || window.__savedBuildOpenHydrationProbe.phases[window.__savedBuildOpenHydrationProbe.phase].accessoryCalls > 0));
    };
    try {
      setSavedIds([batchId]);
      const batchCard = await waitFor(() => (document.body?.innerText ?? "").includes("saved-build-open-batch"));
      const batchStarted = batchCard && await openResult("batch");
      const batchRequestsStarted = await waitFor(() => {
        const current = state.phases.batch;
        return current.partsCalls > 0 && current.accessoryCalls > 0;
      });
      push("/");
      const batchHome = await waitFor(() => document.querySelector(".home-page") !== null && document.querySelector(".history-page") === null);
      await wait(250);
      const batchStaleToast = (document.body?.innerText ?? "").includes("saved-build-open-batch을 현재 카탈로그 기준으로 다시 검사해 불러오는 중입니다.");

      state.phase = "compatibility";
      push("/history");
      await waitFor(() => document.querySelector(".history-page") !== null);
      setSavedIds([compatibilityId]);
      const compatibilityCard = await waitFor(() => (document.body?.innerText ?? "").includes("saved-build-open-compatibility"));
      const compatibilityStarted = compatibilityCard && await openResult("compatibility");
      const compatibilityRequestsStarted = await waitFor(() => state.phases.compatibility.compatibilityCalls > 0);
      push("/");
      const compatibilityHome = await waitFor(() => document.querySelector(".home-page") !== null && document.querySelector(".history-page") === null);
      await wait(250);
      const compatibilityStaleToast = (document.body?.innerText ?? "").includes("saved-build-open-compatibility을 현재 카탈로그 기준으로 다시 검사해 불러오는 중입니다.");
      return {
        stage: "checked",
        batchCard,
        batchStarted,
        batchRequestsStarted,
        batchHome,
        batchStaleToast,
        compatibilityCard,
        compatibilityStarted,
        compatibilityRequestsStarted,
        compatibilityHome,
        compatibilityStaleToast,
        path: location.pathname,
        phases: state.phases
      };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  const batch = result?.phases?.batch;
  const compatibility = result?.phases?.compatibility;
  if (
    result?.stage !== "checked" ||
    result.batchCard !== true ||
    result.batchStarted !== true ||
    result.batchRequestsStarted !== true ||
    result.batchHome !== true ||
    result.batchStaleToast !== false ||
    result.compatibilityCard !== true ||
    result.compatibilityStarted !== true ||
    result.compatibilityRequestsStarted !== true ||
    result.compatibilityHome !== true ||
    result.compatibilityStaleToast !== false ||
    result.path !== "/" ||
    batch?.partsCalls < 1 ||
    batch?.accessoryCalls < 1 ||
    compatibility?.compatibilityCalls < 1 ||
    batch?.partsSignalCalls !== batch?.partsCalls ||
    batch?.accessorySignalCalls !== batch?.accessoryCalls ||
    batch?.partsAbortedCalls !== batch?.partsCalls ||
    batch?.accessoryAbortedCalls !== batch?.accessoryCalls ||
    compatibility?.compatibilitySignalCalls !== 1 ||
    compatibility?.compatibilityAbortedCalls < 1
  ) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
