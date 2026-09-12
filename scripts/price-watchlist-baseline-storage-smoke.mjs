import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); return; } catch { /* fall back to direct child */ }
  }
  try { child.kill(signal); } catch { /* best-effort cleanup */ }
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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-price-watch-baseline-smoke-"));
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
    `${baseUrl}/watchlist`
  ], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  let client;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused price watch baseline Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForValue(client, "location.pathname === '/watchlist' && document.querySelector('.price-watchlist-page') !== null", "focused price watch baseline page");
    const probe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const baselineKey = "pc-supporter-price-monitor-baseline";
      const autoKey = "pc-supporter-price-monitor-auto-refresh";
      const policyKey = "pc-supporter-price-alert-policy";
      const original = Object.fromEntries([watchlistKey, baselineKey, autoKey, policyKey].map((key) => [key, localStorage.getItem(key)]));
      const originalFetch = window.fetch;
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      let priceCalls = 0;
      const dispatch = (key, value) => { const event = new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }); try { Object.defineProperty(event, "storageArea", { value: localStorage }); } catch {} window.dispatchEvent(event); };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      const entry = { itemId: "cpu-i7-14700k", itemName: "baseline storage probe CPU", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
      try {
        window.fetch = async (input, init) => {
          const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
          if (requestUrl.pathname === "/api/parts/cpu-i7-14700k") {
            priceCalls += 1;
            return new Response(JSON.stringify({ id: "cpu-i7-14700k", category: "cpu", name: "baseline storage probe CPU", priceWon: 100000, dataQuality: "seed", missingFields: [], specs: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return originalFetch(input, init);
        };
        setStored(autoKey, "false");
        setStored(policyKey, JSON.stringify({ targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 0 }));
        setStored(watchlistKey, JSON.stringify([entry]));
        dispatch(watchlistKey, JSON.stringify([entry]));
        for (let index = 0; index < 120 && !document.querySelector('.price-watchlist-tracked-item'); index += 1) await wait(25);
        for (let index = 0; index < 120 && priceCalls < 1; index += 1) await wait(25);
        const tracked = Boolean(document.querySelector('.price-watchlist-tracked-item'));
        const firstRefreshCalls = priceCalls;
        const baseline = JSON.stringify({ "part:cpu-i7-14700k": { status: "available", priceWon: 200000 } });
        setStored(baselineKey, baseline);
        dispatch(baselineKey, baseline);
        priceCalls = 0;
        setStored(autoKey, "true");
        dispatch(autoKey, "true");
        for (let index = 0; index < 160 && priceCalls < 1; index += 1) await wait(25);
        for (let index = 0; index < 160 && !document.querySelector('.price-watchlist-alert'); index += 1) await wait(25);
        const alertVisible = Boolean(document.querySelector('.price-watchlist-alert'));
        return { stage: "checked", tracked, firstRefreshCalls, priceCalls, alertVisible, path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        for (const [key, value] of Object.entries(original)) { setStored(key, value); dispatch(key, value); }
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.tracked === true && probe.priceCalls >= 1 && probe.alertVisible === true && probe.path === "/watchlist", "focused price watch baseline storage probe failed: " + JSON.stringify(probe));
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    client?.close();
    signalProcessGroup(chrome, "SIGTERM");
    await sleep(500);
    signalProcessGroup(chrome, "SIGKILL");
    try { await rm(profileDir, { recursive: true, force: true }); } catch { await sleep(500); try { await rm(profileDir, { recursive: true, force: true }); } catch {} }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
