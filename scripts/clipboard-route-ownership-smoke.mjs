import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, openResultDetails, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-clipboard-route-smoke-"));
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
], { detached: true, stdio: ["ignore", "ignore", "ignore"] });

let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "clipboard route smoke Chrome page");
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");

  await client.send("Page.navigate", { url: `${baseUrl}/accessories` });
  await waitForValue(client, "location.pathname === '/accessories' && document.querySelector('[data-testid=\"accessory-copy-filter-link\"]') !== null", "accessory copy route smoke page");
  const accessory = await client.evaluate(`(async () => {
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let copyCalls = 0;
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      const copy = document.querySelector('[data-testid="accessory-copy-filter-link"]');
      if (!(copy instanceof HTMLButtonElement)) return { stage: "missing-copy" };
      copy.click();
      for (let index = 0; index < 80 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return { stage: "checked", copyCalls, path: location.pathname, home: document.querySelector(".home-page") !== null, accessory: document.querySelector(".accessory-page") !== null, staleToast: body.includes("현재 주변 부품 검색 조건 링크") };
    } finally {
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  assert(accessory?.stage === "checked" && accessory.copyCalls === 1 && accessory.path === "/" && accessory.home === true && accessory.accessory === false && accessory.staleToast === false, "accessory 조건 링크 copy가 route 이탈 뒤 stale toast를 남겼습니다: " + JSON.stringify(accessory));

  await client.send("Page.navigate", { url: `${baseUrl}/recommend` });
  await waitForValue(client, "location.pathname === '/recommend' && document.querySelector('[data-testid=\"generator-copy-condition-link\"]') !== null", "generator copy route smoke page");
  const generator = await client.evaluate(`(async () => {
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let copyCalls = 0;
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      const copy = document.querySelector('[data-testid="generator-copy-condition-link"]');
      if (!(copy instanceof HTMLButtonElement)) return { stage: "missing-copy" };
      copy.click();
      for (let index = 0; index < 80 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return { stage: "checked", copyCalls, path: location.pathname, home: document.querySelector(".home-page") !== null, generator: document.querySelector(".generator-page") !== null, staleToast: body.includes("자동 구성 조건 링크") };
    } finally {
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  assert(generator?.stage === "checked" && generator.copyCalls === 1 && generator.path === "/" && generator.home === true && generator.generator === false && generator.staleToast === false, "generator 조건 링크 copy가 route 이탈 뒤 stale toast를 남겼습니다: " + JSON.stringify(generator));

  await client.send("Page.navigate", { url: `${baseUrl}/` });
  await waitForHomeDemoButtons(client, "result comparison copy smoke home");
  assert(await client.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('문제 있는 예시 견적')); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true; })()`), "result comparison copy smoke demo button not found");
  await waitForValue(client, "location.pathname === '/build' && document.querySelector('button.button-primary.full-width')?.disabled === false", "result comparison copy smoke editor");
  assert(await client.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('호환성 검사하기')); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true; })()`), "result comparison copy smoke check button not found");
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('[data-testid=\"result-findings\"]') !== null", "result comparison copy smoke result");
  await openResultDetails(client);
  await waitForValue(client, "[...document.querySelectorAll('.suggestions')].some((candidate) => candidate.querySelectorAll('.suggestion-compare-toggle').length >= 2)", "result comparison copy smoke suggestions");
  const selected = await client.evaluate(`(() => { const group = [...document.querySelectorAll('.suggestions')].find((candidate) => candidate.querySelectorAll('.suggestion-compare-toggle').length >= 2); if (!group) return 0; const buttons = [...group.querySelectorAll('.suggestion-compare-toggle')].slice(0, 2); buttons.forEach((button) => button.click()); return buttons.length; })()`);
  assert(selected >= 2, "result comparison copy smoke could not select two suggestions");
  await waitForValue(client, "document.querySelector('.suggestion-comparison') !== null", "result comparison copy smoke comparison");
  const resultComparison = await client.evaluate(`(async () => {
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let copyCalls = 0;
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      const copy = [...document.querySelectorAll('.suggestion-comparison button')].find((candidate) => (candidate.textContent ?? '').includes('비교 복사'));
      if (!(copy instanceof HTMLButtonElement)) return { stage: "missing-copy" };
      copy.click();
      for (let index = 0; index < 80 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return { stage: "checked", copyCalls, path: location.pathname, home: document.querySelector(".home-page") !== null, result: document.querySelector(".result-page") !== null, staleToast: body.includes("대체 부품 비교표를 클립보드에 복사했어요") || body.includes("대체 부품 비교표 복사에 실패했어요") };
    } finally {
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  assert(resultComparison?.stage === "checked" && resultComparison.copyCalls === 1 && resultComparison.path === "/" && resultComparison.home === true && resultComparison.result === false && resultComparison.staleToast === false, "결과 후보 비교 copy가 route 이탈 뒤 stale toast를 남겼습니다: " + JSON.stringify(resultComparison));

  await client.send("Page.navigate", { url: `${baseUrl}/result` });
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('[data-testid=\"purchase-checklist-copy\"]') !== null", "purchase checklist copy smoke panel");
  await openResultDetails(client);
  const checklist = await client.evaluate(`(async () => {
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let copyCalls = 0;
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      const copy = document.querySelector('[data-testid="purchase-checklist-copy"]');
      if (!(copy instanceof HTMLButtonElement) || copy.disabled) return { stage: "missing-copy", disabled: copy?.disabled ?? null };
      copy.click();
      for (let index = 0; index < 80 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return { stage: "checked", copyCalls, path: location.pathname, home: document.querySelector(".home-page") !== null, result: document.querySelector(".result-page") !== null, staleToast: body.includes("체크리스트를 클립보드에 복사했습니다") || body.includes("체크리스트 복사에 실패했습니다") };
    } finally {
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  assert(checklist?.stage === "checked" && checklist.copyCalls === 1 && checklist.path === "/" && checklist.home === true && checklist.result === false && checklist.staleToast === false, "구매 체크리스트 copy가 route 이탈 뒤 stale toast를 남겼습니다: " + JSON.stringify(checklist));
  console.log(JSON.stringify({ ok: true, accessory, generator, resultComparison, checklist }, null, 2));
} finally {
  client?.close();
  signalProcessGroup(chrome, "SIGTERM");
  await sleep(500);
  signalProcessGroup(chrome, "SIGKILL");
  await rm(profileDir, { recursive: true, force: true });
}
