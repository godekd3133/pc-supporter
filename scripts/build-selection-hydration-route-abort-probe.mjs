import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const shareId = "build-selection-hydration-abort";
const previousId = `${shareId}-previous`;
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-build-selection-hydration-abort-probe-"));
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
    const shareId = ${JSON.stringify(shareId)};
    const previousId = ${JSON.stringify(previousId)};
    const timestamp = ${JSON.stringify(timestamp)};
    const request = { profile: "gaming", budgetWon: 1500000, includeGpu: true, priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: "retail_only" };
    const selectionFor = (suffix) => ({ cpu: { partId: "hydration-cpu-" + suffix, quantity: 1 }, motherboard: { partId: "hydration-board-" + suffix, quantity: 1 }, gpu: { partId: "hydration-gpu-" + suffix, quantity: 1 }, memory: [], ssd: [], hdd: [], case: { partId: "hydration-case-" + suffix, quantity: 1 }, psu: { partId: "hydration-psu-" + suffix, quantity: 1 }, accessories: [{ accessoryId: "hydration-accessory-" + suffix, quantity: 1 }], useIntegratedGraphics: false });
    const payloadFor = (suffix) => ({ type: "pc-supporter-budget-ladder", version: 1, exportedAt: timestamp, items: [
      { id: "economy", label: "절약형", description: "probe", budgetWon: 1200000, status: "호환 가능", totalPriceWon: 1100000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 80, lines: [] },
      { id: "target", label: "목표 예산", description: "probe", budgetWon: 1500000, status: "호환 가능", totalPriceWon: 1450000, budgetDeltaWon: 50000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 82, lines: [], selection: selectionFor(suffix) },
      { id: "headroom", label: "여유형", description: "probe", budgetWon: 1800000, status: "호환 가능", totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, analysisScore: 84, lines: [] }
    ], changes: [] });
    const snapshotFor = (id, name, suffix) => ({ id, name, payload: payloadFor(suffix), request, catalogSnapshotAt: timestamp, catalogCurrentSnapshotAt: timestamp, catalogChangedSinceShare: false, createdAt: timestamp, updatedAt: timestamp });
    const liveMeta = await originalFetch("/api/meta").then((metaResponse) => metaResponse.json());
    const metaPayload = { ...liveMeta, catalogUpdatedAt: timestamp };
    const state = { partsCalls: 0, partsSignalCalls: 0, partsAbortedCalls: 0, accessoryCalls: 0, accessorySignalCalls: 0, accessoryAbortedCalls: 0 };
    const delayedBatch = (kind, init, payload) => new Promise((resolve, reject) => {
      const signal = init?.signal;
      const abort = () => { state[kind + "AbortedCalls"] += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response(payload)); }, 2000);
    });
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/budget-ladders/" + shareId || requestUrl.pathname === "/api/budget-ladders/" + previousId) {
        const id = requestUrl.pathname.split("/").at(-1);
        return response(snapshotFor(id, id === shareId ? "hydration A" : "hydration previous", id === shareId ? "a" : "previous"));
      }
      if (requestUrl.pathname.endsWith("/lineage")) return response({ lineageId: "build-selection-hydration-abort-lineage", currentId: requestUrl.pathname.split("/").at(-2), entries: [
        { id: previousId, name: "이전 버전", lineageId: "build-selection-hydration-abort-lineage", versionNumber: 1, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false },
        { id: requestUrl.pathname.includes("/" + shareId + "/") ? shareId : requestUrl.pathname.split("/").at(-2), name: "현재 버전", lineageId: "build-selection-hydration-abort-lineage", versionNumber: 2, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false }
      ] });
      if (requestUrl.pathname === "/api/meta") return response(metaPayload);
      if (requestUrl.pathname === "/api/compatibility/check" && init?.method === "POST") return response({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: "gaming", scoreLabel: "균형형", scoreBasis: "probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 1450000, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: timestamp, checkedAt: timestamp });
      if (requestUrl.pathname === "/api/parts/batch" && init?.method === "POST") {
        state.partsCalls += 1;
        if (init?.signal) state.partsSignalCalls += 1;
        return delayedBatch("parts", init, { items: [] });
      }
      if (requestUrl.pathname === "/api/accessories/batch" && init?.method === "POST") {
        state.accessoryCalls += 1;
        if (init?.signal) state.accessorySignalCalls += 1;
        return delayedBatch("accessory", init, { items: [] });
      }
      return originalFetch(input, init);
    };
    const push = (id) => { history.pushState({}, "", "/budget-ladder/" + id); window.dispatchEvent(new PopStateEvent("popstate")); };
    const pushHome = () => { history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); };
    const waitForHeading = async (name) => { for (let index = 0; index < 200 && !(document.querySelector("h1")?.textContent ?? "").includes(name); index += 1) await wait(25); return (document.querySelector("h1")?.textContent ?? "").includes(name); };
    try {
      push(shareId);
      const mounted = await waitForHeading("hydration A");
      for (let index = 0; index < 200 && !document.querySelector("[aria-label=\\"예산 비교 부분 병합\\"]"); index += 1) await wait(25);
      const preview = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("부분 병합 조합 미리 검사"));
      if (!(preview instanceof HTMLButtonElement)) return { stage: "missing-preview", mounted, ...state };
      preview.click();
      for (let index = 0; index < 160 && !document.querySelector("[aria-label=\\"부분 병합 조합 미리 검사 결과\\"]"); index += 1) await wait(25);
      const apply = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("부분 병합 후 편집기"));
      if (!(apply instanceof HTMLButtonElement)) return { stage: "missing-apply", mounted, previewReady: Boolean(document.querySelector("[aria-label=\\"부분 병합 조합 미리 검사 결과\\"]")), ...state };
      apply.click();
      for (let index = 0; index < 160 && state.partsCalls < 1 && state.accessoryCalls < 1; index += 1) await wait(25);
      const requestStarted = state.partsCalls >= 1 || state.accessoryCalls >= 1;
      pushHome();
      for (let index = 0; index < 240 && (!document.querySelector(".home-page") || document.querySelector(".shared-budget-ladder-page") !== null); index += 1) await wait(25);
      return { stage: "checked", requestStarted, path: location.pathname, home: document.querySelector(".home-page") !== null, partsCalls: state.partsCalls, partsSignalCalls: state.partsSignalCalls, partsAbortedCalls: state.partsAbortedCalls, accessoryCalls: state.accessoryCalls, accessorySignalCalls: state.accessorySignalCalls, accessoryAbortedCalls: state.accessoryAbortedCalls };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.requestStarted !== true || result.partsCalls < 1 || result.accessoryCalls < 1 || result.partsSignalCalls !== 1 || result.accessorySignalCalls !== 1 || result.partsAbortedCalls < 1 || result.accessoryAbortedCalls < 1 || result.path !== "/" || result.home !== true) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
