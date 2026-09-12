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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-assembly-sync-smoke-"));
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
    const id = 'assembly-sync-route-probe';
    const token = 'a'.repeat(48);
    const stamp = '2026-09-09T00:00:00.000Z';
    const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
    const preferences = { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 };
    const saved = { id, name: 'assembly sync route probe', selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, totalPriceWon: 0, priceComplete: true };
    const checked = { status: 'compatible', blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: 'general', scoreLabel: '균형형', scoreBasis: 'probe', confidence: 'high', factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 0, priceComplete: true, engineVersion: '2.58.0', catalogSnapshotAt: stamp, checkedAt: stamp };
    const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let syncCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (requestUrl.pathname === '/api/builds/' + id && method === 'GET') return response(saved);
      if (requestUrl.pathname === '/api/compatibility/check' && method === 'POST') return response(checked);
      if (requestUrl.pathname === '/api/builds/' + id + '/assembly-verification' && method === 'PUT') {
        syncCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 900));
        return response({ ...saved, checkHistory: [] });
      }
      return originalFetch(input, init);
    };
    const restore = () => {
      window.fetch = originalFetch;
      if (originalIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalIds);
      if (originalTokens === null) localStorage.removeItem('pc-supporter-saved-build-owner-tokens'); else localStorage.setItem('pc-supporter-saved-build-owner-tokens', originalTokens);
    };
    try {
      localStorage.setItem('pc-supporter-saved-build-owner-tokens', JSON.stringify({ [id]: token }));
      history.pushState({}, '', '/share/' + id);
      window.dispatchEvent(new PopStateEvent('popstate'));
      for (let index = 0; index < 120 && document.querySelector('[data-testid="assembly-verification-panel"]') === null; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      const syncButton = [...document.querySelectorAll('button')].find((button) => !button.disabled && (button.textContent ?? '').includes('저장 견적에 기록'));
      if (!(syncButton instanceof HTMLButtonElement)) return { stage: 'missing-sync-button', syncCalls, path: location.pathname, body: (document.body?.innerText ?? '').slice(-2000) };
      syncButton.click();
      for (let index = 0; index < 100 && syncCalls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const body = document.body?.innerText ?? '';
      return { stage: 'checked', syncCalls, path: location.pathname, home: document.querySelector('.home-page') !== null, staleToast: body.includes('실측 이력을 저장 견적의 읽기 전용 검사 이력에 기록했습니다.') };
    } finally {
      restore();
    }
  })()`);
  if (result?.stage !== "checked" || result.syncCalls !== 1 || result.path !== "/" || result.home !== true || result.staleToast !== false) {
    throw new Error("assembly verification sync route probe failed: " + JSON.stringify(result));
  }
  console.log(JSON.stringify({ ok: true, ...result }));
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
