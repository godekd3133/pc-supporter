import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = process.env.QUOTE_ONBOARDING_CAPTURE_DIR ?? join(process.cwd(), "artifacts", "quote-onboarding");
const timeoutMs = Number(process.env.QUOTE_ONBOARDING_CAPTURE_TIMEOUT_MS ?? 120_000);

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); } catch { /* The process group may already have exited. */ }
  }
  try { child.kill(signal); } catch { /* Cleanup is best effort. */ }
}

async function waitForValueWithTimeout(client, expression, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await client.evaluate(expression)) return;
    } catch {
      // A route transition can briefly destroy the current execution context.
    }
    await sleep(40);
  }
  const diagnostic = await client.evaluate("JSON.stringify({ href: location.href, body: (document.body?.innerText ?? '').slice(-1600) })").catch(() => "브라우저 상태를 읽지 못했습니다.");
  throw new Error(`${label}을(를) ${timeoutMs}ms 안에 확인하지 못했습니다. state=${diagnostic}`);
}

async function capture(client, filename) {
  await sleep(320);
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = join(outputDir, `${filename}.png`);
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

async function clickButton(client, text) {
  const clicked = await client.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((candidate) => !candidate.disabled && (candidate.textContent ?? "").replace(/\\s+/g, " ").includes(${JSON.stringify(text)})); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true; })()`);
  if (!clicked) throw new Error(`버튼을 찾지 못했습니다: ${text}`);
}

async function waitForTitle(client, title, label) {
  await waitForValueWithTimeout(client, `document.querySelector(".onboarding-title")?.textContent?.replace(/\\s+/g, " ").trim() === ${JSON.stringify(title)}`, label);
}

async function navigateToStart(client) {
  await client.evaluate("sessionStorage.clear(); history.pushState({}, '', '/start'); window.dispatchEvent(new PopStateEvent('popstate'));");
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "온보딩 시작 화면");
}

async function runFlow(client, { prefix, viewport }) {
  await client.send("Emulation.setDeviceMetricsOverride", viewport);
  await client.evaluate("sessionStorage.clear(); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));");
  await waitForValueWithTimeout(client, "location.pathname === '/' && document.querySelector('[data-testid=home-guided-entry]') !== null", "첫 사용자 홈 guided entry");
  const manifest = [];
  const record = async (id, label, route) => {
    const path = await capture(client, `${prefix}-${id}`);
    manifest.push({ id, label, route: route ?? await client.evaluate("location.pathname + location.search"), path });
  };

  await record("01-home-guided", "첫 사용자 홈 · START HERE");
  await navigateToStart(client);
  await record("02-start-intent", "시작 선택 · 새 견적 / 업그레이드 / 나중에");
  await clickButton(client, "새로운 견적을 맞추고 싶어요");
  await clickButton(client, "새 견적 시작하기");
  await waitForTitle(client, "새 견적은 어떤 방식으로 맞춰볼까요?", "새 견적 방식 화면");
  await record("03-new-quote", "새 견적 방식");
  await clickButton(client, "특정 작업이나 게임을 할 거예요");
  await clickButton(client, "다음");
  await waitForTitle(client, "무엇을 주로 할까요?", "용도 선택 화면");
  await record("04-usecase", "게임 또는 작업 선택");
  await clickButton(client, "게임");
  await clickButton(client, "다음");
  await waitForTitle(client, "어떤 게임을 할 건가요?", "게임 선택 화면");
  await clickButton(client, "사이버펑크 2077");
  await clickButton(client, "다음");
  await waitForTitle(client, "원하는 성능을 골라주세요", "성능 목표 화면");
  await record("05-game-performance", "게임 · 4K · 144 FPS 목표");
  await clickButton(client, "4K");
  await clickButton(client, "144 FPS");
  await clickButton(client, "다음");
  await waitForTitle(client, "게임 옵션도 정해주세요", "그래픽 옵션 화면");
  await clickButton(client, "높음");
  await clickButton(client, "DLSS·품질 참고");
  await record("06-graphics-contract", "그래픽 옵션 · PERFORMANCE CONTRACT");
  await clickButton(client, "다음 · 예산 정하기");
  await waitForTitle(client, "예산은 어디까지 생각하세요?", "예산 화면");
  await clickButton(client, "500만원");
  await waitForValueWithTimeout(client, "document.querySelector('.onboarding-budget-value')?.textContent?.trim() === '500만원'", "예산 500만원 선택");
  await record("07-budget-range", "예산 · 참고 가격대 · 예상 사양");
  await clickButton(client, "다음 · 조건 확인");
  await waitForTitle(client, "이 조건으로 맞춰볼까요?", "조건 요약 화면");
  await record("08-summary", "조건 요약 · 항목별 변경");
  await clickButton(client, "이 조건으로 견적 생성하기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "자동 구성 결과");
  await record("09-generator-result", "자동 구성 결과 · GAME PERFORMANCE EVIDENCE");
  return manifest;
}

async function runRepresentativeBranches(client, { prefix, viewport }) {
  await client.send("Emulation.setDeviceMetricsOverride", viewport);
  const branches = { work: [], budget: [], spec: [], upgrade: [], later: [] };
  const record = async (branch, id, label) => {
    const path = await capture(client, `${prefix}-${branch}-${id}`);
    branches[branch].push({ id, label, route: await client.evaluate("location.pathname + location.search"), path });
  };
  const startNewQuote = async () => {
    await navigateToStart(client);
    await clickButton(client, "새로운 견적을 맞추고 싶어요");
    await clickButton(client, "새 견적 시작하기");
    await waitForTitle(client, "새 견적은 어떤 방식으로 맞춰볼까요?", "새 견적 방식 화면");
  };

  await startNewQuote();
  await clickButton(client, "특정 작업이나 게임을 할 거예요");
  await clickButton(client, "다음");
  await waitForTitle(client, "무엇을 주로 할까요?", "작업 용도 화면");
  await clickButton(client, "작업");
  await clickButton(client, "다음");
  await waitForTitle(client, "주로 어떤 작업을 할 건가요?", "작업 선택 화면");
  await record("work", "01-work-select", "작업 선택");
  await clickButton(client, "영상 편집");
  await clickButton(client, "다음");
  await waitForTitle(client, "영상 편집을 어느 정도로 할까요?", "작업 강도 화면");
  await record("work", "02-intensity", "영상 편집 강도 · 구체적 예상 사양");
  await clickButton(client, "무겁게");
  await clickButton(client, "다음 · 예산 정하기");
  await waitForTitle(client, "예산은 어디까지 생각하세요?", "작업 예산 화면");
  await clickButton(client, "300만원");
  await record("work", "03-budget", "작업 예산 · 4K·6K · 64GB · 2TB");
  await clickButton(client, "다음 · 조건 확인");
  await waitForTitle(client, "이 조건으로 맞춰볼까요?", "작업 조건 요약");
  await record("work", "04-summary", "작업 조건 요약");
  await clickButton(client, "이 조건으로 견적 생성하기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "작업 자동 구성 결과");
  await record("work", "05-result", "작업 결과 · WORK TARGET");

  await startNewQuote();
  await clickButton(client, "예산으로 맞출래요");
  await clickButton(client, "다음");
  await waitForTitle(client, "예산은 어디까지 생각하세요?", "예산-only 화면");
  await clickButton(client, "400만원");
  await record("budget", "01-budget", "예산-only · 상급 일반 구성");
  await clickButton(client, "다음 · 조건 확인");
  await waitForTitle(client, "이 조건으로 맞춰볼까요?", "예산-only 요약");
  await record("budget", "02-summary", "예산-only 조건 요약");
  await clickButton(client, "이 조건으로 견적 생성하기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "예산-only 결과");
  await record("budget", "03-result", "예산-only 결과 · GENERAL TARGET");

  await startNewQuote();
  await clickButton(client, "생각해둔 성능이 있어요");
  await clickButton(client, "다음");
  await waitForTitle(client, "생각해둔 성능을 알려주세요", "직접 성능 화면");
  await record("spec", "01-spec", "직접 성능 · 최상급 · RAM · SSD");
  await clickButton(client, "최상급");
  await clickButton(client, "64GB");
  await clickButton(client, "2TB");
  await clickButton(client, "다음");
  await waitForTitle(client, "예산은 어디까지 생각하세요?", "직접 성능 예산 화면");
  await clickButton(client, "300만원");
  await clickButton(client, "다음 · 조건 확인");
  await waitForTitle(client, "이 조건으로 맞춰볼까요?", "직접 성능 요약");
  await record("spec", "02-summary", "직접 성능 조건 요약");
  await clickButton(client, "이 조건으로 견적 생성하기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "직접 성능 결과");
  await record("spec", "03-result", "직접 성능 결과 · GENERAL TARGET");

  await navigateToStart(client);
  await clickButton(client, "이미 가지고 있는 컴퓨터를 업그레이드하고 싶어요");
  await clickButton(client, "다음");
  await waitForValueWithTimeout(client, "document.querySelector('.onboarding-steps-list') !== null", "업그레이드 안내");
  await record("upgrade", "01-entry", "업그레이드 진입 안내");
  await clickButton(client, "현재 부품 고르기");
  await waitForValueWithTimeout(client, "location.pathname === '/build'", "업그레이드 편집기");
  await record("upgrade", "02-editor", "업그레이드 편집기");

  await navigateToStart(client);
  await clickButton(client, "나중에 할래요");
  await clickButton(client, "홈으로 돌아가기");
  await waitForValueWithTimeout(client, "location.pathname === '/' && document.querySelector('[data-testid=home-guided-entry]') !== null", "나중에 선택 후 홈");
  await record("later", "01-home", "나중에 선택 후 홈");
  return branches;
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

await mkdir(outputDir, { recursive: true });
const port = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-quote-onboarding-capture-"));
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
  `${baseUrl}/start`
], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
let chromeExited = false;
const chromeExit = new Promise((resolve) => chrome.once("exit", () => { chromeExited = true; resolve(); }));
let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "캡처 Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("캡처 Chrome target을 찾지 못했습니다.");
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "캡처 앱 초기화");
  const desktop = await runFlow(client, { prefix: "desktop", viewport: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false } });
  const desktopBranches = await runRepresentativeBranches(client, { prefix: "desktop", viewport: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false } });
  await client.evaluate("sessionStorage.clear()");
  await client.send("Page.navigate", { url: `${baseUrl}/start` });
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "모바일 캡처 앱 초기화");
  const mobile = await runFlow(client, { prefix: "mobile", viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } });
  const mobileBranches = await runRepresentativeBranches(client, { prefix: "mobile", viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } });
  const manifest = { generatedAt: new Date().toISOString(), baseUrl, desktopViewport: { width: 1280, height: 900 }, mobileViewport: { width: 390, height: 844 }, desktop, mobile, desktopBranches, mobileBranches };
  await writeFile(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ stage: "passed", outputDir, desktop: desktop.length, mobile: mobile.length, desktopBranches: Object.fromEntries(Object.entries(desktopBranches).map(([key, value]) => [key, value.length])), mobileBranches: Object.fromEntries(Object.entries(mobileBranches).map(([key, value]) => [key, value.length])) }));
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome, "SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
