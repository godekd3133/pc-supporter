import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const shareId = "shared-budget-ladder-version-apply-abort";
const previousId = `${shareId}-previous`;
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-budget-ladder-version-apply-abort-probe-"));
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
    const selectionFor = (suffix) => ({ cpu: { partId: "cpu-" + suffix, quantity: 1 }, motherboard: { partId: "board-" + suffix, quantity: 1 }, gpu: { partId: "gpu-" + suffix, quantity: 1 }, memory: [], ssd: [], hdd: [], case: { partId: "case-" + suffix, quantity: 1 }, psu: { partId: "psu-" + suffix, quantity: 1 }, accessories: [], useIntegratedGraphics: false });
    const payloadFor = (suffix) => ({ type: "pc-supporter-budget-ladder", version: 1, exportedAt: timestamp, items: [
      { id: "economy", label: "절약형", description: "probe", budgetWon: 1200000, status: "호환 가능", totalPriceWon: 1100000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 80, lines: [] },
      { id: "target", label: "목표 예산", description: "probe", budgetWon: 1500000, status: "호환 가능", totalPriceWon: 1450000, budgetDeltaWon: 50000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 82, lines: [], selection: selectionFor(suffix) },
      { id: "headroom", label: "여유형", description: "probe", budgetWon: 1800000, status: "호환 가능", totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 84, lines: [] }
    ], changes: [] });
    const snapshotFor = (id, name, suffix) => ({ id, name, payload: payloadFor(suffix), request, catalogSnapshotAt: timestamp, catalogCurrentSnapshotAt: timestamp, catalogChangedSinceShare: false, createdAt: timestamp, updatedAt: timestamp });
    const state = { recommendCalls: 0, recommendSignalCalls: 0, recommendAbortedCalls: 0 };
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/budget-ladders/" + shareId) return response(snapshotFor(shareId, "현재 버전", "current"));
      if (requestUrl.pathname === "/api/budget-ladders/" + previousId) return response(snapshotFor(previousId, "이전 버전", "previous"));
      if (requestUrl.pathname.endsWith("/lineage")) return response({ lineageId: "shared-budget-ladder-version-apply-abort-lineage", currentId: shareId, entries: [
        { id: previousId, name: "이전 버전", lineageId: "shared-budget-ladder-version-apply-abort-lineage", versionNumber: 1, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false },
        { id: shareId, name: "현재 버전", lineageId: "shared-budget-ladder-version-apply-abort-lineage", versionNumber: 2, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false }
      ] });
      if (requestUrl.pathname === "/api/builds/recommend") {
        state.recommendCalls += 1;
        if (init?.signal) state.recommendSignalCalls += 1;
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          const abort = () => { state.recommendAbortedCalls += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response({ selection: selectionFor("apply"), profile: "gaming", priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, budgetWon: 1500000, includeNonRetail: false, listingPolicy: "retail_only", totalPriceWon: 1400000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, lines: [], rationale: [], warnings: [] })); }, 2000);
        });
      }
      return originalFetch(input, init);
    };
    const push = (path) => { history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); };
    try {
      push("/budget-ladder/" + shareId);
      for (let index = 0; index < 200 && !(document.querySelector("h1")?.textContent ?? "").includes("현재 버전"); index += 1) await wait(25);
      for (let index = 0; index < 200 && ![...document.querySelectorAll("button")].some((button) => (button.textContent ?? "").includes("v1 조건으로 현재 구성 시작")); index += 1) await wait(25);
      const apply = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("v1 조건으로 현재 구성 시작"));
      if (!(apply instanceof HTMLButtonElement)) return { stage: "missing-apply", heading: document.querySelector("h1")?.textContent ?? "", versionComparison: Boolean(document.querySelector("[aria-label=\\"예산 비교 버전 상세 비교\\"]")), ...state };
      apply.click();
      for (let index = 0; index < 160 && state.recommendCalls < 1; index += 1) await wait(25);
      const requestStarted = state.recommendCalls >= 1;
      push("/");
      for (let index = 0; index < 240 && (!document.querySelector(".home-page") || document.querySelector(".shared-budget-ladder-page") !== null); index += 1) await wait(25);
      return { stage: "checked", requestStarted, recommendSignalCalls: state.recommendSignalCalls, abortedCalls: state.recommendAbortedCalls, calls: state.recommendCalls, path: location.pathname, home: document.querySelector(".home-page") !== null, sharedPageAfterExit: document.querySelector(".shared-budget-ladder-page") !== null };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.requestStarted !== true || result.abortedCalls < 1 || result.recommendSignalCalls !== 1 || result.calls !== 1 || result.path !== "/" || result.home !== true) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
