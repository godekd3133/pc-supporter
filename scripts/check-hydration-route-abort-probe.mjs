import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-check-hydration-abort-probe-"));
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

const selection = {
  cpu: { partId: "check-hydration-cpu", quantity: 1 },
  motherboard: { partId: "check-hydration-board", quantity: 1 },
  gpu: { partId: "check-hydration-gpu", quantity: 1 },
  memory: [],
  ssd: [],
  hdd: [],
  case: { partId: "check-hydration-case", quantity: 1 },
  psu: { partId: "check-hydration-psu", quantity: 1 },
  accessories: [{ accessoryId: "check-hydration-accessory", quantity: 1 }],
  useIntegratedGraphics: false
};
const draftEnvelope = { schemaVersion: 1, exportedAt: timestamp, selection, recommendationPreferences: { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1440p" } };

try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForValue(client, "location.pathname === '/'", "홈 화면");
  await client.evaluate(`localStorage.setItem("pc-supporter-draft", ${JSON.stringify(JSON.stringify(draftEnvelope))});`);
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const originalFetch = window.fetch;
      const state = window.__checkHydrationProbe = { partsCalls: 0, partsSignalCalls: 0, partsAbortedCalls: 0, accessoryCalls: 0, accessorySignalCalls: 0, accessoryAbortedCalls: 0 };
      const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
      const delayed = (kind, init, payload) => new Promise((resolve, reject) => {
        const signal = init?.signal;
        const abort = () => { state[kind + "AbortedCalls"] += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response(payload)); }, 2000);
      });
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/parts/batch" && (init?.method ?? "GET").toUpperCase() === "POST") {
          state.partsCalls += 1;
          if (state.partsCalls === 1) return response({ items: [] });
          if (init?.signal) state.partsSignalCalls += 1;
          return delayed("parts", init, { items: [] });
        }
        if (requestUrl.pathname === "/api/accessories/batch" && (init?.method ?? "GET").toUpperCase() === "POST") {
          state.accessoryCalls += 1;
          if (state.accessoryCalls === 1) return response({ items: [] });
          if (init?.signal) state.accessorySignalCalls += 1;
          return delayed("accessory", init, { items: [] });
        }
        return originalFetch(input, init);
      };
    })();`
  });
  await client.send("Page.navigate", { url: `${baseUrl}/build` });
  await waitForValue(client, "location.pathname === '/build' && document.querySelector('.workspace-page') !== null", "견적 편집기");
  const result = await client.evaluate(`(async () => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const state = window.__checkHydrationProbe;
    for (let index = 0; index < 160 && (state.partsCalls < 1 || state.accessoryCalls < 1); index += 1) await wait(25);
    const initialStarted = state.partsCalls >= 1 && state.accessoryCalls >= 1;
    const check = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && button.classList.contains("button-primary") && button.classList.contains("full-width"));
    if (!(check instanceof HTMLButtonElement)) return { stage: "missing-check", initialStarted, ...state };
    check.click();
    for (let index = 0; index < 160 && (state.partsCalls < 2 || state.accessoryCalls < 2); index += 1) await wait(25);
    const requestStarted = state.partsCalls >= 2 && state.accessoryCalls >= 2;
    history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    for (let index = 0; index < 240 && (!document.querySelector(".home-page") || document.querySelector(".workspace-page") !== null); index += 1) await wait(25);
    return { stage: "checked", initialStarted, requestStarted, path: location.pathname, home: document.querySelector(".home-page") !== null, editor: document.querySelector(".workspace-page") !== null, ...state };
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.initialStarted !== true || result.requestStarted !== true || result.partsCalls < 2 || result.accessoryCalls < 2 || result.partsSignalCalls !== 1 || result.accessorySignalCalls !== 1 || result.partsAbortedCalls < 1 || result.accessoryAbortedCalls < 1 || result.path !== "/" || result.home !== true || result.editor !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
