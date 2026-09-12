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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-browser-notification-storage-smoke-"));
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
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused browser notification storage Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Browser.grantPermissions", { origin: new URL(baseUrl).origin, permissions: ["notifications"] });
    await waitForValue(client, "location.pathname === '/' && document.querySelector('.home-page') !== null", "focused browser notification storage page");
    const probe = await client.evaluate(`(async () => {
      const enabledKey = "pc-supporter-browser-notification-enabled";
      const deliveredKey = "pc-supporter-browser-notification-delivered";
      const alertsKey = "pc-supporter-saved-build-monitor-alerts";
      const originalEnabled = localStorage.getItem(enabledKey);
      const originalDelivered = localStorage.getItem(deliveredKey);
      const originalAlerts = localStorage.getItem(alertsKey);
      const originalNotification = window.Notification;
      const alert = { id: "browser-notification-storage-probe", buildId: "missing-build", buildName: "notification storage probe", kind: "critical", title: "중복 알림 방지", message: "다른 탭에서 이미 전달된 알림", createdAt: "2026-09-10T00:00:00.000Z" };
      let notificationCalls = 0;
      class MockNotification {
        static permission = "granted";
        close() {}
        constructor() { notificationCalls += 1; }
      }
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const dispatch = (key, value) => { const event = new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }); try { Object.defineProperty(event, "storageArea", { value: localStorage }); } catch {} window.dispatchEvent(event); };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        window.Notification = MockNotification;
        window.dispatchEvent(new Event("focus"));
        setStored(enabledKey, "true"); dispatch(enabledKey, "true");
        setStored(deliveredKey, JSON.stringify([alert.id])); dispatch(deliveredKey, JSON.stringify([alert.id]));
        setStored(alertsKey, JSON.stringify([alert])); dispatch(alertsKey, JSON.stringify([alert]));
        await wait(500);
        return { stage: "checked", notificationCalls, delivered: localStorage.getItem(deliveredKey), path: location.pathname };
      } finally {
        window.Notification = originalNotification;
        setStored(enabledKey, originalEnabled); dispatch(enabledKey, originalEnabled);
        setStored(deliveredKey, originalDelivered); dispatch(deliveredKey, originalDelivered);
        setStored(alertsKey, originalAlerts); dispatch(alertsKey, originalAlerts);
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.notificationCalls === 0 && probe.delivered?.includes("browser-notification-storage-probe") === true && probe.path === "/", "focused browser notification delivery storage probe failed: " + JSON.stringify(probe));
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
