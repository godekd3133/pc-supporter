import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-cache-storage-smoke-"));
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
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused cache smoke Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForValue(client, `location.href.startsWith(${JSON.stringify(baseUrl)})`, "focused cache smoke page");
    await waitForHomeDemoButtons(client, "focused cache smoke home");
    await client.evaluate("(() => { const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('문제 있는 예시 견적')); button?.click(); })()");
    await waitForValue(client, "location.pathname === '/build' && ((document.body?.innerText ?? '').includes('내 견적 구성') || (document.body?.innerText ?? '').includes('견적 구성'))", "focused cache smoke build");
    await client.evaluate("(() => { const card = [...document.querySelectorAll('.component-card')].find((candidate) => candidate.querySelector('h3')?.textContent?.includes('CPU')); const button = card?.querySelector('.empty-selection button, .selected-lines > .text-button, .included-selection button'); button?.click(); })()");
    await waitForValue(client, "document.querySelector('[role=dialog] #picker-title') !== null", "focused cache smoke picker");
    await client.evaluate("document.querySelector('[role=dialog] button[aria-label=\"부품 선택 닫기\"]')?.click()");

    const pickerProbe = await client.evaluate(`(async () => {
      const key = "pc-supporter-catalog-picker-cache-v1";
      const originalCache = localStorage.getItem(key);
      const originalFetch = window.fetch;
      const storageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(storageKey, value) { if (storageKey === key) storageWrites.push(String(value).includes("focused picker cache item")); return originalSetItem.call(this, storageKey, value); };
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const cache = { schemaVersion: 1, cachedAt: "2026-09-10T00:00:00.000Z", items: [{ id: "focused-picker-cache-item", category: "cpu", name: "focused picker cache item", brand: "probe", model: "probe", source: "seed", listingType: "retail", dataQuality: "seed", missingFields: [], updatedAt: "2026-09-10T00:00:00.000Z", priceWon: 123000, specs: { socket: "AM5", memoryType: "DDR5" } }] };
      try {
        const card = [...document.querySelectorAll('.component-card')].find((candidate) => candidate.querySelector('h3')?.textContent?.includes('CPU'));
        const trigger = card?.querySelector('.empty-selection button, .selected-lines > .text-button, .included-selection button');
        if (!(trigger instanceof HTMLButtonElement)) return { stage: "missing-trigger" };
        window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href); if (requestUrl.pathname === "/api/parts") throw new TypeError("focused picker offline"); return originalFetch(input, init); };
        trigger.click();
        for (let index = 0; index < 100 && document.querySelector('[data-testid="picker-cached-fallback"]') === null; index += 1) await wait(25);
        const fallback = document.querySelector('[data-testid="picker-cached-fallback"]') !== null;
        const parsedCache = originalCache ? JSON.parse(originalCache) : { schemaVersion: 1, cachedAt: "2026-09-10T00:00:00.000Z", items: [] };
        const baseItem = Array.isArray(parsedCache.items) && parsedCache.items.length > 0 ? parsedCache.items[0] : cache.items[0];
        parsedCache.items = [...(Array.isArray(parsedCache.items) ? parsedCache.items : []), { ...baseItem, id: "focused-picker-cache-item", name: "focused picker cache item", priceWon: 1 }];
        const serializedCache = JSON.stringify(parsedCache);
        localStorage.setItem(key, serializedCache);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: serializedCache, storageArea: localStorage }));
        for (let index = 0; index < 100 && !(document.body?.innerText ?? "").includes("focused picker cache item"); index += 1) await wait(25);
        const sentinelVisible = (document.body?.innerText ?? "").includes("focused picker cache item");
        localStorage.removeItem(key);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: null, storageArea: localStorage }));
        for (let index = 0; index < 100 && (document.body?.innerText ?? "").includes("focused picker cache item"); index += 1) await wait(25);
        const sentinelCleared = !(document.body?.innerText ?? "").includes("focused picker cache item");
        return { stage: "checked", fallback, sentinelVisible, sentinelCleared, title: document.querySelector('#picker-title')?.textContent ?? "", query: document.querySelector('[role="dialog"] .search-box input')?.value ?? "", cacheHasSentinel: (localStorage.getItem(key) ?? "").includes("focused picker cache item"), cachedListText: document.querySelector('[data-testid="picker-cached-catalog-list"]')?.textContent?.slice(0, 600) ?? "", storageWrites: storageWrites.slice(-8) };
      } finally {
        Storage.prototype.setItem = originalSetItem;
        window.fetch = originalFetch;
        if (originalCache === null) localStorage.removeItem(key); else localStorage.setItem(key, originalCache);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: originalCache, storageArea: localStorage }));
        document.querySelector('[role="dialog"] button[aria-label="부품 선택 닫기"]')?.click();
        await wait(100);
      }
    })()`);
    assert(pickerProbe?.stage === "checked" && pickerProbe.fallback === true && pickerProbe.sentinelVisible === true && pickerProbe.sentinelCleared === true, "focused PartPicker cache storage probe failed: " + JSON.stringify(pickerProbe));

    await client.send("Page.navigate", { url: `${baseUrl}/accessories` });
    await waitForValue(client, "location.pathname === '/accessories' && document.querySelector('.accessory-list .accessory-item') !== null", "focused accessory cache list");
    const accessoryProbe = await client.evaluate(`(async () => {
      const key = "pc-supporter-accessory-catalog-cache-v1";
      const originalCache = localStorage.getItem(key);
      const originalFetch = window.fetch;
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      try {
        if (!originalCache) return { stage: "missing-cache" };
        window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href); if (requestUrl.pathname === "/api/accessories") throw new TypeError("focused accessory offline"); return originalFetch(input, init); };
        const input = document.querySelector('.accessory-search input');
        if (!(input instanceof HTMLInputElement)) return { stage: "missing-input" };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "focused cache");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        for (let index = 0; index < 100 && document.querySelector('[data-testid="accessory-cached-fallback"]') === null; index += 1) await wait(25);
        const fallback = document.querySelector('[data-testid="accessory-cached-fallback"]') !== null;
        const parsedCache = JSON.parse(originalCache);
        parsedCache.items = [...(Array.isArray(parsedCache.items) ? parsedCache.items : []), { ...(parsedCache.items?.[0] ?? {}), id: "focused-accessory-cache-item", name: "focused accessory cache item", category: "cooling_fan", rawSpecText: "focused cache probe", priceWon: 1 }];
        const serializedCache = JSON.stringify(parsedCache);
        localStorage.setItem(key, serializedCache);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: serializedCache, storageArea: localStorage }));
        await wait(100);
        const sentinelVisible = (document.body?.innerText ?? "").includes("focused accessory cache item");
        localStorage.removeItem(key);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: null, storageArea: localStorage }));
        for (let index = 0; index < 100 && (document.body?.innerText ?? "").includes("focused accessory cache item"); index += 1) await wait(25);
        const sentinelCleared = !(document.body?.innerText ?? "").includes("focused accessory cache item");
        return { stage: "checked", fallback, sentinelVisible, sentinelCleared };
      } finally {
        window.fetch = originalFetch;
        if (originalCache === null) localStorage.removeItem(key); else localStorage.setItem(key, originalCache);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: originalCache, storageArea: localStorage }));
        await wait(100);
      }
    })()`);
    assert(accessoryProbe?.stage === "checked" && accessoryProbe.sentinelVisible === true && accessoryProbe.sentinelCleared === true, "focused AccessoryView cache storage probe failed: " + JSON.stringify(accessoryProbe));
    console.log(JSON.stringify({ ok: true, pickerProbe, accessoryProbe }, null, 2));
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
