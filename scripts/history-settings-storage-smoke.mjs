import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";
const origin = new URL(baseUrl).origin;

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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-history-settings-smoke-"));
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
  let client;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused history settings Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Browser.grantPermissions", { origin, permissions: ["notifications"] });
    await waitForValue(client, `location.href.startsWith(${JSON.stringify(baseUrl)})`, "focused history settings page");
    await waitForValue(client, "document.querySelector('.home-page') !== null", "focused history settings app mount");

    const probe = await client.evaluate(`(async () => {
      const idsKey = "pc-supporter-saved-build-ids";
      const autoRefreshKey = "pc-supporter-saved-build-monitor-auto-refresh";
      const intervalKey = "pc-supporter-saved-build-monitor-interval";
      const notificationKey = "pc-supporter-browser-notification-enabled";
      const originalIds = localStorage.getItem(idsKey);
      const originalAutoRefresh = localStorage.getItem(autoRefreshKey);
      const originalInterval = localStorage.getItem(intervalKey);
      const originalNotification = localStorage.getItem(notificationKey);
      const originalFetch = window.fetch;
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      let buildsCalls = 0;
      const dispatch = (key, value) => { const event = new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }); try { Object.defineProperty(event, "storageArea", { value: localStorage }); } catch {} window.dispatchEvent(event); };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        const savedBuildList = await originalFetch("/api/builds?limit=1").then((response) => response.json());
        const savedBuild = savedBuildList?.items?.[0];
        if (!savedBuild?.id) return { stage: "missing-build" };
        const buildId = savedBuild.id;
        window.fetch = async (input, init) => {
          const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
          if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) buildsCalls += 1;
          return originalFetch(input, init);
        };
        setStored(autoRefreshKey, "false");
        setStored(intervalKey, "15");
        setStored(notificationKey, "false");
        const serializedIds = JSON.stringify([buildId]);
        setStored(idsKey, serializedIds);
        dispatch(idsKey, serializedIds);
        for (let index = 0; index < 120 && buildsCalls < 1; index += 1) await wait(25);
        await wait(150);
        history.pushState({}, "", "/history");
        window.dispatchEvent(new PopStateEvent("popstate"));
        for (let index = 0; index < 120 && !document.querySelector('[data-testid="saved-build-health-dashboard"]'); index += 1) await wait(25);
        const historyReady = Boolean(document.querySelector('[data-testid="saved-build-health-dashboard"]'));
        const historyCard = Boolean(document.querySelector('.history-card'));
        window.dispatchEvent(new Event("focus"));
        setStored(autoRefreshKey, "true");
        dispatch(autoRefreshKey, "true");
        setStored(intervalKey, "30");
        dispatch(intervalKey, "30");
        for (let index = 0; index < 120 && document.querySelector('[aria-label="저장 견적 자동 점검"]')?.checked !== true; index += 1) await wait(25);
        for (let index = 0; index < 120 && document.querySelector('[aria-label="저장 견적 자동 점검 주기"]')?.value !== "30"; index += 1) await wait(25);
        const autoRefreshEnabled = document.querySelector('[aria-label="저장 견적 자동 점검"]')?.checked === true;
        const autoRefreshMinutes = document.querySelector('[aria-label="저장 견적 자동 점검 주기"]')?.value ?? "";
        const autoRefreshStatus = document.querySelector('.history-health-monitor-status')?.textContent ?? "";
        setStored(notificationKey, "true");
        dispatch(notificationKey, "true");
        for (let index = 0; index < 120 && document.querySelector('[aria-label="저장 견적 브라우저 알림 사용"]')?.checked !== true; index += 1) await wait(25);
        const browserNotificationEnabled = document.querySelector('[aria-label="저장 견적 브라우저 알림 사용"]')?.checked === true;
        return { stage: "checked", historyReady, historyCard, autoRefreshEnabled, autoRefreshMinutes, autoRefreshStatus, browserNotificationEnabled, buildId, buildsCalls, ids: localStorage.getItem(idsKey), path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        setStored(idsKey, originalIds);
        dispatch(idsKey, originalIds);
        setStored(autoRefreshKey, originalAutoRefresh);
        dispatch(autoRefreshKey, originalAutoRefresh);
        setStored(intervalKey, originalInterval);
        dispatch(intervalKey, originalInterval);
        setStored(notificationKey, originalNotification);
        dispatch(notificationKey, originalNotification);
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.historyReady === true && probe.historyCard === true && probe.autoRefreshEnabled === true && probe.autoRefreshMinutes === "30" && probe.autoRefreshStatus.includes("30분") && probe.browserNotificationEnabled === true, "focused history settings storage probe failed: " + JSON.stringify(probe));
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    client?.close();
    signalProcessGroup(chrome, "SIGTERM");
    await sleep(500);
    signalProcessGroup(chrome, "SIGKILL");
    try {
      await rm(profileDir, { recursive: true, force: true });
    } catch {
      await sleep(500);
      try { await rm(profileDir, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
