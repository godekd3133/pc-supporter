import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const shareId = "shared-watchlist-abort-route";

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-watchlist-route-abort-probe-"));
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
    let calls = 0;
    let abortedCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/watchlists/${shareId}") {
        calls += 1;
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          const abort = () => { abortedCalls += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response({ id: "${shareId}", name: "abort route watchlist", entries: [], nearLowThresholdPercent: 10, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z" })); }, 2000);
        });
      }
      return originalFetch(input, init);
    };
    try {
      history.pushState({}, "", "/watchlist/${shareId}");
      window.dispatchEvent(new PopStateEvent("popstate"));
      for (let index = 0; index < 160 && calls < 1; index += 1) await wait(25);
      const requestStarted = calls >= 1;
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(500);
      return { stage: "checked", calls, abortedCalls, requestStarted, path: location.pathname, home: document.querySelector(".home-page") !== null };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.requestStarted !== true || result.abortedCalls < 1 || result.path !== "/" || result.home !== true) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
