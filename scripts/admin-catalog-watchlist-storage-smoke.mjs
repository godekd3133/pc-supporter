import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, browserApiJson, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already have exited.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Cleanup is best effort.
  }
}

async function main() {
  const chromePath = await firstAvailable([
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean));
  if (!chromePath) throw new Error("Chrome 실행 파일을 찾지 못했습니다.");

  const port = await freePort();
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-admin-watchlist-smoke-"));
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
    `${baseUrl}/admin`
  ], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  let client;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused admin smoke Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForValue(client, `location.href.startsWith(${JSON.stringify(baseUrl)})`, "focused admin smoke page");

    const session = await browserApiJson(client, baseUrl, "/api/admin/session");
    if (session?.enabled && !session.authenticated) {
      throw new Error("focused admin smoke requires an already authenticated development admin session or BROWSER_SMOKE_ADMIN_PASSWORD");
    }
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터')", "focused admin page");
    await client.evaluate("(() => { const hash = '#admin-catalog-change-log'; history.replaceState({}, '', location.pathname + location.search + hash); window.dispatchEvent(new HashChangeEvent('hashchange')); })()");
    await waitForValue(client, "document.querySelector('.catalog-change-card') !== null", "focused admin catalog change log");

    const probe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const thresholdKey = "pc-supporter-catalog-watch-threshold";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const originalThreshold = localStorage.getItem(thresholdKey);
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const entry = { itemId: "focused-admin-watch-storage-probe", itemName: "focused admin cross-tab watch probe", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
      const dispatch = (key, value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        const serialized = JSON.stringify([entry]);
        setStored(watchlistKey, serialized);
        dispatch(watchlistKey, serialized);
        for (let index = 0; index < 80 && !(document.body?.innerText ?? "").includes(entry.itemName); index += 1) await wait(25);
        const tracked = (document.body?.innerText ?? "").includes(entry.itemName);
        const thresholdSerialized = "5";
        setStored(thresholdKey, thresholdSerialized);
        dispatch(thresholdKey, thresholdSerialized);
        for (let index = 0; index < 80 && document.querySelector('[aria-label="관심 가격 최저가 근접 기준"]')?.value !== "5"; index += 1) await wait(25);
        const threshold = document.querySelector('[aria-label="관심 가격 최저가 근접 기준"]')?.value ?? "";
        return { stage: "checked", tracked, threshold, path: location.pathname, hash: location.hash };
      } finally {
        setStored(watchlistKey, originalWatchlist);
        dispatch(watchlistKey, originalWatchlist);
        setStored(thresholdKey, originalThreshold);
        dispatch(thresholdKey, originalThreshold);
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.tracked === true && probe.threshold === "5" && probe.path === "/admin" && probe.hash === "#admin-catalog-change-log", "focused admin catalog watch-list storage probe failed: " + JSON.stringify(probe));
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    client?.close();
    signalProcessGroup(chrome, "SIGTERM");
    await sleep(500);
    signalProcessGroup(chrome, "SIGKILL");
    await rm(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
