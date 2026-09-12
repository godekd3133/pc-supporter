import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, clickText, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
function signalProcessGroup(child, signal) { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } }
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-restore-history-route-probe-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank"], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
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
  const stamp = "2026-09-10T00:00:00.000Z";
  const build = { cpu: { partId: "cpu-7500f", quantity: 1 }, cooler: { partId: "cooler-small-am5", quantity: 1 }, motherboard: { partId: "mb-a620-small", quantity: 1 }, memory: [{ partId: "memory-ddr5-32-7200", quantity: 4 }], gpu: { partId: "gpu-rtx-5090", quantity: 1 }, ssd: [{ partId: "ssd-nvme-1tb", quantity: 4 }], hdd: [{ partId: "hdd-seagate-4tb", quantity: 4 }], case: { partId: "case-compact-matx", quantity: 1 }, psu: { partId: "psu-650w", quantity: 1 }, accessories: [], useIntegratedGraphics: false };
  const preferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144, budgetWon: 1500000 };
  const history = [{ id: "restore-history-route-probe", label: "route probe 이전 구성", snapshot: { build, recommendationPreferences: preferences }, changedAt: stamp }];
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `sessionStorage.setItem("pc-supporter-build-history", ${JSON.stringify(JSON.stringify(history))}); sessionStorage.removeItem("pc-supporter-last-compatibility-result"); sessionStorage.removeItem("pc-supporter-last-compatibility-input");` });
  await client.send("Page.navigate", { url: `${baseUrl}/build` });
  await waitForValue(client, "location.pathname === '/build'", "편집기 화면");
  await waitForValue(client, "document.querySelector('.change-history-panel') !== null", "견적 변경 이력");
  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let compatibilityCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/compatibility/check" && (init?.method ?? "GET").toUpperCase() === "POST") {
        compatibilityCalls += 1;
        await wait(700);
      }
      return originalFetch(input, init);
    };
    try {
      if (![...document.querySelectorAll("button")].some((button) => !button.disabled && (button.textContent ?? "").includes("이전 구성 복원"))) return { stage: "missing-restore" };
      const restore = [...document.querySelectorAll("button")].find((button) => !button.disabled && (button.textContent ?? "").includes("이전 구성 복원"));
      if (!(restore instanceof HTMLButtonElement)) return { stage: "missing-restore" };
      restore.click();
      for (let index = 0; index < 120 && compatibilityCalls < 1; index += 1) await wait(25);
      if (compatibilityCalls < 1) return { stage: "missing-check", compatibilityCalls };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return { stage: "checked", compatibilityCalls, path: location.pathname, home: document.querySelector('.home-page') !== null, editor: document.querySelector('.workspace-page') !== null, result: document.querySelector('.result-page') !== null, staleToast: body.includes("전 구성으로 복원하고 다시 검사") };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.compatibilityCalls !== 1 || result.path !== "/" || result.home !== true || result.editor !== false || result.result !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) { signalProcessGroup(chrome, "SIGTERM"); await Promise.race([chromeExit, sleep(2_000)]); if (!chromeExited) signalProcessGroup(chrome, "SIGKILL"); }
  await rm(profileDir, { recursive: true, force: true });
}
