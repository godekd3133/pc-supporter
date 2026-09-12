import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-version-recheck-route-probe-"));
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
    const stamp = "2026-09-11T00:00:00.000Z";
    const check = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 1000000, priceComplete: true, analysisScore: 80, analysisScoreLabel: "균형형", analysisConfidence: "high", findings: [], engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp };
    const payload = { schemaVersion: 1, kind: "pc-supporter.saved-build-version-comparison-share", generatedAt: stamp, before: { id: "recheck-before", label: "v1", versionNumber: 1, name: "재검사 이전", updatedAt: stamp, check }, after: { id: "recheck-after", label: "v2", versionNumber: 2, name: "재검사 이후", updatedAt: stamp, check }, summary: { direction: "same", selectionChangedCategoryCount: 0 }, transition: { direction: "same", statusChanged: false, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, priceCompletenessChanged: false, resourceBudgetChanged: false, benchmarkChanged: false, benchmarkNeedsReview: false, engineChanged: false, catalogChanged: false, resolvedFindingCount: 0, newFindingCount: 0, severityChangedFindingCount: 0, detailsChangedFindingCount: 0 }, changes: [], findingChanges: [], dataBoundary: "route probe", text: "route probe" };
    const snapshot = { id: "recheck-route", name: "공유 버전 재검사 route probe", payload, createdAt: stamp, updatedAt: stamp };
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const saved = (id) => ({ id, name: id, selection, recommendationPreferences: { profile: "general", priority: "balanced", listingPolicy: "retail_only" }, createdAt: stamp, updatedAt: stamp });
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    const compatibility = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: "general", scoreLabel: "균형형", scoreBasis: "route probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 1000000, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp };
    let compatibilityCalls = 0;
    let abortedCalls = 0;
    let buildCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/version-comparisons/recheck-route") return response(snapshot);
      if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) { buildCalls += 1; return response({ items: [saved("recheck-before"), saved("recheck-after")] }); }
      if (requestUrl.pathname === "/api/compatibility/check" && (init?.method ?? "GET").toUpperCase() === "POST") {
        compatibilityCalls += 1;
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          const abort = () => { abortedCalls += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response(compatibility)); }, 2000);
        });
      }
      return originalFetch(input, init);
    };
    try {
      history.pushState({}, "", "/version-comparison/recheck-route");
      window.dispatchEvent(new PopStateEvent("popstate"));
      for (let index = 0; index < 160 && !document.querySelector('[data-testid="shared-version-comparison-card"]'); index += 1) await wait(25);
      for (let index = 0; index < 160 && compatibilityCalls < 1; index += 1) await wait(25);
      const beforeExit = { buildCalls, compatibilityCalls, abortedCalls, card: Boolean(document.querySelector('[data-testid="shared-version-comparison-card"]')), current: Boolean(document.querySelector('[data-testid="shared-version-comparison-current-check"]')), currentState: document.querySelector('.shared-version-current-check-state')?.textContent ?? "" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(400);
      return { stage: "checked", ...beforeExit, path: location.pathname, home: document.querySelector(".home-page") !== null, cardAfterExit: Boolean(document.querySelector('[data-testid="shared-version-comparison-card"]')), bodyTail: (document.body?.innerText ?? "").slice(-1600), errors: window.__pcSupporterSmokeErrors ?? [] };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.compatibilityCalls < 1 || result.abortedCalls < 1 || result.path !== "/" || result.home !== true) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
