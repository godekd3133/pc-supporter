import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-version-copy-route-probe-"));
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
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const stamp = "2026-09-11T00:00:00.000Z";
    const check = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 1000000, priceComplete: true, analysisScore: 80, analysisScoreLabel: "균형형", analysisConfidence: "high", findings: [], engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp };
    const payload = { schemaVersion: 1, kind: "pc-supporter.saved-build-version-comparison-share", generatedAt: stamp, before: { id: "shared-copy-before", label: "변경 전", versionNumber: 1, name: "공유 이전 견적", updatedAt: stamp, check }, after: { id: "shared-copy-after", label: "변경 후", versionNumber: 2, name: "공유 이후 견적", updatedAt: stamp, check }, summary: { direction: "same", selectionChangedCategoryCount: 0 }, transition: { direction: "same", statusChanged: false, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, priceCompletenessChanged: false, resourceBudgetChanged: false, benchmarkChanged: false, benchmarkNeedsReview: false, engineChanged: false, catalogChanged: false, resolvedFindingCount: 0, newFindingCount: 0, severityChangedFindingCount: 0, detailsChangedFindingCount: 0 }, changes: [], findingChanges: [], dataBoundary: "route probe", text: "공유 버전 비교 route probe" };
    const snapshot = { id: "shared-copy-route", name: "공유 버전 복사 route probe", payload, createdAt: stamp, updatedAt: stamp };
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const savedBuild = (id) => ({ id, name: id, selection, recommendationPreferences: { profile: "gaming", priority: "balanced", budgetWon: 1500000, listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 }, createdAt: stamp, updatedAt: stamp });
    const compatibility = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: "gaming", scoreLabel: "균형형", scoreBasis: "route probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 1000000, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp };
    let copyCalls = 0;
    try {
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
        if (requestUrl.pathname === "/api/version-comparisons/shared-copy-route") return response(snapshot);
        if (requestUrl.pathname === "/api/builds") return response({ items: [savedBuild("shared-copy-before"), savedBuild("shared-copy-after")] });
        if (requestUrl.pathname === "/api/compatibility/check" && init?.method === "POST") return response(compatibility);
        return originalFetch(input, init);
      };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      history.pushState({}, "", "/version-comparison/shared-copy-route");
      window.dispatchEvent(new PopStateEvent("popstate"));
      for (let index = 0; index < 160 && !document.querySelector('[data-testid="shared-version-comparison-card"]') ; index += 1) await wait(25);
      const copy = document.querySelector('[data-testid="shared-version-comparison-copy"]');
      if (!(copy instanceof HTMLButtonElement)) return { stage: "missing-copy" };
      copy.click();
      for (let index = 0; index < 160 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      return { stage: "checked", copyCalls, path: location.pathname, home: document.querySelector(".home-page") !== null, staleToast: Boolean(document.querySelector(".toast")) };
    } finally {
      window.fetch = originalFetch;
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.copyCalls !== 1 || result.path !== "/" || result.home !== true || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
