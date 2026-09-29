import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, clickText, firstAvailable, freePort, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); } catch { /* The process group may already have exited. */ }
  }
  try { child.kill(signal); } catch { /* Best-effort cleanup for this test's browser. */ }
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-compatible-demo-smoke-"));
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
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "compatible demo smoke Chrome page");
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  const errorTracker = `(() => {
    const errors = [];
    const add = (kind, value) => { if (errors.length < 20) errors.push({ kind, message: String(value ?? '').slice(0, 900) }); };
    window.__compatibleDemoSmokeErrors = errors;
    console.error = (...args) => add('console.error', args.map((value) => value?.stack ?? String(value)).join(' '));
    window.addEventListener('error', (event) => add('error', event.error?.stack ?? event.message));
    window.addEventListener('unhandledrejection', (event) => add('unhandledrejection', event.reason?.stack ?? event.reason));
  })()`;
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: errorTracker });
  await client.evaluate(errorTracker);
  await waitForHomeDemoButtons(client, "compatible demo smoke home");
  assert(await clickText(client, "문제 없는 예시 견적"), "문제 없는 예시 견적 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/build' && document.querySelector('button.button-primary.full-width')?.disabled === false", "문제 없는 예시 견적 편집기");
  assert(await clickText(client, "호환 확인하기"), "문제 없는 예시 견적의 호환 확인 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/result' && (document.querySelector('[data-testid=\"result-findings\"]') !== null || document.querySelector('#app-error-title') !== null)", "문제 없는 예시 견적 결과 또는 오류 경계");
  await waitForValue(client, "(() => { try { return Array.isArray(JSON.parse(sessionStorage.getItem('pc-supporter-last-compatibility-result') ?? 'null')?.findings); } catch { return false; } })()", "문제 없는 예시 견적 호환 결과 데이터");
  await sleep(100);
  const result = await client.evaluate(`JSON.stringify({
    path: location.pathname,
    appError: document.querySelector('#app-error-title')?.textContent ?? null,
    findingsMounted: Boolean(document.querySelector('[data-testid="result-findings"]')),
    compatibility: (() => { try { const value = JSON.parse(sessionStorage.getItem('pc-supporter-last-compatibility-result') ?? 'null'); return value ? { status: value.status, blockerCount: value.blockerCount, warningCount: value.warningCount, unknownCount: value.unknownCount, findings: value.findings?.length, accessoryStatus: value.accessoryCompatibility?.status } : null; } catch { return null; } })(),
    body: (document.body?.innerText ?? '').slice(0, 900),
    errors: window.__compatibleDemoSmokeErrors ?? []
  })`);
  const probe = JSON.parse(result);
  assert(probe.appError === null && probe.findingsMounted, "문제 없는 예시 견적의 호환 확인이 결과 화면을 렌더링하지 못했습니다. probe=" + JSON.stringify(probe));
  assert(probe.compatibility?.status === "compatible" && probe.compatibility.blockerCount === 0 && probe.compatibility.warningCount === 0 && probe.compatibility.unknownCount === 0 && probe.compatibility.findings === 0 && (!probe.compatibility.accessoryStatus || probe.compatibility.accessoryStatus === "compatible"), "문제 없는 예시 견적에서 호환·주의·정보 부족 상태가 남았습니다. probe=" + JSON.stringify(probe.compatibility));
  await waitForValue(client, "document.querySelector('[data-testid=\"upgrade-bundle-panel\"]') !== null || document.querySelector('#app-error-title') !== null", "문제 없는 예시 견적 업그레이드 조합 패널");
  const bundlePreviewStarted = await client.evaluate(`(() => {
    const button = document.querySelector('.upgrade-bundle-card .upgrade-bundle-actions button.button-light');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert(bundlePreviewStarted, "문제 없는 예시 결과에서 업그레이드 조합 미리보기를 시작하지 못했습니다.");
  await waitForValue(client, "document.querySelector('[data-testid=\"upgrade-bundle-scenario-preview\"]') !== null || document.querySelector('#app-error-title') !== null", "문제 없는 예시 업그레이드 조합 미리보기");
  const preview = JSON.parse(await client.evaluate(`JSON.stringify({
    appError: document.querySelector('#app-error-title')?.textContent ?? null,
    previewMounted: Boolean(document.querySelector('[data-testid="upgrade-bundle-scenario-preview"]')),
    body: (document.body?.innerText ?? '').slice(-1200),
    errors: window.__compatibleDemoSmokeErrors ?? []
  })`));
  assert(preview.appError === null && preview.previewMounted, "업그레이드 조합 미리보기가 공개 compatibility payload를 렌더링하지 못했습니다. probe=" + JSON.stringify(preview));
  console.log(JSON.stringify({ ok: true, path: probe.path, findingsMounted: probe.findingsMounted, previewMounted: preview.previewMounted, body: probe.body }));
} finally {
  client?.close();
  signalProcessGroup(chrome, "SIGTERM");
  await sleep(250);
  signalProcessGroup(chrome, "SIGKILL");
  await rm(profileDir, { recursive: true, force: true });
}
