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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-generator-preset-smoke-"));
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
    `${baseUrl}/recommend`
  ], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  let client;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused generator preset Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForValue(client, "location.pathname === '/recommend' && document.querySelector('[data-testid=\"generator-preset-name\"]') !== null", "focused generator preset page");
    const probe = await client.evaluate(`(async () => {
      const key = "pc-supporter-generator-presets";
      const original = localStorage.getItem(key);
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
      const preset = { id: "focused-generator-storage-probe", name: "focused generator preset", profile: "general", priority: "balanced", gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: 1500000, includeGpu: true, storageCapacityGb: 1000, hddCount: 0, hddCapacityGb: 4000, listingPolicy: "retail_only", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" };
      try {
        const serialized = JSON.stringify({ schemaVersion: 1, items: [preset] });
        localStorage.setItem(key, serialized);
        dispatch(serialized);
        for (let index = 0; index < 80 && !(document.body?.innerText ?? "").includes("focused generator preset"); index += 1) await wait(25);
        const added = (document.body?.innerText ?? "").includes("focused generator preset");
        localStorage.removeItem(key);
        dispatch(null);
        for (let index = 0; index < 80 && (document.body?.innerText ?? "").includes("focused generator preset"); index += 1) await wait(25);
        const removed = !(document.body?.innerText ?? "").includes("focused generator preset");
        return { stage: "checked", added, removed, path: location.pathname };
      } finally {
        if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original);
        dispatch(original);
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.added === true && probe.removed === true && probe.path === "/recommend", "focused generator preset storage probe failed: " + JSON.stringify(probe));
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
