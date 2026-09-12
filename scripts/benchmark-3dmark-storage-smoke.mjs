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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-3dmark-storage-smoke-"));
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
    `${baseUrl}/admin#admin-benchmark-review`
  ], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  let client;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused 3DMark Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForValue(client, `location.href.startsWith(${JSON.stringify(baseUrl)})`, "focused 3DMark page");
    const session = await browserApiJson(client, baseUrl, "/api/admin/session");
    if (session?.enabled && !session.authenticated) throw new Error("focused 3DMark smoke requires an authenticated admin session");
    await waitForValue(client, "document.querySelector('[data-testid=\"benchmark-3dmark-work-package\"]') !== null && document.querySelector('[data-testid=\"benchmark-3dmark-package-range\"]') !== null", "focused 3DMark work package");

    const probe = await client.evaluate(`(async () => {
      const key = "pc-supporter-3dmark-review-work-progress-v1";
      const original = localStorage.getItem(key);
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
      try {
        let current;
        try { current = JSON.parse(original ?? "null"); } catch { current = null; }
        if (!current?.queueFingerprint) return { stage: "missing-fingerprint", original };
        const next = JSON.stringify({ offset: 24, queueFingerprint: current.queueFingerprint, completedIds: [] });
        localStorage.setItem(key, next);
        dispatch(next);
        for (let index = 0; index < 120 && !(document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith("25–48 /"); index += 1) await wait(25);
        const movedToNext = (document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith("25–48 /");
        if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original);
        dispatch(original);
        for (let index = 0; index < 120 && !(document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith("1–24 /"); index += 1) await wait(25);
        const restored = (document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith("1–24 /");
        const batchReady = document.querySelector('[data-testid="benchmark-3dmark-package-to-batch"]')?.disabled === false;
        return { stage: "checked", movedToNext, restored, batchReady, path: location.pathname, hash: location.hash };
      } finally {
        if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original);
        dispatch(original);
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.movedToNext === true && probe.restored === true && probe.batchReady === true, "focused 3DMark storage probe failed: " + JSON.stringify(probe));
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
