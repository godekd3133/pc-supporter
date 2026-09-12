import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const shareId = "shared-watchlist-live-price-abort";

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-watchlist-live-price-abort-probe-"));
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
      const state = window.__sharedWatchlistLivePriceAbortProbe = { priceCalls: 0, abortedCalls: 0 };
      const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/watchlists/${shareId}") return response({ id: "${shareId}", name: "live price abort watchlist", entries: [{ itemId: "live-price-abort-item", itemName: "가격 취소 부품", category: "cpu", kind: "part", addedAt: "2026-09-11T00:00:00.000Z" }], nearLowThresholdPercent: 10, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z" });
        if (requestUrl.pathname === "/api/parts/live-price-abort-item") {
          state.priceCalls += 1;
          return new Promise((resolve, reject) => {
            const signal = init?.signal;
            const abort = () => { state.abortedCalls += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
            if (signal?.aborted) return abort();
            signal?.addEventListener("abort", abort, { once: true });
            setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response({ id: "live-price-abort-item", category: "cpu", name: "가격 취소 부품", priceWon: 100000, dataQuality: "seed", missingFields: [], specs: {}, updatedAt: "2026-09-11T00:00:00.000Z" })); }, 2000);
          });
        }
        return originalFetch(input, init);
      };
    })();`
  });
  await client.send("Page.navigate", { url: `${baseUrl}/watchlist/${shareId}` });
  await waitForValue(client, `location.pathname === '/watchlist/${shareId}'`, "공유 관심 가격 route");
  await waitForValue(client, "document.querySelector('.shared-watchlist-card') !== null", "공유 관심 가격 snapshot");
  const result = await client.evaluate(`(async () => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const state = window.__sharedWatchlistLivePriceAbortProbe;
    const refresh = [...document.querySelectorAll("button")].find((button) => !button.disabled && (button.textContent ?? "").includes("현재 가격 다시 확인"));
    if (!(refresh instanceof HTMLButtonElement)) return { stage: "missing-refresh" };
    refresh.click();
    for (let index = 0; index < 160 && state.priceCalls < 1; index += 1) await wait(25);
    const requestStarted = state.priceCalls >= 1;
    history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await wait(500);
    return { stage: "checked", priceCalls: state.priceCalls, abortedCalls: state.abortedCalls, requestStarted, path: location.pathname, home: document.querySelector(".home-page") !== null };
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
