import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CdpClient, firstAvailable, freePort, waitForJson, waitForValue, sleep } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-saved-build-metadata-smoke-"));
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
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeExited = false;
const chromeExit = new Promise((resolve) => chrome.once("exit", () => { chromeExited = true; resolve(); }));
let client;

try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForValue(client, "document.querySelector('.home-page') !== null", "PC Supporter 홈");

  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch.bind(window.fetch);
    const originalIds = localStorage.getItem('pc-supporter-saved-build-ids');
    const originalTokens = localStorage.getItem('pc-supporter-saved-build-owner-tokens');
    const originalSync = localStorage.getItem('pc-supporter-saved-build-metadata-sync');
    const id = 'saved-build-metadata-focused-probe';
    const token = 'f'.repeat(48);
    const stamp = '2026-09-09T00:00:00.000Z';
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const preferences = { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 };
    const before = { id, name: 'focused-metadata-before', selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, totalPriceWon: 100000, priceComplete: true };
    const after = { ...before, name: 'focused-metadata-after', updatedAt: '2026-09-09T00:01:00.000Z' };
    const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let patchCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.has('ids')) return response({ items: [before] });
      if (requestUrl.pathname === '/api/builds/' + id && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        patchCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 900));
        return response(after);
      }
      return originalFetch(input, init);
    };
    const restore = () => {
      window.fetch = originalFetch;
      if (originalIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalIds);
      if (originalTokens === null) localStorage.removeItem('pc-supporter-saved-build-owner-tokens'); else localStorage.setItem('pc-supporter-saved-build-owner-tokens', originalTokens);
      if (originalSync === null) localStorage.removeItem('pc-supporter-saved-build-metadata-sync'); else localStorage.setItem('pc-supporter-saved-build-metadata-sync', originalSync);
    };
    try {
      const serializedIds = JSON.stringify([id]);
      localStorage.setItem('pc-supporter-saved-build-ids', serializedIds);
      localStorage.setItem('pc-supporter-saved-build-owner-tokens', JSON.stringify({ [id]: token }));
      history.pushState({}, '', '/history');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: serializedIds, storageArea: localStorage }));
      for (let index = 0; index < 100 && !document.querySelector('[data-testid="saved-build-edit-metadata-' + id + '"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      const edit = document.querySelector('[data-testid="saved-build-edit-metadata-' + id + '"]');
      if (!(edit instanceof HTMLButtonElement)) return { stage: 'missing-edit', patchCalls, path: location.pathname };
      edit.click();
      for (let index = 0; index < 50 && !document.querySelector('#edit-saved-build-name'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      const input = document.querySelector('#edit-saved-build-name');
      const save = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('변경사항 저장'));
      if (!(input instanceof HTMLInputElement) || !(save instanceof HTMLButtonElement)) return { stage: 'missing-dialog', patchCalls, path: location.pathname };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'focused-metadata-after');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      save.click();
      for (let index = 0; index < 100 && patchCalls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return { stage: 'checked', patchCalls, path: location.pathname, home: document.querySelector('.home-page') !== null, syncChanged: localStorage.getItem('pc-supporter-saved-build-metadata-sync') !== originalSync };
    } finally {
      restore();
    }
  })()`);
  if (result?.stage !== "checked" || result.patchCalls !== 1 || result.path !== "/" || result.home !== true || result.syncChanged !== false) {
    throw new Error("saved-build metadata route probe failed: " + JSON.stringify(result));
  }
  const mutationResult = await client.evaluate(`(async () => {
    const originalFetch = window.fetch.bind(window.fetch);
    const originalConfirm = window.confirm;
    const originalIds = localStorage.getItem('pc-supporter-saved-build-ids');
    const originalTokens = localStorage.getItem('pc-supporter-saved-build-owner-tokens');
    const stamp = '2026-09-09T00:00:00.000Z';
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const preferences = { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 };
    const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const savedFor = (id, name) => ({ id, name, selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, totalPriceWon: 100000, priceComplete: true });
    const run = async (id, mode) => {
      const token = 'r'.repeat(48);
      const saved = savedFor(id, mode === 'record' ? 'focused-record-before' : 'focused-revoke-before');
      let calls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.has('ids')) return response({ items: [saved] });
        const mutationPath = mode === 'record' ? '/api/builds/' + id + '/check' : '/api/builds/' + id;
        if (requestUrl.pathname === mutationPath && (init?.method ?? 'GET').toUpperCase() === (mode === 'record' ? 'POST' : 'DELETE')) {
          calls += 1;
          await wait(900);
          return response(mode === 'record' ? { ...saved, checkHistory: [{ checkedAt: stamp, status: 'compatible', blockerCount: 0, warningCount: 0, unknownCount: 0 }] } : { ok: true });
        }
        return originalFetch(input, init);
      };
      const ids = JSON.stringify([id]);
      localStorage.setItem('pc-supporter-saved-build-ids', ids);
      localStorage.setItem('pc-supporter-saved-build-owner-tokens', JSON.stringify({ [id]: token }));
      history.pushState({}, '', '/history');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: ids, storageArea: localStorage }));
      for (let index = 0; index < 100 && !document.querySelector('.history-record-check-button, .history-revoke-button'); index += 1) await wait(25);
      const button = document.querySelector(mode === 'record' ? '.history-record-check-button' : '.history-revoke-button');
      if (!(button instanceof HTMLButtonElement)) return { stage: 'missing-button', mode, calls, path: location.pathname };
      if (mode === 'revoke') window.confirm = () => true;
      button.click();
      for (let index = 0; index < 100 && calls < 1; index += 1) await wait(25);
      history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await wait(1100);
      const body = document.body?.innerText ?? '';
      return { stage: 'checked', mode, calls, path: location.pathname, home: document.querySelector('.home-page') !== null, staleToast: mode === 'record' ? body.includes('현재 카탈로그 기준 검사 기록을 추가했습니다.') : body.includes('공유 견적 링크를 취소했습니다.') };
    };
    try {
      const record = await run('saved-build-record-focused-probe', 'record');
      const revoke = await run('saved-build-revoke-focused-probe', 'revoke');
      return { record, revoke };
    } finally {
      window.fetch = originalFetch;
      window.confirm = originalConfirm;
      if (originalIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalIds);
      if (originalTokens === null) localStorage.removeItem('pc-supporter-saved-build-owner-tokens'); else localStorage.setItem('pc-supporter-saved-build-owner-tokens', originalTokens);
    }
  })()`);
  const mutationValid = mutationResult?.record?.stage === 'checked' && mutationResult.record.calls === 1 && mutationResult.record.path === '/' && mutationResult.record.home === true && mutationResult.record.staleToast === false && mutationResult?.revoke?.stage === 'checked' && mutationResult.revoke.calls === 1 && mutationResult.revoke.path === '/' && mutationResult.revoke.home === true && mutationResult.revoke.staleToast === false;
  if (!mutationValid) throw new Error("saved-build record/revoke route probe failed: " + JSON.stringify(mutationResult));
  const refreshResult = await client.evaluate(`(async () => {
    const originalFetch = window.fetch.bind(window.fetch);
    const originalIds = localStorage.getItem('pc-supporter-saved-build-ids');
    const originalTokens = localStorage.getItem('pc-supporter-saved-build-owner-tokens');
    const stamp = '2026-09-09T00:00:00.000Z';
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const preferences = { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 };
    const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let calls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.has('ids')) {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 900));
        return response({ items: [{ id: 'saved-build-refresh-fresh', name: 'refresh-fresh', selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp }] });
      }
      return originalFetch(input, init);
    };
    const restore = () => {
      window.fetch = originalFetch;
      if (originalIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalIds);
      if (originalTokens === null) localStorage.removeItem('pc-supporter-saved-build-owner-tokens'); else localStorage.setItem('pc-supporter-saved-build-owner-tokens', originalTokens);
    };
    try {
      const serializedIds = JSON.stringify(['saved-build-refresh-stale']);
      localStorage.setItem('pc-supporter-saved-build-ids', serializedIds);
      window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: serializedIds, storageArea: localStorage }));
      for (let index = 0; index < 80 && calls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      history.pushState({}, '', '/catalog');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      let storedIds = [];
      try { storedIds = JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]'); } catch { storedIds = []; }
      return { stage: 'checked', calls, path: location.pathname, staleIdsPreserved: Array.isArray(storedIds) && storedIds.length === 1 && storedIds[0] === 'saved-build-refresh-stale' };
    } finally {
      restore();
    }
  })()`);
  if (refreshResult?.stage !== 'checked' || refreshResult.calls !== 1 || refreshResult.path !== '/catalog' || refreshResult.staleIdsPreserved !== true) throw new Error("saved-build read route probe failed: " + JSON.stringify(refreshResult));
  console.log(JSON.stringify({ ok: true, metadata: result, ...mutationResult, refresh: refreshResult }));
} finally {
  client?.close();
  if (!chromeExited) {
    chrome.kill("SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) {
      chrome.kill("SIGKILL");
      await Promise.race([chromeExit, sleep(1_000)]);
    }
  }
  await rm(profileDir, { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Top-level execution is intentionally handled by the awaited body above.
}
