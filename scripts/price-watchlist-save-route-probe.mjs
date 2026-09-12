import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, clickText, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
function signalProcessGroup(child, signal = "SIGTERM") {
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-price-watchlist-save-route-probe-"));
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
    source: `localStorage.setItem("pc-supporter-catalog-watchlist", ${JSON.stringify(JSON.stringify([{ itemId: "cpu-7500f", itemName: "AMD 라이젠5-5세대 7500F", category: "cpu", kind: "part", addedAt: "2026-09-11T00:00:00.000Z" }]))});`
  });
  await client.send("Page.navigate", { url: `${baseUrl}/watchlist` });
  await waitForValue(client, "location.pathname === '/watchlist'", "가격 추적 화면");
  await waitForValue(client, "[...document.querySelectorAll('button')].some((button) => !button.disabled && (button.textContent ?? '').includes('서버 저장·공유'))", "가격 추적 서버 저장 버튼");
  const result = await client.evaluate(`(async () => {
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let copyCalls = 0;
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      const save = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("서버 저장·공유"));
      if (!(save instanceof HTMLButtonElement)) return { stage: "missing-save" };
      save.click();
      for (let index = 0; index < 160 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return {
        stage: "checked",
        copyCalls,
        path: location.pathname,
        home: document.querySelector(".home-page") !== null,
        watchlist: document.querySelector(".price-watchlist-page") !== null,
        staleToast: Boolean(document.querySelector(".toast")),
        bodyTail: body.slice(-700)
      };
    } finally {
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.copyCalls !== 1 || result.path !== "/" || result.home !== true || result.watchlist !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
