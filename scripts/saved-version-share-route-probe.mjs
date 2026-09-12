import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";
function signalProcessGroup(child, signal) { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } }
const chromePath = await firstAvailable([process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean));
if (!chromePath) throw new Error("Chrome 또는 Chromium 실행 파일을 찾지 못했습니다.");
const port = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-version-share-route-probe-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `${baseUrl}/history`], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
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
  await waitForValue(client, "location.pathname === '/history'", "History 화면");
  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const originalIds = localStorage.getItem("pc-supporter-saved-build-ids");
    const originalTokens = localStorage.getItem("pc-supporter-saved-build-owner-tokens");
    const originalShares = localStorage.getItem("pc-supporter-saved-build-version-shares");
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    const stamp = "2026-09-10T00:00:00.000Z";
    const beforeId = "version-route-before";
    const afterId = "version-route-after";
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const preferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 };
    const before = { id: beforeId, name: "version route before", selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, versionGroupId: "version-route-group", versionNumber: 1, totalPriceWon: 100000, priceComplete: true };
    const after = { id: afterId, name: "version route after", selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, versionGroupId: "version-route-group", versionNumber: 2, derivedFromBuildId: beforeId, totalPriceWon: 100000, priceComplete: true };
    const check = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 100000, priceComplete: true, analysisScore: 80, analysisScoreLabel: "균형형", analysisConfidence: "high", findings: [], engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp };
    const payload = { schemaVersion: 1, kind: "pc-supporter.saved-build-version-comparison-share", generatedAt: stamp, before: { id: beforeId, label: "변경 전", versionNumber: 1, name: before.name, updatedAt: stamp, check }, after: { id: afterId, label: "변경 후", versionNumber: 2, name: after.name, updatedAt: stamp, check }, summary: { direction: "same", selectionChangedCategoryCount: 0 }, transition: { direction: "same", statusChanged: false, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, priceCompletenessChanged: false, resourceBudgetChanged: false, benchmarkChanged: false, benchmarkNeedsReview: false, engineChanged: false, catalogChanged: false, resolvedFindingCount: 0, newFindingCount: 0, severityChangedFindingCount: 0, detailsChangedFindingCount: 0 }, changes: [], findingChanges: [], dataBoundary: "route probe", text: "route probe" };
    const shareResponse = { id: "version-route-share", name: "version route share", payload, createdAt: stamp, updatedAt: stamp, ownerToken: "x".repeat(48) };
    let buildCalls = 0;
    let shareCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) { buildCalls += 1; return response({ items: [before, after] }); }
      if (requestUrl.pathname === "/api/version-comparisons" && (init?.method ?? "GET").toUpperCase() === "POST") { shareCalls += 1; await wait(700); return response(shareResponse); }
      if (requestUrl.pathname === "/api/version-comparisons/version-route-share") return response(shareResponse);
      return originalFetch(input, init);
    };
    const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
    try {
      const ids = JSON.stringify([beforeId, afterId]);
      localStorage.setItem("pc-supporter-saved-build-ids", ids);
      localStorage.setItem("pc-supporter-saved-build-owner-tokens", JSON.stringify({ [afterId]: "x".repeat(48) }));
      window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-ids", newValue: ids, storageArea: localStorage }));
      for (let index = 0; index < 160 && !document.querySelector('[data-testid="saved-build-version-share"]'); index += 1) await wait(25);
      const share = document.querySelector('[data-testid="saved-build-version-share"]');
      if (!(share instanceof HTMLButtonElement)) return { stage: "missing-share", buildCalls, shareCalls, body: (document.body?.innerText ?? "").slice(-2200) };
      share.click();
      for (let index = 0; index < 80 && shareCalls < 1; index += 1) await wait(25);
      if (shareCalls < 1) return { stage: "missing-post", buildCalls, shareCalls };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const stored = localStorage.getItem("pc-supporter-saved-build-version-shares") ?? "";
      const body = document.body?.innerText ?? "";
      return { stage: "checked", buildCalls, shareCalls, path: location.pathname, staleStored: stored.includes("version-route-share"), staleToast: body.includes("견적 버전 비교 공유 링크가 생성되었습니다") || body.includes("견적 버전 비교 공유 링크를 클립보드에") };
    } finally {
      window.fetch = originalFetch;
      setStored("pc-supporter-saved-build-ids", originalIds);
      setStored("pc-supporter-saved-build-owner-tokens", originalTokens);
      setStored("pc-supporter-saved-build-version-shares", originalShares);
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.shareCalls !== 1 || result.path !== "/" || result.staleStored !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) { signalProcessGroup(chrome, "SIGTERM"); await Promise.race([chromeExit, sleep(2_000)]); if (!chromeExited) signalProcessGroup(chrome, "SIGKILL"); }
  await rm(profileDir, { recursive: true, force: true });
}
