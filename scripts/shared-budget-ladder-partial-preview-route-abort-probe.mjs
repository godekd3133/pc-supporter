import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const shareId = "shared-budget-ladder-partial-preview-abort";
const previousId = `${shareId}-previous`;
const nextShareId = `${shareId}-next`;
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-budget-ladder-partial-preview-abort-probe-"));
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
    const nextShareId = ${JSON.stringify(nextShareId)};
    const timestamp = ${JSON.stringify(timestamp)};
    const request = { profile: "gaming", budgetWon: 1500000, includeGpu: true, priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: "retail_only" };
    const selectionFor = (suffix) => ({ cpu: { partId: "cpu-" + suffix, quantity: 1 }, motherboard: { partId: "board-" + suffix, quantity: 1 }, gpu: { partId: "gpu-" + suffix, quantity: 1 }, memory: [], ssd: [], hdd: [], case: { partId: "case-" + suffix, quantity: 1 }, psu: { partId: "psu-" + suffix, quantity: 1 }, accessories: [], useIntegratedGraphics: false });
    const payloadFor = (suffix) => ({ type: "pc-supporter-budget-ladder", version: 1, exportedAt: timestamp, items: [
      { id: "economy", label: "절약형", description: "probe", budgetWon: 1200000, status: "호환 가능", totalPriceWon: 1100000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 80, lines: [] },
      { id: "target", label: "목표 예산", description: "probe", budgetWon: 1500000, status: "호환 가능", totalPriceWon: 1450000, budgetDeltaWon: 50000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 82, lines: [], selection: selectionFor(suffix) },
      { id: "headroom", label: "여유형", description: "probe", budgetWon: 1800000, status: "호환 가능", totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 84, lines: [] }
    ], changes: [] });
    const snapshotFor = (id, name, suffix) => ({ id, name, payload: payloadFor(suffix), request, catalogSnapshotAt: timestamp, catalogCurrentSnapshotAt: timestamp, catalogChangedSinceShare: false, createdAt: timestamp, updatedAt: timestamp });
    const liveMeta = await originalFetch("/api/meta").then((metaResponse) => metaResponse.json());
    const metaPayload = { ...liveMeta, catalogUpdatedAt: timestamp };
    const state = { checkCalls: 0, checkSignalCalls: 0, checkAbortedCalls: 0 };
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/budget-ladders/" + shareId || requestUrl.pathname === "/api/budget-ladders/" + nextShareId) {
        const id = requestUrl.pathname.split("/").at(-1);
        return response(snapshotFor(id, id === shareId ? "부분 병합 A" : "부분 병합 B", id === shareId ? "a" : "b"));
      }
      if (requestUrl.pathname === "/api/budget-ladders/" + previousId) return response(snapshotFor(previousId, "부분 병합 이전", "previous"));
      if (requestUrl.pathname.endsWith("/lineage")) return response({ lineageId: "shared-budget-ladder-partial-preview-abort-lineage", currentId: requestUrl.pathname.split("/").at(-2), entries: [
        { id: previousId, name: "이전 버전", lineageId: "shared-budget-ladder-partial-preview-abort-lineage", versionNumber: 1, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false },
        { id: requestUrl.pathname.includes(nextShareId) ? nextShareId : shareId, name: "현재 버전", lineageId: "shared-budget-ladder-partial-preview-abort-lineage", versionNumber: 2, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false }
      ] });
      if (requestUrl.pathname === "/api/meta") return response(metaPayload);
      if (requestUrl.pathname === "/api/compatibility/check" && init?.method === "POST") {
        state.checkCalls += 1;
        if (init?.signal) state.checkSignalCalls += 1;
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          const abort = () => { state.checkAbortedCalls += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: "gaming", scoreLabel: "균형형", scoreBasis: "probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 1450000, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: timestamp, checkedAt: timestamp })); }, 2000);
        });
      }
      return originalFetch(input, init);
    };
    const push = (id) => { history.pushState({}, "", "/budget-ladder/" + id); window.dispatchEvent(new PopStateEvent("popstate")); };
    const waitForHeading = async (name) => { for (let index = 0; index < 200 && !(document.querySelector("h1")?.textContent ?? "").includes(name); index += 1) await wait(25); return (document.querySelector("h1")?.textContent ?? "").includes(name); };
    try {
      push(shareId);
      const mounted = await waitForHeading("부분 병합 A");
      for (let index = 0; index < 200 && !document.querySelector("[aria-label=\\"예산 비교 부분 병합\\"]"); index += 1) await wait(25);
      const preview = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("부분 병합 조합 미리 검사"));
      if (!(preview instanceof HTMLButtonElement)) return { stage: "missing-preview", mounted, ...state };
      preview.click();
      for (let index = 0; index < 160 && state.checkCalls < 1; index += 1) await wait(25);
      const requestStarted = state.checkCalls >= 1;
      push(nextShareId);
      for (let index = 0; index < 240 && (!(document.querySelector("h1")?.textContent ?? "").includes("부분 병합 B") || document.querySelector(".shared-budget-ladder-page") === null); index += 1) await wait(25);
      return { stage: "checked", requestStarted, checkSignalCalls: state.checkSignalCalls, abortedCalls: state.checkAbortedCalls, calls: state.checkCalls, path: location.pathname, nextMounted: (document.querySelector("h1")?.textContent ?? "").includes("부분 병합 B"), nextPartialMounted: document.querySelector("[aria-label=\\"예산 비교 부분 병합\\"]") !== null };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.requestStarted !== true || result.checkSignalCalls !== 1 || result.abortedCalls < 1 || result.calls !== 1 || result.path !== "/budget-ladder/${nextShareId}" || result.nextMounted !== true) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
