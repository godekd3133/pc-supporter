import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const linkKey = "pc-supporter-saved-watchlist-link";
const tokenKey = "pc-supporter-saved-watchlist-owner-tokens";
const oldId = "watch-link-context-old";
const newId = "watch-link-context-new";
const oldToken = "o".repeat(48);
const newToken = "n".repeat(48);

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-price-watchlist-link-context-smoke-"));
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
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem(${JSON.stringify(linkKey)}, "[]"); localStorage.setItem(${JSON.stringify(tokenKey)}, ${JSON.stringify(JSON.stringify({ [oldId]: oldToken, [newId]: newToken }))});`
  });
  await client.send("Page.navigate", { url: `${baseUrl}/watchlist` });
  await waitForValue(client, "location.pathname === '/watchlist' && document.querySelector('.price-watchlist-page') !== null", "가격 추적 화면");

  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    const oldSerialized = JSON.stringify([{ id: ${JSON.stringify(oldId)}, name: "old watchlist", createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z" }]);
    const newSerialized = JSON.stringify([{ id: ${JSON.stringify(newId)}, name: "new watchlist", createdAt: "2026-09-11T00:01:00.000Z", updatedAt: "2026-09-11T00:01:00.000Z" }]);
    let oldCalls = 0;
    let newCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/watchlists/${oldId}" && (init?.method ?? "GET").toUpperCase() === "GET") {
        oldCalls += 1;
        await wait(700);
        return response({ error: "저장된 가격 목록을 찾을 수 없습니다." }, 404);
      }
      if (requestUrl.pathname === "/api/watchlists/${newId}" && (init?.method ?? "GET").toUpperCase() === "GET") {
        newCalls += 1;
        return response({ id: ${JSON.stringify(newId)}, name: "new watchlist", entries: [], nearLowThresholdPercent: 10, createdAt: "2026-09-11T00:01:00.000Z", updatedAt: "2026-09-11T00:01:00.000Z" });
      }
      return originalFetch(input, init);
    };
    const dispatch = (key, value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
    try {
      localStorage.setItem(${JSON.stringify(linkKey)}, oldSerialized);
      dispatch(${JSON.stringify(linkKey)}, oldSerialized);
      for (let index = 0; index < 120 && oldCalls < 1; index += 1) await wait(25);
      if (oldCalls < 1) return { stage: "missing-old-request", oldCalls, newCalls };
      localStorage.setItem(${JSON.stringify(linkKey)}, newSerialized);
      dispatch(${JSON.stringify(linkKey)}, newSerialized);
      for (let index = 0; index < 120 && newCalls < 1; index += 1) await wait(25);
      await wait(900);
      const tokens = JSON.parse(localStorage.getItem(${JSON.stringify(tokenKey)}) ?? "{}");
      return { stage: "checked", oldCalls, newCalls, oldTokenPreserved: tokens[${JSON.stringify(oldId)}] === ${JSON.stringify(oldToken)}, newTokenPreserved: tokens[${JSON.stringify(newId)}] === ${JSON.stringify(newToken)}, linkRaw: localStorage.getItem(${JSON.stringify(linkKey)}) };
    } finally {
      window.fetch = originalFetch;
      localStorage.setItem(${JSON.stringify(linkKey)}, oldSerialized);
      dispatch(${JSON.stringify(linkKey)}, oldSerialized);
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.oldCalls < 1 || result.newCalls < 1 || result.oldTokenPreserved !== true || result.newTokenPreserved !== true) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome, "SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
