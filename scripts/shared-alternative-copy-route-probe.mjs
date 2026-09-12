import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-shared-alternative-copy-route-probe-"));
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
  await waitForValue(client, "location.pathname === '/'", "홈 화면");
  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const stamp = "2026-09-11T00:00:00.000Z";
    const snapshot = { schemaVersion: 1, kind: "pc-supporter.alternative-comparison-share", id: "shared-alt-copy-route", name: "공유 후보 복사 route probe", category: "GPU", createdAt: stamp, generatedAt: stamp, currentPartName: "현재 GPU", currentPartSummary: "현재 기준", currentPartPrice: "100,000원", candidates: [{ name: "후보 GPU", category: "gpu", partId: "gpu-rtx-5090", summary: "route probe candidate", price: "200,000원", similarity: "유사도 확인", performance: "성능 확인", compatibility: "호환 검사 필요", dataQuality: "seed", dataFreshness: "fresh" }], text: "shared alternative route probe" };
    let copyCalls = 0;
    try {
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
        if (requestUrl.pathname === "/api/comparisons/shared-alt-copy-route") return response(snapshot);
        if (requestUrl.pathname === "/api/parts/batch") return response({ items: [], missingIds: [] });
        return originalFetch(input, init);
      };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      history.pushState({}, "", "/compare/shared-alt-copy-route");
      window.dispatchEvent(new PopStateEvent("popstate"));
      for (let index = 0; index < 160 && ![...document.querySelectorAll("button")].some((button) => !button.disabled && (button.textContent ?? "").includes("비교 복사")); index += 1) await wait(25);
      const copy = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("비교 복사"));
      if (!(copy instanceof HTMLButtonElement)) return { stage: "missing-copy" };
      copy.click();
      for (let index = 0; index < 160 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      return { stage: "checked", copyCalls, path: location.pathname, home: document.querySelector(".home-page") !== null, comparison: document.querySelector(".shared-comparison-page") !== null, staleToast: Boolean(document.querySelector(".toast")) };
    } finally {
      window.fetch = originalFetch;
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.copyCalls !== 1 || result.path !== "/" || result.home !== true || result.comparison !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
