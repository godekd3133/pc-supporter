import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";
function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch {}
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-alternative-share-route-probe-"));
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
  `${baseUrl}/catalog?category=cpu`
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
  await waitForValue(client, "location.pathname === '/catalog'", "카탈로그 화면");

  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const originalShares = localStorage.getItem("pc-supporter-alternative-comparison-shares");
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    const stamp = "2026-09-10T00:00:00.000Z";
    let shareCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/comparisons" && (init?.method ?? "GET").toUpperCase() === "POST") {
        shareCalls += 1;
        await wait(700);
        return response({ id: "alternative-route-share", name: "alternative route share", category: "CPU", candidates: [], currentPartName: "route probe baseline", currentPartSummary: "route probe", currentPartPrice: "100,000원", createdAt: stamp, updatedAt: stamp, ownerToken: "x".repeat(48) });
      }
      return originalFetch(input, init);
    };
    try {
      for (let index = 0; index < 160 && document.querySelectorAll(".catalog-part-compare").length < 2; index += 1) await wait(25);
      const compareButtons = [...document.querySelectorAll(".catalog-part-compare")].slice(0, 2);
      if (compareButtons.length < 2) return { stage: "missing-compare-buttons", shareCalls, body: (document.body?.innerText ?? "").slice(-2400) };
      compareButtons.forEach((button) => button.click());
      for (let index = 0; index < 120 && !(document.querySelector('[data-testid="catalog-compare-submit"]') instanceof HTMLButtonElement && document.querySelector('[data-testid="catalog-compare-submit"]')?.disabled === false); index += 1) await wait(25);
      const submit = document.querySelector('[data-testid="catalog-compare-submit"]');
      if (!(submit instanceof HTMLButtonElement) || submit.disabled) return { stage: "missing-compare-submit", shareCalls, body: (document.body?.innerText ?? "").slice(-2400) };
      submit.click();
      for (let index = 0; index < 160 && !document.querySelector('[data-testid="catalog-spec-comparison"]'); index += 1) await wait(25);
      const share = document.querySelector('[data-testid="catalog-comparison-share"]');
      if (!(share instanceof HTMLButtonElement)) return { stage: "missing-share", shareCalls, body: (document.body?.innerText ?? "").slice(-2400) };
      share.click();
      for (let index = 0; index < 80 && shareCalls < 1; index += 1) await wait(25);
      if (shareCalls < 1) return { stage: "missing-post", shareCalls };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const stored = localStorage.getItem("pc-supporter-alternative-comparison-shares") ?? "";
      const body = document.body?.innerText ?? "";
      return { stage: "checked", shareCalls, path: location.pathname, staleStored: stored.includes("alternative-route-share"), staleToast: body.includes("후보 비교 링크가 생성되었습니다") || body.includes("후보 비교 공유 링크를 클립보드") };
    } finally {
      window.fetch = originalFetch;
      if (originalShares === null) localStorage.removeItem("pc-supporter-alternative-comparison-shares");
      else localStorage.setItem("pc-supporter-alternative-comparison-shares", originalShares);
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.shareCalls !== 1 || result.path !== "/" || result.staleStored !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome, "SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
