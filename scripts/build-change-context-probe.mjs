import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, clickSelector, clickText, firstAvailable, freePort, openResultDetails, selectLabel, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
function signalProcessGroup(child, signal = "SIGTERM") { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } }
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-build-change-context-probe-"));
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
  await waitForHomeDemoButtons(client, "홈 화면");
  if (!(await clickText(client, "문제 있는 예시 견적"))) throw new Error("문제 있는 예시 견적 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/build'", "편집기");
  await selectLabel(client, "사용 목적", "gaming");
  await selectLabel(client, "게임 해상도", "1440p");
  await selectLabel(client, "목표 주사율", "144");
  const checkButton = await client.evaluate("(() => { const button = [...document.querySelectorAll('button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('호환성 검사하기')); button?.click(); return button instanceof HTMLButtonElement; })()");
  if (!checkButton) throw new Error("호환성 검사 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "결과 화면");
  await openResultDetails(client);
  await waitForValue(client, "document.querySelector('[data-testid=\"peripheral-recommendation-panel\"]') !== null && document.querySelector('.accessory-add-button:not([disabled])') !== null", "주변 부품 추천 후보");
  if ((await clickSelector(client, '.accessory-add-button:not([disabled])', 1)) !== 1) throw new Error("주변 부품 추천 후보를 추가하지 못했습니다.");
  await waitForValue(client, "[...document.querySelectorAll('.suggestions')].some((group) => group.querySelectorAll('.suggestion-compare-toggle').length >= 2 && group.querySelector('.suggestion-gpu-target-line'))", "후보 비교 가능 상태");

  const stages = [];
  const moduleProbe = async (label) => {
    const value = await client.evaluate(`(async () => { const timeout = new Promise((resolve) => setTimeout(() => resolve({ status: "timeout" }), 5000)); try { const module = await Promise.race([import('/src/BuildChangeDecisionDialog.tsx').then((value) => ({ status: "resolved", keys: Object.keys(value) })), timeout]); return module; } catch (error) { return { status: "error", message: error instanceof Error ? error.message : String(error) }; } })()`);
    stages.push({ label, module: value });
  };
  await moduleProbe("before-candidate-context");
  let selected = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await client.evaluate("document.querySelector('.suggestion-comparison') !== null")) === true) break;
    selected = await client.evaluate(`(async () => { const group = [...document.querySelectorAll('.suggestions')].find((candidate) => candidate.querySelectorAll('.suggestion-compare-toggle').length >= 2 && candidate.querySelector('.suggestion-gpu-target-line')); if (!group) return 0; const buttons = [...group.querySelectorAll('.suggestion-compare-toggle:not(.selected)')].slice(0, 2); for (const button of buttons) { button.click(); await new Promise((resolve) => setTimeout(resolve, 120)); } return buttons.length; })()`);
    if ((await client.evaluate("document.querySelector('.suggestion-comparison') !== null")) === true) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  stages.push({ label: "candidate-selected", selected });
  await waitForValue(client, "document.querySelector('.suggestion-comparison') !== null", "후보 비교표");
  const virtualCompareClicked = await clickText(client, "전체 미리 비교", ".suggestion-comparison button");
  stages.push({ label: "virtual-compare-click", virtualCompareClicked });
  if (!virtualCompareClicked) throw new Error("suggestion comparison virtual-compare button missing");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const firstDialog = await client.evaluate("({ dialog: Boolean(document.querySelector('.candidate-scenario-dialog')), loading: Boolean(document.querySelector('.candidate-scenario-dialog-loading')), errors: window.__pcSupporterSmokeErrors ?? [], resources: performance.getEntriesByType('resource').filter((entry) => /CandidateScenarioComparison|BuildChangeDecisionDialog/.test(entry.name)).map((entry) => entry.name) })");
  stages.push({ label: "candidate-dialog-first", firstDialog });
  if (firstDialog.dialog) {
    await clickSelector(client, '[aria-label="부품 미리 비교 닫기"]', 1);
    await waitForValue(client, "document.querySelector('.candidate-scenario-dialog') === null", "candidate dialog close");
    await clickText(client, "전체 미리 비교");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    stages.push({ label: "candidate-dialog-second", secondDialog: await client.evaluate("({ dialog: Boolean(document.querySelector('.candidate-scenario-dialog')), loading: Boolean(document.querySelector('.candidate-scenario-dialog-loading')) })") });
    await client.evaluate("(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); })()");
    await waitForHomeDemoButtons(client, "route home");
    await client.evaluate("history.back()");
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "route back result");
    await openResultDetails(client);
    await moduleProbe("after-route-back");
    const postBack = await client.evaluate("({ path: location.pathname, candidateDialog: Boolean(document.querySelector('.candidate-scenario-dialog')), applyButtons: document.querySelectorAll('.suggestion-card .suggestion-apply:not([disabled])').length, comparison: Boolean(document.querySelector('[data-testid=\"suggestion-comparison-benchmark\"]')) })");
    stages.push({ label: "after-route-back", postBack });
    const apply = await client.evaluate("(() => { const current = document.querySelector('.build-mini-list')?.textContent ?? ''; const card = [...document.querySelectorAll('.suggestion-card')].find((candidate) => { const button = candidate.querySelector('.suggestion-apply:not([disabled])'); const name = button?.getAttribute('aria-label')?.replace(/ 적용$/, '') ?? ''; return !(candidate.textContent ?? '').includes('적용하지 않음') && name && !current.includes(name) && button instanceof HTMLButtonElement; }); const button = card?.querySelector('.suggestion-apply:not([disabled])'); button?.click(); return { clicked: button instanceof HTMLButtonElement, name: button?.getAttribute('aria-label') ?? '' }; })()");
    stages.push({ label: "apply-click", apply });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    stages.push({ label: "after-apply-wait", ui: await client.evaluate("({ dialog: Boolean(document.querySelector('.build-change-dialog')), loading: Boolean(document.querySelector('[data-testid=\"build-change-dialog-loading\"]')), result: Boolean(document.querySelector('.result-page')), errors: window.__pcSupporterSmokeErrors ?? [], resources: performance.getEntriesByType('resource').filter((entry) => /BuildChangeDecisionDialog/.test(entry.name)).map((entry) => entry.name) })") });
  } else {
    process.exitCode = 1;
  }
  console.log(JSON.stringify({ ok: true, stages }, null, 2));
} finally {
  client?.close();
  if (!chromeExited) { signalProcessGroup(chrome); await Promise.race([chromeExit, sleep(2_000)]); if (!chromeExited) signalProcessGroup(chrome, "SIGKILL"); }
  await rm(profileDir, { recursive: true, force: true });
}
