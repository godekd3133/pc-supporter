import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";
const savedBuilds = JSON.parse(await readFile(new URL("../data/builds.json", import.meta.url), "utf8"));
const probeBuildId = savedBuilds.find((build) => typeof build?.id === "string")?.id;
if (!probeBuildId) throw new Error("data/builds.json에서 focused History probe용 저장 견적을 찾지 못했습니다.");

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-history-priority-probe-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `${baseUrl}/history`], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
let chromeExited = false;
const chromeExit = new Promise((resolve) => chrome.once("exit", () => { chromeExited = true; resolve(); }));
let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForValue(client, "location.pathname === '/history'", "저장 견적 이력 화면");
  await client.evaluate(`(() => { const ids = JSON.stringify([${JSON.stringify(probeBuildId)}]); localStorage.setItem('pc-supporter-saved-build-ids', ids); window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: ids, storageArea: localStorage })); })()`);
  await waitForValue(client, "document.querySelector('[data-testid^=\"saved-build-priority-row-\"]') !== null", "저장 견적 우선순위 행");
  const result = await client.evaluate(`(async () => {
    const row = document.querySelector('[data-testid^="saved-build-priority-row-"]');
    const testId = row?.getAttribute('data-testid') ?? '';
    const id = testId.replace('saved-build-priority-row-', '');
    const originalFetch = window.fetch;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    let compatibilityCalls = 0;
    let buildListCalls = 0;
    const currentPayload = await originalFetch('/api/builds?ids=' + encodeURIComponent(id)).then((res) => res.json());
    const currentBuild = currentPayload.items?.[0];
    if (!currentBuild) return { stage: 'missing-build', id };
    const updatedBuild = { ...currentBuild, updatedAt: new Date(Date.now() + 60_000).toISOString() };
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (requestUrl.pathname === '/api/compatibility/check' && (init?.method ?? 'GET').toUpperCase() === 'POST') {
        compatibilityCalls += 1;
        await wait(700);
        return originalFetch(input, init);
      }
      if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.get('ids') === id) {
        buildListCalls += 1;
        return response({ items: [updatedBuild] });
      }
      return originalFetch(input, init);
    };
    try {
      const action = [...document.querySelectorAll('button')].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? '').includes('다음 할 일 분석'));
      if (!(action instanceof HTMLButtonElement)) return { stage: 'missing-action', id, body: (document.body?.innerText ?? '').slice(-1800) };
      action.click();
      for (let index = 0; index < 80 && compatibilityCalls < 1; index += 1) await wait(25);
      if (compatibilityCalls < 1) return { stage: 'missing-compatibility-call', id, compatibilityCalls };
      const ids = localStorage.getItem('pc-supporter-saved-build-ids');
      window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: ids, storageArea: localStorage }));
      for (let index = 0; index < 100 && buildListCalls < 1; index += 1) await wait(25);
      await wait(900);
      const updatedRow = document.querySelector('[data-testid="saved-build-priority-row-' + id + '"]');
      return { stage: 'checked', id, compatibilityCalls, buildListCalls, updated: buildListCalls > 0, staleAction: Boolean(updatedRow?.querySelector('[data-testid="saved-build-priority-action-' + id + '"]')), actionText: updatedRow?.textContent?.slice(-1000) ?? '' };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== 'checked' || result.compatibilityCalls !== 1 || result.updated !== true || result.staleAction !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome, "SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
