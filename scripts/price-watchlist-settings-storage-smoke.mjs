import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-price-watch-settings-smoke-"));
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
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused price watch settings Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForValue(client, "location.pathname === '/watchlist' && document.querySelector('.price-watchlist-page') !== null", "focused price watch settings page");
    const probe = await client.evaluate(`(async () => {
      const autoKey = "pc-supporter-price-monitor-auto-refresh";
      const intervalKey = "pc-supporter-price-monitor-interval";
      const alertPolicyKey = "pc-supporter-price-alert-policy";
      const historyKey = "pc-supporter-price-history-window";
      const original = Object.fromEntries([autoKey, intervalKey, alertPolicyKey, historyKey].map((key) => [key, localStorage.getItem(key)]));
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const dispatch = (key, value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        setStored(autoKey, "true"); dispatch(autoKey, "true");
        setStored(intervalKey, "30"); dispatch(intervalKey, "30");
        setStored(historyKey, "90"); dispatch(historyKey, "90");
        const alertPolicy = JSON.stringify({ targetReached: false, priceDrop: false, priceAvailability: true, minimumDropPercent: 5 });
        setStored(alertPolicyKey, alertPolicy); dispatch(alertPolicyKey, alertPolicy);
        for (let index = 0; index < 120 && document.querySelector('[aria-label="가격 추적 자동 확인"]')?.checked !== true; index += 1) await wait(25);
        for (let index = 0; index < 120 && document.querySelector('[aria-label="가격 추적 자동 확인 주기"]')?.value !== "30"; index += 1) await wait(25);
        for (let index = 0; index < 120 && document.querySelector('[aria-label="가격 추적 가격 이력 기간"]')?.value !== "90"; index += 1) await wait(25);
        const autoRefreshEnabled = document.querySelector('[aria-label="가격 추적 자동 확인"]')?.checked === true;
        const autoRefreshMinutes = document.querySelector('[aria-label="가격 추적 자동 확인 주기"]')?.value ?? "";
        const historyDays = document.querySelector('[aria-label="가격 추적 가격 이력 기간"]')?.value ?? "";
        const alertPolicyState = {
          targetReached: document.querySelector('[aria-label="가격 추적 목표가 도달 알림"]')?.checked === true,
          priceDrop: document.querySelector('[aria-label="가격 추적 가격 하락 알림"]')?.checked === true,
          priceAvailability: document.querySelector('[aria-label="가격 추적 가격 확인 상태 알림"]')?.checked === true,
          minimumDropPercent: document.querySelector('[aria-label="가격 추적 하락 알림 최소 변동"]')?.value ?? ""
        };
        return { stage: "checked", autoRefreshEnabled, autoRefreshMinutes, historyDays, alertPolicyState, status: document.querySelector('.price-watchlist-monitor-status')?.textContent ?? "", path: location.pathname };
      } finally {
        for (const [key, value] of Object.entries(original)) { setStored(key, value); dispatch(key, value); }
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.autoRefreshEnabled === true && probe.autoRefreshMinutes === "30" && probe.historyDays === "90" && probe.alertPolicyState.targetReached === false && probe.alertPolicyState.priceDrop === false && probe.alertPolicyState.priceAvailability === true && probe.alertPolicyState.minimumDropPercent === "5" && probe.status.includes("30분"), "focused price watch settings storage probe failed: " + JSON.stringify(probe));
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
