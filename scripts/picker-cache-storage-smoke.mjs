import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, clickText, firstAvailable, freePort, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const cacheKey = "pc-supporter-catalog-picker-cache-v1";

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-picker-cache-storage-smoke-"));
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
], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore"] });

let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "picker cache smoke Chrome page");
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForHomeDemoButtons(client, "picker cache smoke home");

  const originalCache = await client.evaluate(`localStorage.getItem(${JSON.stringify(cacheKey)})`);
  await client.evaluate(`(() => {
    const part = { id: "picker-cache-storage-probe", category: "cpu", name: "picker cache storage probe CPU", brand: "probe", model: "CACHE-PROBE", source: "manual", listingType: "retail", dataQuality: "manual", missingFields: [], updatedAt: "2026-09-10T00:00:00.000Z", priceWon: 1, specs: { socket: "AM5", memoryType: "DDR5", cores: 6, threads: 12 } };
    localStorage.setItem(${JSON.stringify(cacheKey)}, JSON.stringify({ schemaVersion: 1, cachedAt: "2026-09-10T00:00:00.000Z", items: [part] }));
  })()`);
  await client.evaluate(`(() => {
    const original = window.fetch;
    window.__pickerCacheStorageSmokeFetch = original;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/parts" && requestUrl.searchParams.get("category") === "cpu") throw new TypeError("picker-cache-storage-smoke-offline");
      return original(input, init);
    };
  })()`);
  assert(await clickText(client, "문제 있는 예시 견적"), "picker cache smoke demo build button not found");
  await waitForValue(client, "location.pathname === '/build'", "picker cache smoke editor");
  const opened = await client.evaluate(`(() => {
    const card = [...document.querySelectorAll('.component-card')].find((candidate) => candidate.querySelector('h3')?.textContent?.trim() === 'CPU');
    const button = card?.querySelector('.empty-selection button, .selected-lines > .text-button, .included-selection button');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert(opened, "picker cache smoke CPU picker button not found");
  await waitForValue(client, "document.querySelector('[role=dialog] #picker-title')?.textContent?.includes('CPU') === true", "picker cache smoke CPU dialog");
  await waitForValue(client, "document.querySelector('[data-testid=picker-cached-fallback]') !== null && document.querySelector('[data-testid=picker-cached-catalog-list] .picker-item-card') !== null", "picker cache smoke fallback");

  const probe = await client.evaluate(`(async () => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key: ${JSON.stringify(cacheKey)}, newValue: value, storageArea: localStorage }));
    const sample = (label) => { const body = document.body?.innerText ?? ""; return { label, cachedFallback: Boolean(document.querySelector('[data-testid="picker-cached-fallback"]')), cachedList: Boolean(document.querySelector('[data-testid="picker-cached-catalog-list"]')), cachedCards: document.querySelectorAll('[data-testid="picker-cached-catalog-list"] .picker-item-card').length, sentinelPresent: body.includes("picker cache storage probe CPU"), error: Boolean(document.querySelector('.fetch-error')) }; };
    const samples = [sample("before-delete")];
    localStorage.removeItem(${JSON.stringify(cacheKey)});
    dispatch(null);
    for (let index = 0; index < 12; index += 1) {
      await wait(25);
      samples.push(sample("after-delete-" + (index + 1)));
    }
    return { samples, final: samples.at(-1), storedAfterDelete: localStorage.getItem(${JSON.stringify(cacheKey)}) };
  })()`);
  const cleared = probe?.final?.sentinelPresent === false;
  console.log(JSON.stringify({ ok: cleared, probe }, null, 2));
  assert(cleared, "picker cache storage deletion did not remove the visible fallback: " + JSON.stringify(probe));
} finally {
  await client?.evaluate(`(() => {
    const original = window.__pickerCacheStorageSmokeFetch;
    if (original) window.fetch = original;
    delete window.__pickerCacheStorageSmokeFetch;
    localStorage.removeItem(${JSON.stringify(cacheKey)});
  })()`).catch(() => {});
  client?.close();
  signalProcessGroup(chrome, "SIGTERM");
  await sleep(500);
  signalProcessGroup(chrome, "SIGKILL");
  await rm(profileDir, { recursive: true, force: true });
}
