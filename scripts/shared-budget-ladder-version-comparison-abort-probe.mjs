import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const shareId = "shared-budget-ladder-version-abort";
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-budget-ladder-version-abort-probe-"));
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
], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
let chromeExited = false;
const chromeExit = new Promise((resolve) => chrome.once("exit", () => { chromeExited = true; resolve(); }));
let client;

const request = { profile: "gaming", budgetWon: 1500000, includeGpu: true, priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: "retail_only" };
const payload = { type: "pc-supporter-budget-ladder", version: 1, exportedAt: timestamp, items: [], changes: [] };
const snapshotFor = (id, name) => ({ id, name, payload, request, catalogSnapshotAt: timestamp, catalogCurrentSnapshotAt: timestamp, catalogChangedSinceShare: false, createdAt: timestamp, updatedAt: timestamp });
const lineage = {
  lineageId: "shared-budget-ladder-version-abort-lineage",
  currentId: shareId,
  entries: [
    { id: previousId, name: "이전 버전", lineageId: "shared-budget-ladder-version-abort-lineage", versionNumber: 1, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false },
    { id: shareId, name: "현재 버전", lineageId: "shared-budget-ladder-version-abort-lineage", versionNumber: 2, createdAt: timestamp, updatedAt: timestamp, catalogSnapshotAt: timestamp, expired: false }
  ]
};

try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const originalFetch = window.fetch;
      const state = window.__sharedBudgetVersionAbortProbe = { versionCalls: 0, abortedCalls: 0 };
      const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
      const previousId = ${JSON.stringify(previousId)};
      const shareId = ${JSON.stringify(shareId)};
      const previousSnapshot = ${JSON.stringify(snapshotFor(previousId, "이전 버전"))};
      const currentSnapshot = ${JSON.stringify(snapshotFor(shareId, "현재 버전"))};
      const lineage = ${JSON.stringify(lineage)};
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/budget-ladders/" + shareId) return response(currentSnapshot);
        if (requestUrl.pathname === "/api/budget-ladders/" + shareId + "/lineage") return response(lineage);
        if (requestUrl.pathname === "/api/budget-ladders/" + previousId) {
          state.versionCalls += 1;
          return new Promise((resolve, reject) => {
            const signal = init?.signal;
            const abort = () => { state.abortedCalls += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
            if (signal?.aborted) return abort();
            signal?.addEventListener("abort", abort, { once: true });
            setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response(previousSnapshot)); }, 2000);
          });
        }
        return originalFetch(input, init);
      };
    })();`
  });
  await client.send("Page.navigate", { url: `${baseUrl}/budget-ladder/${shareId}` });
  await waitForValue(client, `location.pathname === '/budget-ladder/${shareId}'`, "공유 예산 ladder version route");
  await waitForValue(client, "document.querySelector('.shared-budget-ladder-page') !== null", "공유 예산 ladder version 화면 mount");
  const result = await client.evaluate(`(async () => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const state = window.__sharedBudgetVersionAbortProbe;
    for (let index = 0; index < 240 && state.versionCalls < 1; index += 1) await wait(25);
    const requestStarted = state.versionCalls >= 1;
    history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await wait(500);
    return { stage: "checked", versionCalls: state.versionCalls, abortedCalls: state.abortedCalls, requestStarted, path: location.pathname, home: document.querySelector(".home-page") !== null };
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.requestStarted !== true || result.abortedCalls < 1 || result.versionCalls !== 1 || result.path !== "/" || result.home !== true) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
