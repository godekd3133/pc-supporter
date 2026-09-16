import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, clickText, firstAvailable, freePort, openResultDetails, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The process group may already have exited.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Cleanup is best effort.
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-purchase-list-context-smoke-"));
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
], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore"] });

let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "purchase list context smoke Chrome page");
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForHomeDemoButtons(client, "purchase list context smoke home");
  assert(await clickText(client, "문제 있는 예시 견적"), "purchase list context smoke demo button not found");
  await waitForValue(client, "location.pathname === '/build' && document.querySelector('button.button-primary.full-width')?.disabled === false", "purchase list context smoke editor");
  assert(await clickText(client, "호환성 검사하기"), "purchase list context smoke check button not found");
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('[data-testid=\"result-findings\"]') !== null", "purchase list context smoke result");
  await openResultDetails(client);
  await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-panel\"]') !== null || [...document.querySelectorAll('button')].some((button) => (button.textContent ?? '').includes('구매 목록'))", "purchase list context smoke purchase list mount");
  const mounted = await client.evaluate(`(() => {
    const button = document.querySelector('[data-testid="purchase-list-live-price-refresh"]');
    if (button instanceof HTMLButtonElement) return true;
    const quick = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('구매 목록'));
    if (!(quick instanceof HTMLButtonElement)) return false;
    quick.click();
    return true;
  })()`);
  assert(mounted, "purchase list context smoke could not mount the purchase list");
  await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-live-price-refresh\"]') !== null", "purchase list context smoke live price button");

  const probe = await client.evaluate(`(async () => {
    const button = document.querySelector('[data-testid="purchase-list-live-price-refresh"]');
    const priority = document.querySelector('[data-testid="recommendation-priority"]');
    if (!(button instanceof HTMLButtonElement) || !(priority instanceof HTMLSelectElement) || button.disabled) return { stage: "missing-controls", button: Boolean(button), priority: Boolean(priority), buttonDisabled: button?.disabled ?? null };
    const originalFetch = window.fetch;
    let delayedCalls = 0;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (/^\\/api\\/(parts|accessories)\\/[^/]+(?:\\/refresh)?$/.test(requestUrl.pathname)) {
        delayedCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      return originalFetch(input, init);
    };
    try {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 75));
      const nextPriority = priority.value === "reliability" ? "balanced" : "reliability";
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(priority, nextPriority);
      priority.dispatchEvent(new Event("change", { bubbles: true }));
      const samples = [];
      for (let index = 0; index < 120; index += 1) {
        const currentButton = document.querySelector('[data-testid="purchase-list-live-price-refresh"]');
        const result = document.querySelector('.result-page');
        samples.push({ index, delayedCalls, priority: priority.value, buttonDisabled: currentButton instanceof HTMLButtonElement ? currentButton.disabled : null, bodyChecking: (document.body?.innerText ?? "").includes("검사 중") || (document.body?.innerText ?? "").includes("검사 준비 중"), result: Boolean(result) });
        if (delayedCalls > 0 && currentButton instanceof HTMLButtonElement && !currentButton.disabled) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { stage: "checked", delayedCalls, samples, final: samples.at(-1) };
    } finally {
      window.fetch = originalFetch;
      await new Promise((resolve) => setTimeout(resolve, 2_100));
    }
  })()`);
  const enabledBeforeDelayedResponse = probe?.final?.buttonDisabled === false;
  console.log(JSON.stringify({ ok: enabledBeforeDelayedResponse, enabledBeforeDelayedResponse, probe }, null, 2));
  assert(enabledBeforeDelayedResponse, "purchase list remained locked after input context changed: " + JSON.stringify(probe));
} finally {
  client?.close();
  signalProcessGroup(chrome, "SIGTERM");
  await sleep(500);
  signalProcessGroup(chrome, "SIGKILL");
  await rm(profileDir, { recursive: true, force: true });
}
