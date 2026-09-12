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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-browser-notification-route-probe-"));
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
  const stamp = "2026-09-11T00:00:00.000Z";
  const buildId = "browser-notification-route-probe";
  const savedBuild = {
    id: buildId,
    name: "알림 route probe 견적",
    selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false },
    recommendationPreferences: { profile: "gaming", priority: "balanced", budgetWon: 1500000, listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 },
    createdAt: stamp,
    updatedAt: stamp
  };
  const snapshot = {
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    totalPriceWon: 0,
    priceComplete: true,
    coreTotalPriceWon: 0,
    corePriceComplete: true,
    accessoryTotalPriceWon: 0,
    accessoryPriceComplete: true,
    findings: [],
    analysisScore: 80,
    analysisScoreLabel: "균형형",
    analysisConfidence: "high",
    resourceBudget: { state: "good", powerState: "good", coolingState: "good" },
    engineVersion: "2.58.0",
    catalogSnapshotAt: stamp,
    checkedAt: stamp
  };
  const probeScript = `
    (() => {
      const buildId = ${JSON.stringify(buildId)};
      const savedBuild = ${JSON.stringify(savedBuild)};
      const snapshot = ${JSON.stringify(snapshot)};
      localStorage.setItem("pc-supporter-saved-build-ids", JSON.stringify([buildId]));
      let permissionCalls = 0;
      const permission = { get calls() { return permissionCalls; }, run: async () => { permissionCalls += 1; await new Promise((resolve) => setTimeout(resolve, 700)); return "granted"; } };
      window.__browserNotificationRouteProbe = permission;
      Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: permission.run } });
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        const response = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
        if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) return response({ items: [savedBuild] });
        if (requestUrl.pathname === "/api/builds/check-preview") return response({ requestedCount: 1, checkedCount: 1, checkedAt: ${JSON.stringify(stamp)}, items: [{ id: buildId, status: "ready", snapshot }] });
        return originalFetch(input, init);
      };
    })();
  `;
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: probeScript });
  await client.send("Page.navigate", { url: `${baseUrl}/history` });
  await waitForValue(client, "location.pathname === '/history' && [...document.querySelectorAll('button')].some((button) => !button.disabled && (button.textContent ?? '').includes('브라우저 알림 허용'))", "저장 견적 브라우저 알림 버튼");
  await client.evaluate("new Promise((resolve) => setTimeout(resolve, 3800))");
  const result = await client.evaluate(`(async () => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const allow = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("브라우저 알림 허용"));
    if (!(allow instanceof HTMLButtonElement)) return { stage: "missing-button" };
    allow.click();
    for (let index = 0; index < 80 && (window.__browserNotificationRouteProbe?.calls ?? 0) < 1; index += 1) await wait(25);
    if ((window.__browserNotificationRouteProbe?.calls ?? 0) < 1) return { stage: "missing-permission-call" };
    history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await wait(950);
    const body = document.body?.innerText ?? "";
    return { stage: "checked", permissionCalls: window.__browserNotificationRouteProbe?.calls ?? 0, path: location.pathname, home: document.querySelector(".home-page") !== null, history: document.querySelector(".history-page") !== null, toastText: document.querySelector(".toast")?.textContent ?? "", bodyTail: body.slice(-900), staleToast: Boolean(document.querySelector(".toast")) };
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.permissionCalls !== 1 || result.path !== "/" || result.home !== true || result.history !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
