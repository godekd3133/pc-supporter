import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, clickSelector, clickText, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
function signalProcessGroup(child) { if (!child.pid) return; try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} } }
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-accessory-add-route-probe-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `${baseUrl}/`], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
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
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await waitForValue(client, "location.pathname === '/'", "홈 화면");
  await waitForValue(client, "(document.body?.innerText ?? '').includes('오류 시연 견적')", "홈 컨텐츠");
  if (!(await clickText(client, "오류 시연 견적"))) throw new Error("오류 시연 견적 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/build' && (document.body?.innerText ?? '').includes('검사할 준비가 되었습니다.')", "시연 편집기");
  if ((await clickSelector(client, "button.button-primary.full-width", 1)) !== 1) throw new Error("호환성 검사 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "결과 화면");
  await waitForValue(client, "document.querySelector('[data-testid=\"peripheral-recommendation-panel\"]') !== null", "주변 부품 추천 패널");
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
      const buttons = [...document.querySelectorAll('.peripheral-recommendation-panel .accessory-add-button:not([disabled])')];
      const add = buttons[0];
      if (!(add instanceof HTMLButtonElement)) return { stage: "missing-add", compatibilityCalls };
      const itemName = add.closest('.peripheral-recommendation')?.querySelector('.peripheral-recommendation-copy strong')?.textContent?.trim() ?? "";
      add.click();
      for (let index = 0; index < 120 && compatibilityCalls < 1; index += 1) await wait(25);
      if (compatibilityCalls < 1) return { stage: "missing-check", compatibilityCalls, itemName };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return { stage: "checked", compatibilityCalls, itemName, path: location.pathname, home: document.querySelector('.home-page') !== null, editor: document.querySelector('.workspace-page') !== null, result: document.querySelector('.result-page') !== null, staleToast: itemName.length > 0 ? body.includes(itemName + "을 견적에 추가했습니다.") : body.includes("을 견적에 추가했습니다.") };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.compatibilityCalls !== 1 || result.path !== "/" || result.home !== true || result.editor !== false || result.result !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) { signalProcessGroup(chrome); await Promise.race([chromeExit, sleep(2_000)]); if (!chromeExited) { try { process.kill(-chrome.pid, "SIGKILL"); } catch {} } }
  await rm(profileDir, { recursive: true, force: true });
}
