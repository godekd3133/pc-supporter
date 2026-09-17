import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BROWSER_ROUTE_HISTORY_FLOW_IDS, BROWSER_ROUTE_HISTORY_MANIFEST } from "./browser-route-history-manifest.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const timeoutMs = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS ?? 120_000);
const evaluateTimeoutMs = Number(process.env.BROWSER_SMOKE_EVALUATE_TIMEOUT_MS ?? 30_000);
const adminPassword = process.env.BROWSER_SMOKE_ADMIN_PASSWORD;

function assertRouteHistoryManifest() {
  assert(BROWSER_ROUTE_HISTORY_MANIFEST.length === 6, "브라우저 route-history manifest 항목 수가 예상과 다릅니다.");
  assert(new Set(BROWSER_ROUTE_HISTORY_FLOW_IDS).size === BROWSER_ROUTE_HISTORY_FLOW_IDS.length && BROWSER_ROUTE_HISTORY_FLOW_IDS.every((id) => typeof id === "string" && id.length > 0), "브라우저 route-history manifest ID가 유효하지 않습니다.");
}

const executedRouteHistoryFlowIds = new Set();

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The process group may already have exited; fall back to the direct child.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Cleanup must remain best effort after an assertion failure.
  }
}

function recordRouteHistoryFlow(id) {
  executedRouteHistoryFlowIds.add(id);
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("브라우저 smoke test용 포트를 확보하지 못했습니다.");
  return port;
}

export async function firstAvailable(paths) {
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Try the next known browser location.
    }
  }
  return undefined;
}

export class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = undefined;
    this.evaluateTimeoutMs = evaluateTimeoutMs;
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "Chrome DevTools Protocol 요청에 실패했습니다."));
      else pending.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Chrome CDP WebSocket 연결에 실패했습니다.")), { once: true });
    });
  }

  async send(method, params = {}, requestTimeoutMs = 0) {
    if (!this.socket) throw new Error("CDP 연결이 시작되지 않았습니다.");
    const id = this.nextId++;
    let timer;
    const result = new Promise((resolve, reject) => {
      const settle = (callback) => (value) => {
        if (timer) clearTimeout(timer);
        callback(value);
      };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      if (requestTimeoutMs > 0) {
        timer = setTimeout(() => {
        this.pending.delete(id);
          reject(new Error(`Chrome CDP ${method} timed out after ${requestTimeoutMs}ms${method === "Runtime.evaluate" ? ` expression=${String(params.expression ?? "").slice(0, 180)}` : ""}`));
        }, requestTimeoutMs);
      }
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, this.evaluateTimeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "브라우저 JavaScript 평가에 실패했습니다.");
    }
    return result.result?.value;
  }

  close() {
    this.socket?.close();
  }
}

export async function waitForJson(url, predicate, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        if (predicate(value)) return value;
      }
    } catch {
      // The browser or dev server may still be starting.
    }
    await sleep(100);
  }
  throw new Error(`${label}을(를) ${timeoutMs}ms 안에 확인하지 못했습니다.`);
}

export function isTransientNavigationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id|No execution context with given id|Target page, context or browser has been closed/i.test(message);
}

export function isTransientEvaluationTimeout(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Chrome CDP Runtime\.evaluate timed out/i.test(message);
}

export async function waitForValue(client, expression, label) {
  const startedAt = Date.now();
  let lastNavigationError;
  let lastEvaluationTimeout;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await client.evaluate(expression)) return;
    } catch (error) {
      if (isTransientEvaluationTimeout(error)) {
        lastEvaluationTimeout = error;
        await sleep(100);
        continue;
      }
      if (!isTransientNavigationError(error)) {
        throw new Error(label + " 단계에서 브라우저 target이 끊겼습니다: " + (error instanceof Error ? error.message : String(error)));
      }
      lastNavigationError = error;
    }
    await sleep(100);
  }
  if (lastNavigationError) {
    throw new Error(label + " 단계에서 브라우저 navigation이 안정화되지 않았습니다: " + (lastNavigationError instanceof Error ? lastNavigationError.message : String(lastNavigationError)));
  }
  let diagnostic = "";
  try {
    diagnostic = await client.evaluate("JSON.stringify({ href: location.href, title: document.title, body: (document.body?.innerText ?? '').slice(-1800) })");
  } catch {
    diagnostic = "브라우저 상태를 읽지 못했습니다.";
  }
  const timeoutDetail = lastEvaluationTimeout ? ` last-evaluation=${lastEvaluationTimeout.message}` : "";
  throw new Error(`${label}을(를) ${timeoutMs}ms 안에 확인하지 못했습니다.${timeoutDetail} state=${diagnostic}`);
}

export async function browserApiJson(client, origin, path) {
  const cookieResult = await Promise.race([
    client.send("Network.getAllCookies"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Network.getAllCookies timed out")), evaluateTimeoutMs))
  ]).catch(() => undefined);
  const cookies = cookieResult?.cookies?.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const response = await fetch(`${origin}${path}`, { headers: cookies ? { Cookie: cookies } : undefined });
  const body = await response.json().catch(() => ({}));
  return response.ok ? body : { status: response.status, body };
}

export async function clickText(client, text, selector = "button") {
  return client.evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) => !candidate.disabled && (candidate.textContent ?? "").includes(${JSON.stringify(text)})); if (!node) return false; node.click(); return true; })()`);
}

export async function clickSelector(client, selector, count = 1) {
  return client.evaluate(`(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((node) => !node.disabled); nodes.slice(0, ${count}).forEach((node) => node.click()); return Math.min(nodes.length, ${count}); })()`);
}

export async function openDetails(client, selector, label = "펼침 대상") {
  await waitForValue(client, `document.querySelector(${JSON.stringify(selector)}) !== null`, label);
  return client.evaluate(`(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((node) => node instanceof HTMLDetailsElement); let opened = 0; for (const node of nodes) { if (!node.open) { node.open = true; opened += 1; } } return opened; })()`);
}

export async function waitForHomeDemoButtons(client, label = "홈 화면") {
  await waitForValue(client, "location.pathname === '/' && (document.body?.innerText ?? '').includes('예시 구성 보기')", label);
  await openDetails(client, "details.hero-demo-tools, details.mobile-demo-tools, details.home-secondary-details", `${label} 예시 구성 도구`);
  await waitForValue(client, "(document.body?.innerText ?? '').includes('문제 있는 예시 견적')", `${label} 예시 견적 버튼`);
}

export async function openResultDetails(client) {
  return openDetails(client, "details.result-quick-nav-disclosure, details.result-more-details, details.result-assembly-details, details.result-more-tools, details.mobile-result-tools", "결과 상세 펼침");
}

export async function openHistoryDetails(client) {
  await waitForValue(client, "location.pathname === '/history' && document.querySelector('.history-details-toggle') !== null", "저장 견적 이력 화면");
  await client.evaluate("(() => { const toggle = document.querySelector('.history-details-toggle'); if (toggle instanceof HTMLButtonElement && toggle.getAttribute('aria-expanded') === 'false') toggle.click(); return true; })()");
  await waitForValue(client, "document.querySelector('.history-page.history-details-open') !== null", "저장 견적 점검·비교 상세 펼침");
}

export async function setInputValue(client, selector, value) {
  return client.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return input.value === ${JSON.stringify(value)}; })()`);
}

export async function setTextValue(client, selector, value) {
  return client.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!(input instanceof HTMLTextAreaElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return input.value === ${JSON.stringify(value)}; })()`);
}

export async function setFileInput(client, selector, filePath) {
  await client.send("DOM.enable");
  const document = await client.send("DOM.getDocument", { depth: -1 });
  const node = await client.send("DOM.querySelector", { nodeId: document.root.nodeId, selector });
  if (!node.nodeId) return false;
  await client.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [filePath] });
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event("change", { bubbles: true }))`);
  return true;
}

export async function selectLabel(client, labelText, value) {
  return client.evaluate(`(() => { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; for (const label of [...document.querySelectorAll("label")]) { if (!(label.textContent ?? "").includes(${JSON.stringify(labelText)})) continue; const select = label.querySelector("select"); if (!select || ![...select.options].some((option) => option.value === ${JSON.stringify(value)})) continue; setter?.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event("change", { bubbles: true })); return select.value === ${JSON.stringify(value)}; } return false; })()`);
}

export async function pressKey(client, key, code = key, keyCode) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, ...(keyCode ? { windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode } : {}) });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, ...(keyCode ? { windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode } : {}) });
}

export async function goBack(client) {
  const history = await client.send("Page.getNavigationHistory");
  const previous = history.entries?.[history.currentIndex - 1];
  if (!previous) throw new Error("브라우저 navigation history에서 이전 항목을 찾지 못했습니다.");
  await client.send("Page.navigateToHistoryEntry", { entryId: previous.id });
}

export async function bodyText(client) {
  return client.evaluate("document.body?.innerText ?? \"\"");
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assertRouteHistoryManifest();
  const healthResponse = await fetch(`${baseUrl}/api/health`).catch(() => undefined);
  if (!healthResponse?.ok) {
    throw new Error(`개발 서버가 실행 중이지 않습니다. ${baseUrl}에서 npm run dev를 먼저 실행해 주세요.`);
  }
  const metaResponse = await fetch(`${baseUrl}/api/meta`).catch(() => undefined);
  const metaPayload = metaResponse?.ok ? await metaResponse.json() : undefined;
  assert(Array.isArray(metaPayload?.catalogSpecCoverage?.categories) && metaPayload.catalogSpecCoverage.categories.length === 9 && typeof metaPayload?.catalogSpecCoverage?.pcieSlotCoverage?.byRequiredWidth?.[4]?.missing === 'number', "카탈로그 스펙 coverage 메타데이터가 없습니다.");
  const catalogProbeResponse = await fetch(`${baseUrl}/api/parts?category=cpu&limit=1`).catch(() => undefined);
  const catalogProbePayload = catalogProbeResponse?.ok ? await catalogProbeResponse.json() : undefined;
  assert(catalogProbeResponse?.ok && Array.isArray(catalogProbePayload?.items) && catalogProbePayload.items.length > 0, "부품 목록 API proxy가 응답하지 않습니다.");
  const benchmarkProbeResponse = await fetch(`${baseUrl}/api/parts?category=cpu&benchmarkStatus=incomplete&limit=1`).catch(() => undefined);
  const benchmarkProbePayload = benchmarkProbeResponse?.ok ? await benchmarkProbeResponse.json() : undefined;
  assert(benchmarkProbeResponse?.ok && benchmarkProbePayload?.benchmarkStatus === "incomplete" && typeof benchmarkProbePayload?.benchmarkExcludedCount === "number", "벤치마크 근거 필터 API가 응답하지 않습니다.");

  const chromePath = await firstAvailable([
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean));
  if (!chromePath) throw new Error("Chrome 또는 Chromium 실행 파일을 찾지 못했습니다. CHROME_BIN으로 경로를 지정해 주세요.");

  const port = await freePort();
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-browser-smoke-"));
  const watchlistImportFile = join(profileDir, "price-watchlist-import.json");
  await writeFile(watchlistImportFile, JSON.stringify({ type: "pc-supporter-catalog-watchlist", version: 1, exportedAt: new Date().toISOString(), filters: { nearLowThresholdPercent: 20 }, items: [{ entry: { itemId: "cpu-7800x3d", itemName: "AMD 라이젠7-5세대 7800X3D", category: "cpu", kind: "part", addedAt: new Date().toISOString(), targetPriceWon: 123456 }, currentDataStatus: "price_unavailable", sampleCount: 0, signals: [] }] }));
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
    const page = await waitForJson(`http://127.0.0.1:${port}/json/list`, (pages) => Array.isArray(pages) && pages.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
    const pageTarget = page.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.evaluate(`(() => {
      const errors = [];
      const add = (kind, value) => { if (errors.length < 20) errors.push({ kind, message: String(value ?? '').slice(0, 600) }); };
      window.__pcSupporterSmokeErrors = errors;
      console.error = (...args) => add('console.error', args.map((value) => value?.stack ?? String(value)).join(' '));
      window.addEventListener('error', (event) => add('error', event.error?.stack ?? event.message));
      window.addEventListener('unhandledrejection', (event) => add('unhandledrejection', event.reason?.stack ?? event.reason));
    })()`);
    await waitForValue(client, `location.href.startsWith(${JSON.stringify(baseUrl)})`, "PC Supporter 페이지");
    await waitForHomeDemoButtons(client, "홈 화면");
    await waitForValue(client, "document.querySelector('[data-testid=\"home-data-trust-open-incomplete\"]')?.getAttribute('href') === '/catalog?quality=incomplete'", "홈 데이터 신뢰도 스펙 부족 이동");
    assert((await clickSelector(client, '[data-testid="home-data-trust-open-incomplete"]', 1)) === 1, "홈 데이터 신뢰도 스펙 부족 목록 링크를 클릭하지 못했습니다.");
    await waitForValue(client, `location.href === ${JSON.stringify(`${baseUrl}/catalog?quality=incomplete`)}`, "홈 데이터 신뢰도 스펙 부족 목록 이동");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filters\"]') !== null && new URLSearchParams(location.search).get('quality') === 'incomplete'", "홈 데이터 신뢰도 필터 적용");

    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await waitForHomeDemoButtons(client, "홈 데이터 신뢰도 성능 근거 링크 준비");
    await waitForValue(client, "document.querySelector('[data-testid=\"home-data-trust-open-cpu-benchmark\"]')?.getAttribute('href') === '/catalog?category=cpu&benchmarkStatus=incomplete'", "홈 데이터 신뢰도 CPU 성능 근거 이동");
    assert((await clickSelector(client, '[data-testid="home-data-trust-open-cpu-benchmark"]', 1)) === 1, "홈 데이터 신뢰도 CPU 성능 근거 링크를 클릭하지 못했습니다.");
    await waitForValue(client, `location.href === ${JSON.stringify(`${baseUrl}/catalog?category=cpu&benchmarkStatus=incomplete`)}`, "홈 데이터 신뢰도 CPU 성능 근거 목록 이동");
    await waitForValue(client, "document.querySelector('[aria-label=\"카탈로그 성능 근거 상태\"]')?.value === 'incomplete' && document.querySelector('[data-testid=\"catalog-benchmark-filter-summary\"]') !== null && new URLSearchParams(location.search).get('benchmarkStatus') === 'incomplete'", "홈 데이터 신뢰도 CPU 성능 근거 필터 적용");

    await client.send("Page.navigate", { url: `${baseUrl}/recommend` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('조건으로 PC 견적 만들기')", "자동 구성 화면");
    assert(await selectLabel(client, "구성 우선순위", "reliability"), "자동 구성의 안심 우선 기준을 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-priority\"]')?.value === 'reliability' && document.querySelector('[data-testid=\"generator-priority-note\"]')?.textContent?.includes('안심 우선') === true", "자동 구성 안심 우선 기준 안내");
    assert(await setTextValue(client, '[data-testid="generator-brief-input"]', "게이밍 200만원"), "부분 한 줄 요구사항 입력창을 찾지 못했습니다.");
    assert(await clickText(client, "조건 분석"), "부분 한 줄 요구사항 해석 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-brief-guidance\"]') !== null && document.querySelector('[data-testid=\"generator-guidance-gaming-resolution\"]') !== null", "한 줄 요구사항 보완 안내");
    assert(await clickSelector(client, '[data-testid="generator-guidance-gaming-resolution"]') === 1, "한 줄 요구사항 보완 칩을 누르지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-brief-input\"]')?.value?.includes('QHD') === true && document.querySelector('[data-testid=\"generator-brief-preview\"]')?.textContent?.includes('QHD') === true", "한 줄 요구사항 보완 재해석");
    assert(await setTextValue(client, '[data-testid="generator-brief-input"]', "QHD 게이밍 220만원, RAM 32GB, SSD 2TB, 144Hz"), "한 줄 요구사항 입력창을 찾지 못했습니다.");
    assert(await clickText(client, "조건 분석"), "한 줄 요구사항 해석 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-brief-preview\"]') !== null && (document.body?.innerText ?? '').includes('해석 미리보기') && (document.body?.innerText ?? '').includes('QHD')", "한 줄 요구사항 해석 미리보기");
    assert(await clickText(client, "해석한 조건을 폼에 적용"), "해석한 조건 적용 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-brief-preview\"]')?.textContent?.includes('폼에 적용됨') === true && document.querySelector('.generator-form input[type=\"number\"]')?.value === '2200000' && document.querySelectorAll('.generator-form select')[0]?.value === 'gaming'", "한 줄 요구사항 폼 적용");
    assert(await clickText(client, "예산 구간 3안 비교"), "예산 구간 비교 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-budget-tradeoff\"]') !== null", "예산 구간 비교 결과 패널");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-budget-comparison-summary\"]') !== null", "예산 구간 비교 핵심 요약");
    assert(await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"generator-budget-comparison-summary\"]'); const text = node?.textContent ?? ''; return text.includes('구성') && text.includes('실제 합계') && text.includes('카탈로그 분석') && text.includes('부품 변경'); })()"), "예산 구간 비교 핵심 요약이 표시되지 않았습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-budget-tradeoff\"]')?.textContent?.includes('비교 결과') === true", "예산 구간 비교 결과 내용");
    assert(await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"generator-budget-tradeoff\"]'); const text = node?.textContent ?? ''; return text.includes('남은 위험') && text.includes('실제 합계') && text.includes('분석'); })()"), "예산 구간 비용·위험·분석 tradeoff가 표시되지 않았습니다.");
    const generatorRouteHistoryProbe = await client.evaluate("(async () => { const profileSelect = [...document.querySelectorAll('label')].find((label) => (label.textContent ?? '').includes('사용 목적'))?.querySelector('select'); const budgetInput = document.querySelector('.generator-form input[type=\"number\"]'); if (!(profileSelect instanceof HTMLSelectElement) || !(budgetInput instanceof HTMLInputElement)) return { stage: 'missing-controls' }; const before = { url: location.href, profile: profileSelect.value, budget: budgetInput.value }; history.pushState({}, '', '/recommend?profile=office&priority=budget&resolution=1080p&refresh=60&ram=16&budget=800000&includeGpu=false&ssd=500&hdd=0&hddCapacity=4000&listingPolicy=retail_only'); window.dispatchEvent(new PopStateEvent('popstate')); for (let index = 0; index < 60 && !(profileSelect.value === 'office' && budgetInput.value === '800000'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const pushed = { profile: profileSelect.value, budget: budgetInput.value, url: location.href }; history.back(); for (let index = 0; index < 60 && !(profileSelect.value === before.profile && budgetInput.value === before.budget); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); return { stage: 'checked', before, pushed, restored: { profile: profileSelect.value, budget: budgetInput.value, url: location.href } }; })()" );
    assert(generatorRouteHistoryProbe?.stage === 'checked' && generatorRouteHistoryProbe.pushed.profile === 'office' && generatorRouteHistoryProbe.pushed.budget === '800000' && generatorRouteHistoryProbe.restored.profile === generatorRouteHistoryProbe.before.profile && generatorRouteHistoryProbe.restored.budget === generatorRouteHistoryProbe.before.budget, "자동 구성 route history가 profile·예산을 복원하지 못했습니다. probe=" + JSON.stringify(generatorRouteHistoryProbe));
    const generatorPresetStorageProbe = await client.evaluate(`(async () => { const key = "pc-supporter-generator-presets"; const original = localStorage.getItem(key); const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)); const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage })); const preset = { id: "generator-storage-probe", name: "cross-tab generator preset", profile: "general", priority: "balanced", gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: 1500000, includeGpu: true, storageCapacityGb: 1000, hddCount: 0, hddCapacityGb: 4000, listingPolicy: "retail_only", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" }; try { const serialized = JSON.stringify({ schemaVersion: 1, items: [preset] }); localStorage.setItem(key, serialized); dispatch(serialized); for (let index = 0; index < 80 && !(document.body?.innerText ?? "").includes("cross-tab generator preset"); index += 1) await wait(25); const added = (document.body?.innerText ?? "").includes("cross-tab generator preset"); localStorage.removeItem(key); dispatch(null); for (let index = 0; index < 80 && (document.body?.innerText ?? "").includes("cross-tab generator preset"); index += 1) await wait(25); const removed = !(document.body?.innerText ?? "").includes("cross-tab generator preset"); return { stage: "checked", added, removed, path: location.pathname }; } finally { if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original); dispatch(original); await wait(100); } })()`);
    assert(generatorPresetStorageProbe?.stage === "checked" && generatorPresetStorageProbe.added === true && generatorPresetStorageProbe.removed === true && generatorPresetStorageProbe.path === "/recommend", "자동 구성 generator preset storage 변경이 현재 화면에 반영되지 않았습니다. probe=" + JSON.stringify(generatorPresetStorageProbe));
    recordRouteHistoryFlow("generator-route-history");
    const shareRouteLatestCancelProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; const headers = { 'Content-Type': 'application/json' }; const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers }); const stamp = '2026-09-08T00:00:00.000Z'; const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false }; const preferences = { profile: 'gaming', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 }; const saved = { id: 'share-route-probe', name: 'share route probe', selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp }; const checked = { status: 'compatible', blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: 'gaming', scoreLabel: '균형형', scoreBasis: 'probe', confidence: 'high', factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 0, priceComplete: true, engineVersion: '2.58.0', catalogSnapshotAt: stamp, checkedAt: stamp }; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname === '/api/builds/share-route-probe') return response(saved); if (requestUrl.pathname === '/api/compatibility/check' && init?.method === 'POST') { await new Promise((resolve) => setTimeout(resolve, 400)); return response(checked); } return originalFetch(input, init); }; const push = (path) => { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }; try { push('/share/share-route-probe'); await new Promise((resolve) => setTimeout(resolve, 25)); push('/'); await new Promise((resolve) => setTimeout(resolve, 500)); const body = document.body?.innerText ?? ''; return { stage: 'checked', path: location.pathname, home: document.querySelector('.home-page') !== null, result: document.querySelector('.result-page') !== null, routeKey: document.querySelector('.app-shell')?.getAttribute('data-route-key') ?? '', bodyTail: body.slice(-1200) }; } finally { window.fetch = originalFetch; } })()");
    assert(shareRouteLatestCancelProbe?.stage === 'checked' && shareRouteLatestCancelProbe.path === '/' && shareRouteLatestCancelProbe.home === true && shareRouteLatestCancelProbe.result === false, "공유 견적 로딩 중 route 이탈 후 늦은 compatibility 응답이 새 화면을 덮었습니다. probe=" + JSON.stringify(shareRouteLatestCancelProbe));

    // 온보딩 위자드 → /recommend autorun 핸드오프 — 선택한 게임·성능·예산이 URL로 전달되고 실제 견적이 생성돼야 한다.
    await client.send("Page.navigate", { url: `${baseUrl}/start` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('어떤 PC가 필요하세요?')", "온보딩 intent 화면");
    assert(await clickText(client, "새로운 견적을 맞추고 싶어요"), "온보딩 intent 선택을 클릭하지 못했습니다.");
    assert(await clickText(client, "새 견적 시작하기"), "온보딩 intent CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('새 견적은 어떤 방식으로 맞춰볼까요?')", "온보딩 mode 화면");
    assert(await clickText(client, "특정 작업이나 게임을 할 거예요"), "온보딩 task 방식을 선택하지 못했습니다.");
    assert(await clickText(client, "다음"), "온보딩 mode CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('무엇을 주로 할까요?')", "온보딩 usecase 화면");
    assert(await clickText(client, "게임"), "온보딩 게임 용도를 선택하지 못했습니다.");
    assert(await clickText(client, "다음"), "온보딩 usecase CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('어떤 게임을 할 건가요?') && document.querySelector('input[aria-label=\"게임 이름 검색\"]') !== null", "온보딩 games 화면");
    assert(await setInputValue(client, 'input[aria-label="게임 이름 검색"]', "cyber"), "온보딩 게임 검색창을 찾지 못했습니다.");
    assert(await clickText(client, "사이버펑크 2077"), "온보딩에서 사이버펑크 2077을 선택하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('1개 선택')", "온보딩 게임 선택 개수 표시");
    assert(await clickText(client, "다음"), "온보딩 games CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('원하는 성능을 골라주세요')", "온보딩 performance 화면");
    assert(await clickText(client, "4K"), "온보딩 4K 해상도를 선택하지 못했습니다.");
    assert(await clickText(client, "144 FPS"), "온보딩 144 FPS를 선택하지 못했습니다.");
    assert(await clickText(client, "다음"), "온보딩 performance CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('게임 옵션도 정해주세요')", "온보딩 graphics 화면");
    assert(await clickText(client, "다음 · 예산 정하기"), "온보딩 graphics CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('예산은 어디까지 생각하세요?')", "온보딩 budget 화면");
    assert(await clickText(client, "200만원"), "온보딩 200만원 빠른 예산을 선택하지 못했습니다.");
    assert(await clickText(client, "다음 · 조건 확인"), "온보딩 budget CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('이 조건으로 맞춰볼까요?')", "온보딩 summary 화면");
    assert(await clickText(client, "이 조건으로 견적 생성하기"), "온보딩 견적 생성 CTA를 클릭하지 못했습니다.");
    await waitForValue(client, "location.pathname === '/recommend' && new URLSearchParams(location.search).get('autorun') === '1' && new URLSearchParams(location.search).get('profile') === 'gaming' && new URLSearchParams(location.search).get('resolution') === '4k' && (new URLSearchParams(location.search).get('games') ?? '').includes('cyberpunk') && new URLSearchParams(location.search).get('budget') === '2000000'", "온보딩 → 자동 구성 URL 핸드오프");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-gaming-evidence\"]') !== null && (document.body?.innerText ?? '').includes('게임별 FPS 자료')", "자동 구성 결과의 게임별 FPS 자료 패널");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('자료 없음') || (document.body?.innerText ?? '').includes('확인 필요') || (document.body?.innerText ?? '').includes('평균 FPS 기준 충족')", "자동 구성 FPS 자료 상태 표시");

    await client.send("Page.navigate", { url: `${baseUrl}/admin` });
    if (adminPassword) {
      await waitForValue(client, "document.querySelector('#admin-password') !== null", "관리자 인증 화면");
      assert(await setInputValue(client, '#admin-password', adminPassword), "관리자 인증 비밀번호를 입력하지 못했습니다.");
      assert(await clickText(client, '로그인'), "관리자 인증 로그인 버튼을 클릭하지 못했습니다.");
      await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "관리자 데이터 센터 로그인");
    } else {
      await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터')", "관리자 데이터 센터");
    }
    const adminSessionProbe = await browserApiJson(client, baseUrl, "/api/admin/session");
    assert(adminSessionProbe?.authenticated === true && adminSessionProbe?.security?.environment && typeof adminSessionProbe.security.passwordConfigured === 'boolean' && typeof adminSessionProbe.security.sessionSecretConfigured === 'boolean' && typeof adminSessionProbe.security.productionReady === 'boolean', "관리자 세션의 운영 보안 진단 정보가 없습니다. probe=" + JSON.stringify(adminSessionProbe));
    if (adminSessionProbe.security.environment === 'development' && adminSessionProbe.security.passwordConfigured === false) {
      await waitForValue(client, "document.querySelector('[data-testid=\"admin-security-notice\"]')?.textContent?.includes('개발용 관리자 모드') === true", "개발용 관리자 보안 안내");
    }
    const crawlResumePreview = await browserApiJson(client, baseUrl, "/api/admin/crawl/resume-preview");
    assert(crawlResumePreview?.kind === 'crawl-resume-preview' && crawlResumePreview?.schemaVersion === 1 && crawlResumePreview?.readOnly === true && typeof crawlResumePreview?.running === 'boolean' && typeof crawlResumePreview?.available === 'boolean' && Array.isArray(crawlResumePreview?.completedCategories) && Array.isArray(crawlResumePreview?.remainingCategories), "카탈로그 수집 재개 프리뷰 API 응답이 올바르지 않습니다. probe=" + JSON.stringify(crawlResumePreview));
    if (crawlResumePreview.available) {
      await waitForValue(client, "document.querySelector('[data-testid=\"admin-crawl-resume-control\"]') !== null && document.querySelector('[data-testid=\"admin-crawl-resume\"]') !== null", "중단된 카탈로그 수집 재개 컨트롤");
    }
    await waitForValue(client, "document.getElementById('admin-seed-catalog-preview-panel') !== null", "starter 기준 anchor");
    await client.evaluate("(() => { const target = document.getElementById('admin-seed-catalog-preview-panel'); target?.scrollIntoView({ block: 'center', behavior: 'auto' }); target?.focus({ preventScroll: true }); return Boolean(target); })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-seed-catalog-preview\"]') !== null && (document.body?.innerText ?? '').includes('기본 정보 기준값 비교')", "기본 정보 기준값 비교 패널");
    const seedPreview = await client.evaluate("fetch('/api/admin/catalog/seed-preview').then((response) => response.json())");
    assert(seedPreview?.kind === 'catalog-seed-preview' && seedPreview?.schemaVersion === 1 && seedPreview?.readOnly === true && typeof seedPreview?.coverage?.coveragePercent === 'number' && Array.isArray(seedPreview?.categoryRows) && Array.isArray(seedPreview?.missingItems) && Array.isArray(seedPreview?.conflicts), "starter 기준값 대조 API 응답이 올바르지 않습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-seed-catalog-source-summary\"]') !== null && (document.body?.innerText ?? '').includes('현재 데이터 출처')", "starter 데이터 출처 요약");
    await waitForValue(client, "document.getElementById('admin-seed-catalog-mapping-panel') !== null", "starter 매핑 anchor");
    await client.evaluate("(() => { const target = document.getElementById('admin-seed-catalog-mapping-panel'); target?.scrollIntoView({ block: 'center', behavior: 'auto' }); target?.focus({ preventScroll: true }); return Boolean(target); })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-seed-catalog-mapping\"]') !== null && document.querySelector('[data-testid=\"admin-seed-catalog-mapping\"]')?.textContent?.includes('starter 상품 코드 매핑 확인') === true", "starter 상품 코드 매핑 확인 패널");
    const seedMappingPreview = await client.evaluate("fetch('/api/admin/catalog/seed-mapping-preview').then((response) => response.json())");
    assert(seedMappingPreview?.kind === 'catalog-seed-mapping-preview' && seedMappingPreview?.schemaVersion === 1 && seedMappingPreview?.readOnly === true && typeof seedMappingPreview?.summary?.missingStarterCount === 'number' && typeof seedMappingPreview?.summary?.candidateCount === 'number' && Array.isArray(seedMappingPreview?.items), "starter 상품 코드 매핑 API 응답이 올바르지 않습니다.");
    const seedCollectionQueue = await client.evaluate("fetch('/api/admin/catalog/seed-collection-queue').then((response) => response.json())");
    assert(seedCollectionQueue?.kind === 'catalog-seed-collection-queue' && seedCollectionQueue?.schemaVersion === 1 && seedCollectionQueue?.readOnly === true && typeof seedCollectionQueue?.queueFingerprint === 'string' && typeof seedCollectionQueue?.summary?.queueCount === 'number' && Array.isArray(seedCollectionQueue?.categoryRows) && Array.isArray(seedCollectionQueue?.items), "starter 원문 수집 큐 API 응답이 올바르지 않습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-seed-mapping-summary\"]')?.textContent?.includes('확인 부품') === true", "starter 매핑 큐 요약");
    assert(await client.evaluate("(() => { const button = [...document.querySelectorAll('.admin-seed-mapping-filters button')].find((candidate) => (candidate.textContent ?? '').includes('수동 필요')); button?.click(); return Boolean(button); })()"), "starter 수동 매핑 필터를 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('.admin-seed-mapping-manual-form') !== null && (document.body?.innerText ?? '').includes('자동 부품이 없는 항목')", "starter 수동 매핑 입력 폼");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-seed-collection-queue\"]')?.textContent?.includes('상품 페이지 수집 작업 목록') === true && document.querySelector('[data-testid=\"admin-seed-collection-queue-summary\"]') !== null", "starter 상품 페이지 수집 작업 목록");
    await waitForValue(client, "document.querySelectorAll('[data-testid=\"admin-seed-collection-queue-item\"]').length > 0 && document.querySelector('.admin-seed-collection-queue-filters button') !== null", "starter 원문 수집 큐 작업 항목");
    const categoryCrawlButton = await client.evaluate("(() => { const button = document.querySelector('[data-testid=\"admin-seed-collection-queue-start-category\"]'); return button ? { disabled: button.disabled, category: button.getAttribute('data-category') } : undefined; })()");
    assert(categoryCrawlButton?.category, "starter 수집 큐의 카테고리 수집 버튼을 찾지 못했습니다.");
    const categoryCrawlStatus = await client.evaluate("fetch('/api/admin/crawl/status').then((response) => response.json())");
    assert(typeof categoryCrawlStatus?.pageRetries === 'number' && Array.isArray(categoryCrawlStatus?.failedPages), "카탈로그 페이지 telemetry 필드가 없습니다. probe=" + JSON.stringify(categoryCrawlStatus));
    if (categoryCrawlStatus?.currentPage !== undefined || categoryCrawlStatus?.currentCategory || categoryCrawlStatus?.failedPages?.length > 0) {
      await waitForValue(client, "document.querySelector('[data-testid=\"admin-crawl-progress-detail\"]') !== null && (document.body?.innerText ?? '').includes('PAGE TELEMETRY')", "카탈로그 페이지 telemetry 패널");
    }
    if (categoryCrawlStatus?.failedPages?.some((failure) => failure.stage === 'list')) {
      await waitForValue(client, "document.querySelector('[data-testid^=\"admin-crawl-retry-page-\"]') !== null", "실패 목록 페이지 단독 재시도 액션");
      await waitForValue(client, "document.querySelector('[data-testid=\"admin-crawl-retry-all-pages\"]') !== null", "실패 목록 페이지 일괄 재시도 액션");
    }
    if (categoryCrawlStatus?.pageRetryBatch) {
      const retryBatch = categoryCrawlStatus.pageRetryBatch;
      assert(Number.isInteger(retryBatch.total) && retryBatch.total > 0 && Number.isInteger(retryBatch.completed) && Number.isInteger(retryBatch.succeeded) && Number.isInteger(retryBatch.failed) && retryBatch.completed >= 0 && retryBatch.completed <= retryBatch.total && retryBatch.succeeded >= 0 && retryBatch.failed >= 0 && retryBatch.succeeded + retryBatch.failed <= retryBatch.completed, "카탈로그 페이지 일괄 재시도 telemetry 필드가 올바르지 않습니다. probe=" + JSON.stringify(retryBatch));
      await waitForValue(client, "document.querySelector('[data-testid=\"admin-crawl-batch-progress\"]') !== null", "실패 목록 페이지 일괄 재시도 telemetry");
      if (categoryCrawlStatus.operation === 'page-retry-batch' && categoryCrawlStatus.status === 'running') {
        await waitForValue(client, "document.querySelector('[data-testid=\"admin-crawl-cancel-batch\"]') !== null", "실패 목록 페이지 일괄 재시도 중단 액션");
      }
    }
    const categoryCrawlManifest = await client.evaluate("fetch('/api/admin/crawl/manifest').then(async (response) => response.ok ? response.json() : { status: response.status })");
    if (categoryCrawlManifest?.status === undefined) {
      const pageRetryHistory = categoryCrawlManifest?.pageRetryHistory;
      assert(pageRetryHistory === undefined || Array.isArray(pageRetryHistory), "카탈로그 manifest의 페이지 재시도 이력이 배열이 아닙니다. probe=" + JSON.stringify(categoryCrawlManifest));
      if (Array.isArray(pageRetryHistory) && pageRetryHistory.length > 0) {
        await waitForValue(client, "document.querySelector('[data-testid=\"admin-crawl-retry-history\"]') !== null", "카탈로그 페이지 재시도 이력");
      }
    }
    if (categoryCrawlStatus?.status === 'running') {
      assert(categoryCrawlButton.disabled === true, "기존 카탈로그 수집 중 범주 수집 버튼이 비활성화되지 않았습니다.");
    } else {
      assert(categoryCrawlButton.disabled === false, "수집 중이 아닌데 범주 수집 버튼이 비활성화되어 있습니다.");
      const categoryCrawlProbe = await client.evaluate("(async () => { const button = document.querySelector('[data-testid=\"admin-seed-collection-queue-start-category\"]'); const category = button?.getAttribute('data-category'); const originalConfirm = window.confirm; const originalFetch = window.fetch; let captured; window.confirm = () => true; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; if (url === '/api/admin/crawl' && init?.method === 'POST') { captured = { url, method: init.method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }; return new Response(JSON.stringify({ message: 'probe accepted', category }), { status: 202, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); }; try { button.click(); for (let index = 0; index < 30 && !captured; index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); return { category, request: captured }; } finally { window.confirm = originalConfirm; window.fetch = originalFetch; } })()");
      assert(categoryCrawlProbe?.category && categoryCrawlProbe.request?.body?.category === categoryCrawlProbe.category && categoryCrawlProbe.request?.body?.all === false && categoryCrawlProbe.request?.body?.pages === 1 && categoryCrawlProbe.request?.body?.limitPerCategory === 16 && categoryCrawlProbe.request?.body?.details === true, "starter 범주 빠른 수집 클릭이 안전한 카테고리 샘플 요청으로 전달되지 않았습니다.");
      // This probe deliberately mocks the POST response, so the component remains
      // in its optimistic `running` state. Reload before testing the next action
      // to avoid making the following button look disabled for a fake job.
      await client.send("Page.navigate", { url: `${baseUrl}/admin` });
      await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('[data-testid=\"admin-seed-collection-queue\"]') !== null", "mock 수집 이후 관리자 상태 복구");
      await waitForValue(client, "document.querySelector('[data-testid=\"admin-seed-collection-queue-focus-mapping\"]') !== null", "자동 재계산 후 매핑 큐 렌더링");
    }
    const focusedStarterId = await client.evaluate("(() => { const button = document.querySelector('[data-testid=\"admin-seed-collection-queue-focus-mapping\"]'); if (!button) return undefined; const starterId = button.getAttribute('data-starter-id'); button.click(); return starterId; })()");
    assert(typeof focusedStarterId === 'string' && focusedStarterId.length > 0, "starter 수집 큐의 매핑 이동 버튼을 찾지 못했습니다.");
    await waitForValue(client, `document.querySelector('.admin-seed-mapping-search input')?.value === ${JSON.stringify(focusedStarterId)} && document.getElementById(${JSON.stringify(`admin-seed-mapping-item-${focusedStarterId}`)}) !== null`, "starter 수집 큐에서 매핑 입력으로 이동");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-spec-coverage\"]') !== null && (document.body?.innerText ?? '').includes('스펙 완성도·보강 우선순위')", "관리자 카탈로그 스펙 coverage");
    await client.evaluate("(() => { const hash = '#admin-catalog-change-log'; if (location.hash !== hash) { history.replaceState({}, '', location.pathname + location.search + hash); window.dispatchEvent(new HashChangeEvent('hashchange')); } document.getElementById('admin-catalog-change-log')?.scrollIntoView({ block: 'center' }); })()");
    await waitForValue(client, "document.querySelector('.catalog-change-card') !== null", "관리자 카탈로그 변경 이력 관심 목록");
    const adminCatalogWatchlistStorageProbe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const thresholdKey = "pc-supporter-catalog-watch-threshold";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const originalThreshold = localStorage.getItem(thresholdKey);
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const entry = { itemId: "admin-watch-storage-probe", itemName: "admin cross-tab watch probe", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
      const dispatch = (key, value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        const serialized = JSON.stringify([entry]);
        setStored(watchlistKey, serialized);
        dispatch(watchlistKey, serialized);
        for (let index = 0; index < 80 && !(document.body?.innerText ?? "").includes("admin cross-tab watch probe"); index += 1) await wait(25);
        const tracked = (document.body?.innerText ?? "").includes("admin cross-tab watch probe");
        const thresholdSerialized = "5";
        setStored(thresholdKey, thresholdSerialized);
        dispatch(thresholdKey, thresholdSerialized);
        for (let index = 0; index < 80 && document.querySelector('[aria-label="관심 가격 최저가 근접 기준"]')?.value !== "5"; index += 1) await wait(25);
        const threshold = document.querySelector('[aria-label="관심 가격 최저가 근접 기준"]')?.value ?? "";
        return { stage: "checked", tracked, threshold, path: location.pathname };
      } finally {
        setStored(watchlistKey, originalWatchlist);
        dispatch(watchlistKey, originalWatchlist);
        setStored(thresholdKey, originalThreshold);
        dispatch(thresholdKey, originalThreshold);
        await wait(100);
      }
    })()`);
    assert(adminCatalogWatchlistStorageProbe?.stage === "checked" && adminCatalogWatchlistStorageProbe.tracked === true && adminCatalogWatchlistStorageProbe.threshold === "5" && adminCatalogWatchlistStorageProbe.path === "/admin", "관리자 카탈로그 변경 이력 화면이 다른 탭의 관심 가격 목록·근접 기준 변경을 반영하지 못했습니다. probe=" + JSON.stringify(adminCatalogWatchlistStorageProbe));
    const adminCatalogWatchlistMutationContextProbe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const originalFetch = window.fetch;
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const firstEntry = { itemId: "admin-watch-mutation-old", itemName: "admin watch mutation old", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
      const nextEntry = { itemId: "admin-watch-mutation-new", itemName: "admin watch mutation new", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:01.000Z" };
      let postCalls = 0;
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key: watchlistKey, newValue: value, storageArea: localStorage }));
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/watchlists" && (init?.method ?? "GET").toUpperCase() === "POST") {
          postCalls += 1;
          await wait(500);
          return response({ id: "stale-admin-watchlist-probe", name: "stale-admin-watchlist-probe", entries: [firstEntry], nearLowThresholdPercent: 10, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" });
        }
        return originalFetch(input, init);
      };
      try {
        const serializedOld = JSON.stringify([firstEntry]);
        const serializedNew = JSON.stringify([nextEntry]);
        localStorage.setItem(watchlistKey, serializedOld);
        dispatch(serializedOld);
        for (let index = 0; index < 120 && !(document.body?.innerText ?? "").includes(firstEntry.itemName); index += 1) await wait(25);
        const save = [...document.querySelectorAll(".catalog-watchlist-server-save button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? "").includes("서버에 저장"));
        if (!(save instanceof HTMLButtonElement)) return { stage: "missing-save", postCalls, body: (document.body?.innerText ?? "").slice(-1800) };
        save.click();
        for (let index = 0; index < 80 && postCalls < 1; index += 1) await wait(25);
        localStorage.setItem(watchlistKey, serializedNew);
        dispatch(serializedNew);
        for (let index = 0; index < 100 && !(document.body?.innerText ?? "").includes(nextEntry.itemName); index += 1) await wait(25);
        await wait(650);
        const body = document.body?.innerText ?? "";
        const savedLinkValue = document.querySelector('.catalog-watchlist-server-link input')?.value ?? "";
        return { stage: "checked", postCalls, currentEntry: body.includes(nextEntry.itemName), staleLink: savedLinkValue.includes("/watchlist/stale-admin-watchlist-probe"), savedLinkValue, bodyTail: body.slice(-1800) };
      } finally {
        window.fetch = originalFetch;
        if (originalWatchlist === null) localStorage.removeItem(watchlistKey); else localStorage.setItem(watchlistKey, originalWatchlist);
        dispatch(originalWatchlist);
        await wait(100);
      }
    })()`);
    assert(adminCatalogWatchlistMutationContextProbe?.stage === "checked" && adminCatalogWatchlistMutationContextProbe.postCalls === 1 && adminCatalogWatchlistMutationContextProbe.currentEntry === true && adminCatalogWatchlistMutationContextProbe.staleLink === false, "관리자 카탈로그 관심 목록 저장 중 이전 payload의 stale 공유 링크가 현재 입력에 남았습니다. probe=" + JSON.stringify(adminCatalogWatchlistMutationContextProbe));
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-pcie-coverage\"]') !== null && (document.body?.innerText ?? '').includes('메인보드 PCIe 슬롯 정보') && (document.body?.innerText ?? '').includes('x4 이상 조건')", "관리자 PCIe evidence coverage");
    const pcieCoverageProbe = await client.evaluate("(async () => { const meta = await fetch('/api/meta').then((response) => response.json()); const coverage = meta?.catalogSpecCoverage?.pcieSlotCoverage; const integrity = meta?.catalogCategoryIntegrity; const total = coverage?.total; const rawTotal = coverage?.rawTotal ?? total; const excludedCategoryMismatchCount = coverage?.excludedCategoryMismatchCount ?? 0; return { total, rawTotal, excludedCategoryMismatchCount, x4: coverage?.byRequiredWidth?.[4], integrityMismatchCount: integrity?.mismatchCount, integrityPanel: document.querySelector('[data-testid=\"admin-catalog-category-integrity\"]') !== null, rendered: document.querySelectorAll('[data-testid=\"admin-catalog-pcie-coverage\"] [role=\"progressbar\"]').length, missingHref: document.querySelector('[data-testid=\"admin-catalog-pcie-open-missing\"]')?.getAttribute('href'), reviewHref: document.querySelector('[data-testid=\"admin-catalog-pcie-open-review\"]')?.getAttribute('href') }; })()");
    assert(pcieCoverageProbe.total > 0 && pcieCoverageProbe.rawTotal >= pcieCoverageProbe.total && pcieCoverageProbe.excludedCategoryMismatchCount === pcieCoverageProbe.rawTotal - pcieCoverageProbe.total && pcieCoverageProbe.integrityMismatchCount === pcieCoverageProbe.excludedCategoryMismatchCount && pcieCoverageProbe.integrityPanel && pcieCoverageProbe.x4?.missing > 0 && pcieCoverageProbe.rendered === 4 && pcieCoverageProbe.missingHref === '/catalog?category=motherboard&pcieSlotInfo=missing' && pcieCoverageProbe.reviewHref === '/admin?reviewEvidence=pcie#admin-catalog-spec-review', "관리자 PCIe evidence coverage 또는 카테고리 정합성 경계가 실제 메타데이터와 일치하지 않습니다. probe=" + JSON.stringify(pcieCoverageProbe));
    if (pcieCoverageProbe.excludedCategoryMismatchCount > 0) {
      await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-category-integrity-review\"]') !== null && document.querySelectorAll('[data-testid=\"admin-catalog-category-integrity-item\"]').length > 0", "분리 원본 검수 큐 렌더링");
      const categoryIntegrityReviewProbe = await client.evaluate("fetch('/api/admin/catalog-category-integrity/review-package?limit=2').then((response) => response.json())");
      assert(categoryIntegrityReviewProbe?.kind === 'catalog-category-integrity-review-package' && categoryIntegrityReviewProbe?.schemaVersion === 1 && categoryIntegrityReviewProbe?.ruleVersion === 1 && categoryIntegrityReviewProbe?.checkedCount > 0 && categoryIntegrityReviewProbe?.mismatchCount > 0 && categoryIntegrityReviewProbe?.queueTotal === categoryIntegrityReviewProbe?.mismatchCount && categoryIntegrityReviewProbe?.includedCount === categoryIntegrityReviewProbe?.items?.length && typeof categoryIntegrityReviewProbe?.queueFingerprint === 'string' && categoryIntegrityReviewProbe.queueFingerprint.length > 0 && Array.isArray(categoryIntegrityReviewProbe?.items) && categoryIntegrityReviewProbe.items.length === 2 && categoryIntegrityReviewProbe.items.every((item) => item.category === 'motherboard' && typeof item.signal === 'string' && typeof item.reason === 'string' && typeof item.catalogUrl === 'string'), "카테고리 불일치 원본 검수 패키지 API 응답이 올바르지 않습니다. probe=" + JSON.stringify(categoryIntegrityReviewProbe));
      const categoryIntegrityReviewNext = await client.evaluate(`fetch('/api/admin/catalog-category-integrity/review-package?limit=2&offset=${categoryIntegrityReviewProbe.nextOffset ?? 2}').then((response) => response.json())`);
      assert(categoryIntegrityReviewNext?.queueFingerprint === categoryIntegrityReviewProbe.queueFingerprint && categoryIntegrityReviewNext?.offset === (categoryIntegrityReviewProbe.nextOffset ?? 2) && Array.isArray(categoryIntegrityReviewNext?.items) && categoryIntegrityReviewNext.items.length > 0, "카테고리 불일치 원본 검수 큐의 페이지 이동이 fingerprint를 유지하지 않습니다. probe=" + JSON.stringify({ first: categoryIntegrityReviewProbe, next: categoryIntegrityReviewNext }));
      const categoryIntegrityReviewChanged = await client.evaluate("fetch('/api/admin/catalog-category-integrity/review-package?limit=2&offset=2&queueFingerprint=stale-queue-fingerprint').then((response) => response.json())");
      assert(categoryIntegrityReviewChanged?.queueChanged === true && categoryIntegrityReviewChanged?.queueFingerprint === categoryIntegrityReviewProbe.queueFingerprint, "카테고리 불일치 원본 검수 큐의 stale fingerprint 감지가 동작하지 않습니다. probe=" + JSON.stringify(categoryIntegrityReviewChanged));
    } else {
      const categoryIntegrityReviewProbe = await client.evaluate("fetch('/api/admin/catalog-category-integrity/review-package?limit=2').then((response) => response.json())");
      assert(categoryIntegrityReviewProbe?.kind === 'catalog-category-integrity-review-package' && categoryIntegrityReviewProbe?.schemaVersion === 1 && categoryIntegrityReviewProbe?.ruleVersion === 1 && categoryIntegrityReviewProbe?.checkedCount > 0 && categoryIntegrityReviewProbe?.mismatchCount === 0 && categoryIntegrityReviewProbe?.queueTotal === 0 && categoryIntegrityReviewProbe?.includedCount === 0 && Array.isArray(categoryIntegrityReviewProbe?.items) && categoryIntegrityReviewProbe.items.length === 0, "카테고리 불일치가 없는 seed에서 원본 검수 큐가 비어 있지 않습니다. probe=" + JSON.stringify(categoryIntegrityReviewProbe));
    }
    if (metaPayload.catalogSpecCoverage.categories.some((category) => category.priority === 'high')) {
      await waitForValue(client, "document.querySelector('.catalog-spec-coverage-priority.high')?.textContent?.includes('우선 보강') === true", "카탈로그 보강 우선순위 정렬");
    }
    const coverageCategoryActions = await client.evaluate("(() => [...document.querySelectorAll('[data-testid=\"admin-catalog-spec-start-category\"]')].map((button) => ({ category: button.getAttribute('data-category'), disabled: button instanceof HTMLButtonElement ? button.disabled : true })).filter((item) => item.category))()");
    assert(Array.isArray(coverageCategoryActions) && coverageCategoryActions.length > 0 && coverageCategoryActions.some((item) => item.category === 'gpu' || item.category === 'ssd' || item.category === 'case'), "카탈로그 coverage 카드에 우선 범주 빠른 수집 액션이 없습니다. actions=" + JSON.stringify(coverageCategoryActions));
    const coverageCrawlStatus = await client.evaluate("fetch('/api/admin/crawl/status').then((response) => response.json())");
    if (coverageCrawlStatus?.status === 'running') {
      assert(coverageCategoryActions.every((item) => item.disabled === true) && await client.evaluate("[...document.querySelectorAll('[data-testid=\"admin-catalog-spec-start-category-all\"], [data-testid=\"admin-catalog-work-priority-start-category-all\"]')].every((node) => !(node instanceof HTMLButtonElement) || node.disabled)"), "기존 카탈로그 수집 중 범주 전체 수집 버튼이 비활성화되지 않았습니다.");
    } else {
      const exhaustiveCategoryCrawlProbe = await client.evaluate("(async () => { const button = [...document.querySelectorAll('[data-testid=\"admin-catalog-spec-start-category-all\"], [data-testid=\"admin-catalog-work-priority-start-category-all\"]')].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled); const category = button?.getAttribute('data-category'); const originalConfirm = window.confirm; const originalFetch = window.fetch; let captured; window.confirm = () => true; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname === '/api/admin/crawl' && (init?.method ?? 'GET').toUpperCase() === 'POST') { captured = { url: requestUrl.pathname, method: init.method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }; return new Response(JSON.stringify({ message: 'exhaustive probe accepted', category, mode: 'all' }), { status: 202, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); }; try { button?.click(); for (let index = 0; index < 30 && !captured; index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); return { category, request: captured }; } finally { window.confirm = originalConfirm; window.fetch = originalFetch; } })()");
      assert(exhaustiveCategoryCrawlProbe?.category && exhaustiveCategoryCrawlProbe.request?.body?.category === exhaustiveCategoryCrawlProbe.category && exhaustiveCategoryCrawlProbe.request?.body?.all === true && exhaustiveCategoryCrawlProbe.request?.body?.pages === 1 && exhaustiveCategoryCrawlProbe.request?.body?.limitPerCategory === 0 && exhaustiveCategoryCrawlProbe.request?.body?.details === true, "카탈로그 coverage 카드의 범주 전체 수집이 선택 범주 exhaustive 요청으로 전달되지 않았습니다. probe=" + JSON.stringify(exhaustiveCategoryCrawlProbe));
    }
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-work-priority\"]') !== null && (document.body?.innerText ?? '').includes('다음 보강 작업')", "카탈로그 다음 보강 작업 패널");
    const priorityActionProbe = await client.evaluate("(() => ({ benchmark: Boolean(document.querySelector('[data-testid=\"admin-catalog-work-priority-benchmark-gpu\"]')), spec: Boolean(document.querySelector('[data-testid=\"admin-catalog-work-priority-spec-case\"]') || document.querySelector('[data-testid=\"admin-catalog-work-priority-spec-ssd\"]')), pcie: Boolean(document.querySelector('[data-testid=\"admin-catalog-work-priority-pcie-motherboard\"]')), accessory: document.querySelectorAll('[data-testid^=\"admin-catalog-work-priority-accessory-\"]').length, actions: [...document.querySelectorAll('[data-testid^=\"admin-catalog-work-priority-\"]')].map((node) => node.getAttribute('data-testid')).filter(Boolean) }))()");
    assert(priorityActionProbe.benchmark && priorityActionProbe.spec && priorityActionProbe.pcie && priorityActionProbe.accessory > 0, "카탈로그 다음 보강 작업 패널이 PCIe·benchmark·스펙·주변 부품 gap을 모두 표시하지 않습니다. probe=" + JSON.stringify(priorityActionProbe));
    const pciePriorityProbe = await client.evaluate("(() => { const card = document.querySelector('[data-testid=\"admin-catalog-work-priority-pcie-motherboard\"]'); const link = card?.querySelector('[data-testid=\"admin-catalog-work-priority-open-missing\"]'); const reviewLink = card?.querySelector('[data-testid=\"admin-catalog-work-priority-open-review\"]'); return { href: link?.getAttribute('href'), reviewHref: reviewLink?.getAttribute('href'), text: card?.textContent ?? '' }; })()");
    assert(pciePriorityProbe.href === '/catalog?category=motherboard&pcieSlotInfo=missing' && pciePriorityProbe.reviewHref === '/admin?reviewEvidence=pcie#admin-catalog-spec-review' && pciePriorityProbe.text.includes('PCIe 정보 부족 보드 보기'), "PCIe evidence 우선 작업의 누락 보드·전용 보강 큐 이동 링크가 올바르지 않습니다. probe=" + JSON.stringify(pciePriorityProbe));
    const accessoryPriorityProbe = await client.evaluate("(() => { const card = document.querySelector('[data-testid^=\"admin-catalog-work-priority-accessory-\"]'); const link = card?.querySelector('[data-testid=\"admin-catalog-work-priority-open-accessory\"]'); const button = card?.querySelector('[data-testid=\"admin-catalog-work-priority-start-accessory\"]'); return { href: link?.getAttribute('href'), category: button?.getAttribute('data-category') }; })()");
    assert(typeof accessoryPriorityProbe.href === 'string' && accessoryPriorityProbe.href.startsWith('/accessories?category=') && accessoryPriorityProbe.href.includes('quality=incomplete') && typeof accessoryPriorityProbe.category === 'string' && accessoryPriorityProbe.category.length > 0, "주변 부품 우선 작업 카드의 미완료 목록 링크·범주 보강 액션이 올바르지 않습니다. probe=" + JSON.stringify(accessoryPriorityProbe));
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-accessory-spec-coverage\"]') !== null && document.querySelectorAll('[data-testid=\"admin-accessory-spec-open-incomplete\"]').length > 0", "주변 부품 전체 coverage 패널");
    const accessoryCoverageProbe = await client.evaluate("(async () => { const meta = await fetch('/api/meta').then((response) => response.json()); const expected = meta?.accessoryCoverage?.categories?.length ?? 0; return { expected, rendered: document.querySelectorAll('[data-testid=\"admin-accessory-spec-open-incomplete\"]').length, tracks: document.querySelectorAll('[data-testid=\"admin-accessory-spec-coverage\"] [role=\"progressbar\"]').length, firstHref: document.querySelector('[data-testid=\"admin-accessory-spec-open-incomplete\"]')?.getAttribute('href') }; })()");
    assert(accessoryCoverageProbe.expected > 0 && accessoryCoverageProbe.rendered === accessoryCoverageProbe.expected && accessoryCoverageProbe.tracks === accessoryCoverageProbe.expected && typeof accessoryCoverageProbe.firstHref === 'string' && accessoryCoverageProbe.firstHref.startsWith('/accessories?category=') && accessoryCoverageProbe.firstHref.includes('quality=incomplete'), "주변 부품 전체 coverage가 API 범주 수와 동일하게 렌더링되지 않거나 링크 필터가 올바르지 않습니다. probe=" + JSON.stringify(accessoryCoverageProbe));
    assert((await clickSelector(client, '[data-testid="admin-catalog-work-priority-open-benchmark"]', 1)) === 1, "다음 보강 작업의 benchmark 검수 큐 이동을 클릭하지 못했습니다.");
    await waitForValue(client, "document.activeElement?.id === 'admin-benchmark-review'", "다음 보강 작업 benchmark 큐 focus");
    await client.evaluate("(() => { document.getElementById('admin-benchmark-review')?.scrollIntoView({ block: 'center' }); return true; })()");
    await waitForValue(client, "document.querySelector('.benchmark-override-composer') !== null && document.querySelector('[aria-label=\"벤치마크 보강 행 범주\"]')?.value === 'gpu'", "벤치마크 행 작성 도구");
    await waitForValue(client, "document.querySelector('[data-testid^=\"benchmark-review-open-composer-gpu-\"]') !== null", "3DMark 검수 큐 GPU 바로가기");
    assert((await clickSelector(client, '[data-testid^="benchmark-review-open-composer-gpu-"]', 1)) === 1, "3DMark 검수 큐 GPU 바로가기를 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"benchmark-3dmark-import\"]') !== null", "3DMark GPU 검수 도구");
    await waitForValue(client, "document.querySelector('[data-testid=\"benchmark-3dmark-work-package\"]') !== null && document.querySelector('[data-testid=\"benchmark-3dmark-package-progress\"]') !== null", "3DMark GPU 검수 작업 패키지");
    const benchmark3DMarkPackageProbe = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"benchmark-3dmark-work-package\"]'); const range = document.querySelector('[data-testid=\"benchmark-3dmark-package-range\"]')?.textContent ?? ''; const next = document.querySelector('[data-testid=\"benchmark-3dmark-package-next\"]'); return { text: node?.textContent ?? '', range, queueTotal: [...(node?.querySelectorAll('.benchmark-3dmark-work-list article') ?? [])].length, nextDisabled: next instanceof HTMLButtonElement ? next.disabled : true }; })()");
    const benchmark3DMarkPackageMeta = await client.evaluate("fetch('/api/admin/benchmark-review/work-package?offset=0&limit=24').then((response) => response.ok ? response.json() : null)");
    const benchmark3DMarkPackageTotal = benchmark3DMarkPackageMeta?.summary?.queueTotal ?? benchmark3DMarkPackageMeta?.items?.length ?? 0;
    const benchmark3DMarkFirstPageEnd = Math.min(24, benchmark3DMarkPackageTotal);
    const benchmark3DMarkSecondPageStart = `25–${Math.min(48, benchmark3DMarkPackageTotal)} /`;
    assert(benchmark3DMarkPackageTotal > 0 && benchmark3DMarkPackageProbe.range === `1–${benchmark3DMarkFirstPageEnd} / ${benchmark3DMarkPackageTotal}` && benchmark3DMarkPackageProbe.queueTotal === benchmark3DMarkFirstPageEnd && benchmark3DMarkPackageProbe.nextDisabled === !(benchmark3DMarkPackageTotal > 24), "3DMark GPU 검수 작업 패키지의 첫 페이지·다음 버튼이 올바르지 않습니다. probe=" + JSON.stringify(benchmark3DMarkPackageProbe) + " meta=" + JSON.stringify(benchmark3DMarkPackageMeta?.summary));
    if (benchmark3DMarkPackageTotal > 24) {
      const benchmark3DMarkStorageProbe = await client.evaluate(`(async () => { const key = "pc-supporter-3dmark-review-work-progress-v1"; const original = localStorage.getItem(key); const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)); const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage })); try { let current; try { current = JSON.parse(original ?? "null"); } catch { current = null; } if (!current?.queueFingerprint) return { stage: "missing-fingerprint", original }; const serialized = JSON.stringify({ offset: 24, queueFingerprint: current.queueFingerprint, completedIds: [] }); localStorage.setItem(key, serialized); dispatch(serialized); for (let index = 0; index < 120 && !(document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith(${JSON.stringify(benchmark3DMarkSecondPageStart)}); index += 1) await wait(25); const movedToNext = (document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith(${JSON.stringify(benchmark3DMarkSecondPageStart)}); if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original); dispatch(original); for (let index = 0; index < 120 && !(document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith("1–24 /"); index += 1) await wait(25); const restored = (document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? "").startsWith("1–24 /"); return { stage: "checked", movedToNext, restored }; } finally { if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original); dispatch(original); await wait(100); } })()`);
      assert(benchmark3DMarkStorageProbe?.stage === "checked" && benchmark3DMarkStorageProbe.movedToNext === true && benchmark3DMarkStorageProbe.restored === true, "3DMark 작업 패키지가 다른 탭의 offset storage 변경을 반영하지 못했습니다. probe=" + JSON.stringify(benchmark3DMarkStorageProbe));
    }
    try {
      await waitForValue(client, "document.querySelector('[data-testid=\"benchmark-3dmark-package-to-batch\"]')?.disabled === false", "3DMark storage sync 이후 일괄 입력 준비");
    } catch (error) {
      let probe = "브라우저 상태를 읽지 못했습니다.";
      try {
        probe = await client.evaluate("JSON.stringify({ range: document.querySelector('[data-testid=\\\"benchmark-3dmark-package-range\\\"]')?.textContent ?? '', packageDisabled: document.querySelector('[data-testid=\\\"benchmark-3dmark-package-to-batch\\\"]')?.disabled ?? null, packageLoading: document.querySelector('[data-testid=\\\"benchmark-3dmark-work-package\\\"] [role=\\\"status\\\"]')?.textContent ?? '', disabledControls: [...document.querySelectorAll('button:disabled, input:disabled, textarea:disabled, select:disabled')].slice(0, 24).map((node) => ({ tag: node.tagName, testId: node.getAttribute('data-testid'), label: node.getAttribute('aria-label'), text: (node.textContent ?? '').trim().slice(0, 80) })) })");
      } catch {
        // Preserve the original timeout when the browser cannot be inspected.
      }
      throw new Error(`${error instanceof Error ? error.message : String(error)} probe=${probe}`);
    }
    assert((await clickSelector(client, '[data-testid="benchmark-3dmark-package-to-batch"]', 1)) === 1, "3DMark 작업 패키지의 일괄 입력 준비 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, `document.querySelector('[data-testid="benchmark-3dmark-batch-input"]')?.value?.startsWith('partId,sourceUrl\\n') === true && document.querySelector('[data-testid="benchmark-3dmark-batch-input"]')?.value?.split('\\n').length === ${Math.min(benchmark3DMarkPackageTotal, 12) + 1}`, "3DMark 작업 패키지 ID의 일괄 입력 준비");
    assert((await clickSelector(client, '[data-testid="benchmark-3dmark-work-package"] input[type="checkbox"]', 1)) === 1, "3DMark GPU 검수 작업 완료 체크를 클릭하지 못했습니다.");
    await waitForValue(client, `document.querySelector('[data-testid="benchmark-3dmark-package-progress"]')?.textContent?.includes('1 / ${benchmark3DMarkFirstPageEnd}') === true`, "3DMark GPU 검수 작업 진행률");
    if (benchmark3DMarkPackageTotal > 24) {
      assert((await clickSelector(client, '[data-testid="benchmark-3dmark-package-next"]', 1)) === 1, "3DMark GPU 검수 다음 작업 패키지 버튼을 클릭하지 못했습니다.");
      await waitForValue(client, `document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent?.startsWith('${benchmark3DMarkSecondPageStart}') === true`, "3DMark GPU 검수 다음 작업 패키지");
    }
    const stale3DMarkPackageProbe = await client.evaluate("fetch('/api/admin/benchmark-review/work-package?offset=24&limit=24&queueFingerprint=stale-3dmark-queue').then((response) => response.json())");
    assert(stale3DMarkPackageProbe?.queueChanged === true && typeof stale3DMarkPackageProbe?.queueFingerprint === 'string', "3DMark GPU 검수 작업 패키지의 stale fingerprint 감지가 동작하지 않습니다. probe=" + JSON.stringify(stale3DMarkPackageProbe));
    await client.send("Page.reload");
    await waitForValue(client, "document.getElementById('admin-benchmark-review') !== null", "3DMark GPU 검수 작업 패키지 앵커 복구");
    await client.evaluate("(() => { const target = document.getElementById('admin-benchmark-review'); target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true }); return Boolean(target); })()");
    const benchmark3DMarkResumeOffset = benchmark3DMarkPackageTotal > 24 ? 24 : 0;
    const benchmark3DMarkResumeRange = benchmark3DMarkPackageTotal > 24 ? benchmark3DMarkSecondPageStart : `1–${benchmark3DMarkFirstPageEnd} /`;
    try {
      await waitForValue(client, `document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent?.startsWith('${benchmark3DMarkResumeRange}') === true && document.querySelector('[data-testid="benchmark-3dmark-package-previous"]')?.disabled === ${benchmark3DMarkResumeOffset === 0}`, "3DMark GPU 검수 작업 패키지 재개");
    } catch (error) {
      const resumeProbe = await client.evaluate("(() => { let progress; try { progress = JSON.parse(localStorage.getItem('pc-supporter-3dmark-review-work-progress-v1') ?? 'null'); } catch { progress = null; } const node = document.querySelector('[data-testid=\"benchmark-3dmark-work-package\"]'); return { url: location.href, range: document.querySelector('[data-testid=\"benchmark-3dmark-package-range\"]')?.textContent ?? '', previousDisabled: document.querySelector('[data-testid=\"benchmark-3dmark-package-previous\"]')?.disabled ?? null, progress, loading: node?.textContent?.includes('계산하는 중') ?? false, error: node?.textContent?.includes('불러오지 못했습니다') ?? false, body: (node?.textContent ?? '').slice(0, 500) }; })()");
      throw new Error((error instanceof Error ? error.message : String(error)) + " probe=" + JSON.stringify(resumeProbe));
    }
    assert(await client.evaluate(`(() => { try { const value = JSON.parse(localStorage.getItem('pc-supporter-3dmark-review-work-progress-v1') ?? 'null'); return value?.offset === ${benchmark3DMarkResumeOffset} && Array.isArray(value?.completedIds) && value.completedIds.length === 1 && typeof value.queueFingerprint === 'string'; } catch { return false; } })()`), "3DMark GPU 검수 작업 위치·완료 체크가 새로고침 후 보존되지 않았습니다.");
    if (benchmark3DMarkPackageTotal > 24) {
      assert((await clickSelector(client, '[data-testid="benchmark-3dmark-package-previous"]', 1)) === 1, "3DMark GPU 검수 이전 작업 패키지 버튼을 클릭하지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"benchmark-3dmark-package-range\"]')?.textContent?.startsWith('1–24 /') === true && document.querySelector('[data-testid=\"benchmark-3dmark-work-package\"] input[type=\"checkbox\"]')?.checked === true && document.querySelector('[data-testid^=\"benchmark-3dmark-package-open-\"]')?.disabled === false", "3DMark GPU 검수 이전 패키지 복귀");
    }
    const packageTarget = await client.evaluate("(() => { const button = document.querySelector('[data-testid^=\"benchmark-3dmark-package-open-\"]'); return { partId: button?.getAttribute('data-part-id'), partName: button?.getAttribute('data-part-name') }; })()");
    assert(typeof packageTarget?.partId === 'string' && packageTarget.partId.length > 0 && typeof packageTarget?.partName === 'string' && packageTarget.partName.length > 0, "3DMark GPU 작업 패키지의 첫 항목 식별자를 읽지 못했습니다.");
    assert((await clickSelector(client, '[data-testid^="benchmark-3dmark-package-open-"]', 1)) === 1, "3DMark GPU 작업 패키지의 검수 작성기 열기 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, `document.querySelector('[data-testid=\"benchmark-3dmark-import\"]') !== null && document.querySelector('.benchmark-override-composer-search input')?.value === ${JSON.stringify(packageTarget.partName)} && document.querySelector('.benchmark-override-selected')?.textContent?.includes(${JSON.stringify(packageTarget.partId)}) === true`, "3DMark 작업 패키지 검수 작성기 연결");
    assert(await setInputValue(client, '[aria-label="3DMark 결과 URL"]', "https://www.3dmark.com/spy/62191556"), "3DMark 결과 URL을 입력하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"benchmark-3dmark-preview\"]')?.disabled === false", "3DMark 미리보기 준비");
    const benchmarkPreviewProbe = await client.evaluate(`(async () => { const originalFetch = window.fetch; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; if (url === '/api/admin/benchmark-import/3dmark' && init?.method === 'POST') return new Response(JSON.stringify({ partId: 'gpu-rtx-4060', partName: '검수 GPU', sourceUrl: 'https://www.3dmark.com/spy/62191556', resultId: '62191556', benchmark: 'time_spy', benchmarkLabel: '3DMark Time Spy', scoreKey: 'gpu3dmarkTimeSpyScore', score: 22779, gpuName: 'NVIDIA GeForce RTX 4060', identityStatus: 'matched', identityDetail: '선택 부품과 결과 페이지의 GPU 식별자가 일치합니다.', fetchedAt: '2026-09-05T00:00:00.000Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); return originalFetch(input, init); }; try { const button = document.querySelector('[data-testid="benchmark-3dmark-preview"]'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); for (let index = 0; index < 40 && !document.querySelector('[data-testid="benchmark-3dmark-preview-result"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); return Boolean(document.querySelector('[data-testid="benchmark-3dmark-preview-result"]')); } finally { window.fetch = originalFetch; } })()`);
    assert(benchmarkPreviewProbe === true, "3DMark 결과 미리보기 카드가 렌더링되지 않았습니다.");
    const benchmarkPreviewText = await client.evaluate("document.querySelector('[data-testid=\"benchmark-3dmark-preview-result\"]')?.textContent ?? ''");
    assert(benchmarkPreviewText.includes('GPU 식별 일치') && benchmarkPreviewText.includes('22,779') && benchmarkPreviewText.includes('3DMark Time Spy'), "3DMark 결과 미리보기의 식별 상태·점수·벤치마크명이 올바르지 않습니다. text=" + benchmarkPreviewText);
    assert((await clickSelector(client, '[data-testid="benchmark-3dmark-add"]', 1)) === 1, "일치한 3DMark 결과를 검수 JSON에 반영하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"벤치마크 보강 JSON\"]')?.value?.includes('\\\"gpu3dmarkTimeSpyScore\\\": 22779') === true && document.querySelector('[aria-label=\"벤치마크 보강 JSON\"]')?.value?.includes('\\\"sourceKind\\\": \\\"community_measurement\\\"') === true", "3DMark 점수의 검수 JSON 반영");
    assert(await setTextValue(client, '[data-testid="benchmark-3dmark-batch-input"]', "partId,sourceUrl\ngpu-rtx-4060,https://www.3dmark.com/prt/72191556\ngpu-rtx-5090,https://www.3dmark.com/spy/72191557"), "3DMark 일괄 입력을 채우지 못했습니다.");
    const benchmark3DMarkBatchProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      let request;
      const headers = { 'Content-Type': 'application/json' };
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const requestUrl = new URL(url, window.location.href);
        if (requestUrl.pathname === '/api/admin/benchmark-import/3dmark/batch' && init?.method === 'POST') {
          request = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
          return new Response(JSON.stringify({ schemaVersion: 1, kind: '3dmark-batch-preview', readOnly: true, generatedAt: '2026-09-06T00:00:00.000Z', maxItems: 12, requestedCount: 2, processedCount: 2, matchedCount: 1, reviewCount: 1, failedCount: 0, items: [
            { row: 1, partId: 'gpu-rtx-4060', partName: '검수 GPU 4060', sourceUrl: 'https://www.3dmark.com/prt/72191556', status: 'matched', preview: { sourceUrl: 'https://www.3dmark.com/prt/72191556', resultId: '72191556', benchmark: 'port_royal', benchmarkLabel: '3DMark Port Royal', scoreKey: 'gpu3dmarkPortRoyalScore', score: 11234, gpuName: 'NVIDIA GeForce RTX 4060', identityStatus: 'matched', identityDetail: '선택 부품과 결과 페이지의 GPU 식별자가 일치합니다.', fetchedAt: '2026-09-06T00:00:00.000Z' } },
            { row: 2, partId: 'gpu-rtx-5090', partName: '검수 GPU 5090', sourceUrl: 'https://www.3dmark.com/spy/72191557', status: 'manual_required', preview: { sourceUrl: 'https://www.3dmark.com/spy/72191557', resultId: '72191557', benchmark: 'time_spy', benchmarkLabel: '3DMark Time Spy', scoreKey: 'gpu3dmarkTimeSpyScore', score: 30123, gpuName: 'NVIDIA GeForce RTX 5090', identityStatus: 'manual_required', identityDetail: '수동 대조 필요', fetchedAt: '2026-09-06T00:00:00.000Z' } }
          ] }), { status: 200, headers });
        }
        return originalFetch(input, init);
      };
      try {
        const button = document.querySelector('[data-testid="benchmark-3dmark-batch-preview"]');
        if (!(button instanceof HTMLButtonElement)) return { stage: 'missing-preview' };
        button.click();
        for (let index = 0; index < 40 && !document.querySelector('[data-testid="benchmark-3dmark-batch-summary"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        const summary = document.querySelector('[data-testid="benchmark-3dmark-batch-summary"]')?.textContent ?? '';
        const list = document.querySelector('[data-testid="benchmark-3dmark-batch"] .benchmark-3dmark-batch-list')?.textContent ?? '';
        return { request, summary, list, rendered: Boolean(document.querySelector('[data-testid="benchmark-3dmark-batch-summary"]')) };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(benchmark3DMarkBatchProbe?.rendered === true && benchmark3DMarkBatchProbe.request?.items?.length === 2 && benchmark3DMarkBatchProbe.summary.includes('식별 일치 1') && benchmark3DMarkBatchProbe.summary.includes('수동 대조 1') && benchmark3DMarkBatchProbe.list.includes('GPU 식별 일치') && benchmark3DMarkBatchProbe.list.includes('수동 대조'), "3DMark 일괄 미리보기의 입력 전달·상태 요약·결과 목록이 올바르지 않습니다. probe=" + JSON.stringify(benchmark3DMarkBatchProbe));
    assert((await clickSelector(client, '[data-testid="benchmark-3dmark-batch-add"]', 1)) === 1, "3DMark 일괄 미리보기의 일치 결과를 JSON에 반영하지 못했습니다.");
    await waitForValue(client, `document.querySelector('[aria-label="벤치마크 보강 JSON"]')?.value?.includes('"gpu3dmarkPortRoyalScore": 11234') === true && document.querySelector('[aria-label="벤치마크 보강 JSON"]')?.value?.includes('"sourceUrl": "https://www.3dmark.com/prt/72191556"') === true`, "3DMark 일괄 일치 결과의 검수 JSON 반영");
    const benchmarkSaveRefreshProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const headers = { 'Content-Type': 'application/json' };
      let packageRequests = 0;
      let reviewRequests = 0;
      let saved = false;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const requestUrl = new URL(url, window.location.href);
        if (requestUrl.pathname === '/api/admin/benchmark-review/work-package') {
          packageRequests += 1;
          const response = await originalFetch(input, init);
          if (!saved) return response;
          const payload = await response.json();
          return new Response(JSON.stringify({ ...payload, items: [], nextOffset: undefined, summary: { ...payload.summary, queueTotal: 0, remainingCount: 0 } }), { status: response.status, headers });
        }
        if (requestUrl.pathname === '/api/admin/benchmark-review') {
          reviewRequests += 1;
          return originalFetch(input, init);
        }
        if (requestUrl.pathname === '/api/admin/benchmark-overrides/validate' && init?.method === 'POST') {
          return new Response(JSON.stringify({ validCount: 1, invalidCount: 0, items: [{ partId: 'gpu-rtx-4060', partName: '검수 GPU', category: 'gpu', valid: true, errors: [], operation: 'update', changedFields: ['gpu3dmarkTimeSpyScore'] }] }), { status: 200, headers });
        }
        if (requestUrl.pathname === '/api/admin/benchmark-overrides' && init?.method === 'PUT') {
          saved = true;
          return new Response(JSON.stringify({ saved: true, count: 1, items: [] }), { status: 200, headers });
        }
        return originalFetch(input, init);
      };
      try {
        const before = { packageRequests, reviewRequests };
        const validate = document.querySelector('[data-testid="benchmark-overrides-validate"]');
        if (!(validate instanceof HTMLButtonElement)) return { stage: 'missing-validate', before };
        validate.click();
        for (let index = 0; index < 40 && !document.querySelector('.benchmark-override-validation')?.textContent?.includes('저장 가능'); index += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        const save = document.querySelector('[data-testid="benchmark-overrides-save"]');
        if (!(save instanceof HTMLButtonElement) || save.disabled) return { stage: 'save-disabled', before, validation: document.querySelector('.benchmark-override-validation')?.textContent ?? '' };
        save.click();
        for (let index = 0; index < 60; index += 1) {
          if (saved && packageRequests > before.packageRequests && document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent === '0 / 0') return { stage: 'refreshed', before, packageRequests, reviewRequests, saved, packageEmpty: true };
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return { stage: 'timeout', before, packageRequests, reviewRequests, saved, packageRange: document.querySelector('[data-testid="benchmark-3dmark-package-range"]')?.textContent ?? '' };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(benchmarkSaveRefreshProbe?.stage === 'refreshed' && benchmarkSaveRefreshProbe.saved === true && benchmarkSaveRefreshProbe.packageEmpty === true && benchmarkSaveRefreshProbe.packageRequests > benchmarkSaveRefreshProbe.before.packageRequests && benchmarkSaveRefreshProbe.reviewRequests > benchmarkSaveRefreshProbe.before.reviewRequests, "벤치마크 저장 성공 후 일반 검수 큐·3DMark 작업 패키지가 최신 상태로 갱신되지 않았습니다. probe=" + JSON.stringify(benchmarkSaveRefreshProbe));
    await waitForValue(client, "document.getElementById('admin-catalog-spec-review') !== null", "카탈로그 스펙 보강 큐 lazy anchor");
    await client.evaluate("(() => { const node = document.getElementById('admin-catalog-spec-review'); node?.scrollIntoView({ block: 'center' }); node?.focus({ preventScroll: true }); return Boolean(node); })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-spec-review\"]') !== null && (document.body?.innerText ?? '').includes('카탈로그 스펙 보강 작업 패키지')", "카탈로그 스펙 보강 큐");
    await waitForValue(client, "document.querySelectorAll('[data-testid=\"catalog-spec-review-item\"]').length > 0 && document.querySelector('[data-testid=\"catalog-spec-review-download\"]') !== null", "카탈로그 스펙 보강 작업 항목");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-refresh-history\"]') !== null && (document.body?.innerText ?? '').includes('최근 보강 실행 이력')", "카탈로그 스펙 보강 실행 이력");
    const refreshHistory = await client.evaluate("fetch('/api/admin/catalog-spec/refresh-history?limit=5').then((response) => response.json())");
    assert(Array.isArray(refreshHistory?.items), "카탈로그 스펙 보강 실행 이력 API 응답이 올바르지 않습니다.");
    const refreshProgress = await client.evaluate("fetch('/api/admin/catalog-spec/refresh-progress').then((response) => response.json())");
    assert(typeof refreshProgress?.runCount === 'number' && typeof refreshProgress?.coverageRunCount === 'number' && typeof refreshProgress?.pcieNewlyCompleteCount === 'number' && typeof refreshProgress?.pcieResolvedFieldCount === 'number' && Array.isArray(refreshProgress?.pcieFieldProgress) && Array.isArray(refreshProgress?.points) && Array.isArray(refreshProgress?.fieldProgress) && Array.isArray(refreshProgress?.categoryProgress), "카탈로그 스펙 보강 품질 추이 API 응답이 올바르지 않습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-refresh-progress\"]') !== null && document.querySelector('[data-testid=\"catalog-spec-refresh-pcie-progress\"]') !== null && document.querySelector('[data-testid=\"catalog-spec-refresh-field-progress\"]') !== null && document.querySelector('[data-testid=\"catalog-spec-refresh-category-progress\"]') !== null && document.querySelector('[data-testid=\"catalog-spec-refresh-category-coverage\"]') !== null && (document.body?.innerText ?? '').includes('보강 품질 추이') && (document.body?.innerText ?? '').includes('완성 전환 누적') && (document.body?.innerText ?? '').includes('PCIe EVIDENCE LANE')", "카탈로그 스펙 보강 품질 추이");
    const reviewPackage = await client.evaluate("fetch('/api/admin/catalog-spec/review-package?category=gpu&limit=2').then((response) => response.json())");
    assert(reviewPackage?.kind === 'catalog-spec-review-package' && reviewPackage?.schemaVersion === 1 && reviewPackage?.category === 'gpu' && typeof reviewPackage?.queueFingerprint === 'string' && reviewPackage.queueFingerprint.length > 0 && reviewPackage?.excludedNonCoreCount >= 0 && Array.isArray(reviewPackage?.items), "카탈로그 스펙 보강 작업 패키지 API 응답이 올바르지 않습니다.");
    const pcieReviewPackage = await client.evaluate("fetch('/api/admin/catalog-spec/review-package?category=motherboard&evidence=pcie&limit=2').then((response) => response.json())");
    assert(pcieReviewPackage?.kind === 'catalog-spec-review-package' && pcieReviewPackage?.schemaVersion === 1 && pcieReviewPackage?.category === 'motherboard' && pcieReviewPackage?.evidence === 'pcie' && pcieReviewPackage?.summary?.total > 0 && pcieReviewPackage?.categoryMismatchExcludedCount >= 0 && Array.isArray(pcieReviewPackage?.fields) && pcieReviewPackage.fields.length === 4 && pcieReviewPackage.fields.every((field) => field.field.startsWith('pcieX')) && Array.isArray(pcieReviewPackage?.items) && pcieReviewPackage.items.length > 0 && pcieReviewPackage.items.every((item) => Array.isArray(item.pcieMissingFields) && item.pcieMissingFields.length > 0 && item.evidenceKind === 'pcie') && !pcieReviewPackage.items.some((item) => /라즈베리\s*파이|raspberry\s*pi|아두이노|arduino|임베디드\s*보드|서보\s*모터/i.test(item.partName)), "PCIe 전용 스펙 보강 작업 패키지가 일반 누락 필드와 카테고리 불일치 레코드를 분리하지 못했습니다. package=" + JSON.stringify(pcieReviewPackage));
    const invalidEvidencePackage = await client.evaluate("fetch('/api/admin/catalog-spec/review-package?evidence=unknown').then(async (response) => ({ status: response.status, body: await response.json() }))");
    assert(invalidEvidencePackage?.status === 400 && typeof invalidEvidencePackage?.body?.error === 'string', "스펙 보강 큐의 잘못된 evidence 범위가 차단되지 않았습니다. probe=" + JSON.stringify(invalidEvidencePackage));
    assert(await selectLabel(client, "정보 범위", "pcie"), "관리자 스펙 보강 목록의 PCIe 정보 범위를 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"스펙 보강 목록 정보 범위\"]')?.value === 'pcie' && document.querySelectorAll('[data-testid=\"catalog-spec-review-item\"] .catalog-spec-review-evidence.pcie').length > 0", "관리자 PCIe 전용 정보 목록 렌더링");
    assert(await selectLabel(client, "정보 범위", "all"), "관리자 스펙 보강 목록의 전체 정보 범위를 복귀하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"스펙 보강 목록 정보 범위\"]')?.value === 'all'", "관리자 전체 정보 목록 복귀");
    const refreshOnlyPackage = await client.evaluate("fetch('/api/admin/catalog-spec/review-package?category=gpu&action=refresh_source&limit=2').then((response) => response.json())");
    assert(refreshOnlyPackage?.action === 'refresh_source' && Array.isArray(refreshOnlyPackage?.items) && refreshOnlyPackage.items.every((item) => item.nextAction === 'refresh_source'), "카탈로그 스펙 작업 유형 필터가 자동 원문 재확인 범위를 분리하지 못했습니다.");
    const reviewNextPackage = await client.evaluate(`fetch('/api/admin/catalog-spec/review-package?category=gpu&limit=2&offset=2&queueFingerprint=${encodeURIComponent(reviewPackage.queueFingerprint)}').then((response) => response.json())`);
    assert(reviewNextPackage?.queueChanged !== true && reviewNextPackage?.queueFingerprint === reviewPackage.queueFingerprint, "카탈로그 스펙 보강 작업 패키지 fingerprint가 페이지 간 유지되지 않습니다.");
    const changedReviewPackage = await client.evaluate("fetch('/api/admin/catalog-spec/review-package?category=gpu&limit=2&offset=2&queueFingerprint=stale-queue-fingerprint').then((response) => response.json())");
    assert(changedReviewPackage?.queueChanged === true && changedReviewPackage?.queueFingerprint === reviewPackage.queueFingerprint, "카탈로그 스펙 보강 큐 변경 감지가 stale offset을 표시하지 않았습니다.");
    assert(await client.evaluate("(() => { const select = document.querySelector('[aria-label=\"스펙 보강 목록 작업 유형\"]'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, 'refresh_source'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === 'refresh_source'; })()"), "카탈로그 스펙 작업 유형 필터를 선택하지 못했습니다.");
    assert(await clickText(client, "목록 검색"), "카탈로그 스펙 작업 유형 필터 검색 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"스펙 보강 목록 작업 유형\"]')?.value === 'refresh_source' && document.querySelectorAll('[data-testid=\"catalog-spec-review-item\"]').length > 0", "자동 원문 재확인 작업 유형 필터");
    await waitForValue(client, "document.querySelectorAll('[data-testid=\"catalog-spec-review-item\"] input[type=\"checkbox\"]:not([disabled])').length > 0", "스펙 보강 일괄 재확인 선택 항목");
    assert((await clickSelector(client, '[data-testid="catalog-spec-review-item"] input[type="checkbox"]:not([disabled])', 1)) === 1, "스펙 보강 일괄 재확인 항목을 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-review-refresh-batch\"]')?.disabled === false", "스펙 보강 일괄 재확인 활성화");
    assert((await clickSelector(client, '[data-testid="catalog-spec-review-item"] input[type="checkbox"]:checked', 1)) === 1, "스펙 보강 일괄 재확인 선택을 해제하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-review-refresh-batch\"]')?.disabled === true", "스펙 보강 일괄 재확인 비활성화");
    const duplicateBatch = await client.evaluate("fetch('/api/admin/catalog-spec/refresh-batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partIds: ['duplicate', 'duplicate'] }) }).then(async (response) => ({ status: response.status, body: await response.json() }))");
    assert(duplicateBatch?.status === 400 && duplicateBatch?.body?.code === 'PART_REFRESH_BATCH_DUPLICATE_ID', "스펙 보강 일괄 재확인 중복 ID 차단이 동작하지 않습니다.");
    await waitForValue(client, "document.getElementById('admin-catalog-spec-override') !== null", "제조사 정보 수동 스펙 보강 anchor");
    await client.evaluate("(() => { const node = document.getElementById('admin-catalog-spec-override'); node?.scrollIntoView({ block: 'center', behavior: 'auto' }); node?.focus({ preventScroll: true }); return Boolean(node); })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-spec-override\"]')?.textContent?.includes('제조사 정보 수동 스펙 보강') === true", "수동 카탈로그 스펙 override 패널");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-spec-override-list\"]') !== null && document.querySelector('[aria-label=\"수동 스펙 보강 부품 검색\"]') !== null", "수동 스펙 override 목록·검색");
    const adminSearchLatestResponseProbe = await client.evaluate("(async () => { const input = document.querySelector('[aria-label=\"수동 스펙 보강 부품 검색\"]'); const category = document.querySelector('[aria-label=\"수동 스펙 보강 부품 범주\"]'); if (!(input instanceof HTMLInputElement) || !(category instanceof HTMLSelectElement)) return { stage: 'missing-controls' }; const originalFetch = window.fetch; window.fetch = async (request, init) => { const url = typeof request === 'string' ? request : request.url; const requestUrl = new URL(url, location.href); if (requestUrl.pathname === '/api/parts' && requestUrl.searchParams.get('category') === 'gpu') { await new Promise((resolve) => setTimeout(resolve, 350)); return new Response(JSON.stringify({ items: [{ id: 'stale-gpu-result', name: 'Stale GPU result', category: 'gpu', dataQuality: 'seed', missingFields: ['powerW'], specs: {} }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(request, init); }; try { const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; inputSetter?.call(input, 'stale-gpu'); input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 25)); const form = input.closest('form'); if (!(form instanceof HTMLFormElement)) return { stage: 'missing-form' }; form.requestSubmit(); await new Promise((resolve) => setTimeout(resolve, 25)); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; selectSetter?.call(category, 'case'); category.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 450)); return { stage: 'checked', category: category.value, results: [...document.querySelectorAll('.catalog-spec-override-search-results button')].map((node) => node.textContent ?? '') }; } finally { window.fetch = originalFetch; } })()");
    assert(adminSearchLatestResponseProbe?.stage === 'checked' && adminSearchLatestResponseProbe.category === 'case' && adminSearchLatestResponseProbe.results.length === 0, "관리자 스펙 검색의 이전 범주 응답이 최신 범주 화면을 덮었습니다. probe=" + JSON.stringify(adminSearchLatestResponseProbe));
    const adminMetaLatestResponseProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; const baseline = await originalFetch('/api/meta').then((response) => response.json()); let calls = 0; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase(); if (requestUrl.pathname === '/api/meta' && method === 'GET') { calls += 1; const probeMeta = { ...baseline, engineVersion: calls === 1 ? 'meta-stale-probe' : 'meta-fresh-probe', catalogCount: (baseline.catalogCount ?? 0) + calls }; if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 350)); return new Response(JSON.stringify(probeMeta), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); }; try { window.dispatchEvent(new Event('pc-supporter:catalog-meta-refresh')); window.dispatchEvent(new Event('pc-supporter:catalog-meta-refresh')); for (let index = 0; index < 60; index += 1) { const body = document.body?.innerText ?? ''; if (calls >= 2 && body.includes('meta-fresh-probe') && !body.includes('meta-stale-probe')) break; await new Promise((resolve) => setTimeout(resolve, 25)); } const body = document.body?.innerText ?? ''; return { stage: 'checked', calls, fresh: body.includes('meta-fresh-probe'), stale: body.includes('meta-stale-probe') }; } finally { window.fetch = originalFetch; } })()");
    assert(adminMetaLatestResponseProbe?.stage === 'checked' && adminMetaLatestResponseProbe.calls === 2 && adminMetaLatestResponseProbe.fresh === true && adminMetaLatestResponseProbe.stale === false, "관리자 meta 최신 응답이 이전 meta 응답에 의해 덮였습니다. probe=" + JSON.stringify(adminMetaLatestResponseProbe));
    const overrideValidation = await client.evaluate("fetch('/api/admin/catalog-spec-overrides/batch/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ partId: 'missing-override-part', category: 'gpu', fields: { powerW: 320 }, manufacturerModel: 'MISSING', sourceNote: '테스트', sourceUrl: 'https://vendor.example/test' }] }) }).then(async (response) => ({ status: response.status, body: await response.json() }))");
    assert(overrideValidation?.status === 200 && overrideValidation?.body?.invalidCount > 0, "수동 스펙 override 검증 API의 오류 항목 반환이 동작하지 않습니다.");
    assert((await clickSelector(client, '[data-testid="admin-catalog-spec-missing-field"]', 1)) === 1, "카탈로그 누락 필드 이동 링크를 클릭하지 못했습니다.");
    await waitForValue(client, "location.pathname === '/catalog' && new URLSearchParams(location.search).get('missingField') !== null && document.querySelector('[data-testid=\"catalog-missing-field-filter\"]') !== null", "카탈로그 누락 필드 필터");
    await waitForValue(client, "document.querySelectorAll('[data-testid^=\"catalog-part-\"]').length > 0 && (document.body?.innerText ?? '').includes('누락 필드 필터')", "카탈로그 누락 필드 결과");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-refresh-part\"]') !== null", "카탈로그 부품 원문 재확인 액션");
    const coreRefreshMockInstalled = await client.evaluate("(async () => { const partButton = document.querySelector('.catalog-part-card [data-testid^=\"catalog-part-\"]'); const testId = partButton?.getAttribute('data-testid') ?? ''; const partId = testId.replace(/^catalog-part-/, ''); if (!partId) return false; const currentResponse = await fetch('/api/parts/' + encodeURIComponent(partId)); const current = await currentResponse.json(); if (!current?.id) return false; const originalFetch = window.fetch; window.__pcSupporterCatalogRefreshFetch = originalFetch; const previousPrice = typeof current.priceWon === 'number' ? current.priceWon : 100000; const nextPrice = previousPrice + 1000; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase(); if (requestUrl.pathname.startsWith('/api/parts/') && requestUrl.pathname.endsWith('/refresh') && method === 'POST') { const refreshedAt = new Date().toISOString(); return new Response(JSON.stringify({ part: { ...current, priceWon: nextPrice, updatedAt: refreshedAt }, previousDataQuality: current.dataQuality, previousMissingFields: current.missingFields ?? [], changedFields: ['가격'], valueDiffs: [{ field: '가격', previous: previousPrice.toLocaleString('ko-KR') + '원', next: nextPrice.toLocaleString('ko-KR') + '원' }], refreshedAt }), { status: 200, headers: { 'content-type': 'application/json' } }); } return originalFetch(input, init); }; return true; })()");
    assert(coreRefreshMockInstalled === true, "카탈로그 부품 원문 재확인 테스트 mock을 설치하지 못했습니다.");
    assert((await clickSelector(client, '[data-testid="catalog-refresh-part"]', 1)) === 1, "카탈로그 부품 원문 재확인 성공 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.catalog-detail-refresh-status:not(.error)') !== null && document.querySelector('[data-testid=\"catalog-detail-refresh-diff\"]') !== null && (document.body?.innerText ?? '').includes('가격')", "카탈로그 부품 원문 재확인 값 변화");
    assert(await client.evaluate("(() => { const originalFetch = window.__pcSupporterCatalogRefreshFetch; if (!originalFetch) return false; window.fetch = originalFetch; delete window.__pcSupporterCatalogRefreshFetch; return true; })()"), "카탈로그 부품 원문 재확인 테스트 mock을 복원하지 못했습니다.");
    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: ["*://*/api/parts/*/refresh*"] });
    assert((await clickSelector(client, '[data-testid="catalog-refresh-part"]', 1)) === 1, "카탈로그 부품 원문 재확인 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.catalog-detail-refresh-status.error') !== null", "카탈로그 부품 원문 재확인 실패 안내");
    await client.send("Network.setBlockedURLs", { urls: [] });
    assert((await clickSelector(client, '[data-testid="catalog-missing-field-filter"] .text-button', 1)) === 1, "카탈로그 누락 필드 필터 해제 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "new URLSearchParams(location.search).get('missingField') === null && document.querySelector('[data-testid=\"catalog-missing-field-filter\"]') === null", "카탈로그 누락 필드 필터 해제");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=psu&mode=compatible&candidateScope=safe` });
    await waitForValue(client, "document.querySelector('.catalog-state') === null && (document.querySelectorAll('.catalog-part-card').length > 0 || document.querySelector('.catalog-part-list') !== null)", "호환 후보 목록 로딩");
    const incompleteNoticeProbe = await client.evaluate(`(async () => {
      const notice = document.querySelector('[data-testid="catalog-incomplete-notice"]');
      if (notice) return { present: true };
      let draft = null;
      try { draft = JSON.parse(localStorage.getItem('pc-supporter-draft') ?? 'null'); } catch { draft = null; }
      if (!draft) return { present: false, verified: false, reason: 'no-draft' };
      const response = await fetch('/api/parts/compatible', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'psu', build: draft, mode: 'safe', offset: 0, limit: 24 }) });
      const payload = response.ok ? await response.json() : null;
      return { present: false, verified: payload ? (payload.incompleteExcludedCount ?? 0) === 0 : false, incompleteExcludedCount: payload?.incompleteExcludedCount, status: response.status };
    })()`);
    if (incompleteNoticeProbe?.present === true) {
      await waitForValue(client, "document.querySelector('[data-testid=\"catalog-incomplete-notice\"]') !== null && document.querySelectorAll('[data-testid=\"catalog-open-missing-field\"]').length > 0 && (document.body?.innerText ?? '').includes('정보가 부족한 부품')", "호환 후보 데이터 부족 안내");
      assert((await clickSelector(client, '[data-testid="catalog-open-incomplete"]', 1)) === 1, "불완전 데이터 목록 링크를 클릭하지 못했습니다.");
      await waitForValue(client, "location.pathname === '/catalog' && new URLSearchParams(location.search).get('quality') === 'incomplete' && document.querySelector('[aria-label=\"카탈로그 데이터 상태\"]')?.value === 'incomplete'", "불완전 데이터 카탈로그 목록");
    } else {
      assert(incompleteNoticeProbe?.verified === true, "호환 후보 데이터 부족 안내가 없는데 안전 범위에서 제외된 미완료 후보가 남아 있습니다. probe=" + JSON.stringify(incompleteNoticeProbe));
    }
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu&quality=seed&priceStatus=known` });
    await waitForValue(client, "document.querySelector('[data-testid^=\"catalog-price-evidence-\"]') !== null && (document.body?.innerText ?? '').includes('참고 가격')", "참고 가격 표시");
    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await waitForHomeDemoButtons(client, "홈 화면 복귀");

    assert(await clickText(client, "문제 있는 예시 견적"), "문제 있는 예시 견적 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('.workspace-page') !== null && ((document.body?.innerText ?? '').includes('나의 PC 견적 구성') || (document.body?.innerText ?? '').includes('견적 구성'))", "견적 편집기");
    await waitForValue(client, "document.querySelector('button.button-primary.full-width')?.disabled === false || (document.body?.innerText ?? '').includes('검사할 준비가 되었습니다') || (document.body?.innerText ?? '').includes('모든 필수 부품을 선택했습니다')", "검사 준비 상태");
    await client.evaluate("(() => { document.querySelectorAll('.mobile-editor-advanced').forEach((node) => { if (node instanceof HTMLDetailsElement) node.open = true; }); return true; })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"build-price-summary\"]') !== null", "편집기 구매 금액 요약");
    assert(await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"build-price-summary\"]'); const text = node?.textContent ?? ''; return text.includes('핵심 부품') && text.includes('주변 부품') && (text.includes('가격 확인 완료') || text.includes('가격 일부 확인')); })()"), "편집기 구매 금액 요약에 가격 상태·구성별 소계가 표시되지 않았습니다.");
    const unknownMotherboardPayload = await fetch(`${baseUrl}/api/parts?category=motherboard&priceStatus=unknown&limit=1`).then((response) => response.ok ? response.json() : null).catch(() => null);
    const unknownMotherboard = unknownMotherboardPayload?.items?.[0];
    let unknownPriceHasSourceRefresh = false;
    if (unknownMotherboard?.id) {
    const partialBuild = { cpu: { partId: "cpu-7500f", quantity: 1 }, cooler: { partId: "cooler-small-am5", quantity: 1 }, motherboard: { partId: unknownMotherboard.id, quantity: 1 }, memory: [{ partId: "memory-ddr5-32-7200", quantity: 4 }], gpu: { partId: "gpu-rtx-5090", quantity: 1 }, ssd: [{ partId: "ssd-nvme-1tb", quantity: 4 }], hdd: [{ partId: "hdd-seagate-4tb", quantity: 4 }], case: { partId: "case-compact-matx", quantity: 1 }, psu: { partId: "psu-650w", quantity: 1 }, accessories: [], useIntegratedGraphics: false };
    await client.evaluate(`(() => { localStorage.setItem('pc-supporter-draft', ${JSON.stringify(JSON.stringify(partialBuild))}); localStorage.setItem('pc-supporter-recommendation-preferences', JSON.stringify({ priority: 'balanced', profile: 'general', listingPolicy: 'retail_only', gamingResolution: '1440p', budgetWon: 1500000 })); sessionStorage.removeItem('pc-supporter-last-compatibility-result'); sessionStorage.removeItem('pc-supporter-last-compatibility-input'); return true; })()`);
    await client.send("Page.navigate", { url: `${baseUrl}/build?priceSummaryPartial=1` });
    await client.evaluate("(() => { document.querySelectorAll('.mobile-editor-advanced').forEach((node) => { if (node instanceof HTMLDetailsElement) node.open = true; }); return true; })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"build-price-summary\"]') !== null", "부분 가격 요약 패널");
    await waitForValue(client, "document.querySelector('[data-testid=\"build-price-summary\"]')?.textContent?.includes('가격 일부 확인') === true", "부분 가격 상태");
    await waitForValue(client, `document.querySelector('[data-testid="build-price-summary-unknown-items"]')?.textContent?.includes(${JSON.stringify(unknownMotherboard.name)}) === true`, "부분 가격 미확인 항목");
    unknownPriceHasSourceRefresh = unknownMotherboard.source === "danawa" && Boolean(unknownMotherboard.danawaUrl);
    assert(await client.evaluate(`(() => { const node = document.querySelector('[data-testid="build-price-summary-unknown-items"]'); const summary = document.querySelector('[data-testid="build-price-summary"]'); const text = node?.textContent ?? ''; return text.includes('가격 확인이 필요한 항목') && (${JSON.stringify(unknownPriceHasSourceRefresh)} === false || text.includes('정보 다시 확인')) && (summary?.textContent ?? '').includes('예산 결과 보류'); })()`), "가격 미확인 항목 목록과 source 조건에 맞는 원문 재확인·예산 보류 상태가 표시되지 않았습니다.");
    assert(await clickText(client, "호환성 검사하기"), "부분 가격 견적 호환성 검사 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('검사 결과 상세') && document.querySelector('[data-testid=\"data-health-panel\"]') !== null", "부분 가격 견적 검사 결과");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-panel\"]') !== null", "부분 가격 견적 구매 목록");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-action-center\"]') !== null && document.querySelectorAll('[data-testid^=\"purchase-list-action-\"]').length > 0", "구매 다음 행동 센터");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-decision-gate\"]')?.textContent?.includes('구매 목록 단계') === true", "최종 구매 판단 구매 단계 요약");
    assert((await clickSelector(client, '[data-testid="purchase-decision-gate-purchase-action"]', 1)) === 1, "최종 구매 판단의 구매 목록 이동 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.activeElement?.getAttribute('data-testid') === 'purchase-list-panel'", "최종 구매 판단 구매 목록 이동");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-status-filter-planned\"]')?.classList.contains('selected') === true", "최종 구매 판단 구매 단계 필터 이동");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-status-board\"]') !== null && document.querySelector('.purchase-list-status-select') !== null", "구매 단계 보드");
    await waitForValue(client, "document.querySelector('[data-testid=\"assembly-plan-step-confirm-purchase\"]')?.textContent?.includes('수령·조립') === true", "구매·조립 실행 순서 진행도");
    await waitForValue(client, "document.querySelector('[data-testid=\"assembly-plan-resume\"]') !== null && ['차단 해결로 이동', '확인 필요로 이동', '선행 단계로 이동', '실측 로그 열기'].some((label) => (document.querySelector('[data-testid=\"assembly-plan-resume\"]')?.textContent ?? '').includes(label))", "구매·조립 실행 순서 재개 액션");
    assert((await clickSelector(client, '.data-health-toggle', 1)) === 1, "부분 가격 데이터 상태 상세를 열지 못했습니다.");
    if (unknownPriceHasSourceRefresh) {
    await waitForValue(client, "document.querySelectorAll('.data-refresh-button').length > 0", "부분 가격 원문 재확인 대상");
    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: ["*://*/api/parts/*/refresh*"] });
    assert((await clickSelector(client, '.data-refresh-button', 1)) === 1, "부분 가격 원문 재확인 실패 경로 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-catalog-refresh-report\"]')?.classList.contains('failed') === true", "원문 재확인 실패 보고서");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-catalog-refresh-retry-failed\"]') !== null", "실패 항목만 다시 확인 액션");
    await client.send("Network.setBlockedURLs", { urls: [] });
    const bulkRefreshProgressProbe = await client.evaluate(`(async () => {
      const button = document.querySelector('[data-testid="purchase-list-catalog-refresh-retry-failed"]') ?? document.querySelector('.data-refresh-all-button');
      const retryOnly = button?.getAttribute('data-testid') === 'purchase-list-catalog-refresh-retry-failed';
      if (!(button instanceof HTMLButtonElement) || button.disabled) return { available: false };
      const originalFetch = window.fetch.bind(window);
      let intercepted = 0;
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : String(input), location.href);
        const method = String(init?.method ?? 'GET').toUpperCase();
        const match = url.pathname.match(/^\\/api\\/(parts|accessories)\\/([^/]+)\\/refresh$/);
        if (method !== 'POST' || !match) return originalFetch(input, init);
        intercepted += 1;
        await new Promise((resolve) => setTimeout(resolve, 350));
        const detailResponse = await originalFetch(url.pathname.replace(/\\/refresh$/, ''), { method: 'GET' });
        const detail = await detailResponse.json();
        const payload = match[1] === 'parts'
          ? { part: detail, previousDataQuality: detail.dataQuality, previousMissingFields: detail.missingFields ?? [], changedFields: [], refreshedAt: new Date().toISOString() }
          : { item: detail, previousDataQuality: detail.dataQuality, previousMissingFields: detail.missingFields ?? [], changedFields: [], refreshedAt: new Date().toISOString() };
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      try {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const progress = document.querySelector('[data-testid="catalog-refresh-progress"]');
        const during = progress ? { text: progress.textContent ?? '', count: progress.querySelector('.topbar-refresh-progress-count')?.textContent ?? '', current: progress.querySelector('small')?.textContent ?? '', now: progress.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? '' } : undefined;
        for (let index = 0; index < 300 && document.querySelector('[data-testid="catalog-refresh-progress"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 100));
        return { available: true, retryOnly, intercepted, during };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(bulkRefreshProgressProbe?.available && bulkRefreshProgressProbe.retryOnly === true && bulkRefreshProgressProbe.intercepted > 0 && /\d+\s*\/\s*\d+/.test(bulkRefreshProgressProbe.during?.count ?? '') && (bulkRefreshProgressProbe.during?.text ?? '').includes('CATALOG REFRESH') && (bulkRefreshProgressProbe.during?.current ?? '').includes('확인 중'), "실패 항목만 다시 확인하는 복구 흐름 또는 카탈로그 원문 확인 진행 표시가 동작하지 않았습니다. probe=" + JSON.stringify(bulkRefreshProgressProbe));
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('[data-testid=\"purchase-list-catalog-refresh-report\"]') !== null", "bulk refresh 후 결과 report 안정화");
    }
    await client.evaluate("(() => { history.pushState({}, '', '/build'); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()");
    await waitForValue(client, "location.pathname === '/build' && document.querySelector('button.button-primary.full-width')?.disabled === false", "지연 refresh 경합 probe 편집기");
    const hasPreflightRefreshTarget = await client.evaluate("document.querySelector('.build-preflight-refresh') instanceof HTMLButtonElement");
    if (hasPreflightRefreshTarget === true) {
    await client.evaluate("document.querySelector('.build-preflight-refresh')?.classList.add('data-refresh-button')");
    const catalogRefreshLatestCancelProbe = await client.evaluate("(async () => { const originalFetch = window.fetch.bind(window); const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }); let intercepted = 0; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const requestUrl = new URL(url, location.href); const method = String(init?.method ?? 'GET').toUpperCase(); const match = requestUrl.pathname.match(/^\\/api\\/(parts|accessories)\\/([^/]+)\\/refresh$/); if (method === 'POST' && match) { intercepted += 1; const detailPath = requestUrl.pathname.replace(/\\/refresh$/, ''); const detail = await originalFetch(detailPath, { method: 'GET' }).then((result) => result.json()); await new Promise((resolve) => setTimeout(resolve, 900)); const refreshedAt = new Date().toISOString(); const next = { ...detail, updatedAt: refreshedAt }; return match[1] === 'parts' ? response({ part: next, previousDataQuality: detail.dataQuality, previousMissingFields: detail.missingFields ?? [], changedFields: ['stale-refresh-probe'], valueDiffs: [{ field: 'stale-refresh-probe', previous: '기존', next: '지연 응답' }], refreshedAt }) : response({ item: next, previousDataQuality: detail.dataQuality, previousMissingFields: detail.missingFields ?? [], changedFields: ['stale-refresh-probe'], valueDiffs: [{ field: 'stale-refresh-probe', previous: '기존', next: '지연 응답' }], refreshedAt }); } return originalFetch(input, init); }; try { let refreshButton = document.querySelector('.data-refresh-button'); if (!(refreshButton instanceof HTMLButtonElement)) { document.querySelector('.data-health-toggle')?.click(); for (let index = 0; index < 40 && !(document.querySelector('.data-refresh-button') instanceof HTMLButtonElement); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); refreshButton = document.querySelector('.data-refresh-button'); } if (!(refreshButton instanceof HTMLButtonElement)) return { stage: 'missing-refresh-button', intercepted }; refreshButton.click(); await new Promise((resolve) => setTimeout(resolve, 100)); history.pushState({}, '', '/build'); window.dispatchEvent(new PopStateEvent('popstate')); for (let index = 0; index < 80 && location.pathname !== '/build'; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); for (let index = 0; index < 160 && ![...document.querySelectorAll('button')].some((button) => !button.disabled && (button.textContent ?? '').includes('호환성 검사하기')); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const checkButton = [...document.querySelectorAll('button')].find((button) => !button.disabled && (button.textContent ?? '').includes('호환성 검사하기')); if (!(checkButton instanceof HTMLButtonElement)) return { stage: 'missing-check-button', intercepted, path: location.pathname }; checkButton.click(); for (let index = 0; index < 480 && location.pathname !== '/result'; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 1100)); const body = document.body?.innerText ?? ''; return { stage: 'checked', intercepted, path: location.pathname, staleReport: body.includes('stale-refresh-probe'), report: document.querySelector('[data-testid=\"purchase-list-catalog-refresh-report\"]')?.textContent ?? '', progress: Boolean(document.querySelector('[data-testid=\"catalog-refresh-progress\"]')) }; } finally { window.fetch = originalFetch; } })()");
    assert(catalogRefreshLatestCancelProbe?.stage === 'checked' && catalogRefreshLatestCancelProbe.intercepted > 0 && catalogRefreshLatestCancelProbe.path === '/result' && catalogRefreshLatestCancelProbe.staleReport === false && catalogRefreshLatestCancelProbe.progress === false, "새 호환성 검사 이후 이전 delayed catalog refresh가 report 또는 progress를 덮었습니다. probe=" + JSON.stringify(catalogRefreshLatestCancelProbe));
    }
    }
    await client.evaluate(`(() => { localStorage.setItem('pc-supporter-draft', ${JSON.stringify(JSON.stringify({ cpu: { partId: "cpu-7500f", quantity: 1 }, cooler: { partId: "cooler-small-am5", quantity: 1 }, motherboard: { partId: "mb-a620-small", quantity: 1 }, memory: [{ partId: "memory-ddr5-32-7200", quantity: 4 }], gpu: { partId: "gpu-rtx-5090", quantity: 1 }, ssd: [{ partId: "ssd-nvme-1tb", quantity: 4 }], hdd: [{ partId: "hdd-seagate-4tb", quantity: 4 }], case: { partId: "case-compact-matx", quantity: 1 }, psu: { partId: "psu-650w", quantity: 1 }, accessories: [], useIntegratedGraphics: false }))}); return true; })()`);
    await client.send("Page.navigate", { url: `${baseUrl}/build?priceSummaryComplete=1` });
    await waitForValue(client, "document.querySelector('[data-testid=\"build-price-summary\"]')?.textContent?.includes('가격 확인 완료') === true", "가격 요약 완전 확인 상태 복원");
    assert(await selectLabel(client, "사용 목적", "gaming"), "게이밍 추천 프로필을 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('label select option[value=gaming]')?.parentElement?.value === 'gaming'", "게이밍 추천 프로필 반영");
    assert(await selectLabel(client, "게임 해상도", "1440p"), "게이밍 목표 해상도를 선택하지 못했습니다.");
    assert(await selectLabel(client, "목표 주사율", "144"), "게이밍 목표 주사율을 선택하지 못했습니다.");

    assert(await clickText(client, "호환성 검사하기"), "호환성 검사 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('검사 결과 상세')", "호환성 검사 결과");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"result-price-summary\"]') !== null && (document.body?.innerText ?? '').includes('가격')", "결과 구매 금액 요약");
    assert(await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"result-price-summary\"]'); const text = node?.textContent ?? ''; return text.includes('카탈로그 기준 전체 합계') || text.includes('현재 확인된 부품 소계'); })()"), "결과 화면 구매 금액 요약에 합계 확정 상태가 표시되지 않았습니다.");
    await waitForValue(client, "document.querySelector('.part-watch-button[data-item-id]') !== null", "결과 PartWatchButton storage sync probe 준비");
    await sleep(2_000);
    const resultRenderLoopProbe = await client.evaluate("(() => ({ errors: (window.__pcSupporterSmokeErrors ?? []).filter((entry) => /Maximum update depth exceeded|Too many re-renders/.test(entry.message)), path: location.pathname, purchaseRows: document.querySelectorAll('.purchase-list-row').length }))()");
    assert(resultRenderLoopProbe.errors.length === 0 && resultRenderLoopProbe.path === '/result' && resultRenderLoopProbe.purchaseRows > 0, "결과 화면 렌더링 루프가 감지되었습니다. probe=" + JSON.stringify(resultRenderLoopProbe));
    const partWatchStorageKey = "pc-supporter-catalog-watchlist";
    const originalPartWatchlist = await client.evaluate("localStorage.getItem('pc-supporter-catalog-watchlist')");
    let partWatchStorageProbe;
    try {
      const controls = await client.evaluate("(() => { const button = document.querySelector('.part-watch-button[data-item-id]'); return { itemId: button?.getAttribute('data-item-id') ?? '', button: button instanceof HTMLButtonElement }; })()");
      if (!controls?.button || !controls.itemId) {
        partWatchStorageProbe = { stage: "missing-controls", itemId: controls?.itemId ?? "" };
      } else {
        await client.evaluate("(() => { localStorage.setItem('pc-supporter-catalog-watchlist', '[]'); window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-catalog-watchlist', newValue: '[]', storageArea: localStorage })); })()");
        await waitForValue(client, "document.querySelector('.part-watch-button[data-item-id]')?.classList.contains('watched') === false", "PartWatch 초기 미등록 상태");
        const entry = { itemId: controls.itemId, itemName: "cross-tab part watch probe", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
        const serialized = JSON.stringify([entry]);
        await client.evaluate(`(() => { const value = ${JSON.stringify(serialized)}; localStorage.setItem('pc-supporter-catalog-watchlist', value); window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-catalog-watchlist', newValue: value, storageArea: localStorage })); })()`);
        await waitForValue(client, "document.querySelector('.part-watch-button[data-item-id]')?.classList.contains('watched') === true", "PartWatch cross-tab 등록");
        await client.evaluate("(() => { localStorage.setItem('pc-supporter-catalog-watchlist', '[]'); window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-catalog-watchlist', newValue: '[]', storageArea: localStorage })); })()");
        await waitForValue(client, "document.querySelector('.part-watch-button[data-item-id]')?.classList.contains('watched') === false", "PartWatch cross-tab 제거");
        partWatchStorageProbe = { stage: "checked", itemId: controls.itemId, initiallyUnwatched: true, added: true, removed: true };
      }
    } finally {
      await client.evaluate(`(() => { const original = ${JSON.stringify(originalPartWatchlist)}; if (original === null) localStorage.removeItem(${JSON.stringify(partWatchStorageKey)}); else localStorage.setItem(${JSON.stringify(partWatchStorageKey)}, original); window.dispatchEvent(new StorageEvent('storage', { key: ${JSON.stringify(partWatchStorageKey)}, newValue: original, storageArea: localStorage })); })()`);
      await sleep(100);
    }
    assert(partWatchStorageProbe?.stage === "checked" && partWatchStorageProbe.initiallyUnwatched === true && partWatchStorageProbe.added === true && partWatchStorageProbe.removed === true, "결과 PartWatchButton이 다른 탭의 watch-list 추가·제거를 반영하지 못했습니다. probe=" + JSON.stringify(partWatchStorageProbe));
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-checklist\"] input[type=checkbox]') !== null", "구매 체크리스트 cross-tab probe 준비");
    const purchaseChecklistStorageProbe = await client.evaluate(`(async () => {
      const checkbox = document.querySelector('[data-testid="purchase-checklist"] input[type="checkbox"]');
      if (!(checkbox instanceof HTMLInputElement)) return { stage: "missing-checkbox" };
      checkbox.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const storageKeys = Object.keys(localStorage).filter((key) => key.startsWith("pc-supporter-purchase-checklist:"));
      const activeStorageKey = storageKeys.find((key) => { try { return JSON.parse(localStorage.getItem(key) ?? "[]").length > 0; } catch { return false; } });
      const storageKey = activeStorageKey ?? storageKeys[0];
      const checkedBefore = checkbox.checked;
      if (!storageKey) return { stage: "missing-storage-key", checkedBefore };
      localStorage.setItem(storageKey, "[]");
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: "[]", storageArea: localStorage }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { stage: "checked", checkedBefore, checkedAfter: checkbox.checked, storageKey };
    })()`);
    assert(purchaseChecklistStorageProbe?.stage === "checked" && purchaseChecklistStorageProbe.checkedBefore === true && purchaseChecklistStorageProbe.checkedAfter === false, "구매 체크리스트가 다른 탭의 localStorage 완료 상태 변경을 반영하지 못했습니다. probe=" + JSON.stringify(purchaseChecklistStorageProbe));
    await waitForValue(client, "document.querySelector('[data-testid=\"assembly-verification-panel\"]') !== null", "조립 검증 storage sync probe 준비");
    const assemblyVerificationStorageProbe = await client.evaluate(`(async () => {
      const storageKey = document.querySelector('[data-testid="assembly-verification-panel"]')?.getAttribute("data-storage-key") ?? undefined;
      if (!storageKey) return { stage: "missing-storage-key" };
      let current;
      try { current = JSON.parse(localStorage.getItem(storageKey) ?? "null"); } catch { return { stage: "invalid-storage" }; }
      if (!current || !Array.isArray(current.runs) || current.runs.length === 0) return { stage: "missing-run" };
      const activeRunId = current.activeRunId ?? current.runs.at(-1)?.runId;
      const next = { ...current, updatedAt: new Date().toISOString(), runs: current.runs.map((run) => run.runId === activeRunId ? { ...run, runLabel: "cross-tab assembly probe" } : run) };
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: JSON.stringify(next), storageArea: localStorage }));
      await new Promise((resolve) => setTimeout(resolve, 180));
      return { stage: "checked", visible: (document.body?.innerText ?? "").includes("cross-tab assembly probe"), storageKey };
    })()`);
    assert(assemblyVerificationStorageProbe?.stage === "checked" && assemblyVerificationStorageProbe.visible === true, "조립 검증 패널이 다른 탭의 localStorage 이력 변경을 반영하지 못했습니다. probe=" + JSON.stringify(assemblyVerificationStorageProbe));
    await waitForValue(client, "document.querySelector('[data-testid=\"peripheral-recommendation-panel\"]') !== null && document.querySelector('[data-testid=\"accessory-recommendation-filter-all\"]') !== null && document.querySelector('[data-testid=\"accessory-recommendation-sort\"]') !== null", "주변 부품 추천 탐색 컨트롤");
    const accessoryRecommendationProbe = await client.evaluate("(() => { const card = document.querySelector('.peripheral-recommendation'); const catalogLink = card?.querySelector('[data-testid=\"accessory-recommendation-open-catalog\"]'); const details = card?.querySelector('[data-testid=\"accessory-recommendation-details\"]'); return { cards: document.querySelectorAll('.peripheral-recommendation').length, filters: document.querySelectorAll('[data-testid^=\"accessory-recommendation-filter-\"]').length, categories: [...document.querySelectorAll('[data-testid^=\"accessory-recommendation-filter-\"]')].map((button) => button.getAttribute('data-testid')), href: catalogLink?.getAttribute('href'), details: Boolean(details), detailSummary: details?.querySelector('summary')?.textContent ?? '' }; })()");
    assert(accessoryRecommendationProbe.cards > 0 && accessoryRecommendationProbe.filters > 1 && accessoryRecommendationProbe.categories.includes('accessory-recommendation-filter-storage_accessory') && accessoryRecommendationProbe.categories.includes('accessory-recommendation-filter-memory_cooler') && accessoryRecommendationProbe.categories.includes('accessory-recommendation-filter-gpu_cooler') && typeof accessoryRecommendationProbe.href === 'string' && accessoryRecommendationProbe.href.startsWith('/accessories?category=') && accessoryRecommendationProbe.href.includes('itemId=') && accessoryRecommendationProbe.details && accessoryRecommendationProbe.detailSummary.includes('스펙·이유'), "주변 부품 추천 카드의 범주 필터·카탈로그 이동·스펙·이유 펼치기가 표시되지 않았습니다. probe=" + JSON.stringify(accessoryRecommendationProbe));
    assert((await clickSelector(client, '[data-testid="accessory-recommendation-filter-storage_accessory"]', 1)) === 1, "M.2 저장장치 어댑터 추천 범주를 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-recommendation-filter-storage_accessory\"]')?.classList.contains('selected') === true && document.querySelector('[data-testid=\"accessory-recommendation-capacity\"]') !== null && document.querySelector('[data-testid=\"accessory-recommendation-pcie-slot\"]') !== null && (document.body?.innerText ?? '').includes('M.2 SSD 최대') && (document.body?.innerText ?? '').includes('PCIe 슬롯 x')", "M.2 어댑터 장착 수용량·슬롯 폭 근거");
    assert(await setInputValue(client, '[data-testid="accessory-recommendation-watch-target"]', '123456'), "주변 부품 추천 목표가 입력을 설정하지 못했습니다.");
    assert((await clickSelector(client, '[data-testid="accessory-recommendation-watch"]', 1)) === 1, "주변 부품 추천 가격 추적 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(() => { try { const entries = JSON.parse(localStorage.getItem('pc-supporter-catalog-watchlist') ?? '[]'); return entries.some((entry) => entry.kind === 'accessory' && entry.targetPriceWon === 123456); } catch { return false; } })()", "주변 부품 추천 목표가 가격 추적 저장");
    await client.evaluate("localStorage.removeItem('pc-supporter-catalog-watchlist')");
    assert(await selectLabel(client, "추천 정렬", "price_asc"), "주변 부품 추천 가격 정렬을 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-recommendation-sort\"]')?.value === 'price_asc'", "주변 부품 추천 가격 정렬");
    assert((await clickSelector(client, '[data-testid="accessory-recommendation-details"] summary', 1)) === 1, "주변 부품 추천 스펙 근거를 열지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-recommendation-details\"]')?.open === true && (document.body?.innerText ?? '').includes('저장된 스펙 정보')", "주변 부품 추천 스펙 정보 펼치기");
    const accessoryRecommendationCategory = await client.evaluate("(() => { const preferred = document.querySelector('[data-testid=\"accessory-recommendation-filter-m2_heatsink\"]'); const button = preferred instanceof HTMLButtonElement && !preferred.disabled ? preferred : [...document.querySelectorAll('[data-testid^=\"accessory-recommendation-filter-\"]')].find((candidate) => candidate.getAttribute('data-testid') !== 'accessory-recommendation-filter-all' && !candidate.disabled); if (!(button instanceof HTMLButtonElement)) return undefined; button.click(); return button.getAttribute('data-testid'); })()");
    assert(typeof accessoryRecommendationCategory === 'string' && accessoryRecommendationCategory.length > 0, "주변 부품 추천 비교용 범주 필터를 찾지 못했습니다.");
    await waitForValue(client, `document.querySelector('[data-testid="${accessoryRecommendationCategory}"]')?.classList.contains('selected') === true`, "주변 부품 추천 범주 필터");
    assert((await clickSelector(client, '.accessory-add-button', 1)) === 1, "주변 부품 추천 후보를 견적에 추가하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-cart-panel\"]') !== null && document.activeElement?.getAttribute('data-testid') === 'accessory-cart-panel'", "주변 부품 추가 후 카트 포커스 이동");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-cart-price-evidence\"]') !== null && document.querySelector('.accessory-cart-price-evidence') !== null", "주변 부품 카트 가격 근거");
    assert(await client.evaluate("(() => { const guidance = document.querySelector('[data-testid=\"accessory-cart-target-guidance\"]')?.textContent ?? ''; return guidance.includes('M.2 SSD') && document.querySelector('.accessory-cart-target select[aria-label*=\"연결 대상 SSD\"]') !== null; })()"), "M.2 주변 부품의 연결 대상 안내 또는 SSD 대상 선택이 표시되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid="accessory-recommendation-compare"]', 2)) === 2, "주변 부품 추천 후보 두 개를 비교 대상으로 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-recommendation-comparison\"]') !== null && (document.body?.innerText ?? '').includes('부품 비교')", "주변 부품 추천 후보 비교표");
    const accessoryRecommendationComparisonProbe = await client.evaluate("(() => ({ headers: document.querySelectorAll('[data-testid=\"accessory-recommendation-comparison\"] thead th').length, rows: document.querySelectorAll('[data-testid=\"accessory-recommendation-comparison\"] tbody tr').length, text: document.querySelector('[data-testid=\"accessory-recommendation-comparison\"]')?.textContent ?? '' }))()");
    assert(accessoryRecommendationComparisonProbe.headers === 3 && accessoryRecommendationComparisonProbe.rows >= 8 && accessoryRecommendationComparisonProbe.text.includes('데이터 상태') && accessoryRecommendationComparisonProbe.text.includes('가격 행동') && accessoryRecommendationComparisonProbe.text.includes('최근 가격 이력') && accessoryRecommendationComparisonProbe.text.includes('추천 이유'), "주변 부품 추천 후보 비교표에 선택 후보·가격 근거 또는 비교 근거가 누락되었습니다. probe=" + JSON.stringify(accessoryRecommendationComparisonProbe));
    assert(await client.evaluate("(() => { const select = document.querySelector('[data-testid=\"accessory-recommendation-history-days\"]'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, '90'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === '90'; })()"), "주변 부품 추천 가격 이력 기간을 변경하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-recommendation-history-days\"]')?.value === '90' && (document.body?.innerText ?? '').includes('최근 가격 이력')", "주변 부품 추천 가격 이력 기간");
    const accessoryRecommendationComparisonStabilityProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      let priceHistoryCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (requestUrl.pathname === '/api/price-history') priceHistoryCalls += 1;
        return originalFetch(input, init);
      };
      try {
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { priceHistoryCalls };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(accessoryRecommendationComparisonStabilityProbe?.priceHistoryCalls === 0, "주변 부품 후보 비교가 안정화된 뒤 가격 이력 API를 반복 호출했습니다. probe=" + JSON.stringify(accessoryRecommendationComparisonStabilityProbe));
    await waitForValue(client, "(document.body?.innerText ?? '').includes('대체 부품') || (document.body?.innerText ?? '').includes('안전한 대체 부품')", "대체 후보 영역");
    const suggestionComparisonProbe = await client.evaluate("(() => { const group = [...document.querySelectorAll('.suggestions')].find((candidate) => candidate.querySelectorAll('.suggestion-compare-toggle').length >= 2 && candidate.querySelector('.suggestion-gpu-target-line')); if (!group) return { stage: 'missing' }; const buttons = [...group.querySelectorAll('.suggestion-compare-toggle')].slice(0, 2); buttons.forEach((button) => button.click()); return { stage: 'clicked', categories: [...group.querySelectorAll('.suggestion-card .suggestion-category-badge')].slice(0, 2).map((node) => node.textContent ?? '') }; })()");
    assert(suggestionComparisonProbe?.stage === 'clicked', "결과 화면에서 비교 가능한 대체 후보 2개를 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"suggestion-comparison-benchmark\"]') !== null", "결과 대체 후보 원본 성능 근거 비교 행");
    const suggestionBenchmarkProbe = await client.evaluate("(() => { const row = document.querySelector('[data-testid=\"suggestion-comparison-benchmark\"]'); return { text: row?.textContent ?? '', cells: row?.querySelectorAll('[data-testid=\"comparison-benchmark-cell\"]').length ?? 0 }; })()");
    assert(suggestionBenchmarkProbe.cells >= 1 && suggestionBenchmarkProbe.text.includes('점') && suggestionBenchmarkProbe.text.includes('출처') && suggestionBenchmarkProbe.text.includes('점검'), "결과 대체 후보 비교표의 원본 성능 점수·출처·점검 상태가 누락되었습니다. probe=" + JSON.stringify(suggestionBenchmarkProbe));
    assert((await clickText(client, "전체 미리 비교")) === true, "대체 후보 전체 미리 비교 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.candidate-scenario-dialog') !== null", "대체 후보 전체 미리 비교 모달");
    await waitForValue(client, "document.querySelector('.candidate-scenario-watch-control .part-watch-button[data-item-id]') !== null", "대체 후보 watch storage sync probe 준비");
    const candidateWatchStorageProbe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const button = document.querySelector('.candidate-scenario-watch-control .part-watch-button[data-item-id]');
      const itemId = button?.getAttribute('data-item-id') ?? "";
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const entry = { itemId, itemName: "cross-tab candidate watch probe", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z", targetPriceWon: 1 };
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key: watchlistKey, newValue: value, storageArea: localStorage }));
      try {
        if (!(button instanceof HTMLButtonElement) || !itemId) return { stage: "missing-controls", itemId };
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const initiallyUnwatched = !button.classList.contains("watched");
        const serialized = JSON.stringify([entry]);
        localStorage.setItem(watchlistKey, serialized);
        dispatch(serialized);
        for (let index = 0; index < 80 && !button.classList.contains("watched"); index += 1) await wait(25);
        for (let index = 0; index < 80 && document.querySelector('.candidate-scenario-target input')?.value !== "1"; index += 1) await wait(25);
        const added = button.classList.contains("watched");
        const targetSynced = document.querySelector('.candidate-scenario-target input')?.value === "1";
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const removed = !button.classList.contains("watched") && document.querySelector('.candidate-scenario-target') === null;
        return { stage: "checked", itemId, initiallyUnwatched, added, targetSynced, removed };
      } finally {
        if (originalWatchlist === null) localStorage.removeItem(watchlistKey); else localStorage.setItem(watchlistKey, originalWatchlist);
        dispatch(originalWatchlist);
        await wait(100);
      }
    })()`);
    assert(candidateWatchStorageProbe?.stage === "checked" && candidateWatchStorageProbe.initiallyUnwatched === true && candidateWatchStorageProbe.added === true && candidateWatchStorageProbe.targetSynced === true && candidateWatchStorageProbe.removed === true, "대체 후보 CandidateWatchControl이 다른 탭의 watch-list·목표가 변경을 반영하지 못했습니다. probe=" + JSON.stringify(candidateWatchStorageProbe));
    await waitForValue(client, "document.querySelector('[data-testid=\"candidate-scenario-benchmark\"]') !== null", "대체 후보 원본 benchmark 변화");
    const candidateScenarioBenchmarkProbe = await client.evaluate("(() => { const nodes = [...document.querySelectorAll('[data-testid=\"candidate-scenario-benchmark\"]')]; return { count: nodes.length, text: nodes.map((node) => node.textContent ?? '').join(' ') }; })()");
    assert(candidateScenarioBenchmarkProbe.count >= 1 && candidateScenarioBenchmarkProbe.text.includes('원본 벤치마크 비교') && candidateScenarioBenchmarkProbe.text.includes('점'), "대체 후보 전체 가상 비교에 원본 benchmark 변화가 표시되지 않았습니다. probe=" + JSON.stringify(candidateScenarioBenchmarkProbe));
    const candidateScenarioRankingProbe = await client.evaluate("(() => { const node = document.querySelector('.candidate-scenario-ranking'); return { text: node?.textContent ?? '', reasons: node?.querySelectorAll('span small').length ?? 0 }; })()");
    assert(candidateScenarioRankingProbe.reasons > 0 && candidateScenarioRankingProbe.text.includes('성능 정보'), "대체 후보 순위에 성능 비교 범위·정보 설명이 표시되지 않았습니다. probe=" + JSON.stringify(candidateScenarioRankingProbe));
    assert((await clickSelector(client, '[aria-label="부품 미리 비교 닫기"]', 1)) === 1, "대체 후보 전체 미리 비교 모달을 닫지 못했습니다.");
    await waitForValue(client, "document.querySelector('.candidate-scenario-dialog') === null", "대체 후보 전체 미리 비교 모달 닫힘");
    await waitForValue(client, "document.querySelector('.suggestion-gpu-target-line') !== null", "GPU 대체 후보 게이밍 목표 근거");
    assert(await clickText(client, "전체 미리 비교"), "route transition reset 검증용 후보 전체 미리 비교 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.candidate-scenario-dialog') !== null && document.querySelector('[aria-label=\"부품 미리 비교 닫기\"]') !== null", "route transition 전 후보 가상 비교");
    await client.evaluate("(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()");
    await waitForHomeDemoButtons(client, "후보 가상 비교 route transition 홈 복귀");
    const candidateRouteResetProbe = await client.evaluate("({ path: location.pathname, dialog: Boolean(document.querySelector('.candidate-scenario-dialog')) })");
    assert(candidateRouteResetProbe?.path === '/' && candidateRouteResetProbe.dialog === false, "route transition 뒤 후보 가상 비교 modal이 남아 있습니다. probe=" + JSON.stringify(candidateRouteResetProbe));
    await goBack(client);
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.suggestion-gpu-target-line') !== null", "후보 미리 비교 route transition 결과 복귀");
    await openResultDetails(client);
    await waitForValue(client, "performance.getEntriesByType('resource').some((entry) => /BuildChangeDecisionDialog/.test(entry.name))", "대체 후보 변경 dialog preload");
    const suggestionApplyProbe = await client.evaluate("(() => { const currentBuildText = document.querySelector('.build-mini-list')?.textContent ?? ''; const card = [...document.querySelectorAll('.suggestion-card')].find((candidate) => { const button = candidate.querySelector('.suggestion-apply:not([disabled])'); const candidateName = button?.getAttribute('aria-label')?.replace(/ 적용$/, '') ?? ''; return !(candidate.textContent ?? '').includes('적용하지 않음') && candidateName.length > 0 && !currentBuildText.includes(candidateName) && button instanceof HTMLButtonElement; }); const button = card?.querySelector('.suggestion-apply:not([disabled])'); if (!(button instanceof HTMLButtonElement)) return { clicked: false, currentBuildText, candidates: [...document.querySelectorAll('.suggestion-card .suggestion-apply:not([disabled])')].map((candidate) => candidate.getAttribute('aria-label') ?? '') }; button.click(); return { clicked: true, reviewCandidate: (card?.textContent ?? '').includes('확인 후 적용'), candidateName: button.getAttribute('aria-label') ?? '' }; })()");
    assert(suggestionApplyProbe?.clicked === true, "결과 대체 후보 적용 버튼을 찾지 못했습니다.");
    try {
      await waitForValue(client, "document.querySelector('.build-change-dialog') !== null && document.querySelector('.build-change-diff') !== null", "대체 후보 변경 미리보기");
    } catch (error) {
      let diagnostic;
      try {
        diagnostic = await client.evaluate(`(() => ({ dialog: Boolean(document.querySelector('.build-change-dialog')), diffRows: document.querySelectorAll('.build-change-diff-row').length, resultPage: Boolean(document.querySelector('.result-page')), toast: document.querySelector('.toast')?.textContent ?? '', smokeErrors: window.__pcSupporterSmokeErrors ?? [], suggestionApplyProbe: ${JSON.stringify(suggestionApplyProbe)}, buildDialogResources: performance.getEntriesByType('resource').map((entry) => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize })).filter((entry) => /BuildChangeDecisionDialog|index-.*\\.js/.test(entry.name)).slice(-8) }))()`);
      } catch (diagnosticError) {
        diagnostic = { evaluationError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) };
      }
      throw new Error(`${error instanceof Error ? error.message : String(error)} diagnostic=${JSON.stringify(diagnostic)}`);
    }
    const suggestionChangePreviewProbe = await client.evaluate("(() => { const dialog = document.querySelector('.build-change-dialog'); return { text: dialog?.textContent ?? '', rows: dialog?.querySelectorAll('.build-change-diff-row').length ?? 0, review: dialog?.querySelector('[data-testid=\"build-change-candidate-review\"]')?.textContent ?? '' }; })()");
    assert(suggestionChangePreviewProbe.rows > 0 && suggestionChangePreviewProbe.text.includes('구매 결정 요약') && suggestionChangePreviewProbe.text.includes('확인 후 현재 카탈로그 기준'), "대체 후보 적용 전에 변경·가격·재검사 안내가 표시되지 않았습니다. probe=" + JSON.stringify(suggestionChangePreviewProbe));
    if (suggestionApplyProbe.reviewCandidate) assert(suggestionChangePreviewProbe.review.includes('적용 전 추가 확인') && suggestionChangePreviewProbe.review.includes('부품 자체 결과') && suggestionChangePreviewProbe.review.includes('적용 후 전체 견적'), "확인 후 적용 후보의 추가 확인 근거와 후보·전체 견적 위험 수치가 미리보기에 표시되지 않았습니다. probe=" + JSON.stringify(suggestionChangePreviewProbe));
    assert((await clickSelector(client, '.build-change-actions .button-light', 1)) === 1, "대체 후보 변경 미리보기를 취소하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.build-change-dialog') === null", "대체 후보 변경 미리보기 취소");
    const routeResetCandidateProbe = await client.evaluate("(() => { const currentBuildText = document.querySelector('.build-mini-list')?.textContent ?? ''; const card = [...document.querySelectorAll('.suggestion-card')].find((candidate) => { const button = candidate.querySelector('.suggestion-apply:not([disabled])'); const candidateName = button?.getAttribute('aria-label')?.replace(/ 적용$/, '') ?? ''; return !(candidate.textContent ?? '').includes('적용하지 않음') && candidateName.length > 0 && !currentBuildText.includes(candidateName) && button instanceof HTMLButtonElement; }); const button = card?.querySelector('.suggestion-apply:not([disabled])'); if (!(button instanceof HTMLButtonElement)) return { clicked: false }; button.click(); return { clicked: true }; })()");
    assert(routeResetCandidateProbe?.clicked === true, "route transition reset 검증용 대체 후보 적용 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('.build-change-dialog') !== null", "route transition 전 변경 미리보기");
    await client.evaluate("(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()");
    await waitForHomeDemoButtons(client, "변경 미리보기 route transition 홈 복귀");
    const routeResetProbe = await client.evaluate("({ path: location.pathname, dialog: Boolean(document.querySelector('.build-change-dialog')) })");
    assert(routeResetProbe?.path === '/' && routeResetProbe.dialog === false, "route transition 뒤 변경 미리보기 dialog가 남아 있습니다. probe=" + JSON.stringify(routeResetProbe));
    await goBack(client);
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.suggestion-gpu-target-line') !== null", "변경 미리보기 route transition 결과 복귀");
    await openResultDetails(client);
    const virtualSuggestionProbe = await client.evaluate("(() => { const cards = [...document.querySelectorAll('.suggestion-card')]; const card = cards.find((candidate) => (candidate.textContent ?? '').includes('확인 후 적용') && candidate.querySelector('.suggestion-preview-button:not([disabled])')) ?? cards.find((candidate) => !(candidate.textContent ?? '').includes('적용하지 않음') && candidate.querySelector('.suggestion-preview-button:not([disabled])')); const button = card?.querySelector('.suggestion-preview-button:not([disabled])'); if (!(button instanceof HTMLButtonElement)) return { clicked: false }; button.click(); return { clicked: true, reviewCandidate: (card?.textContent ?? '').includes('확인 후 적용') }; })()");
    assert(virtualSuggestionProbe?.clicked === true, "대체 후보 미리 적용 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('.build-scenario-preview:not(.loading) .button-primary') !== null", "대체 후보 미리 적용 확인 완료");
    assert((await clickSelector(client, '.build-scenario-preview .button-primary', 1)) === 1, "가상 적용 결과의 실제 적용 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.build-change-dialog') !== null", "가상 적용 후보 변경 미리보기");
    const virtualChangePreviewProbe = await client.evaluate("(() => ({ text: document.querySelector('.build-change-dialog')?.textContent ?? '', review: document.querySelector('[data-testid=\"build-change-candidate-review\"]')?.textContent ?? '' }))()");
    assert(virtualChangePreviewProbe.text.includes('구매 결정 요약') && virtualChangePreviewProbe.text.includes('변경 예정'), "가상 적용 후보의 변경 미리보기가 표시되지 않았습니다.");
    if (virtualSuggestionProbe.reviewCandidate) assert(virtualChangePreviewProbe.review.includes('적용 전 추가 확인') && virtualChangePreviewProbe.review.includes('적용 후 전체 견적'), "가상 적용 경로에서 확인 필요 후보 근거가 변경 미리보기까지 전달되지 않았습니다. probe=" + JSON.stringify(virtualChangePreviewProbe));
    assert((await clickSelector(client, '.build-change-actions .button-light', 1)) === 1, "가상 적용 후보 변경 미리보기를 취소하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.build-change-dialog') === null && document.querySelector('.build-scenario-preview') === null", "가상 적용 후보 변경 미리보기 취소");
    await waitForValue(client, "document.querySelector('.repair-plan-panel') !== null", "수리 플랜 패널");
    await waitForValue(client, "document.querySelector('[data-testid=\"repair-plan-tradeoff\"]') !== null", "수리 플랜 비교 우위");
    assert(await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"repair-plan-tradeoff\"]'); const text = node?.textContent ?? ''; return text.includes('비교 우위') && text.includes('남은 위험') && text.includes('추가 비용'); })()"), "수리 플랜 비용·위험·변경 규모 tradeoff가 표시되지 않았습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"benchmark-evidence-panel\"]') !== null && [...document.querySelectorAll('.benchmark-evidence-card')].some((card) => (card.textContent ?? '').includes('자료'))", "원본 benchmark 근거 freshness");
    await waitForValue(client, "document.querySelector('[data-testid=\"build-resource-summary\"]') !== null && document.querySelectorAll('[data-testid^=\"build-resource-card-\"]').length === 2 && (document.body?.innerText ?? '').includes('전력·냉각 여유')", "전력·냉각 여유 요약");
    await waitForValue(client, "document.querySelector('[data-testid=\"compatibility-map\"]') !== null && document.querySelectorAll('[data-testid=\"compatibility-map\"] .compatibility-link-action').length > 0", "호환 관계 맵 원인 이동 액션");
    assert((await clickSelector(client, '[data-testid="compatibility-map"] .compatibility-link-action', 1)) === 1, "호환 관계 맵의 관련 판정 이동 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.activeElement?.id?.startsWith('finding-') === true", "호환 관계 맵에서 finding 포커스 이동");
    await waitForValue(client, "document.querySelector('[data-testid=\"result-quick-nav\"]')?.querySelectorAll('button').length === 5", "검사 결과 바로가기");
    assert(await client.evaluate("(() => { const nav = document.querySelector('[data-testid=\"result-quick-nav\"]'); const text = nav?.textContent ?? ''; return text.includes('최종 구매 판단') && text.includes('먼저 할 일') && text.includes('상세 결과') && text.includes('구매 전 체크') && text.includes('구매 목록'); })()"), "검사 결과 바로가기 항목이 모두 표시되지 않았습니다.");
    await waitForValue(client, "document.querySelectorAll('.result-metrics button.metric-card').length === 3", "검사 결과 요약 카드 액션");
    assert((await clickSelector(client, '.result-metrics button.metric-card.danger', 1)) === 1, "차단 오류 요약 카드를 클릭하지 못했습니다.");
    await waitForValue(client, "document.activeElement?.getAttribute('data-testid') === 'result-findings' && document.querySelector('.result-metrics button.metric-card.danger')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.finding-filter-button.selected')?.textContent?.includes('차단 오류') === true", "차단 오류 요약 필터 이동");
    await waitForValue(client, "location.search === '?finding=blocker' && location.hash === '#findings'", "차단 오류 URL 상태");
    await waitForValue(client, "document.querySelector('.result-link-copy-button')?.textContent?.includes('결과 링크 복사') === true", "결과 링크 복사 액션");
    assert((await clickSelector(client, '.result-link-copy-button', 1)) === 1, "결과 링크 복사 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('현재 결과 링크') || (document.body?.innerText ?? '').includes('결과 링크를 복사하지 못했습니다')", "결과 링크 복사 안내");
    await client.send("Page.reload");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('검사 결과 상세') && document.querySelector('[data-testid=\"result-quick-nav\"]') !== null", "결과 필터 새로고침 복원");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('.finding-filter-button.selected')?.textContent?.includes('차단 오류') === true && document.querySelector('.result-metrics button.metric-card.danger')?.getAttribute('aria-pressed') === 'true'", "결과 필터 새로고침 상태");
    assert((await clickSelector(client, '.result-metrics button.metric-card.warning', 1)) === 1, "주의 요약 카드를 클릭하지 못했습니다.");
    await waitForValue(client, "location.search === '?finding=warning' && document.querySelector('.finding-filter-button.selected')?.textContent?.includes('주의') === true", "주의 URL 상태");
    await goBack(client);
    await waitForValue(client, "location.search === '?finding=blocker' && location.hash === '#findings' && document.querySelector('.finding-filter-button.selected')?.textContent?.includes('차단 오류') === true && document.querySelector('[data-testid=\"result-quick-nav-result-findings\"]') !== null", "결과 필터 뒤로 가기 복원");
    recordRouteHistoryFlow("result-route-history");
    const checkLatestRouteProbe = await client.evaluate(`(async () => {
      const button = [...document.querySelectorAll('button')].find((candidate) => !candidate.disabled && ((candidate.textContent ?? '').includes('같은 구성 다시 검사') || (candidate.textContent ?? '').includes('현재 구성 다시 검사')));
      if (!(button instanceof HTMLButtonElement)) return { stage: 'missing-button', path: location.pathname };
      const originalFetch = window.fetch.bind(window);
      let intercepted = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (requestUrl.pathname === '/api/compatibility/check' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
          intercepted += 1;
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
        return originalFetch(input, init);
      };
      try {
        button.click();
        for (let index = 0; index < 120 && intercepted === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
        for (let index = 0; index < 60 && location.pathname !== '/'; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return { stage: 'checked', intercepted, path: location.pathname, home: document.querySelector('.home-page') !== null, result: document.querySelector('.result-page') !== null };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(checkLatestRouteProbe?.stage === 'checked' && checkLatestRouteProbe.intercepted > 0 && checkLatestRouteProbe.path === '/' && checkLatestRouteProbe.home === true && checkLatestRouteProbe.result === false, "검사 중 route 이탈 뒤 늦은 compatibility 응답이 홈 화면을 결과 화면으로 덮었습니다. probe=" + JSON.stringify(checkLatestRouteProbe));
    await client.send("Page.navigate", { url: `${baseUrl}/result?finding=blocker#findings` });
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('[data-testid=\"result-findings\"]') !== null", "검사 route 이탈 probe 이후 결과 화면 복귀");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"result-quick-nav-result-findings\"]') !== null", "검사 route 이탈 probe 이후 결과 quick-nav 복귀");
    const saveBuildLatestRouteProbe = await client.evaluate(`(async () => {
      const openButton = [...document.querySelectorAll('button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('견적 저장·공유'));
      if (!(openButton instanceof HTMLButtonElement)) return { stage: 'missing-open-button', path: location.pathname };
      const originalFetch = window.fetch.bind(window);
      const originalSavedIds = localStorage.getItem('pc-supporter-saved-build-ids');
      const stamp = '2026-09-09T00:00:00.000Z';
      const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      let saveCalls = 0;
      const savedIdsRestore = () => { if (originalSavedIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalSavedIds); };
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (requestUrl.pathname === '/api/builds' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
          saveCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 900));
          return response({ id: 'save-route-probe', ownerToken: 's'.repeat(48), name: 'save-route-probe', selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false }, recommendationPreferences: { profile: 'gaming', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 }, createdAt: stamp, updatedAt: stamp, totalPriceWon: 0, priceComplete: true });
        }
        return originalFetch(input, init);
      };
      try {
        localStorage.setItem('pc-supporter-saved-build-ids', JSON.stringify([]));
        openButton.click();
        for (let index = 0; index < 60 && !document.querySelector('.save-build-form'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        const submit = document.querySelector('.save-build-form button[type="submit"]');
        if (!(submit instanceof HTMLButtonElement)) return { stage: 'missing-submit', saveCalls, path: location.pathname };
        submit.click();
        for (let index = 0; index < 120 && saveCalls === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await new Promise((resolve) => setTimeout(resolve, 1100));
        let storedIds = [];
        try { storedIds = JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]'); } catch { storedIds = []; }
        return { stage: 'checked', saveCalls, path: location.pathname, home: document.querySelector('.home-page') !== null, result: document.querySelector('.result-page') !== null, staleSavedId: Array.isArray(storedIds) && storedIds.includes('save-route-probe') };
      } finally {
        window.fetch = originalFetch;
        savedIdsRestore();
      }
    })()`);
    assert(saveBuildLatestRouteProbe?.stage === 'checked' && saveBuildLatestRouteProbe.saveCalls > 0 && saveBuildLatestRouteProbe.path === '/' && saveBuildLatestRouteProbe.home === true && saveBuildLatestRouteProbe.result === false && saveBuildLatestRouteProbe.staleSavedId === false, "저장 중 route 이탈 뒤 늦은 저장 응답이 새 화면의 저장 상태를 덮었습니다. probe=" + JSON.stringify(saveBuildLatestRouteProbe));
    await client.send("Page.navigate", { url: `${baseUrl}/result?finding=blocker#findings` });
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('[data-testid=\"result-findings\"]') !== null", "저장 route 이탈 probe 이후 결과 화면 복귀");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"result-quick-nav-result-findings\"]') !== null", "저장 route 이탈 probe 이후 결과 quick-nav 복귀");
    assert((await clickSelector(client, '[data-testid="result-quick-nav-result-findings"]', 1)) === 1, "상세 결과 바로가기를 클릭하지 못했습니다.");
    await waitForValue(client, "document.activeElement?.getAttribute('data-testid') === 'result-findings'", "상세 결과 바로가기 포커스");
    assert((await clickSelector(client, '[data-testid="result-quick-nav-purchase-list-panel"]', 1)) === 1, "구매 목록 바로가기를 클릭하지 못했습니다.");
    await waitForValue(client, "document.activeElement?.getAttribute('data-testid') === 'purchase-list-panel'", "lazy 구매 목록 바로가기 포커스");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-connection-target\"]') !== null && (document.body?.innerText ?? '').includes('연결 대상')", "구매 목록 연결 대상 전달");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-price-evidence-summary\"]') !== null && document.querySelector('.purchase-list-row .purchase-list-price-evidence') !== null", "구매 목록 가격 근거 요약·행 배지");
    const resultText = await bodyText(client);
    if (process.env.BROWSER_SMOKE_DEBUG === "1") console.log(resultText.slice(0, 12_000));
    assert(!resultText.includes("Failed to fetch"), "브라우저 결과 화면에 Failed to fetch가 남아 있습니다.");
    assert(resultText.includes("대체 부품") || resultText.includes("안전한 대체 부품"), "검사 결과에 대체 후보 영역이 없습니다.");
    const purchaseListLatestContextProbe = await client.evaluate(`(async () => {
      const button = document.querySelector('[data-testid="purchase-list-live-price-refresh"]');
      const priority = [...document.querySelectorAll('label')].find((label) => (label.textContent ?? '').includes('우선순위'))?.querySelector('select');
      if (!(button instanceof HTMLButtonElement) || button.disabled || !(priority instanceof HTMLSelectElement)) return { stage: 'missing-controls', button: Boolean(button), priority: Boolean(priority) };
      const originalFetch = window.fetch;
      let delayedCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (/^\\/api\\/(parts|accessories)\\/[^/]+(?:\\/refresh)?$/.test(requestUrl.pathname)) {
          delayedCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        return originalFetch(input, init);
      };
      try {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 75));
        const nextPriority = priority.value === 'reliability' ? 'balanced' : 'reliability';
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(priority, nextPriority);
        priority.dispatchEvent(new Event('change', { bubbles: true }));
        for (let index = 0; index < 320; index += 1) {
          const currentButton = document.querySelector('[data-testid="purchase-list-live-price-refresh"]');
          const body = document.body?.innerText ?? '';
          if (delayedCalls > 0 && currentButton instanceof HTMLButtonElement && !currentButton.disabled && body.includes('검사 결과 상세')) return { stage: 'checked', delayedCalls, enabledBeforeDelayedResponse: true, priority: nextPriority };
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const currentButton = document.querySelector('[data-testid="purchase-list-live-price-refresh"]');
        return { stage: 'timeout', delayedCalls, enabledBeforeDelayedResponse: currentButton instanceof HTMLButtonElement ? !currentButton.disabled : false, priority: priority.value };
      } finally {
        window.fetch = originalFetch;
        await new Promise((resolve) => setTimeout(resolve, 2100));
      }
    })()`);
    assert(purchaseListLatestContextProbe?.stage === 'checked' && purchaseListLatestContextProbe.enabledBeforeDelayedResponse === true, "구매 목록의 새 context가 이전 지연 가격 조회 때문에 잠겼습니다. probe=" + JSON.stringify(purchaseListLatestContextProbe));
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-price-review\"]') !== null && document.querySelector('[data-testid=\"purchase-list-price-review-refresh\"]')?.disabled === false", "구매 목록 가격 재확인 큐");
    const targetedPriceRefreshProbe = await client.evaluate("(async () => { const button = document.querySelector('[data-testid=\"purchase-list-price-review-refresh\"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return { completed: false, reason: 'no-button' }; const originalFetch = window.fetch; const calls = []; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase(); if (/^\\/api\\/(parts|accessories)\\//.test(url)) { calls.push({ url, method }); if (method === 'POST' && url.endsWith('/refresh')) { const payload = url.includes('/accessories/') ? { item: { priceWon: 321000 } } : { part: { priceWon: 321000 } }; return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return new Response(JSON.stringify({ priceWon: 321000 }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); }; try { button.click(); for (let index = 0; index < 100; index += 1) { [...document.querySelectorAll('details')].forEach((details) => { if (!details.open) details.open = true; }); if ((document.body?.innerText ?? '').includes('가격 재확인 완료')) return { completed: true, sourceRefreshCalls: calls.filter((call) => call.method === 'POST' && call.url.endsWith('/refresh')).length, catalogReadCalls: calls.filter((call) => call.method === 'GET').length }; await new Promise((resolve) => setTimeout(resolve, 50)); } return { completed: false, reason: 'timeout', calls }; } finally { window.fetch = originalFetch; } })()");
    assert(targetedPriceRefreshProbe?.completed === true, "구매 목록 대상 가격 재조회가 완료되지 않았습니다. probe=" + JSON.stringify(targetedPriceRefreshProbe));
    assert(targetedPriceRefreshProbe.sourceRefreshCalls + targetedPriceRefreshProbe.catalogReadCalls > 0, "구매 목록 가격 재조회가 카탈로그 요청을 보내지 않았습니다. probe=" + JSON.stringify(targetedPriceRefreshProbe));
    if (unknownMotherboard?.source === "danawa" && unknownMotherboard.danawaUrl) {
      assert(targetedPriceRefreshProbe.sourceRefreshCalls > 0, "다나와 원문 연결 행이 구매 목록 가격 확인에서 refresh POST를 사용하지 않았습니다. probe=" + JSON.stringify(targetedPriceRefreshProbe));
      assert((await bodyText(client)).includes("실제 페이지 확인"), "실제 페이지 확인 가격 출처가 구매 목록 결과에 표시되지 않았습니다.");
    }
    if (unknownPriceHasSourceRefresh) {
    const purchasePriceCooldownProbe = await client.evaluate("(async () => { const button = document.querySelector('[data-testid=\"purchase-list-live-price-refresh\"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return { completed: false, reason: 'no-button' }; const originalFetch = window.fetch; const calls = []; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase(); if (/^\\/api\\/(parts|accessories)\\//.test(url)) { calls.push({ url, method }); if (method === 'POST' && url.endsWith('/refresh')) return new Response(JSON.stringify({ error: '같은 부품은 7초 후 다시 확인할 수 있습니다.', code: 'PART_REFRESH_COOLDOWN', retryAfterSeconds: 7 }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '7' } }); return new Response(JSON.stringify({ priceWon: 321000 }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); }; try { button.click(); for (let index = 0; index < 100; index += 1) { [...document.querySelectorAll('details')].forEach((details) => { if (!details.open) details.open = true; }); const text = document.body?.innerText ?? ''; if (text.includes('정보 재확인 7초 대기')) { const refreshed = document.querySelector('[data-testid=\"purchase-list-live-price-refresh\"]'); return { completed: true, disabled: refreshed instanceof HTMLButtonElement ? refreshed.disabled : false, label: refreshed?.textContent ?? '', sourceRefreshCalls: calls.filter((call) => call.method === 'POST' && call.url.endsWith('/refresh')).length }; } await new Promise((resolve) => setTimeout(resolve, 50)); } return { completed: false, reason: 'timeout', calls }; } finally { window.fetch = originalFetch; } })()");
    assert(purchasePriceCooldownProbe?.completed === true, "구매 목록 원문 cooldown 상태가 표시되지 않았습니다. probe=" + JSON.stringify(purchasePriceCooldownProbe));
    assert(purchasePriceCooldownProbe.disabled === true, "구매 목록 원문 cooldown 동안 재확인 버튼이 잠기지 않았습니다. probe=" + JSON.stringify(purchasePriceCooldownProbe));
    assert((purchasePriceCooldownProbe.label ?? '').includes('7초 후 다시 확인'), "구매 목록 원문 cooldown 남은 시간이 버튼에 표시되지 않았습니다. probe=" + JSON.stringify(purchasePriceCooldownProbe));
    }
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-data-review-queue\"]') !== null && (document.body?.innerText ?? '').includes('스펙·상품 페이지 검토 목록')", "구매 목록 스펙·상품 페이지 검토 목록");
    assert((await clickSelector(client, '[data-testid^="purchase-list-open-catalog-part-"]', 1)) === 1, "구매 목록의 카탈로그 상세 버튼을 찾지 못했습니다.");
    await waitForValue(client, "location.pathname === '/catalog' && new URLSearchParams(location.search).get('partId') !== null && document.querySelector('[data-testid=\"catalog-part-detail\"]') !== null", "구매 목록에서 핵심 부품 카탈로그 상세 이동");
    await client.send("Page.navigate", { url: `${baseUrl}/result?finding=blocker#findings` });
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('[data-testid=\"result-findings\"]') !== null", "카탈로그 상세에서 결과 화면 복귀");
    await openResultDetails(client);

    await waitForValue(client, "[...document.querySelectorAll('.finding-actions button')].some((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('바꾸기'))", "finding 교체 액션");
    assert(await client.evaluate("(() => { const node = [...document.querySelectorAll('.finding-actions button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('바꾸기')); if (!(node instanceof HTMLButtonElement)) return false; node.focus(); return document.activeElement === node; })()"), "모달 Esc 복귀 검증용 finding 교체 트리거에 포커스를 둘 수 없습니다.");
    const replacementClicked = await client.evaluate("(() => { const node = [...document.querySelectorAll('.finding-actions button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('바꾸기')); if (!node) return false; node.click(); return true; })()");
    assert(replacementClicked, "finding의 부품 교체 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] #picker-title')?.textContent?.includes('선택') === true", "부품 후보 선택기");
    await waitForValue(client, "document.querySelectorAll('[role=dialog] .picker-item').length > 0", "부품 후보 목록");
    await waitForValue(client, "document.querySelector('[data-testid=\"picker-trust-overview\"]') !== null && (document.body?.innerText ?? '').includes('추천 점수 분포')", "추천 점수 분포 요약");
    assert(await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"picker-trust-overview\"]'); const bar = node?.querySelector('[role=\"img\"]'); return Boolean(node && bar && (bar.getAttribute('aria-label') ?? '').includes('높음') && (bar.getAttribute('aria-label') ?? '').includes('낮음')); })()"), "추천 점수 분포 요약에 높음·낮음 집계가 없습니다.");
    assert(await client.evaluate("(() => { try { const value = JSON.parse(localStorage.getItem('pc-supporter-catalog-picker-cache-v1') ?? 'null'); return value?.schemaVersion === 1 && typeof value?.cachedAt === 'string' && Array.isArray(value?.items) && value.items.length > 0; } catch { return false; } })()"), "성공한 부품 후보 응답이 schemaVersion·cachedAt을 포함한 브라우저 캐시에 저장되지 않았습니다.");
    const pickerDataGapVisible = await client.evaluate("document.querySelector('[data-testid=\"picker-incomplete-data-notice\"]') !== null");
    if (pickerDataGapVisible) assert(await client.evaluate("document.querySelectorAll('[data-testid=\"picker-open-missing-field\"]').length > 0"), "선택기 데이터 부족 안내에 누락 필드 링크가 없습니다.");
    const pickerText = await bodyText(client);
    assert(pickerText.includes("호환") && pickerText.includes("부품"), "부품 후보 선택기에 호환 부품 설명이 없습니다.");
    assert(await client.evaluate("(() => { const dialog = document.querySelector('[role=dialog]'); return Boolean(dialog && dialog.contains(document.activeElement)); })()"), "부품 후보 선택기 초기 포커스가 모달 안에 없습니다.");
    assert(await client.evaluate("(() => { const dialog = document.querySelector('[role=dialog]'); const nodes = [...(dialog?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])') ?? [])]; if (nodes.length < 2) return false; nodes.at(-1)?.focus(); return true; })()"), "부품 후보 선택기 포커스 경계 준비에 실패했습니다.");
    await pressKey(client, "Tab", "Tab", 9);
    assert(await client.evaluate("(() => { const dialog = document.querySelector('[role=dialog]'); const nodes = [...(dialog?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])') ?? [])]; return nodes.length > 1 && document.activeElement === nodes[0]; })()"), "부품 후보 선택기 Tab 포커스가 모달 안에서 순환하지 않습니다.");
    await pressKey(client, "Escape", "Escape", 27);
    await waitForValue(client, "document.querySelector('[role=dialog]') === null", "부품 후보 선택기 Esc 닫힘");
    assert(await client.evaluate("(() => { const node = [...document.querySelectorAll('.finding-actions button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('바꾸기')); return Boolean(node && document.activeElement === node); })()"), "Esc 이후 finding 교체 액션으로 포커스가 복귀하지 않았습니다.");
    assert(await client.evaluate("(() => { const node = [...document.querySelectorAll('.finding-actions button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('바꾸기')); if (!node) return false; node.click(); return true; })()"), "Esc 이후 부품 후보 선택기를 다시 열지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] #picker-title')?.textContent?.includes('선택') === true && document.querySelectorAll('[role=dialog] .picker-item').length > 0", "부품 후보 선택기 재오픈");

    assert(await selectLabel(client, "부품", "no_blocker"), "부품 모드를 차단 없음으로 전환하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('차단 오류 없는 부품')", "차단 없음 부품 모드");
    await waitForValue(client, "document.querySelectorAll('[role=dialog] .picker-item').length > 0", "차단 없음 후보 목록");
    assert(await client.evaluate("document.querySelector('[data-testid=\"picker-incomplete-data-notice\"]') === null"), "차단 없음 후보 모드에서 안전 후보 전용 데이터 부족 안내가 남아 있습니다.");

    assert(await setInputValue(client, '[role="dialog"] .picker-budget-filter input', "1"), "후보 선택기 교체 예산 필터를 입력하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"picker-empty-state\"]') !== null", "후보 필터 빈 상태");
    assert(await client.evaluate("document.querySelector('[data-testid=\"picker-empty-relax-filters\"]') !== null"), "후보 필터 빈 상태의 조건 완화 액션이 없습니다.");
    assert((await clickSelector(client, '[data-testid="picker-empty-relax-filters"]', 1)) === 1, "후보 필터 완화 액션을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelectorAll('[role=dialog] .picker-item').length > 0", "후보 필터 완화 후 목록");

    const comparedCount = await clickSelector(client, "[role=dialog] .picker-compare-toggle", 2);
    assert(comparedCount === 2, `후보 비교 버튼 2개를 찾지 못했습니다. 실제 ${comparedCount}개`);
    await waitForValue(client, "document.querySelector('[aria-label=\"부품 비교\"]') !== null", "부품 비교표");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('2 / 3개')", "후보 2개 비교 상태");
    assert(await client.evaluate("document.querySelector('[data-testid=\"picker-comparison-baseline\"]')?.textContent?.includes('현재 기준선') === true"), "후보 비교표에 현재 기준선이 표시되지 않았습니다.");
    const pickerShareProbe = await client.evaluate("(async () => { const button = [...document.querySelectorAll('[role=dialog] .picker-comparison-actions button')].find((candidate) => (candidate.textContent ?? '').includes('공유 링크')); if (!(button instanceof HTMLButtonElement)) return undefined; const originalFetch = window.fetch; let captured; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; if (url === '/api/comparisons' && init?.method === 'POST') { captured = typeof init.body === 'string' ? JSON.parse(init.body) : undefined; return new Response(JSON.stringify({ id: 'browser-smoke-comparison', url: '/compare/browser-smoke-comparison', ownerToken: 'browser-smoke-owner' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); }; try { button.click(); for (let index = 0; index < 30 && !captured; index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); return captured; } finally { window.fetch = originalFetch; } })()");
    assert(pickerShareProbe?.currentPartName && pickerShareProbe?.currentPartSummary && pickerShareProbe?.currentPartPrice && pickerShareProbe?.category && Array.isArray(pickerShareProbe?.candidates) && pickerShareProbe.candidates.length === 2, "후보 비교 공유 요청에 현재 기준선 이름·사양·가격 context가 전달되지 않았습니다.");
    assert(pickerShareProbe.candidates.every((candidate) => candidate?.category && candidate?.partId), "부품 선택기 후보 공유 요청에 현재 카탈로그 재확인용 범주·부품 ID가 전달되지 않았습니다.");
   assert(pickerShareProbe.candidates.some((candidate) => candidate?.similarityEvidence?.comparedDimensions !== undefined), "부품 선택기 후보 공유 요청에 구조화된 성능 비교 정보가 전달되지 않았습니다.");
    const pickerShareDuplicateProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      let shareCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/comparisons" && (init?.method ?? "GET").toUpperCase() === "POST") {
          shareCalls += 1;
          await wait(400);
          return response({ id: "picker-duplicate-probe", url: "/compare/picker-duplicate-probe", ownerToken: "picker-duplicate-owner" });
        }
        return originalFetch(input, init);
      };
      try {
        const button = [...document.querySelectorAll("[role=dialog] .picker-comparison-actions button")].find((candidate) => (candidate.textContent ?? "").includes("공유"));
        if (!(button instanceof HTMLButtonElement)) return { stage: "missing-button", shareCalls };
        button.click();
        await wait(50);
        const currentButton = [...document.querySelectorAll("[role=dialog] .picker-comparison-actions button")].find((candidate) => (candidate.textContent ?? "").includes("공유"));
        const disabledDuring = currentButton instanceof HTMLButtonElement ? currentButton.disabled : false;
        if (currentButton instanceof HTMLButtonElement) currentButton.click();
        await wait(500);
        return { stage: "checked", shareCalls, disabledDuring };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(pickerShareDuplicateProbe?.stage === "checked" && pickerShareDuplicateProbe.shareCalls === 1, "부품 선택기 공유 연속 클릭이 중복 snapshot POST를 생성했습니다. probe=" + JSON.stringify(pickerShareDuplicateProbe));
    assert(pickerShareProbe.candidates.filter((candidate) => ["cpu", "gpu"].includes(candidate?.category)).every((candidate) => candidate?.benchmarkEvidence?.rows?.length === 2 && candidate?.benchmarkEvidence?.category === candidate?.category), "부품 선택기 후보 공유 요청에서 CPU·GPU benchmark 근거가 누락되었습니다. probe=" + JSON.stringify(pickerShareProbe));

    assert((await clickSelector(client, "[role=dialog] .picker-item-detail-toggle", 1)) === 1, "후보 상세·근거 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] .picker-item-detail') !== null", "후보 상세 근거");
    await waitForValue(client, "document.querySelector('[role=dialog] [data-testid=\"picker-similarity-evidence\"]') !== null && (document.body?.innerText ?? '').includes('현재') && (document.body?.innerText ?? '').includes('비교 부품')", "부품 지표별 성능 근거");
    const finalText = await bodyText(client);
    assert(!finalText.includes("Failed to fetch"), "후보 선택기 화면에 Failed to fetch가 남아 있습니다.");

    assert((await clickSelector(client, '[role=dialog] button[aria-label="부품 선택 닫기"]', 1)) === 1, "부품 선택기 닫기 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog]') === null", "부품 선택기 닫힘");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=psu&mode=compatible&candidateScope=no_blocker` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('차단 없음 부품') && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "카탈로그 호환 부품 상세 화면");
    assert((await clickSelector(client, '.catalog-part-list [data-testid^="catalog-part-"]', 1)) === 1, "카탈로그 호환 후보를 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-part-detail\"]') !== null", "카탈로그 부품 상세");
    await waitForValue(client, "document.querySelector('.catalog-detail .part-watch-button[data-item-id]') !== null", "카탈로그 watch storage sync probe 준비");
    const catalogWatchStorageProbe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const button = document.querySelector('.catalog-detail .part-watch-button[data-item-id]');
      const itemId = button?.getAttribute('data-item-id') ?? "";
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const entry = { itemId, itemName: "cross-tab catalog watch probe", category: "psu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z", targetPriceWon: 1 };
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key: watchlistKey, newValue: value, storageArea: localStorage }));
      try {
        if (!(button instanceof HTMLButtonElement) || !itemId) return { stage: "missing-controls", itemId };
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const initiallyUnwatched = !button.classList.contains("watched");
        const serialized = JSON.stringify([entry]);
        localStorage.setItem(watchlistKey, serialized);
        dispatch(serialized);
        for (let index = 0; index < 80 && !button.classList.contains("watched"); index += 1) await wait(25);
        const added = button.classList.contains("watched");
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const removed = !button.classList.contains("watched");
        return { stage: "checked", itemId, initiallyUnwatched, added, removed };
      } finally {
        if (originalWatchlist === null) localStorage.removeItem(watchlistKey); else localStorage.setItem(watchlistKey, originalWatchlist);
        dispatch(originalWatchlist);
        await wait(100);
      }
    })()`);
    assert(catalogWatchStorageProbe?.stage === "checked" && catalogWatchStorageProbe.initiallyUnwatched === true && catalogWatchStorageProbe.added === true && catalogWatchStorageProbe.removed === true, "카탈로그 CatalogWatchButton이 다른 탭의 watch-list 추가·제거를 반영하지 못했습니다. probe=" + JSON.stringify(catalogWatchStorageProbe));
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-similarity-evidence\"]') !== null && (document.body?.innerText ?? '').includes('성능 비교 정보')", "카탈로그 성능 비교 정보");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=gpu&minVramGb=12` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filters\"]') !== null && document.querySelector('[aria-label=\"카탈로그 최소 VRAM 스펙 필터\"]')?.value === '12' && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "카탈로그 핵심 사양 필터");
    assert((await client.evaluate("location.search.includes('category=gpu') && location.search.includes('minVramGb=12') && document.querySelector('[data-testid=\"catalog-spec-filter-summary\"]')?.textContent?.includes('VRAM 12GB 이상') === true")), "카탈로그 핵심 사양 필터 URL·요약이 보존되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid="catalog-clear-spec-filters"]', 1)) === 1, "카탈로그 핵심 사양 필터 초기화 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filter-summary\"]') === null && !location.search.includes('minVramGb=')", "카탈로그 핵심 사양 필터 초기화");

    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu&sort=benchmark_desc` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-benchmark-sort-panel\"]') !== null && document.querySelector('[data-testid=\"catalog-benchmark-sort\"]')?.value === 'benchmark_desc' && new URLSearchParams(location.search).get('sort') === 'benchmark_desc' && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "CPU 성능 정렬 URL·선택 상태");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=gpu&sort=benchmark_desc` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-benchmark-sort-panel\"]') !== null && document.querySelector('[data-testid=\"catalog-benchmark-sort\"]')?.value === 'benchmark_desc' && new URLSearchParams(location.search).get('sort') === 'benchmark_desc' && (document.body?.innerText ?? '').includes('3DMark 점수 높은 순')", "GPU 성능 정렬 URL·선택 상태");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=memory&sort=benchmark_desc` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-benchmark-sort-panel\"]') === null && new URLSearchParams(location.search).get('sort') === null && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "비지원 범주 성능 정렬 정규화");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu&sort=similarity` });
    await waitForValue(client, "document.querySelector('[aria-label=\"카탈로그 정렬\"]')?.value === 'price_asc' && new URLSearchParams(location.search).get('sort') === null && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "전체 카탈로그 호환 전용 정렬 정규화");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu&mode=compatible&sort=benchmark_desc` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-benchmark-sort-panel\"]') === null && new URLSearchParams(location.search).get('sort') === 'similarity'", "호환 후보 성능 정렬 정규화");

    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu&brand=AMD` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-brand-filter\"] input')?.value === 'AMD' && new URLSearchParams(location.search).get('brand') === 'AMD' && document.querySelectorAll('.catalog-part-card').length > 0", "카탈로그 제조사 필터");
    assert(await client.evaluate("(() => { const cards = [...document.querySelectorAll('.catalog-part-card')]; return cards.length > 0 && cards.every((card) => (card.textContent ?? '').includes('AMD')); })()"), "카탈로그 제조사 필터 결과에 다른 제조사 부품이 섞였습니다.");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu&brand=ASUS` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-brand-filter\"] input')?.value === 'ASUS' && new URLSearchParams(location.search).get('brand') === 'ASUS' && (document.body?.innerText ?? '').includes('0개 결과')", "카탈로그 제조사 빈 결과");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=motherboard&pcieSlotWidth=4&minPcieSlotCount=1` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filters\"]') !== null && document.querySelector('[aria-label=\"카탈로그 PCIe 슬롯 폭 스펙 필터\"]')?.value === '4' && document.querySelector('[aria-label=\"카탈로그 최소 PCIe 슬롯 수 스펙 필터\"]')?.value === '1' && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "카탈로그 PCIe 슬롯 조건 필터");
    assert((await client.evaluate("location.search.includes('pcieSlotWidth=4') && location.search.includes('minPcieSlotCount=1') && document.querySelector('[data-testid=\"catalog-spec-filter-summary\"]')?.textContent?.includes('PCIe x4 이상 슬롯 1개 이상') === true")), "카탈로그 PCIe 슬롯 조건 URL·요약이 보존되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid="catalog-clear-spec-filters"]', 1)) === 1, "카탈로그 PCIe 슬롯 조건 초기화 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filter-summary\"]') === null && !location.search.includes('pcieSlotWidth=') && !location.search.includes('minPcieSlotCount=')", "카탈로그 PCIe 슬롯 조건 초기화");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=motherboard&pcieSlotInfo=missing` });
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filters\"]') !== null && document.querySelector('[aria-label=\"카탈로그 PCIe 슬롯 정보 상태 필터\"]')?.value === 'missing' && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "카탈로그 PCIe 정보 부족 필터");
    assert((await client.evaluate("location.search.includes('pcieSlotInfo=missing') && document.querySelector('[data-testid=\"catalog-spec-filter-summary\"]')?.textContent?.includes('PCIe 슬롯 정보 부족') === true")), "카탈로그 PCIe 정보 부족 필터 URL·요약이 보존되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid="catalog-clear-spec-filters"]', 1)) === 1, "카탈로그 PCIe 정보 부족 필터 초기화 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filter-summary\"]') === null && !location.search.includes('pcieSlotInfo=')", "카탈로그 PCIe 정보 부족 필터 초기화");
    const catalogIntegrityResponse = await fetch(`${baseUrl}/api/parts?category=motherboard&limit=1`).then((response) => response.json());
    if ((catalogIntegrityResponse?.categoryMismatchExcludedCount ?? 0) > 0) {
      await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=motherboard` });
      await waitForValue(client, "document.querySelector('[data-testid=\"catalog-non-core-notice\"]') !== null && (document.body?.innerText ?? '').includes('분류가 맞지 않는 항목')", "카탈로그 카테고리 정합성 분리 안내");
      const catalogIntegrityNotice = await client.evaluate("(() => { const notice = document.querySelector('[data-testid=\"catalog-non-core-notice\"]'); return { noticeText: notice?.textContent ?? '', accessoryLink: notice?.querySelector('[data-testid=\"catalog-open-accessories\"]') !== null }; })()");
      const catalogIntegrityNoticeProbe = { ...catalogIntegrityResponse, ...catalogIntegrityNotice };
      assert(catalogIntegrityNoticeProbe.categoryMismatchExcludedCount > 0 && catalogIntegrityNoticeProbe.nonCoreExcludedCount >= catalogIntegrityNoticeProbe.categoryMismatchExcludedCount && catalogIntegrityNoticeProbe.noticeText.includes('분류가 맞지 않는 항목') && (catalogIntegrityNoticeProbe.nonCoreExcludedCount > catalogIntegrityNoticeProbe.categoryMismatchExcludedCount || !catalogIntegrityNoticeProbe.accessoryLink), "카탈로그 화면이 카테고리 불일치 원본과 주변 부품 이동을 구분하지 못했습니다. probe=" + JSON.stringify(catalogIntegrityNoticeProbe));
    }
    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await waitForHomeDemoButtons(client, "카탈로그 비교 기준 demo 홈");
    assert(await clickText(client, "문제 있는 예시 견적"), "카탈로그 비교 기준 문제 있는 예시 견적을 불러오지 못했습니다.");
    await waitForValue(client, "location.pathname === '/build' && (document.querySelector('button.button-primary.full-width')?.disabled === false || (document.body?.innerText ?? '').includes('검사할 준비가 되었습니다') || (document.body?.innerText ?? '').includes('모든 필수 부품을 선택했습니다'))", "카탈로그 비교 기준 demo 구성");
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu` });
    await waitForValue(client, "document.querySelector('[aria-label=\"카탈로그 부품 범주\"]')?.value === 'cpu' && document.querySelector('[data-testid=\"catalog-spec-preset\"]') !== null && document.querySelector('[data-testid=\"catalog-apply-spec-preset\"]')?.disabled === false && document.querySelectorAll('.catalog-part-compare').length > 1", "전체 CPU 카탈로그 비교 화면");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-benchmark-evidence-summary\"]') !== null && document.querySelector('.catalog-part-card-copy .catalog-benchmark-evidence-points') !== null && document.querySelector('[data-testid=\"catalog-benchmark-evidence\"]') !== null && (document.body?.innerText ?? '').includes('Cinebench R23 싱글')", "카탈로그 CPU 성능 근거 상세");
    assert((await clickSelector(client, '[data-testid="catalog-apply-spec-preset"]', 1)) === 1, "현재 견적 기준 사양 조건 적용 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-filter-summary\"]')?.textContent?.includes('소켓') === true && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "현재 견적 기준 사양 조건 적용");
    assert((await clickSelector(client, '.catalog-part-compare', 2)) === 2, "전체 카탈로그 비교용 CPU 2개를 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-comparison-bar\"]')?.textContent?.includes('부품 비교 2 / 3') === true", "전체 카탈로그 비교 선택 상태");
    assert((await clickSelector(client, '[data-testid="catalog-compare-submit"]', 1)) === 1, "전체 카탈로그 부품 비교 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-comparison\"]') !== null && document.querySelector('[data-testid=\"catalog-comparison-baseline\"]') !== null", "카탈로그 비교 기준선");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-spec-comparison\"]')?.textContent?.includes('벤치마크') === true && document.querySelector('[data-testid=\"catalog-spec-comparison\"]')?.textContent?.includes('Cinebench R23 싱글') === true && document.querySelector('[data-testid=\"catalog-spec-comparison\"]')?.textContent?.includes('벤치마크 출처') === true", "카탈로그 비교 성능 점수·출처");
    const catalogShareProbe = await client.evaluate("(async () => { const button = document.querySelector('[data-testid=\"catalog-comparison-share\"]'); if (!(button instanceof HTMLButtonElement)) return undefined; const originalFetch = window.fetch; let captured; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; if (url === '/api/comparisons' && init?.method === 'POST') { captured = typeof init.body === 'string' ? JSON.parse(init.body) : undefined; return new Response(JSON.stringify({ id: 'catalog-browser-smoke-comparison', url: '/compare/catalog-browser-smoke-comparison', ownerToken: 'catalog-browser-smoke-owner' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); }; try { button.click(); for (let index = 0; index < 30 && !captured; index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); return captured; } finally { window.fetch = originalFetch; } })()");
    assert(catalogShareProbe?.currentPartName && catalogShareProbe?.currentPartSummary && catalogShareProbe?.currentPartPrice && catalogShareProbe?.category && Array.isArray(catalogShareProbe?.candidates) && catalogShareProbe.candidates.length === 2, "카탈로그 부품 비교 공유 요청에 현재 기준선 context가 전달되지 않았습니다.");
    assert(catalogShareProbe.candidates.every((candidate) => candidate?.benchmarkEvidence?.rows?.length === 2 && ["cpu", "gpu"].includes(candidate.benchmarkEvidence.category)), "카탈로그 부품 비교 공유 요청에서 원본 성능 근거가 누락되었습니다. probe=" + JSON.stringify(catalogShareProbe));
    const sharedComparisonSnapshotPayload = JSON.stringify({ id: "catalog-browser-smoke-comparison", name: "브라우저 스모크 CPU 비교", category: catalogShareProbe.category, currentPartName: catalogShareProbe.currentPartName, currentPartSummary: catalogShareProbe.currentPartSummary, currentPartPrice: catalogShareProbe.currentPartPrice, candidates: catalogShareProbe.candidates, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" });
    await client.evaluate(`(() => { const originalFetch = window.fetch; window.__pcSupporterSharedComparisonOriginalFetch = originalFetch; const payload = ${JSON.stringify(sharedComparisonSnapshotPayload)}; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname === '/api/comparisons/catalog-browser-smoke-comparison') return new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json' } }); return originalFetch(input, init); }; })()`);
    await client.evaluate("(() => { history.pushState({}, '', '/compare/catalog-browser-smoke-comparison'); window.dispatchEvent(new PopStateEvent('popstate')); })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"shared-comparison-benchmark-evidence-panel\"]') !== null && document.querySelectorAll('[data-testid=\"shared-comparison-benchmark-evidence\"]').length === 2 && (document.body?.innerText ?? '').includes('Cinebench R23 싱글')", "공유 비교 원본 성능 근거 보존");
    await waitForValue(client, "document.querySelectorAll('[data-testid=\"shared-comparison-live-benchmark-recheck\"]').length === 2 && (document.body?.innerText ?? '').includes('benchmark ·')", "공유 비교 현재 benchmark 재확인");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('판단 영향 ·') && (document.body?.innerText ?? '').includes('추천 성능 판단')", "공유 비교 benchmark 판단 영향");
    await waitForValue(client, "document.querySelector('.shared-comparison-live-watch[data-item-id]') !== null", "공유 비교 watch storage sync probe 준비");
    const sharedLiveWatchStorageProbe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const button = document.querySelector('.shared-comparison-live-watch[data-item-id]');
      const itemId = button?.getAttribute('data-item-id') ?? "";
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const entry = { itemId, itemName: "cross-tab shared comparison watch probe", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key: watchlistKey, newValue: value, storageArea: localStorage }));
      try {
        if (!(button instanceof HTMLButtonElement) || !itemId) return { stage: "missing-controls", itemId };
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const initiallyUnwatched = !button.classList.contains("watched");
        const serialized = JSON.stringify([entry]);
        localStorage.setItem(watchlistKey, serialized);
        dispatch(serialized);
        for (let index = 0; index < 80 && !button.classList.contains("watched"); index += 1) await wait(25);
        const added = button.classList.contains("watched");
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const removed = !button.classList.contains("watched");
        return { stage: "checked", itemId, initiallyUnwatched, added, removed };
      } finally {
        if (originalWatchlist === null) localStorage.removeItem(watchlistKey); else localStorage.setItem(watchlistKey, originalWatchlist);
        dispatch(originalWatchlist);
        await wait(100);
      }
    })()`);
    assert(sharedLiveWatchStorageProbe?.stage === "checked" && sharedLiveWatchStorageProbe.initiallyUnwatched === true && sharedLiveWatchStorageProbe.added === true && sharedLiveWatchStorageProbe.removed === true, "공유 비교 SharedLiveWatchControl이 다른 탭의 watch-list 추가·제거를 반영하지 못했습니다. probe=" + JSON.stringify(sharedLiveWatchStorageProbe));
    await client.evaluate("(() => { const originalFetch = window.__pcSupporterSharedComparisonOriginalFetch; if (originalFetch) window.fetch = originalFetch; delete window.__pcSupporterSharedComparisonOriginalFetch; })()");
    const sharedComparisonLatestRouteProbe = await client.evaluate(`(async () => { const originalFetch = window.fetch; const base = ${JSON.stringify(sharedComparisonSnapshotPayload)}; const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }); const snapshotFor = (id, name) => { const snapshot = JSON.parse(base); snapshot.id = id; snapshot.name = name; return snapshot; }; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href); if (requestUrl.pathname === "/api/comparisons/shared-route-a") { await new Promise((resolve) => setTimeout(resolve, 400)); return response(snapshotFor("shared-route-a", "공유 비교 A")); } if (requestUrl.pathname === "/api/comparisons/shared-route-b") return response(snapshotFor("shared-route-b", "공유 비교 B")); if (requestUrl.pathname === "/api/parts/batch") return response({ items: [], missingIds: [] }); return originalFetch(input, init); }; const push = (id) => { history.pushState({}, "", "/compare/" + id); window.dispatchEvent(new PopStateEvent("popstate")); }; try { push("shared-route-a"); for (let index = 0; index < 60 && !(document.querySelector("h1")?.textContent ?? "").includes("공유 비교 A"); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); push("shared-route-b"); for (let index = 0; index < 60 && !(document.querySelector("h1")?.textContent ?? "").includes("공유 비교 B"); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 500)); return { stage: "checked", heading: document.querySelector("h1")?.textContent ?? "", cardHeading: document.querySelector(".shared-comparison-card h2")?.textContent ?? "", hasB: (document.body?.innerText ?? "").includes("공유 비교 B"), hasA: (document.body?.innerText ?? "").includes("공유 비교 A") }; } finally { window.fetch = originalFetch; } })()`);
    assert(sharedComparisonLatestRouteProbe?.stage === "checked" && sharedComparisonLatestRouteProbe.heading.includes("공유 비교 B") && sharedComparisonLatestRouteProbe.cardHeading === "공유 비교 B" && sharedComparisonLatestRouteProbe.hasB === true && sharedComparisonLatestRouteProbe.hasA === false, "공유 후보 비교 route 전환 후 이전 snapshot 응답이 최신 화면을 덮었습니다. probe=" + JSON.stringify(sharedComparisonLatestRouteProbe));
    const sharedVersionComparisonLatestRouteProbe = await client.evaluate(`(async () => { const originalFetch = window.fetch; const headers = { "Content-Type": "application/json" }; const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers }); const stamp = "2026-09-08T00:00:00.000Z"; const check = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 1000000, priceComplete: true, analysisScore: 80, analysisScoreLabel: "균형형", analysisConfidence: "high", findings: [], engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp }; const payloadFor = (suffix) => ({ schemaVersion: 1, kind: "pc-supporter.saved-build-version-comparison-share", generatedAt: stamp, before: { id: "build-" + suffix + "-before", label: "변경 전", versionNumber: 1, name: suffix + " 이전 견적", updatedAt: stamp, check }, after: { id: "build-" + suffix + "-after", label: "변경 후", versionNumber: 2, name: suffix + " 이후 견적", updatedAt: stamp, check }, summary: { direction: "same", selectionChangedCategoryCount: 0 }, transition: { direction: "same", statusChanged: false, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, priceCompletenessChanged: false, resourceBudgetChanged: false, benchmarkChanged: false, benchmarkNeedsReview: false, engineChanged: false, catalogChanged: false, resolvedFindingCount: 0, newFindingCount: 0, severityChangedFindingCount: 0, detailsChangedFindingCount: 0 }, changes: [], findingChanges: [], dataBoundary: "probe snapshot", text: "probe" }); const snapshotFor = (id, label, suffix) => ({ id, name: label, payload: payloadFor(suffix), createdAt: stamp, updatedAt: stamp }); const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false }; const savedBuildFor = (id) => ({ id, name: id, selection, recommendationPreferences: { profile: "gaming", priority: "balanced", budgetWon: 1500000, listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 }, createdAt: stamp, updatedAt: stamp }); const compatibilityResult = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: "gaming", scoreLabel: "균형형", scoreBasis: "probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 1000000, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp }; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href); if (requestUrl.pathname === "/api/version-comparisons/version-route-a") { await new Promise((resolve) => setTimeout(resolve, 400)); return response(snapshotFor("version-route-a", "공유 버전 A", "A")); } if (requestUrl.pathname === "/api/version-comparisons/version-route-b") return response(snapshotFor("version-route-b", "공유 버전 B", "B")); if (requestUrl.pathname === "/api/builds") return response({ items: [savedBuildFor("build-version-route-before"), savedBuildFor("build-version-route-after")] }); if (requestUrl.pathname === "/api/compatibility/check" && init?.method === "POST") return response(compatibilityResult); return originalFetch(input, init); }; const push = (id) => { history.pushState({}, "", "/version-comparison/" + id); window.dispatchEvent(new PopStateEvent("popstate")); }; try { push("version-route-a"); await new Promise((resolve) => setTimeout(resolve, 25)); push("version-route-b"); for (let index = 0; index < 60 && document.querySelector('[data-testid="shared-version-comparison-card"] h2')?.textContent !== "공유 버전 B"; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 500)); return { stage: "checked", cardHeading: document.querySelector('[data-testid="shared-version-comparison-card"] h2')?.textContent ?? "", hasB: (document.body?.innerText ?? "").includes("공유 버전 B"), hasA: (document.body?.innerText ?? "").includes("공유 버전 A"), currentCheck: document.querySelector('[data-testid="shared-version-comparison-current-check"]') !== null }; } finally { window.fetch = originalFetch; } })()`);
    assert(sharedVersionComparisonLatestRouteProbe?.stage === "checked" && sharedVersionComparisonLatestRouteProbe.cardHeading === "공유 버전 B" && sharedVersionComparisonLatestRouteProbe.hasB === true && sharedVersionComparisonLatestRouteProbe.hasA === false && sharedVersionComparisonLatestRouteProbe.currentCheck === true, "공유 저장 버전 비교 route 전환 후 이전 snapshot 또는 current recheck 상태가 최신 화면을 덮었습니다. probe=" + JSON.stringify(sharedVersionComparisonLatestRouteProbe));
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu` });
    await waitForValue(client, "document.querySelector('[aria-label=\"카탈로그 부품 범주\"]')?.value === 'cpu' && document.querySelector('.catalog-part-list [data-testid^=\"catalog-part-\"]') !== null", "카탈로그 route history CPU 기준");
    await client.evaluate("(() => { history.pushState({}, '', '/catalog?category=gpu&sort=benchmark_desc'); window.dispatchEvent(new PopStateEvent('popstate')); })()");
    await waitForValue(client, "document.querySelector('[aria-label=\"카탈로그 부품 범주\"]')?.value === 'gpu' && document.querySelector('[data-testid=\"catalog-benchmark-sort\"]')?.value === 'benchmark_desc'", "카탈로그 route history GPU 복원");
    await goBack(client);
    await waitForValue(client, "document.querySelector('[aria-label=\"카탈로그 부품 범주\"]')?.value === 'cpu' && new URLSearchParams(location.search).get('category') === 'cpu' && document.querySelector('[data-testid=\"catalog-benchmark-sort\"]')?.value === 'off'", "카탈로그 route history 뒤로 가기 CPU 복원");
    recordRouteHistoryFlow("catalog-route-history");
    assert(await setInputValue(client, '[aria-label="부품 카탈로그 검색"]', 'AMD'), "카탈로그 query history 첫 검색어를 입력하지 못했습니다.");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(await setInputValue(client, '[aria-label="부품 카탈로그 검색"]', 'AMD Ryzen'), "카탈로그 query history 최종 검색어를 입력하지 못했습니다.");
    await waitForValue(client, "new URLSearchParams(location.search).get('q') === 'AMD Ryzen' && document.querySelector('[aria-label=\"부품 카탈로그 검색\"]')?.value === 'AMD Ryzen'", "카탈로그 query history debounce 최종 상태");
    await goBack(client);
    await waitForValue(client, "new URLSearchParams(location.search).get('category') === 'cpu' && new URLSearchParams(location.search).get('q') === null && document.querySelector('[aria-label=\"부품 카탈로그 검색\"]')?.value === ''", "카탈로그 query history 뒤로 가기 원래 검색 상태 복원");
    recordRouteHistoryFlow("catalog-query-history-coalesce");
    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await waitForHomeDemoButtons(client, "결과 route 복귀 기준 demo 홈");
    assert(await clickText(client, "문제 있는 예시 견적"), "결과 route 복귀 기준 문제 있는 예시 견적을 불러오지 못했습니다.");
    await waitForValue(client, "location.pathname === '/build' && document.querySelector('button.button-primary.full-width')?.disabled === false", "결과 route 복귀 기준 demo 구성");
    assert(await clickText(client, "호환성 검사하기"), "결과 route 복귀 기준 호환성 검사를 실행하지 못했습니다.");
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null && document.querySelector('[data-testid=\"result-findings\"]') !== null", "결과 route 복귀 기준 검사 결과");
    await openResultDetails(client);
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=gpu` });
    const gpuBenchmarkCoverage = await client.evaluate("fetch('/api/parts?category=gpu&benchmarkStatus=complete&limit=1').then((response) => response.json())");
    if ((gpuBenchmarkCoverage?.total ?? 0) > 0) {
      await waitForValue(client, "(document.body?.innerText ?? '').includes('그래픽카드 목록') && document.querySelector('[data-testid=\"catalog-benchmark-evidence-summary\"]') !== null && document.querySelector('[data-testid=\"catalog-benchmark-evidence\"]') !== null && (document.body?.innerText ?? '').includes('3DMark Time Spy')", "카탈로그 GPU 성능 근거 상세");
    } else {
      await waitForValue(client, "(document.body?.innerText ?? '').includes('그래픽카드 목록') && document.querySelector('[data-testid=\"catalog-benchmark-evidence-summary\"]') !== null && (document.body?.innerText ?? '').includes('점수 없음') && (document.body?.innerText ?? '').includes('출처 확인 필요')", "카탈로그 GPU 성능 근거 없음 안내");
    }
    await client.send("Page.navigate", { url: `${baseUrl}/result` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('검사 결과 상세')", "검사 결과 route 복귀");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"build-benchmark-snapshot\"]') !== null", "전체 견적 benchmark snapshot");
    const buildBenchmarkSnapshotProbe = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"build-benchmark-snapshot\"]'); return { text: node?.textContent ?? '', status: node?.className ?? '' }; })()");
    assert(buildBenchmarkSnapshotProbe.text.includes('견적 성능 정보 상태') && buildBenchmarkSnapshotProbe.text.includes('개 점수'), "전체 견적 benchmark snapshot 상태·커버리지가 표시되지 않았습니다. probe=" + JSON.stringify(buildBenchmarkSnapshotProbe));
    await waitForValue(client, "[...document.querySelectorAll('.finding-actions button')].some((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('바꾸기'))", "검사 결과 액션 chunk 복원");
    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: ["*://*/api/parts/compatible*"] });
    const retryReplacementClicked = await client.evaluate("(() => { const node = [...document.querySelectorAll('.finding-actions button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('바꾸기')); if (!node) return false; node.click(); return true; })()");
    assert(retryReplacementClicked, "API 복구 테스트용 finding 교체 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('다시 불러오기')", "후보 조회 실패 복구 안내");
    await client.send("Network.setBlockedURLs", { urls: [] });
    assert(await clickText(client, "다시 불러오기"), "후보 조회 재시도 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelectorAll('[role=dialog] .picker-item').length > 0", "후보 조회 재시도 결과");
    assert((await clickSelector(client, '[role=dialog] button[aria-label="부품 선택 닫기"]', 1)) === 1, "복구 테스트 후 선택기 닫기 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog]') === null", "복구 테스트 선택기 닫힘");

    await client.send("Page.navigate", { url: baseUrl + "/build" });
    await waitForValue(client, "document.querySelector('.workspace-page') !== null && ((document.body?.innerText ?? '').includes('나의 PC 견적 구성') || (document.body?.innerText ?? '').includes('견적 구성'))", "부품 선택기 캐시 fallback 준비");
    await waitForValue(client, "document.querySelector('.component-card button') !== null", "부품 선택기 캐시 fallback 부품 버튼");
    assert(await client.evaluate("(() => { const card = [...document.querySelectorAll('.component-card')].find((candidate) => candidate.querySelector('h3')?.textContent?.includes('메인보드')); const button = card?.querySelector('.empty-selection button, .selected-lines > .text-button, .included-selection button'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true; })()"), "메인보드 부품 선택기를 열지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] #picker-title')?.textContent?.includes('메인보드') === true && document.querySelector('[role=dialog] [aria-label=\"부품 선택기 PCIe 슬롯 정보 상태\"]') !== null && document.querySelector('[role=dialog] [aria-label=\"부품 선택기 PCIe 슬롯 폭\"]') !== null", "부품 선택기 PCIe 슬롯 조건 컨트롤");
    assert(await selectLabel(client, "PCIe 슬롯 정보", "missing"), "부품 선택기 PCIe 정보 부족 조건을 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] .picker-spec-summary')?.textContent?.includes('PCIe 슬롯 정보 부족') === true && document.querySelectorAll('[role=dialog] .picker-item').length > 0", "부품 선택기 PCIe 정보 부족 결과");
    assert(await client.evaluate("document.querySelector('[role=dialog] [aria-label=\"부품 선택기 PCIe 슬롯 정보 상태\"]')?.value === 'missing'"), "부품 선택기 PCIe 정보 부족 조건 값이 유지되지 않았습니다.");
    assert((await clickSelector(client, '[role=dialog] .picker-preset-button', 1)) === 1, "부품 선택기 PCIe 정보 부족 조건 초기화 버튼을 찾지 못했습니다.");
    assert(await selectLabel(client, "PCIe 슬롯 폭", "4"), "부품 선택기 PCIe 슬롯 폭 조건을 선택하지 못했습니다.");
    assert(await setInputValue(client, '[role="dialog"] [aria-label="부품 선택기 최소 PCIe 슬롯 수"]', "1"), "부품 선택기 최소 PCIe 슬롯 수 조건을 입력하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] .picker-spec-summary')?.textContent?.includes('PCIe x4 이상 슬롯 1개 이상') === true && document.querySelectorAll('[role=dialog] .picker-item').length > 0", "부품 선택기 PCIe 슬롯 조건 결과");
    assert(await client.evaluate("document.querySelector('[role=dialog] [aria-label=\"부품 선택기 PCIe 슬롯 폭\"]')?.value === '4' && document.querySelector('[role=dialog] [aria-label=\"부품 선택기 최소 PCIe 슬롯 수\"]')?.value === '1'"), "부품 선택기 PCIe 슬롯 조건 값이 유지되지 않았습니다.");
    assert((await clickSelector(client, '[role=dialog] .picker-preset-button', 1)) === 1, "부품 선택기 PCIe 슬롯 조건 초기화 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] [aria-label=\"부품 선택기 PCIe 슬롯 폭\"]')?.value === '' && document.querySelector('[role=dialog] [aria-label=\"부품 선택기 최소 PCIe 슬롯 수\"]')?.value === ''", "부품 선택기 PCIe 슬롯 조건 초기화");
    assert((await clickSelector(client, '[role=dialog] button[aria-label=\"부품 선택 닫기\"]', 1)) === 1, "PCIe 슬롯 조건 선택기를 닫지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog]') === null", "PCIe 슬롯 조건 선택기 닫힘");
    await client.evaluate("localStorage.setItem('pc-supporter-catalog-picker-cache-v1', JSON.stringify({ schemaVersion: 1, cachedAt: '2026-09-04T01:00:00.000Z', items: [{ id: 'cached-cpu-smoke', category: 'cpu', name: '브라우저 캐시 CPU', brand: 'PC Supporter', model: 'CACHE-CPU', source: 'seed', listingType: 'retail', dataQuality: 'seed', missingFields: [], updatedAt: '2026-09-04T00:00:00.000Z', priceWon: 1, specs: { socket: 'AM5', memoryType: 'DDR5', cores: 6, threads: 12 } }] }))");
    await client.evaluate("sessionStorage.clear()");
    const offlinePickerProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; let blocked = 0; let calls = []; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const requestUrl = new URL(url, location.href); calls.push(requestUrl.pathname + requestUrl.search); if (requestUrl.pathname === '/api/parts' && requestUrl.searchParams.get('category') === 'cpu') { blocked += 1; throw new TypeError('Failed to fetch'); } return originalFetch(input, init); }; try { const card = [...document.querySelectorAll('.component-card')].find((candidate) => candidate.querySelector('h3')?.textContent?.trim() === 'CPU'); const button = card?.querySelector('.empty-selection button, .selected-lines > .text-button, .included-selection button'); if (!(button instanceof HTMLButtonElement)) return { stage: 'no-button', blocked, calls }; button.click(); for (let index = 0; index < 60; index += 1) { if (document.querySelector('[role=\"dialog\"] #picker-title')?.textContent?.includes('CPU')) break; await new Promise((resolve) => setTimeout(resolve, 50)); } if (!document.querySelector('[role=\"dialog\"] #picker-title')?.textContent?.includes('CPU')) return { stage: 'wrong-dialog', blocked, calls: calls.slice(-5), body: (document.body?.innerText ?? '').slice(-1200) }; for (let index = 0; index < 60; index += 1) { if (document.querySelector('[data-testid=\"picker-cached-fallback\"]') && document.querySelectorAll('[data-testid=\"picker-cached-catalog-list\"] .picker-item').length > 0) return { stage: 'fallback', blocked, calls: calls.slice(-5), text: document.body?.innerText ?? '' }; await new Promise((resolve) => setTimeout(resolve, 50)); } return { stage: 'timeout', blocked, calls: calls.slice(-10), cache: localStorage.getItem('pc-supporter-catalog-picker-cache-v1'), dialog: Boolean(document.querySelector('[role=\"dialog\"]')), error: document.querySelector('.fetch-error')?.textContent ?? '', body: (document.body?.innerText ?? '').slice(-4000) }; } finally { window.fetch = originalFetch; } })()");
    assert(offlinePickerProbe?.stage === "fallback", "부품 목록 요청 실패 시 브라우저 캐시 fallback이 표시되지 않았습니다. probe=" + JSON.stringify(offlinePickerProbe));
    const pickerCacheStorageProbe = await client.evaluate(`(async () => { const key = "pc-supporter-catalog-picker-cache-v1"; const original = localStorage.getItem(key); const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)); const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage })); const sentinelId = "cached-cpu-smoke"; const sentinelName = "브라우저 캐시 CPU"; const storedSentinel = () => { try { const parsed = JSON.parse(localStorage.getItem(key) ?? "null"); return Array.isArray(parsed?.items) && parsed.items.some((item) => item?.id === sentinelId); } catch { return false; } }; const visibleSentinel = () => (document.body?.innerText ?? "").includes(sentinelName); try { const cachedList = document.querySelector('[data-testid="picker-cached-catalog-list"]'); const cachedVisible = Boolean(cachedList && cachedList.querySelector(".picker-item-card")); const sentinelVisibleBefore = visibleSentinel(); localStorage.removeItem(key); dispatch(null); for (let index = 0; index < 80 && (visibleSentinel() || storedSentinel()); index += 1) await wait(25); const sentinelCleared = !visibleSentinel() && !storedSentinel(); return { stage: "checked", cachedVisible, sentinelVisibleBefore, sentinelCleared, cacheCleared: !storedSentinel(), fallbackRemains: Boolean(document.querySelector('[data-testid="picker-cached-catalog-list"]')) }; } finally { if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original); dispatch(original); await wait(100); } })()`);
    assert(pickerCacheStorageProbe?.stage === "checked" && pickerCacheStorageProbe.cachedVisible === true && pickerCacheStorageProbe.sentinelVisibleBefore === true && pickerCacheStorageProbe.sentinelCleared === true && pickerCacheStorageProbe.cacheCleared === true, "부품 선택기 cache storage 전용 항목을 제거하지 못했습니다. 세션 메모리 fallback은 남을 수 있습니다. probe=" + JSON.stringify(pickerCacheStorageProbe));
    assert(await client.evaluate("(document.body?.innerText ?? '').includes('탐색 전용') && (document.body?.innerText ?? '').includes('브라우저에 저장된 카탈로그') && (document.body?.innerText ?? '').includes('캐시 저장')"), "브라우저 캐시 fallback의 저장 시각·안전 경계 안내가 없습니다.");
    assert((await clickSelector(client, '[role=dialog] button[aria-label=\"부품 선택 닫기\"]', 1)) === 1, "부품 캐시 fallback 선택기 닫기 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog]') === null", "부품 캐시 fallback 선택기 닫힘");

    await client.send("Page.navigate", { url: `${baseUrl}/admin` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터')", "관리자 세션 만료 복구 준비");
    const adminAuthEventProbe = await client.evaluate("(() => { window.dispatchEvent(new CustomEvent('pc-supporter:admin-auth-required', { detail: { path: '/api/admin/build-versions/status', code: 'ADMIN_AUTH_REQUIRED' } })); return true; })()");
    assert(adminAuthEventProbe === true, "관리자 세션 만료 이벤트를 발행하지 못했습니다.");
    await waitForValue(client, "document.querySelector('#admin-password') !== null && (document.body?.innerText ?? '').includes('데이터 센터에 로그인')", "관리자 세션 만료 로그인 전환");
    const adminRecoveryInput = await setInputValue(client, '#admin-password', adminPassword ?? 'browser-smoke-recovery');
    if (!adminRecoveryInput) {
      const inputProbe = await client.evaluate("(() => { const input = document.querySelector('#admin-password'); return { exists: Boolean(input), tag: input?.tagName, type: input?.getAttribute('type'), valueLength: input instanceof HTMLInputElement ? input.value.length : -1, disabled: input instanceof HTMLInputElement ? input.disabled : undefined, body: (document.body?.innerText ?? '').slice(-1200) }; })()");
      throw new Error("관리자 세션 만료 복구 비밀번호를 입력하지 못했습니다. probe=" + JSON.stringify(inputProbe));
    }
    assert(await clickText(client, '로그인'), "관리자 세션 만료 복구 로그인 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "관리자 세션 복구 완료");
    if (adminPassword) {
      assert((await clickSelector(client, '.admin-logout-button', 1)) === 1, "관리자 로그아웃 버튼을 클릭하지 못했습니다.");
      await waitForValue(client, "document.querySelector('#admin-password') !== null && (document.body?.innerText ?? '').includes('데이터 센터에 로그인')", "관리자 로그아웃 후 인증 화면");
      assert(await setInputValue(client, '#admin-password', adminPassword), "로그아웃 후 관리자 재로그인 비밀번호를 입력하지 못했습니다.");
      assert(await clickText(client, '로그인'), "로그아웃 후 관리자 재로그인 버튼을 클릭하지 못했습니다.");
      await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "관리자 로그아웃 후 재로그인");
    }
    const adminLoginMutationLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      let loginCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/admin/login" && (init?.method ?? "GET").toUpperCase() === "POST") {
          loginCalls += 1;
          await wait(500);
          return response({ enabled: true, authenticated: true, security: { environment: "development", passwordConfigured: true, sessionSecretConfigured: true, productionReady: true } });
        }
        return originalFetch(input, init);
      };
      try {
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/login", code: "ADMIN_AUTH_REQUIRED" } }));
        for (let index = 0; index < 160 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        const input = document.querySelector("#admin-password");
        const button = [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? "").includes("로그인"));
        if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return { stage: "missing-login", loginCalls };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "browser-smoke-login-race");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        button.click();
        for (let index = 0; index < 80 && loginCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/login", code: "ADMIN_AUTH_REQUIRED" } }));
        await wait(700);
        const body = document.body?.innerText ?? "";
        return { stage: "checked", loginCalls, loginScreen: Boolean(document.querySelector("#admin-password")), adminScreen: body.includes("부품 데이터 센터"), bodyTail: body.slice(-1200) };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(adminLoginMutationLatestResponseProbe?.stage === "checked" && adminLoginMutationLatestResponseProbe.loginCalls === 1 && adminLoginMutationLatestResponseProbe.loginScreen === true && adminLoginMutationLatestResponseProbe.adminScreen === false, "관리자 세션 만료 뒤 늦은 로그인 응답이 인증 상태를 되살렸습니다. probe=" + JSON.stringify(adminLoginMutationLatestResponseProbe));
    const loginRaceRecoveryPassword = adminPassword ?? "browser-smoke-recovery";
    assert(await setInputValue(client, "#admin-password", loginRaceRecoveryPassword), "관리자 로그인 race probe 이후 복구 비밀번호를 입력하지 못했습니다.");
    assert(await clickText(client, "로그인"), "관리자 로그인 race probe 이후 복구 로그인을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "관리자 로그인 race probe 이후 복구");
    const adminBackupDetailLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const backupId = "backup-detail-race-probe";
      const summary = { backupId, createdAt: "2026-09-09T00:00:00.000Z", changedCount: 1, resultingFingerprint: "r".repeat(64), rollbackAvailable: true };
      const detail = { ...summary, sourceFingerprint: "s".repeat(64), currentFingerprint: "r".repeat(64), items: [{ buildId: "probe-build", name: "stale-backup-detail-probe", changedFields: ["versionNumber"], before: { versionGroupId: "legacy" }, after: { versionGroupId: "probe-group", versionNumber: 2 } }] };
      let detailCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/admin/build-versions/backups" && (init?.method ?? "GET").toUpperCase() === "GET") return response({ items: [summary] });
        if (requestUrl.pathname === "/api/admin/build-versions/backups/" + backupId) {
          detailCalls += 1;
          await wait(500);
          return response(detail);
        }
        return originalFetch(input, init);
      };
      try {
        for (let index = 0; index < 240 && ![...document.querySelectorAll('button[aria-label="저장 견적 버전 상태 새로고침"]')].some((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled); index += 1) await wait(25);
        const refresh = [...document.querySelectorAll('button[aria-label="저장 견적 버전 상태 새로고침"]')].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled);
        if (!(refresh instanceof HTMLButtonElement)) return { stage: "missing-refresh", detailCalls };
        refresh.click();
        for (let index = 0; index < 160 && !document.querySelector('[data-testid="admin-build-version-backup-history"]'); index += 1) await wait(25);
        const detailButton = document.querySelector('.version-migration-detail-button');
        if (!(detailButton instanceof HTMLButtonElement)) return { stage: "missing-detail-button", detailCalls, body: (document.body?.innerText ?? "").slice(-1800) };
        detailButton.click();
        for (let index = 0; index < 80 && detailCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/build-versions/backups/" + backupId, code: "ADMIN_AUTH_REQUIRED" } }));
        for (let index = 0; index < 80 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(700);
        const input = document.querySelector("#admin-password");
        const button = [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? "").includes("로그인"));
        if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return { stage: "missing-login", detailCalls };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "browser-smoke-backup-detail-race");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        button.click();
        for (let index = 0; index < 160 && document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(450);
        return { stage: "checked", detailCalls, staleAfterRelogin: (document.body?.innerText ?? "").includes("stale-backup-detail-probe"), loginScreen: Boolean(document.querySelector("#admin-password")) };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(adminBackupDetailLatestResponseProbe?.stage === "checked" && adminBackupDetailLatestResponseProbe.detailCalls === 1 && adminBackupDetailLatestResponseProbe.staleAfterRelogin === false && adminBackupDetailLatestResponseProbe.loginScreen === false, "관리자 인증 만료 뒤 늦은 backup 상세 응답이 재로그인 화면에 stale diff를 되살렸습니다. probe=" + JSON.stringify(adminBackupDetailLatestResponseProbe));
    const adminCrawlMutationLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalConfirm = window.confirm;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 202) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      let crawlCalls = 0;
      window.confirm = () => true;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/admin/crawl" && (init?.method ?? "GET").toUpperCase() === "POST") {
          crawlCalls += 1;
          await wait(500);
          return response({ accepted: true, probe: "admin-crawl-mutation" });
        }
        return originalFetch(input, init);
      };
      try {
        for (let index = 0; index < 600 && ![...document.querySelectorAll("button")].some((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.matches('[data-testid="admin-seed-collection-queue-start-category"], [data-testid="admin-catalog-spec-start-category"], [data-testid="admin-catalog-work-priority-start-category"]'))); index += 1) await wait(25);
        const startButton = [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && candidate.matches('[data-testid="admin-seed-collection-queue-start-category"], [data-testid="admin-catalog-spec-start-category"], [data-testid="admin-catalog-work-priority-start-category"]'));
        if (!(startButton instanceof HTMLButtonElement)) return { stage: "missing-start-button", crawlCalls, body: (document.body?.innerText ?? "").slice(-2500) };
        startButton.click();
        for (let index = 0; index < 80 && crawlCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/crawl", code: "ADMIN_AUTH_REQUIRED" } }));
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: "stale-admin-toast-probe" }));
        window.dispatchEvent(new Event("pc-supporter:catalog-meta-refresh"));
        for (let index = 0; index < 80 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(650);
        const body = document.body?.innerText ?? "";
        return { stage: "checked", crawlCalls, login: Boolean(document.querySelector("#admin-password")), staleToast: body.includes("수집을 시작했습니다.") || body.includes("stale-admin-toast-probe"), path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        window.confirm = originalConfirm;
      }
    })()`);
    assert(adminCrawlMutationLatestResponseProbe?.stage === "checked" && adminCrawlMutationLatestResponseProbe.crawlCalls === 1 && adminCrawlMutationLatestResponseProbe.login === true && adminCrawlMutationLatestResponseProbe.staleToast === false && adminCrawlMutationLatestResponseProbe.path === "/admin", "관리자 세션 만료 이후 늦은 카탈로그 수집 kickoff 또는 stale 관리자 이벤트가 로그인 화면에 상태를 남겼습니다. probe=" + JSON.stringify(adminCrawlMutationLatestResponseProbe));
    const crawlRecoveryPassword = adminPassword ?? "browser-smoke-recovery";
    assert(await setInputValue(client, "#admin-password", crawlRecoveryPassword), "카탈로그 수집 kickoff probe 이후 관리자 재로그인 비밀번호를 입력하지 못했습니다.");
    assert(await clickText(client, "로그인"), "카탈로그 수집 kickoff probe 이후 관리자 재로그인 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "카탈로그 수집 kickoff probe 이후 관리자 재로그인");
    const adminLoadOverrideMutationLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const fakePart = {
        id: "admin-load-override-probe-case",
        category: "case",
        name: "admin load override probe case",
        brand: "probe",
        model: "probe-case",
        source: "manual",
        listingType: "retail",
        priceWon: 100000,
        specs: {},
        dataQuality: "manual",
        missingFields: [],
        updatedAt: "2026-09-08T00:00:00.000Z"
      };
      let searchCalls = 0;
      let mutationCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/parts" && requestUrl.searchParams.get("category") === "case" && requestUrl.searchParams.get("q") === "admin-load-override-probe") {
          searchCalls += 1;
          return response({ items: [fakePart], total: 1 });
        }
        if (requestUrl.pathname === "/api/admin/case-rgb-load-overrides/admin-load-override-probe-case" && (init?.method ?? "GET").toUpperCase() === "PUT") {
          mutationCalls += 1;
          await wait(500);
          return response({ saved: true, item: { partId: fakePart.id, rgbDevicePowerW: 2.5, manufacturerModel: "probe-model", sourceNote: "probe-source" } });
        }
        return originalFetch(input, init);
      };
      try {
        for (let index = 0; index < 240 && !document.getElementById("admin-case-rgb-load"); index += 1) await wait(25);
        const anchor = document.getElementById("admin-case-rgb-load");
        anchor?.scrollIntoView({ block: "center" });
        anchor?.focus({ preventScroll: true });
        for (let index = 0; index < 240 && !document.querySelector('[data-testid="admin-case-rgb-load"]'); index += 1) await wait(25);
        const panel = document.querySelector('[data-testid="admin-case-rgb-load"]');
        if (!panel) return { stage: anchor ? "missing-panel" : "missing-anchor", searchCalls, mutationCalls, body: (document.body?.innerText ?? "").slice(-1800) };
        const input = panel.querySelector('input[aria-label="RGB 부하 케이스 검색"]');
        if (!(input instanceof HTMLInputElement)) return { stage: "missing-search", searchCalls, mutationCalls };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "admin-load-override-probe");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        for (let index = 0; index < 120 && !panel.querySelector('.case-rgb-load-parts button'); index += 1) await wait(25);
        const partButton = panel.querySelector('.case-rgb-load-parts button');
        if (!(partButton instanceof HTMLButtonElement)) return { stage: "missing-part", searchCalls, mutationCalls };
        partButton.click();
        for (let index = 0; index < 40 && !panel.querySelector('input[aria-label="RGB 장치당 소비전력"]'); index += 1) await wait(25);
        const power = panel.querySelector('input[aria-label="RGB 장치당 소비전력"]');
        const model = panel.querySelector('input[aria-label="RGB 부하 제조사 모델"]');
        const source = panel.querySelector('input[aria-label="RGB 부하 확인 정보 메모"]');
        if (!(power instanceof HTMLInputElement) || !(model instanceof HTMLInputElement) || !(source instanceof HTMLInputElement)) return { stage: "missing-editor", searchCalls, mutationCalls };
        setter?.call(power, "2.5");
        power.dispatchEvent(new Event("input", { bubbles: true }));
        setter?.call(model, "probe-model");
        model.dispatchEvent(new Event("input", { bubbles: true }));
        setter?.call(source, "probe-source");
        source.dispatchEvent(new Event("input", { bubbles: true }));
        const save = [...panel.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("저장"));
        if (!(save instanceof HTMLButtonElement)) return { stage: "missing-save", searchCalls, mutationCalls };
        save.click();
        for (let index = 0; index < 80 && mutationCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/case-rgb-load-overrides/admin-load-override-probe-case", code: "ADMIN_AUTH_REQUIRED" } }));
        for (let index = 0; index < 80 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(650);
        const body = document.body?.innerText ?? "";
        return { stage: "checked", searchCalls, mutationCalls, login: Boolean(document.querySelector("#admin-password")), staleToast: body.includes("RGB 부하 정보를 저장했습니다"), path: location.pathname };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(adminLoadOverrideMutationLatestResponseProbe?.stage === "checked" && adminLoadOverrideMutationLatestResponseProbe.searchCalls === 1 && adminLoadOverrideMutationLatestResponseProbe.mutationCalls === 1 && adminLoadOverrideMutationLatestResponseProbe.login === true && adminLoadOverrideMutationLatestResponseProbe.staleToast === false && adminLoadOverrideMutationLatestResponseProbe.path === "/admin", "관리자 세션 만료 이후 늦은 RGB 부하 저장 응답이 로그인 화면에 stale toast를 남겼습니다. probe=" + JSON.stringify(adminLoadOverrideMutationLatestResponseProbe));
    assert(await setInputValue(client, "#admin-password", crawlRecoveryPassword), "RGB 부하 저장 ownership probe 이후 관리자 재로그인 비밀번호를 입력하지 못했습니다.");
    assert(await clickText(client, "로그인"), "RGB 부하 저장 ownership probe 이후 관리자 재로그인 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "RGB 부하 저장 ownership probe 이후 관리자 재로그인");
    const adminGpuPhysicalMutationLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const fakePart = {
        id: "admin-gpu-override-probe",
        category: "gpu",
        name: "admin gpu override probe",
        brand: "probe",
        model: "probe-gpu",
        source: "manual",
        listingType: "retail",
        priceWon: 100000,
        specs: {},
        dataQuality: "manual",
        missingFields: [],
        updatedAt: "2026-09-08T00:00:00.000Z"
      };
      let searchCalls = 0;
      let mutationCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/parts" && requestUrl.searchParams.get("category") === "gpu" && requestUrl.searchParams.get("q") === "admin-gpu-override-probe") {
          searchCalls += 1;
          return response({ items: [fakePart], total: 1 });
        }
        if (requestUrl.pathname === "/api/admin/gpu-physical-overrides/admin-gpu-override-probe" && (init?.method ?? "GET").toUpperCase() === "PUT") {
          mutationCalls += 1;
          await wait(500);
          return response({ saved: true, item: { partId: fakePart.id, gpuSlotOccupancy: 3, sourceNote: "probe-source" } });
        }
        return originalFetch(input, init);
      };
      try {
        for (let index = 0; index < 240 && !document.getElementById('admin-gpu-physical'); index += 1) await wait(25);
        const gpuAnchor = document.getElementById('admin-gpu-physical');
        gpuAnchor?.scrollIntoView({ block: 'center' });
        gpuAnchor?.focus({ preventScroll: true });
        for (let index = 0; index < 240 && !document.querySelector('[data-testid="admin-gpu-physical-panel"]'); index += 1) await wait(25);
        const panel = document.querySelector('[data-testid="admin-gpu-physical-panel"]');
        if (!panel) return { stage: gpuAnchor ? "missing-panel" : "missing-anchor", searchCalls, mutationCalls };
        const input = panel.querySelector('.gpu-physical-search-query input');
        if (!(input instanceof HTMLInputElement)) return { stage: "missing-search", searchCalls, mutationCalls };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "admin-gpu-override-probe");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const form = panel.querySelector('form.gpu-physical-search');
        if (!(form instanceof HTMLFormElement)) return { stage: "missing-form", searchCalls, mutationCalls };
        form.requestSubmit();
        for (let index = 0; index < 120 && !panel.querySelector('.gpu-physical-search-results button'); index += 1) await wait(25);
        const resultButton = panel.querySelector('.gpu-physical-search-results button');
        if (!(resultButton instanceof HTMLButtonElement)) return { stage: "missing-result", searchCalls, mutationCalls };
        resultButton.click();
        for (let index = 0; index < 80 && ![...panel.querySelectorAll("button")].some((button) => (button.textContent ?? "").includes("확인값 저장")); index += 1) await wait(25);
        const save = [...panel.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("확인값 저장"));
        if (!(save instanceof HTMLButtonElement)) return { stage: "missing-save", searchCalls, mutationCalls };
        save.click();
        for (let index = 0; index < 80 && mutationCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/gpu-physical-overrides/admin-gpu-override-probe", code: "ADMIN_AUTH_REQUIRED" } }));
        for (let index = 0; index < 80 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(650);
        const body = document.body?.innerText ?? "";
        return { stage: "checked", searchCalls, mutationCalls, login: Boolean(document.querySelector("#admin-password")), staleToast: body.includes("물리 호환 확인값을 저장했습니다"), path: location.pathname };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(adminGpuPhysicalMutationLatestResponseProbe?.stage === "checked" && adminGpuPhysicalMutationLatestResponseProbe.searchCalls === 1 && adminGpuPhysicalMutationLatestResponseProbe.mutationCalls === 1 && adminGpuPhysicalMutationLatestResponseProbe.login === true && adminGpuPhysicalMutationLatestResponseProbe.staleToast === false && adminGpuPhysicalMutationLatestResponseProbe.path === "/admin", "관리자 세션 만료 이후 늦은 GPU 물리 저장 응답이 로그인 화면에 stale toast를 남겼습니다. probe=" + JSON.stringify(adminGpuPhysicalMutationLatestResponseProbe));
    assert(await setInputValue(client, "#admin-password", crawlRecoveryPassword), "GPU 물리 저장 ownership probe 이후 관리자 재로그인 비밀번호를 입력하지 못했습니다.");
    assert(await clickText(client, "로그인"), "GPU 물리 저장 ownership probe 이후 관리자 재로그인 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "GPU 물리 저장 ownership probe 이후 관리자 재로그인");
    const adminM2MutationLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const fakePart = { id: "admin-m2-override-probe", category: "motherboard", name: "admin m2 override probe", brand: "probe", model: "probe-board", source: "manual", listingType: "retail", priceWon: 100000, specs: { m2Slots: 1 }, dataQuality: "manual", missingFields: [], updatedAt: "2026-09-09T00:00:00.000Z" };
      let searchCalls = 0;
      let mutationCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/parts" && requestUrl.searchParams.get("category") === "motherboard" && requestUrl.searchParams.get("q") === "admin-m2-override-probe") { searchCalls += 1; return response({ items: [fakePart], total: 1 }); }
        if (requestUrl.pathname === "/api/admin/m2-overrides/admin-m2-override-probe" && (init?.method ?? "GET").toUpperCase() === "PUT") { mutationCalls += 1; await wait(500); return response({ override: { partId: fakePart.id, slots: [{ slotId: "M2_1", interfaces: ["NVMe"], connection: "unknown", sharedWith: [] }], sourceNote: "probe-source" }, part: fakePart }); }
        return originalFetch(input, init);
      };
      try {
        for (let index = 0; index < 240 && !document.getElementById('admin-m2-mapping'); index += 1) await wait(25);
        const m2Anchor = document.getElementById('admin-m2-mapping');
        m2Anchor?.scrollIntoView({ block: 'center' });
        m2Anchor?.focus({ preventScroll: true });
        for (let index = 0; index < 240 && !document.querySelector('.m2-override-card'); index += 1) await wait(25);
        const panel = document.querySelector('.m2-override-card');
        if (!panel) return { stage: m2Anchor ? "missing-panel" : "missing-anchor", searchCalls, mutationCalls };
        const input = panel.querySelector('.m2-board-search input');
        if (!(input instanceof HTMLInputElement)) return { stage: "missing-search", searchCalls, mutationCalls };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "admin-m2-override-probe");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const form = panel.querySelector('form.m2-board-search');
        if (!(form instanceof HTMLFormElement)) return { stage: "missing-form", searchCalls, mutationCalls };
        form.requestSubmit();
        for (let index = 0; index < 120 && !panel.querySelector('.m2-board-results button'); index += 1) await wait(25);
        const resultButton = panel.querySelector('.m2-board-results button');
        if (!(resultButton instanceof HTMLButtonElement)) return { stage: "missing-result", searchCalls, mutationCalls };
        resultButton.click();
        for (let index = 0; index < 80 && ![...panel.querySelectorAll("button")].some((button) => (button.textContent ?? "").includes("매핑 저장")); index += 1) await wait(25);
        const save = [...panel.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("매핑 저장"));
        if (!(save instanceof HTMLButtonElement)) return { stage: "missing-save", searchCalls, mutationCalls };
        save.click();
        for (let index = 0; index < 80 && mutationCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/m2-overrides/admin-m2-override-probe", code: "ADMIN_AUTH_REQUIRED" } }));
        for (let index = 0; index < 80 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(650);
        const body = document.body?.innerText ?? "";
        return { stage: "checked", searchCalls, mutationCalls, login: Boolean(document.querySelector("#admin-password")), staleToast: body.includes("M.2 슬롯 매핑을 저장했습니다"), path: location.pathname };
      } finally { window.fetch = originalFetch; }
    })()`);
    assert(adminM2MutationLatestResponseProbe?.stage === "checked" && adminM2MutationLatestResponseProbe.searchCalls === 1 && adminM2MutationLatestResponseProbe.mutationCalls === 1 && adminM2MutationLatestResponseProbe.login === true && adminM2MutationLatestResponseProbe.staleToast === false && adminM2MutationLatestResponseProbe.path === "/admin", "관리자 세션 만료 이후 늦은 M.2 저장 응답이 로그인 화면에 stale toast를 남겼습니다. probe=" + JSON.stringify(adminM2MutationLatestResponseProbe));
    assert(await setInputValue(client, "#admin-password", crawlRecoveryPassword), "M.2 저장 ownership probe 이후 관리자 재로그인 비밀번호를 입력하지 못했습니다.");
    assert(await clickText(client, "로그인"), "M.2 저장 ownership probe 이후 관리자 재로그인 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "M.2 저장 ownership probe 이후 관리자 재로그인");
    const adminBenchmarkMutationLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const fakeItem = { partId: "admin-benchmark-override-probe", partName: "admin benchmark override probe", category: "gpu", sourceKind: "independent_review", sourceNote: "probe-source", updatedAt: "2026-09-09T00:00:00.000Z", gpu3dmarkTimeSpyScore: 15000 };
      let validateCalls = 0;
      let mutationCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/admin/benchmark-overrides/validate" && (init?.method ?? "GET").toUpperCase() === "POST") { validateCalls += 1; return response({ validCount: 1, invalidCount: 0, items: [{ partId: fakeItem.partId, partName: fakeItem.partName, category: "gpu", valid: true, operation: "create", changedFields: ["gpu3dmarkTimeSpyScore"] }] }); }
        if (requestUrl.pathname === "/api/admin/benchmark-overrides" && (init?.method ?? "GET").toUpperCase() === "PUT") { mutationCalls += 1; await wait(500); return response({ saved: true, count: 1, items: [fakeItem] }); }
        return originalFetch(input, init);
      };
      try {
        for (let index = 0; index < 240 && !document.getElementById('admin-benchmark-review'); index += 1) await wait(25);
        const benchmarkAnchor = document.getElementById('admin-benchmark-review');
        benchmarkAnchor?.scrollIntoView({ block: 'center' });
        benchmarkAnchor?.focus({ preventScroll: true });
        for (let index = 0; index < 240 && !document.querySelector('[aria-label="벤치마크 보강 관리"]'); index += 1) await wait(25);
        const panel = document.querySelector('[aria-label="벤치마크 보강 관리"]');
        if (!panel) return { stage: benchmarkAnchor ? "missing-panel" : "missing-anchor", validateCalls, mutationCalls };
        const input = panel.querySelector('textarea[aria-label="벤치마크 보강 JSON"]');
        if (!(input instanceof HTMLTextAreaElement)) return { stage: "missing-input", validateCalls, mutationCalls };
        const json = JSON.stringify({ items: [{ partId: fakeItem.partId, gpu3dmarkTimeSpyScore: 15000, sourceKind: "independent_review", sourceNote: "probe-source", sourceUrl: "https://example.com/probe" }] });
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(input, json);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const validate = panel.querySelector('[data-testid="benchmark-overrides-validate"]');
        if (!(validate instanceof HTMLButtonElement)) return { stage: "missing-validate", validateCalls, mutationCalls };
        validate.click();
        for (let index = 0; index < 80 && validateCalls < 1; index += 1) await wait(25);
        for (let index = 0; index < 80 && ![...panel.querySelectorAll('button')].some((button) => button.getAttribute('data-testid') === 'benchmark-overrides-save' && !button.disabled); index += 1) await wait(25);
        const save = panel.querySelector('[data-testid="benchmark-overrides-save"]');
        if (!(save instanceof HTMLButtonElement) || save.disabled) return { stage: "missing-save", validateCalls, mutationCalls };
        save.click();
        for (let index = 0; index < 80 && mutationCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/benchmark-overrides", code: "ADMIN_AUTH_REQUIRED" } }));
        for (let index = 0; index < 80 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(650);
        const body = document.body?.innerText ?? "";
        return { stage: "checked", validateCalls, mutationCalls, login: Boolean(document.querySelector("#admin-password")), staleToast: body.includes("벤치마크 보강 데이터를 저장했습니다"), path: location.pathname };
      } finally { window.fetch = originalFetch; }
    })()`);
    assert(adminBenchmarkMutationLatestResponseProbe?.stage === "checked" && adminBenchmarkMutationLatestResponseProbe.validateCalls === 1 && adminBenchmarkMutationLatestResponseProbe.mutationCalls === 1 && adminBenchmarkMutationLatestResponseProbe.login === true && adminBenchmarkMutationLatestResponseProbe.staleToast === false && adminBenchmarkMutationLatestResponseProbe.path === "/admin", "관리자 세션 만료 이후 늦은 benchmark 저장 응답이 로그인 화면에 stale toast를 남겼습니다. probe=" + JSON.stringify(adminBenchmarkMutationLatestResponseProbe));
    assert(await setInputValue(client, "#admin-password", crawlRecoveryPassword), "benchmark 저장 ownership probe 이후 관리자 재로그인 비밀번호를 입력하지 못했습니다.");
    assert(await clickText(client, "로그인"), "benchmark 저장 ownership probe 이후 관리자 재로그인 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "benchmark 저장 ownership probe 이후 관리자 재로그인");
    await client.send("Page.navigate", { url: `${baseUrl}/admin` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터') && document.querySelector('#admin-password') === null", "관리자 migration ownership probe 화면");
    const adminMigrationMutationLatestResponseProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalConfirm = window.confirm;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const preview = { status: "ready", totalBuilds: 1, legacyCount: 1, changedCount: 1, blockers: [], items: [{ buildId: "migration-probe-build", name: "migration probe", kind: "legacy", current: {}, proposed: { versionGroupId: "migration-probe-group", versionNumber: 1 } }], snapshotFingerprint: "a".repeat(64) };
      const mutationResult = { status: "applied", backupId: "migration-probe-backup", totalBuilds: 1, changedCount: 1, sourceFingerprint: "a".repeat(64), resultingFingerprint: "b".repeat(64) };
      let previewCalls = 0;
      let migrateCalls = 0;
      window.confirm = () => true;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/admin/build-versions/migration-preview") {
          previewCalls += 1;
          return response(preview);
        }
        if (requestUrl.pathname === "/api/admin/build-versions/migrate" && (init?.method ?? "GET").toUpperCase() === "POST") {
          migrateCalls += 1;
          await wait(500);
          return response(mutationResult);
        }
        return originalFetch(input, init);
      };
      try {
        for (let index = 0; index < 240 && ![...document.querySelectorAll("button")].some((candidate) => (candidate.textContent ?? "").includes("마이그레이션 프리뷰")); index += 1) await wait(25);
        const previewButton = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("마이그레이션 프리뷰"));
        if (!(previewButton instanceof HTMLButtonElement)) return { stage: "missing-preview-button", previewCalls, migrateCalls, body: (document.body?.innerText ?? "").slice(-2500) };
        previewButton.click();
        for (let index = 0; index < 80 && !document.querySelector('[data-testid="admin-build-version-migration-preview"]'); index += 1) await wait(25);
        for (let index = 0; index < 240 && ![...document.querySelectorAll("button")].some((candidate) => (candidate.textContent ?? "").includes("프리뷰 결과 적용")); index += 1) await wait(25);
        const applyButton = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("프리뷰 결과 적용"));
        if (!(applyButton instanceof HTMLButtonElement)) return { stage: "missing-apply-button", previewCalls, migrateCalls, body: (document.body?.innerText ?? "").slice(-2500) };
        applyButton.click();
        for (let index = 0; index < 80 && migrateCalls < 1; index += 1) await wait(25);
        window.dispatchEvent(new CustomEvent("pc-supporter:admin-auth-required", { detail: { path: "/api/admin/build-versions/migrate", code: "ADMIN_AUTH_REQUIRED" } }));
        for (let index = 0; index < 80 && !document.querySelector("#admin-password"); index += 1) await wait(25);
        await wait(650);
        const body = document.body?.innerText ?? "";
        return { stage: "checked", previewCalls, migrateCalls, login: Boolean(document.querySelector("#admin-password")), staleResult: body.includes("legacy 메타데이터를 적용했고 backup을 생성했습니다."), staleLoading: body.includes("적용 중..."), path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        window.confirm = originalConfirm;
      }
    })()`);
    assert(adminMigrationMutationLatestResponseProbe?.stage === "checked" && adminMigrationMutationLatestResponseProbe.previewCalls === 1 && adminMigrationMutationLatestResponseProbe.migrateCalls === 1 && adminMigrationMutationLatestResponseProbe.login === true && adminMigrationMutationLatestResponseProbe.staleResult === false && adminMigrationMutationLatestResponseProbe.staleLoading === false && adminMigrationMutationLatestResponseProbe.path === "/admin", "관리자 세션 만료 이후 늦은 저장 견적 migration 응답이 로그인 화면을 덮었습니다. probe=" + JSON.stringify(adminMigrationMutationLatestResponseProbe));

    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await waitForHomeDemoButtons(client, "적용 후 검사 비교 기준 홈");
    assert(await clickText(client, "문제 있는 예시 견적"), "적용 후 검사 비교용 문제 있는 예시 견적을 불러오지 못했습니다.");
    await waitForValue(client, "document.querySelector('button.button-primary.full-width')?.disabled === false || (document.body?.innerText ?? '').includes('검사할 준비가 되었습니다') || (document.body?.innerText ?? '').includes('모든 필수 부품을 선택했습니다')", "적용 후 검사 비교 기준 편집기");
    assert(await clickText(client, "호환성 검사하기"), "적용 후 검사 비교 기준 견적을 검사하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"result-findings\"]') !== null && document.querySelector('.suggestion-card') !== null", "적용 후 검사 비교 기준 결과");
    await openResultDetails(client);
    const appliedSuggestionProbe = await client.evaluate("(() => { const card = [...document.querySelectorAll('.suggestion-card')].find((candidate) => !(candidate.textContent ?? '').includes('적용하지 않음') && candidate.querySelector('.suggestion-apply:not([disabled])')); const button = card?.querySelector('.suggestion-apply:not([disabled])'); if (!(button instanceof HTMLButtonElement)) return { clicked: false }; button.click(); return { clicked: true }; })()");
    assert(appliedSuggestionProbe?.clicked === true, "적용 후 검사 비교 테스트용 대체 후보를 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('.build-change-dialog') !== null", "적용 후 검사 비교 변경 미리보기");
    assert((await clickSelector(client, '.build-change-actions .button-primary', 1)) === 1, "적용 후 검사 비교를 위한 후보 적용을 실행하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"build-change-result-summary\"]') !== null", "적용 후 검사 비교 요약");
    const appliedResultProbe = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"build-change-result-summary\"]'); return { text: node?.textContent ?? '', risk: node?.querySelector('[data-testid=\"build-change-result-summary-risk\"]')?.textContent ?? '', changes: node?.querySelectorAll('.build-change-result-summary-change-list > div').length ?? 0 }; })()");
    assert(appliedResultProbe.text.includes('적용 후 검사 비교') && appliedResultProbe.text.includes('결과') && appliedResultProbe.text.includes('구매 금액') && appliedResultProbe.text.includes('성능 분석') && appliedResultProbe.changes > 0, "적용 후 결과 요약에 판정·금액·성능·변경 내역이 표시되지 않았습니다. probe=" + JSON.stringify(appliedResultProbe));
    assert(appliedResultProbe.risk.includes('차단') && appliedResultProbe.risk.includes('주의') && appliedResultProbe.risk.includes('확인'), "적용 후 결과 요약에 위험 카운트 비교가 없습니다. probe=" + JSON.stringify(appliedResultProbe));
    const changedFindingActionCount = await client.evaluate("document.querySelectorAll('[data-testid^=\"build-change-result-finding-\"]').length");
    if (changedFindingActionCount > 0) {
      assert((await clickSelector(client, '[data-testid^="build-change-result-finding-"]', 1)) === 1, "적용 후 비교의 현재 판정 이동 버튼을 클릭하지 못했습니다.");
      await waitForValue(client, "document.activeElement?.id?.startsWith('finding-') === true", "적용 후 비교 finding 상세 이동");
    }
    assert(await client.evaluate("document.querySelectorAll('[data-testid=\"build-change-result-summary\"] .build-change-result-summary-heading-actions .text-button').length === 3"), "적용 후 검사 비교의 복사·JSON 저장·선택 이유 첨부 액션이 표시되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid="build-change-result-summary"] .build-change-result-summary-heading-actions .text-button', 1)) === 1, "적용 후 검사 비교 복사 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('적용 후 검사 비교를 클립보드에 복사했습니다.') || (document.body?.innerText ?? '').includes('적용 후 검사 비교 복사에 실패했습니다')", "적용 후 검사 비교 복사 안내");
    assert(await clickText(client, "JSON 저장", '[data-testid="build-change-result-summary"] .build-change-result-summary-heading-actions .text-button'), "적용 후 검사 비교 JSON 저장 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('적용 후 검사 비교 JSON을 저장했습니다.')", "적용 후 검사 비교 JSON 저장 안내");
    assert(await clickText(client, "선택 이유에 첨부해 저장", '[data-testid="build-change-result-summary"] .build-change-result-summary-heading-actions .text-button'), "적용 후 비교를 선택 이유에 첨부해 저장하는 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('#save-build-decision-note') !== null && document.querySelector('#save-build-decision-note')?.value?.includes('적용 후 검사') === true", "적용 후 비교 선택 이유 첨부 미리보기");
    assert((await clickSelector(client, '.save-build-actions .button-light', 1)) === 1, "적용 후 비교 선택 이유 첨부 저장을 취소하지 못했습니다.");
    await waitForValue(client, "document.querySelector('#save-build-decision-note') === null", "적용 후 비교 선택 이유 첨부 취소");

    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    const appliedResultWidth = await client.evaluate("({ innerWidth, body: document.body?.scrollWidth ?? 0, document: document.documentElement?.scrollWidth ?? 0 })");
    assert(appliedResultWidth.body <= appliedResultWidth.innerWidth + 1 && appliedResultWidth.document <= appliedResultWidth.innerWidth + 1, `적용 후 검사 비교 패널에 모바일 가로 overflow가 있습니다. innerWidth=${appliedResultWidth.innerWidth}, body=${appliedResultWidth.body}, document=${appliedResultWidth.document}`);
    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await waitForHomeDemoButtons(client, "모바일 홈 화면");
    const homeWidth = await client.evaluate("({ innerWidth, body: document.body?.scrollWidth ?? 0, document: document.documentElement?.scrollWidth ?? 0 })");
    assert(homeWidth.body <= homeWidth.innerWidth + 1 && homeWidth.document <= homeWidth.innerWidth + 1, `모바일 홈 가로 overflow가 있습니다. innerWidth=${homeWidth.innerWidth}, body=${homeWidth.body}, document=${homeWidth.document}`);
    await client.send("Page.navigate", { url: `${baseUrl}/build` });
    await waitForValue(client, "document.querySelector('.workspace-page') !== null && ((document.body?.innerText ?? '').includes('나의 PC 견적 구성') || (document.body?.innerText ?? '').includes('견적 구성'))", "모바일 견적 편집기");
    const buildWidth = await client.evaluate("({ innerWidth, body: document.body?.scrollWidth ?? 0, document: document.documentElement?.scrollWidth ?? 0 })");
    assert(buildWidth.body <= buildWidth.innerWidth + 1 && buildWidth.document <= buildWidth.innerWidth + 1, `모바일 견적 편집기 가로 overflow가 있습니다. innerWidth=${buildWidth.innerWidth}, body=${buildWidth.body}, document=${buildWidth.document}`);
    await client.send("Page.navigate", { url: `${baseUrl}/catalog?category=cpu&benchmarkStatus=incomplete` });
    await waitForValue(client, "document.querySelector('[aria-label=\"카탈로그 성능 근거 상태\"]')?.value === 'incomplete' && document.querySelector('[data-testid=\"catalog-benchmark-filter-summary\"]') !== null", "모바일 CPU 성능 근거 카탈로그");
    const catalogWidth = await client.evaluate("({ innerWidth, body: document.body?.scrollWidth ?? 0, document: document.documentElement?.scrollWidth ?? 0 })");
    assert(catalogWidth.body <= catalogWidth.innerWidth + 1 && catalogWidth.document <= catalogWidth.innerWidth + 1, `모바일 카탈로그 가로 overflow가 있습니다. innerWidth=${catalogWidth.innerWidth}, body=${catalogWidth.body}, document=${catalogWidth.document}`);
    await client.send("Page.navigate", { url: `${baseUrl}/recommend?profile=gaming` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('조건으로 PC 견적 만들기')", "모바일 자동 구성 화면");
    const generatorWidth = await client.evaluate("({ innerWidth, body: document.body?.scrollWidth ?? 0, document: document.documentElement?.scrollWidth ?? 0 })");
    assert(generatorWidth.body <= generatorWidth.innerWidth + 1 && generatorWidth.document <= generatorWidth.innerWidth + 1, `모바일 자동 구성 가로 overflow가 있습니다. innerWidth=${generatorWidth.innerWidth}, body=${generatorWidth.body}, document=${generatorWidth.document}`);
    assert(await setTextValue(client, '[data-testid="generator-brief-input"]', "게이밍 200만원"), "모바일 보완 안내 입력창을 찾지 못했습니다.");
    assert(await clickText(client, "조건 분석"), "모바일 보완 안내 해석 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"generator-brief-guidance\"]') !== null", "모바일 요구사항 보완 안내");
    const guidanceWidth = await client.evaluate("({ innerWidth, body: document.body?.scrollWidth ?? 0, document: document.documentElement?.scrollWidth ?? 0 })");
    assert(guidanceWidth.body <= guidanceWidth.innerWidth + 1 && guidanceWidth.document <= guidanceWidth.innerWidth + 1, `모바일 요구사항 보완 안내 가로 overflow가 있습니다. innerWidth=${guidanceWidth.innerWidth}, body=${guidanceWidth.body}, document=${guidanceWidth.document}`);
    await client.send("Page.navigate", { url: `${baseUrl}/admin` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터')", "모바일 관리자 화면");
    const adminWidth = await client.evaluate("({ innerWidth, body: document.body?.scrollWidth ?? 0, document: document.documentElement?.scrollWidth ?? 0 })");
    assert(adminWidth.body <= adminWidth.innerWidth + 1 && adminWidth.document <= adminWidth.innerWidth + 1, `모바일 관리자 화면 가로 overflow가 있습니다. innerWidth=${adminWidth.innerWidth}, body=${adminWidth.body}, document=${adminWidth.document}`);
    await client.send("Emulation.clearDeviceMetricsOverride");

    await client.send("Page.navigate", { url: `${baseUrl}/watchlist` });
    await waitForValue(client, "(document.body?.innerText ?? '').includes('가격 추적') && (document.body?.innerText ?? '').includes('추적할 부품 찾기')", "가격 추적 화면");
    await client.evaluate("(() => { history.pushState({}, '', '/watchlist?kind=accessory&category=cooling_fan&q=팬'); window.dispatchEvent(new PopStateEvent('popstate')); })()");
    await waitForValue(client, "document.querySelector('[aria-label=\"가격 추적 검색 대상\"]')?.value === 'accessory' && document.querySelector('[aria-label=\"가격 추적 주변 부품 분류\"]')?.value === 'cooling_fan' && document.querySelector('[aria-label=\"가격 추적 부품 검색\"]')?.value === '팬'", "가격 추적 route history 주변 부품 복원");
    await goBack(client);
    await waitForValue(client, "document.querySelector('[aria-label=\"가격 추적 검색 대상\"]')?.value === 'part' && document.querySelector('[aria-label=\"가격 추적 핵심 부품 분류\"]')?.value === 'cpu' && new URLSearchParams(location.search).get('kind') === null", "가격 추적 route history 뒤로 가기 핵심 부품 복원");
    recordRouteHistoryFlow("price-watchlist-route-history");
    await waitForValue(client, "[...document.querySelectorAll('button')].some((button) => !button.disabled && (button.textContent ?? '').includes('추적 추가'))", "가격 추적 검색 결과");
    assert(await selectLabel(client, "대상", "accessory"), "가격 추적 주변 부품 검색 전환을 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"가격 추적 검색 대상\"]')?.value === 'accessory' && document.querySelectorAll('.price-watchlist-search-item').length > 0 && [...document.querySelectorAll('.price-watchlist-search-item > div:first-child > small')].every((node) => !['CPU', '그래픽카드', '메인보드', 'RAM', 'SSD', 'HDD', '케이스', '파워서플라이'].includes((node.textContent ?? '').split(' · ')[0]))", "가격 추적 주변 부품 검색 결과 전환");
    assert(await selectLabel(client, "대상", "part"), "가격 추적 핵심 부품 검색 복귀를 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"가격 추적 검색 대상\"]')?.value === 'part' && document.querySelectorAll('.price-watchlist-search-item').length > 0 && [...document.querySelectorAll('.price-watchlist-search-item > div:first-child > small')].every((node) => ['CPU', 'CPU 쿨러', '메인보드', 'RAM', '그래픽카드', 'SSD', 'HDD', '케이스', '파워서플라이'].includes((node.textContent ?? '').split(' · ')[0]))", "가격 추적 핵심 부품 검색 복귀");
    assert(await clickText(client, "추적 추가"), "가격 추적 추가 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('내 가격 추적 목록') && (document.body?.innerText ?? '').includes('추적 중')", "가격 추적 항목 추가");
    await waitForValue(client, "(() => { const value = document.querySelector('.price-watchlist-current strong')?.textContent?.trim() ?? ''; return value !== '' && !['미확인', '가격 확인 불가', '일시 확인 오류'].includes(value); })()", "가격 추적 현재가");
    assert(await setInputValue(client, '.price-watchlist-tracked-item input[type="number"]', '999999999'), "가격 추적 목표가를 입력하지 못했습니다.");
    await waitForValue(client, "[...document.querySelectorAll('.price-watchlist-decision')].some((node) => (node.textContent ?? '').includes('목표가 도달'))", "가격 추적 목표가 도달 상태");
    await waitForValue(client, "document.querySelector('[data-testid=\"price-watchlist-decision-overview\"]') !== null && (document.body?.innerText ?? '').includes('목표가 도달 1')", "가격 추적 판단 분포");
    assert(await setFileInput(client, '.price-watchlist-import-input', watchlistImportFile), "가격 추적 JSON 가져오기 파일 입력을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"price-watchlist-import-preview\"]') !== null && (document.body?.innerText ?? '').includes('새 항목')", "가격 추적 가져오기 미리보기");
    assert(await clickText(client, "이 내용으로 병합"), "가격 추적 가져오기 확인 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelectorAll('.price-watchlist-tracked-item').length >= 2 && [...document.querySelectorAll('.price-watchlist-tracked-item')].some((node) => (node.textContent ?? '').includes('AMD 라이젠7-5세대 7800X3D')) && document.querySelector('[aria-label=\"가격 추적 최저가 근접 기준\"]')?.value === '20'", "가격 추적 JSON 병합 결과");
    assert(await client.evaluate("(() => { const button = document.querySelector('[data-testid=\"price-watchlist-export\"]'); return button instanceof HTMLButtonElement && !button.disabled; })()"), "가격 추적 JSON 저장 버튼이 활성화되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid="price-watchlist-decision-target"]', 1)) === 1, "가격 추적 판단 분포 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"가격 추적 목록 상태\"]')?.value === 'target' && (document.body?.innerText ?? '').includes('1 / 2개')", "가격 추적 판단 상태 필터");
    assert(await client.evaluate("(() => { const select = document.querySelector('[aria-label=\"가격 추적 목록 상태\"]'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, 'all'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === 'all'; })()"), "가격 추적 빈 목록 재조회 전 전체 상태 필터로 복귀하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"가격 추적 목록 상태\"]')?.value === 'all' && (document.body?.innerText ?? '').includes('2 / 2개')", "가격 추적 전체 상태 필터 복귀");
    await waitForValue(client, "(() => { const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재가 새로고침')); return button instanceof HTMLButtonElement && !button.disabled; })()", "가격 추적 초기 현재가 조회 완료");
    const emptyWatchlistRefreshProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const requestUrl = new URL(url, location.href); if (requestUrl.pathname.startsWith('/api/parts/')) { await new Promise((resolve) => setTimeout(resolve, 400)); } return originalFetch(input, init); }; try { const refresh = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재가 새로고침')); if (!(refresh instanceof HTMLButtonElement) || refresh.disabled) return { stage: 'no-refresh-button' }; refresh.click(); await new Promise((resolve) => setTimeout(resolve, 25)); [...document.querySelectorAll('.price-watchlist-tracked-item > button')].forEach((button) => button.click()); for (let index = 0; index < 40; index += 1) { const refreshButton = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재가 새로고침')); const label = refreshButton?.textContent ?? ''; const empty = (document.body?.innerText ?? '').includes('아직 추적 중인 부품이 없습니다.'); if (empty && refreshButton instanceof HTMLButtonElement && !label.includes('확인 중') && !document.querySelector('.price-watchlist-current')) return { stage: 'cleared', disabled: refreshButton.disabled, label }; await new Promise((resolve) => setTimeout(resolve, 25)); } const refreshButton = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재가 새로고침')); return { stage: 'timeout', disabled: refreshButton instanceof HTMLButtonElement ? refreshButton.disabled : null, label: refreshButton?.textContent ?? '', empty: (document.body?.innerText ?? '').includes('아직 추적 중인 부품이 없습니다.'), current: Boolean(document.querySelector('.price-watchlist-current')) }; } finally { window.fetch = originalFetch; } })()");
    assert(emptyWatchlistRefreshProbe?.stage === 'cleared' && emptyWatchlistRefreshProbe.disabled === true && emptyWatchlistRefreshProbe.label.includes('현재가 새로고침'), "가격 추적 항목을 모두 제거한 뒤 현재가 재조회 중 상태가 남았습니다. probe=" + JSON.stringify(emptyWatchlistRefreshProbe));
    const priceWatchlistStorageSyncProbe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const thresholdKey = "pc-supporter-catalog-watch-threshold";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const originalThreshold = localStorage.getItem(thresholdKey);
      const originalFetch = window.fetch;
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
      const entry = { itemId: "price-watch-storage-probe", itemName: "cross-tab watch probe", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
      const dispatch = (key, value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/parts/price-watch-storage-probe") return response({ id: entry.itemId, name: entry.itemName, category: "cpu", model: "storage-probe", priceWon: 123000, dataQuality: "seed", source: "seed", listingType: "retail", updatedAt: "2026-09-10T00:00:00.000Z", missingFields: [], specs: {} });
        if (requestUrl.pathname === "/api/price-history") return response({ items: [] });
        return originalFetch(input, init);
      };
      try {
        const serialized = JSON.stringify([entry]);
        setStored(watchlistKey, serialized);
        dispatch(watchlistKey, serialized);
        for (let index = 0; index < 80 && !(document.body?.innerText ?? "").includes("cross-tab watch probe"); index += 1) await wait(25);
        const tracked = (document.body?.innerText ?? "").includes("cross-tab watch probe");
        const thresholdSerialized = "5";
        setStored(thresholdKey, thresholdSerialized);
        dispatch(thresholdKey, thresholdSerialized);
        for (let index = 0; index < 80 && document.querySelector('[aria-label="가격 추적 최저가 근접 기준"]')?.value !== "5"; index += 1) await wait(25);
        const threshold = document.querySelector('[aria-label="가격 추적 최저가 근접 기준"]')?.value ?? "";
        return { stage: "checked", tracked, threshold, path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        setStored(watchlistKey, originalWatchlist);
        dispatch(watchlistKey, originalWatchlist);
        setStored(thresholdKey, originalThreshold);
        dispatch(thresholdKey, originalThreshold);
        await wait(100);
      }
    })()`);
    assert(priceWatchlistStorageSyncProbe?.stage === "checked" && priceWatchlistStorageSyncProbe.tracked === true && priceWatchlistStorageSyncProbe.threshold === "5" && priceWatchlistStorageSyncProbe.path === "/watchlist", "가격 추적 화면이 다른 탭의 카탈로그 가격 추적 목록·근접 기준 변경을 반영하지 못했습니다. probe=" + JSON.stringify(priceWatchlistStorageSyncProbe));
    const priceWatchAlertContextProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalLinks = localStorage.getItem("pc-supporter-saved-watchlist-link");
      const originalTokens = localStorage.getItem("pc-supporter-saved-watchlist-owner-tokens");
      const originalAlerts = localStorage.getItem("pc-supporter-price-monitor-alerts");
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const id = "price-alert-context-race";
      const tokenA = "a".repeat(48);
      const tokenB = "b".repeat(48);
      const stampA = "2026-09-09T00:00:00.000Z";
      const stampB = "2026-09-09T00:01:00.000Z";
      const linkA = { id, name: "watchlist A", createdAt: stampA, updatedAt: stampA };
      const linkB = { id, name: "watchlist B", createdAt: stampA, updatedAt: stampB };
      const saved = { id, name: "watchlist current", entries: [{ itemId: "cpu-probe", itemName: "probe CPU", category: "cpu", kind: "part", addedAt: stampA }], nearLowThresholdPercent: 10, createdAt: stampB, updatedAt: stampB };
      const staleAlert = { id: "price-alert-stale", itemKey: "part:stale", message: "stale price alert", kind: "drop", createdAt: stampA };
      let alertCalls = 0;
      const seenTokens = [];
      const storageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key === "pc-supporter-price-monitor-alerts") storageWrites.push(value); return originalSetItem.call(this, key, value); };
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/watchlists/" + id && (init?.method ?? "GET").toUpperCase() === "GET") return response(saved);
        if (requestUrl.pathname === "/api/watchlists/" + id + "/alerts") {
          alertCalls += 1;
          const token = new Headers(init?.headers).get("X-Share-Owner-Token");
          seenTokens.push(token);
          if (token === tokenA) { await wait(600); return response({ items: [staleAlert], alertPreferences: { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 0 } }); }
          return response({ items: [], alertPreferences: { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 0 } });
        }
        if (requestUrl.pathname === "/api/parts/cpu-probe") return response({ id: "cpu-probe", category: "cpu", name: "probe CPU", brand: "probe", model: "probe", priceWon: 100000, danawaUrl: "https://example.com/probe", dataQuality: "manual", dataFreshness: "recent", missingFields: [], specs: {}, updatedAt: stampB });
        return originalFetch(input, init);
      };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        history.pushState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await wait(100);
        history.pushState({}, "", "/watchlist");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await wait(150);
        localStorage.setItem("pc-supporter-saved-watchlist-link", JSON.stringify([linkA]));
        localStorage.setItem("pc-supporter-saved-watchlist-owner-tokens", JSON.stringify({ [id]: tokenA }));
        localStorage.removeItem("pc-supporter-price-monitor-alerts");
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-watchlist-link", newValue: JSON.stringify([linkA]), storageArea: localStorage }));
        for (let index = 0; index < 80 && alertCalls < 1; index += 1) await wait(25);
        localStorage.setItem("pc-supporter-saved-watchlist-link", JSON.stringify([linkB]));
        localStorage.setItem("pc-supporter-saved-watchlist-owner-tokens", JSON.stringify({ [id]: tokenB }));
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-watchlist-link", newValue: JSON.stringify([linkB]), storageArea: localStorage }));
        await wait(900);
        return { stage: "checked", alertCalls, seenTokens, staleWriteObserved: storageWrites.some((value) => value.includes("price-alert-stale")), path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        Storage.prototype.setItem = originalSetItem;
        setStored("pc-supporter-saved-watchlist-link", originalLinks);
        setStored("pc-supporter-saved-watchlist-owner-tokens", originalTokens);
        setStored("pc-supporter-price-monitor-alerts", originalAlerts);
      }
    })()`);
    assert(priceWatchAlertContextProbe?.stage === "checked" && priceWatchAlertContextProbe.alertCalls >= 2 && priceWatchAlertContextProbe.seenTokens.includes("b".repeat(48)) && priceWatchAlertContextProbe.staleWriteObserved === false && priceWatchAlertContextProbe.path === "/watchlist", "가격 추적 서버 alert의 이전 owner-token 응답이 새 링크 context에 반영됐습니다. probe=" + JSON.stringify(priceWatchAlertContextProbe));
    const priceWatchOwnerTokenContextProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalLinks = localStorage.getItem("pc-supporter-saved-watchlist-link");
      const originalTokens = localStorage.getItem("pc-supporter-saved-watchlist-owner-tokens");
      const originalAlerts = localStorage.getItem("pc-supporter-price-monitor-alerts");
      const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const id = "price-owner-token-only-race";
      const tokenA = "a".repeat(48);
      const tokenB = "b".repeat(48);
      const stamp = "2026-09-09T00:00:00.000Z";
      const link = { id, name: "owner token only watchlist", createdAt: stamp, updatedAt: stamp };
      const saved = { id, name: link.name, entries: [{ itemId: "cpu-owner-token", itemName: "owner token CPU", category: "cpu", kind: "part", addedAt: stamp }], nearLowThresholdPercent: 10, createdAt: stamp, updatedAt: stamp };
      const staleAlert = { id: "price-owner-token-stale", itemKey: "part:stale", message: "owner token stale alert", kind: "drop", createdAt: stamp };
      let alertCalls = 0;
      const seenTokens = [];
      const storageWrites = [];
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key === "pc-supporter-price-monitor-alerts") storageWrites.push(value); return originalSetItem.call(this, key, value); };
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/watchlists/" + id && (init?.method ?? "GET").toUpperCase() === "GET") return response(saved);
        if (requestUrl.pathname === "/api/watchlists/" + id + "/alerts") { alertCalls += 1; const token = new Headers(init?.headers).get("X-Share-Owner-Token"); seenTokens.push(token); if (token === tokenA) { await wait(600); return response({ items: [staleAlert], alertPreferences: { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 0 } }); } return response({ items: [], alertPreferences: { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 0 } }); }
        if (requestUrl.pathname === "/api/parts/cpu-owner-token") return response({ id: "cpu-owner-token", category: "cpu", name: "owner token CPU", brand: "probe", model: "probe", priceWon: 100000, dataQuality: "manual", dataFreshness: "recent", missingFields: [], specs: {}, updatedAt: stamp });
        return originalFetch(input, init);
      };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); await wait(100);
        history.pushState({}, "", "/watchlist"); window.dispatchEvent(new PopStateEvent("popstate")); await wait(150);
        localStorage.setItem("pc-supporter-saved-watchlist-link", JSON.stringify([link]));
        localStorage.setItem("pc-supporter-saved-watchlist-owner-tokens", JSON.stringify({ [id]: tokenA }));
        localStorage.removeItem("pc-supporter-price-monitor-alerts");
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-watchlist-link", newValue: JSON.stringify([link]), storageArea: localStorage }));
        for (let index = 0; index < 100 && alertCalls < 1; index += 1) await wait(25);
        await wait(500);
        const tokens = JSON.stringify({ [id]: tokenB });
        localStorage.setItem("pc-supporter-saved-watchlist-owner-tokens", tokens);
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-watchlist-owner-tokens", newValue: tokens, storageArea: localStorage }));
        await wait(900);
        return { stage: "checked", alertCalls, seenTokens, staleWriteObserved: storageWrites.some((value) => value.includes("price-owner-token-stale")), path: location.pathname };
      } finally {
        window.fetch = originalFetch; Storage.prototype.setItem = originalSetItem;
        setStored("pc-supporter-saved-watchlist-link", originalLinks); setStored("pc-supporter-saved-watchlist-owner-tokens", originalTokens); setStored("pc-supporter-price-monitor-alerts", originalAlerts);
      }
    })()`);
    assert(priceWatchOwnerTokenContextProbe?.stage === "checked" && priceWatchOwnerTokenContextProbe.alertCalls >= 2 && priceWatchOwnerTokenContextProbe.seenTokens.includes("b".repeat(48)) && priceWatchOwnerTokenContextProbe.staleWriteObserved === false && priceWatchOwnerTokenContextProbe.path === "/watchlist", "가격 추적 owner-token storage event가 alert context를 갱신하지 못했습니다. probe=" + JSON.stringify(priceWatchOwnerTokenContextProbe));
    const sharedWatchlistLatestRefreshProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; const headers = { 'Content-Type': 'application/json' }; const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers }); const savedFor = (id, label) => ({ id, name: label, entries: [{ itemId: id + '-cpu', itemName: label + ' CPU', category: 'cpu', kind: 'part', addedAt: '2026-09-08T00:00:00.000Z', targetPriceWon: 100000 }], nearLowThresholdPercent: 10, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' }); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const requestUrl = new URL(url, location.href); if (requestUrl.pathname === '/api/watchlists/browser-shared-a') return response(savedFor('browser-shared-a', '공유 목록 A')); if (requestUrl.pathname === '/api/watchlists/browser-shared-b') return response(savedFor('browser-shared-b', '공유 목록 B')); if (requestUrl.pathname === '/api/price-history') return response({ items: [] }); if (requestUrl.pathname === '/api/parts/browser-shared-a-cpu') { await new Promise((resolve) => setTimeout(resolve, 400)); return response({ id: 'browser-shared-a-cpu', name: '공유 목록 A CPU', category: 'cpu', model: 'A-CPU', priceWon: 123000, dataQuality: 'seed', source: 'seed', updatedAt: '2026-09-08T00:00:00.000Z', missingFields: [], specs: {}, rawSpecText: 'probe' }); } if (requestUrl.pathname === '/api/parts/browser-shared-b-cpu') return response({ id: 'browser-shared-b-cpu', name: '공유 목록 B CPU', category: 'cpu', model: 'B-CPU', priceWon: 234000, dataQuality: 'seed', source: 'seed', updatedAt: '2026-09-08T00:00:00.000Z', missingFields: [], specs: {}, rawSpecText: 'probe' }); return originalFetch(input, init); }; const push = (id) => { history.pushState({}, '', '/watchlist/' + id); window.dispatchEvent(new PopStateEvent('popstate')); }; try { push('browser-shared-a'); for (let index = 0; index < 40 && !(document.querySelector('h1')?.textContent ?? '').includes('공유 목록 A'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const refresh = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재 가격 다시 확인')); if (!(refresh instanceof HTMLButtonElement)) return { stage: 'missing-refresh', heading: document.querySelector('h1')?.textContent ?? '' }; refresh.click(); await new Promise((resolve) => setTimeout(resolve, 25)); push('browser-shared-b'); for (let index = 0; index < 40 && !(document.querySelector('h1')?.textContent ?? '').includes('공유 목록 B'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 500)); const liveStatus = document.querySelector('.shared-watchlist-live-status')?.textContent ?? ''; const nextRefresh = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재 가격 다시 확인')); return { stage: 'checked', heading: document.querySelector('h1')?.textContent ?? '', liveStatus, hasBEntry: (document.body?.innerText ?? '').includes('공유 목록 B CPU'), refreshDisabled: nextRefresh instanceof HTMLButtonElement ? nextRefresh.disabled : null, refreshLabel: nextRefresh?.textContent ?? '' }; } finally { window.fetch = originalFetch; } })()");
    assert(sharedWatchlistLatestRefreshProbe?.stage === 'checked' && sharedWatchlistLatestRefreshProbe.heading.includes('공유 목록 B') && sharedWatchlistLatestRefreshProbe.hasBEntry === true && sharedWatchlistLatestRefreshProbe.refreshDisabled === false && sharedWatchlistLatestRefreshProbe.refreshLabel.includes('현재 가격 다시 확인') && !sharedWatchlistLatestRefreshProbe.liveStatus.includes('현재 가격 확인'), "공유 가격 목록 route 전환 후 이전 live-price 응답이 최신 목록 상태를 덮었거나 새 목록의 재조회 상태가 잠겼습니다. probe=" + JSON.stringify(sharedWatchlistLatestRefreshProbe));
    const sharedBudgetLadderLatestRefreshProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; const headers = { 'Content-Type': 'application/json' }; const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers }); const request = { profile: 'gaming', budgetWon: 1500000, includeGpu: true, priority: 'balanced', gamingResolution: '1080p', gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: 'retail_only' }; const payloadFor = () => ({ type: 'pc-supporter-budget-ladder', version: 1, exportedAt: '2026-09-08T00:00:00.000Z', items: [{ id: 'economy', label: '절약형', description: 'probe', budgetWon: 1200000, status: '호환 가능', totalPriceWon: 1100000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 80, lines: [] }, { id: 'target', label: '목표 예산', description: 'probe', budgetWon: 1500000, status: '호환 가능', totalPriceWon: 1450000, budgetDeltaWon: 50000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 82, lines: [] }, { id: 'headroom', label: '여유형', description: 'probe', budgetWon: 1800000, status: '호환 가능', totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 84, lines: [] }], changes: [] }); const snapshotFor = (id, label) => ({ id, name: label, payload: payloadFor(), request, catalogSnapshotAt: '2026-09-08T00:00:00.000Z', catalogCurrentSnapshotAt: '2026-09-08T00:00:00.000Z', catalogChangedSinceShare: false, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' }); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const requestUrl = new URL(url, location.href); if (requestUrl.pathname === '/api/budget-ladders/browser-budget-a') return response(snapshotFor('browser-budget-a', '예산 목록 A')); if (requestUrl.pathname === '/api/budget-ladders/browser-budget-b') return response(snapshotFor('browser-budget-b', '예산 목록 B')); if (requestUrl.pathname.endsWith('/lineage')) return response({ lineageId: 'browser-budget-lineage', currentId: requestUrl.pathname.includes('browser-budget-b') ? 'browser-budget-b' : 'browser-budget-a', entries: [] }); if (requestUrl.pathname === '/api/meta') return response({ catalogUpdatedAt: '2026-09-08T00:00:00.000Z' }); if (requestUrl.pathname === '/api/builds/recommend') { if (location.pathname.includes('browser-budget-a')) await new Promise((resolve) => setTimeout(resolve, 400)); const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}; return response({ selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false }, profile: 'gaming', priority: 'balanced', gamingResolution: '1080p', gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: body.budgetWon ?? 1500000, includeNonRetail: false, listingPolicy: 'retail_only', storageCapacityGb: 1000, hddCount: 0, totalPriceWon: 1400000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, status: 'compatible', blockerCount: 0, warningCount: 0, unknownCount: 0, lines: [], rationale: [], warnings: [] }); } return originalFetch(input, init); }; const push = (id) => { history.pushState({}, '', '/budget-ladder/' + id); window.dispatchEvent(new PopStateEvent('popstate')); }; try { push('browser-budget-a'); for (let index = 0; index < 40 && !(document.querySelector('h1')?.textContent ?? '').includes('예산 목록 A'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const refresh = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재 기준 재생성')); if (!(refresh instanceof HTMLButtonElement)) return { stage: 'missing-refresh', heading: document.querySelector('h1')?.textContent ?? '' }; refresh.click(); await new Promise((resolve) => setTimeout(resolve, 25)); push('browser-budget-b'); for (let index = 0; index < 40 && !(document.querySelector('h1')?.textContent ?? '').includes('예산 목록 B'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 500)); const nextRefresh = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('현재 기준 재생성')); return { stage: 'checked', heading: document.querySelector('h1')?.textContent ?? '', staleComparison: Boolean(document.querySelector('.shared-budget-ladder-refresh')), refreshDisabled: nextRefresh instanceof HTMLButtonElement ? nextRefresh.disabled : null, refreshLabel: nextRefresh?.textContent ?? '' }; } finally { window.fetch = originalFetch; } })()");
    assert(sharedBudgetLadderLatestRefreshProbe?.stage === 'checked' && sharedBudgetLadderLatestRefreshProbe.heading.includes('예산 목록 B') && sharedBudgetLadderLatestRefreshProbe.staleComparison === false && sharedBudgetLadderLatestRefreshProbe.refreshDisabled === false && sharedBudgetLadderLatestRefreshProbe.refreshLabel.includes('현재 기준 재생성'), "공유 예산 ladder route 전환 후 이전 재생성 결과가 최신 snapshot을 덮었거나 재생성 버튼이 잠겼습니다. probe=" + JSON.stringify(sharedBudgetLadderLatestRefreshProbe));
    const sharedBudgetLadderSelectionApplyProbe = await client.evaluate(`(async () => { const originalFetch = window.fetch; const headers = { 'Content-Type': 'application/json' }; const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers }); const request = { profile: 'gaming', budgetWon: 1500000, includeGpu: true, priority: 'balanced', gamingResolution: '1080p', gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: 'retail_only' }; const selectionFor = (suffix) => ({ cpu: { partId: 'cpu-' + suffix, quantity: 1 }, motherboard: { partId: 'board-' + suffix, quantity: 1 }, gpu: { partId: 'gpu-' + suffix, quantity: 1 }, memory: [], ssd: [], hdd: [], case: { partId: 'case-' + suffix, quantity: 1 }, psu: { partId: 'psu-' + suffix, quantity: 1 }, accessories: [], useIntegratedGraphics: false }); const payloadFor = (suffix) => ({ type: 'pc-supporter-budget-ladder', version: 1, exportedAt: '2026-09-08T00:00:00.000Z', items: [{ id: 'economy', label: '절약형', description: 'probe', budgetWon: 1200000, status: '호환 가능', totalPriceWon: 1100000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 80, lines: [], selection: selectionFor(suffix + '-e') }, { id: 'target', label: '목표 예산', description: 'probe', budgetWon: 1500000, status: '호환 가능', totalPriceWon: 1450000, budgetDeltaWon: 50000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 82, lines: [], selection: selectionFor(suffix) }, { id: 'headroom', label: '여유형', description: 'probe', budgetWon: 1800000, status: '호환 가능', totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 84, lines: [], selection: selectionFor(suffix + '-h') }], changes: [] }); const snapshotFor = (id, label) => ({ id, name: label, payload: payloadFor(id), request, catalogSnapshotAt: '2026-09-08T00:00:00.000Z', catalogCurrentSnapshotAt: '2026-09-08T00:00:00.000Z', catalogChangedSinceShare: false, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' }); const lineageEntries = ['browser-budget-a', 'browser-budget-b', 'browser-budget-c', 'browser-budget-d'].map((id, index) => ({ id, name: '예산 버전 ' + id.slice(-1).toUpperCase(), lineageId: 'browser-budget-selection-lineage', versionNumber: index + 1, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z', catalogSnapshotAt: '2026-09-08T00:00:00.000Z', expired: false })); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const requestUrl = new URL(url, location.href); if (['browser-budget-a', 'browser-budget-b', 'browser-budget-c', 'browser-budget-d'].some((id) => requestUrl.pathname === '/api/budget-ladders/' + id)) return response(snapshotFor(requestUrl.pathname.split('/').at(-1), '예산 선택 ' + requestUrl.pathname.split('/').at(-1)?.slice(-1).toUpperCase())); if (requestUrl.pathname.endsWith('/lineage')) return response({ lineageId: 'browser-budget-selection-lineage', currentId: 'browser-budget-c', entries: lineageEntries }); if (requestUrl.pathname === '/api/compatibility/check' && init?.method === 'POST') return response({ status: 'compatible', blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: 'gaming', scoreLabel: '균형형', scoreBasis: 'probe', confidence: 'high', factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 1450000, priceComplete: true, engineVersion: '2.58.0', catalogSnapshotAt: '2026-09-08T00:00:00.000Z', checkedAt: '2026-09-08T00:00:00.000Z' }); return originalFetch(input, init); }; const push = (id) => { history.pushState({}, '', '/budget-ladder/' + id); window.dispatchEvent(new PopStateEvent('popstate')); }; try { push('browser-budget-c'); for (let index = 0; index < 60 && !(document.querySelector('h1')?.textContent ?? '').includes('예산 선택 C'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); for (let index = 0; index < 60 && !document.querySelector('[aria-label="비교 버전 2"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const versionSelect = document.querySelector('[aria-label="비교 버전 2"]'); if (!(versionSelect instanceof HTMLSelectElement)) return { stage: 'missing-version-select', heading: document.querySelector('h1')?.textContent ?? '' }; const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; for (let index = 0; index < 80; index += 1) { const currentSelect = document.querySelector('[aria-label="비교 버전 2"]'); if (currentSelect instanceof HTMLSelectElement && currentSelect.value !== 'browser-budget-a') { selectSetter?.call(currentSelect, 'browser-budget-a'); currentSelect.dispatchEvent(new Event('change', { bubbles: true })); } await new Promise((resolve) => setTimeout(resolve, 50)); if (currentSelect instanceof HTMLSelectElement && currentSelect.value === 'browser-budget-a' && document.querySelector('[aria-label="예산 비교 부분 병합"]')) break; } const gpuSelect = document.querySelector('[aria-label="그래픽카드 적용 버전"]'); if (!(gpuSelect instanceof HTMLSelectElement)) return { stage: 'missing-merge-source', version: versionSelect.value }; for (let index = 0; index < 80; index += 1) { const currentGpuSelect = document.querySelector('[aria-label="그래픽카드 적용 버전"]'); if (currentGpuSelect instanceof HTMLSelectElement && currentGpuSelect.value !== 'browser-budget-a') { selectSetter?.call(currentGpuSelect, 'browser-budget-a'); currentGpuSelect.dispatchEvent(new Event('change', { bubbles: true })); } await new Promise((resolve) => setTimeout(resolve, 50)); if (currentGpuSelect instanceof HTMLSelectElement && currentGpuSelect.value === 'browser-budget-a' && document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]') === null) break; } const preview = [...document.querySelectorAll('button')].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? '').includes('부분 병합 조합 미리 검사')); if (!(preview instanceof HTMLButtonElement)) return { stage: 'missing-preview', version: versionSelect.value, source: gpuSelect.value, stalePreview: Boolean(document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]')) }; preview.click(); for (let index = 0; index < 60 && !document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const previewReady = Boolean(document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]')); for (let index = 0; index < 60 && (document.querySelector('[aria-label="비교 버전 2"]')?.value !== 'browser-budget-a' || document.querySelector('[aria-label="그래픽카드 적용 버전"]')?.value !== 'browser-budget-a'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const selectedVersion = document.querySelector('[aria-label="비교 버전 2"]')?.value ?? ''; const selectedSource = document.querySelector('[aria-label="그래픽카드 적용 버전"]')?.value ?? ''; const apply = [...document.querySelectorAll('button')].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? '').includes('부분 병합 후 편집기')); const applied = apply instanceof HTMLButtonElement; if (applied) apply.click(); for (let index = 0; index < 320 && location.pathname !== '/build'; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const editorPath = location.pathname; if (!applied || editorPath !== '/build') return { stage: 'editor-apply-incomplete', version: selectedVersion, source: selectedSource, previewReady, applied, appliedPath: editorPath }; push('browser-budget-c'); for (let index = 0; index < 60 && !(document.querySelector('h1')?.textContent ?? '').includes('예산 선택 C'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); for (let index = 0; index < 60 && !document.querySelector('[aria-label="예산 비교 부분 병합"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); for (let index = 0; index < 80; index += 1) { const checkGpuSelect = document.querySelector('[aria-label="그래픽카드 적용 버전"]'); if (!(checkGpuSelect instanceof HTMLSelectElement)) break; if (checkGpuSelect.value !== 'browser-budget-a') { selectSetter?.call(checkGpuSelect, 'browser-budget-a'); checkGpuSelect.dispatchEvent(new Event('change', { bubbles: true })); } await new Promise((resolve) => setTimeout(resolve, 50)); if (checkGpuSelect.value === 'browser-budget-a' && document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]') === null) break; } if (!(document.querySelector('[aria-label="그래픽카드 적용 버전"]') instanceof HTMLSelectElement)) return { stage: 'missing-check-now-source', editorPath }; const checkPreview = [...document.querySelectorAll('button')].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? '').includes('부분 병합 조합 미리 검사')); if (!(checkPreview instanceof HTMLButtonElement)) return { stage: 'missing-check-now-preview', editorPath, stalePreview: Boolean(document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]')) }; checkPreview.click(); for (let index = 0; index < 60 && !document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const checkPreviewReady = Boolean(document.querySelector('[aria-label="부분 병합 조합 미리 검사 결과"]')); const checkNow = [...document.querySelectorAll('button')].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? '').includes('부분 병합 후 바로 검사')); const checkNowClicked = checkNow instanceof HTMLButtonElement; if (checkNowClicked) checkNow.click(); for (let index = 0; index < 120 && location.pathname !== '/result'; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); return { stage: 'checked', version: selectedVersion, source: selectedSource, previewReady, appliedPath: editorPath, checkPreviewReady, checkNowClicked, checkNowDisabled: checkNow instanceof HTMLButtonElement ? checkNow.disabled : null, checkNowPath: location.pathname, resultVisible: location.pathname === '/result' }; } finally { window.fetch = originalFetch; } })()`);
    assert(sharedBudgetLadderSelectionApplyProbe?.stage === 'checked' && sharedBudgetLadderSelectionApplyProbe.version === 'browser-budget-a' && sharedBudgetLadderSelectionApplyProbe.source === 'browser-budget-a' && sharedBudgetLadderSelectionApplyProbe.previewReady === true && sharedBudgetLadderSelectionApplyProbe.appliedPath === '/build' && sharedBudgetLadderSelectionApplyProbe.checkPreviewReady === true && sharedBudgetLadderSelectionApplyProbe.checkNowClicked === true && sharedBudgetLadderSelectionApplyProbe.checkNowPath === '/result' && sharedBudgetLadderSelectionApplyProbe.resultVisible === true, "공유 예산 ladder version 선택 변경 → partial merge preview → 편집기 적용·바로 검사 flow가 완주하지 못했습니다. probe=" + JSON.stringify(sharedBudgetLadderSelectionApplyProbe));
    const sharedBudgetLadderMutationRouteProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalConfirm = window.confirm;
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const request = { profile: "gaming", budgetWon: 1500000, includeGpu: true, priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: "retail_only" };
      const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
      const payload = { type: "pc-supporter-budget-ladder", version: 1, exportedAt: "2026-09-08T00:00:00.000Z", items: [
        { id: "economy", label: "절약형", description: "probe", budgetWon: 1200000, status: "호환 가능", totalPriceWon: 1100000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 80, lines: [] },
        { id: "target", label: "목표 예산", description: "probe", budgetWon: 1500000, status: "호환 가능", totalPriceWon: 1450000, budgetDeltaWon: 50000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 82, lines: [], selection },
        { id: "headroom", label: "여유형", description: "probe", budgetWon: 1800000, status: "호환 가능", totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, blockerCount: 0, warningCount: 0, unknownCount: 0, analysisScore: 84, lines: [] }
      ], changes: [] };
      const snapshotFor = (id, name) => ({ id, name, payload, request, catalogSnapshotAt: "2026-09-08T00:00:00.000Z", catalogCurrentSnapshotAt: "2026-09-08T00:00:00.000Z", catalogChangedSinceShare: false, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" });
      const buildResult = (body) => ({ selection, profile: "gaming", priority: "balanced", gamingResolution: "1080p", gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: body?.budgetWon ?? 1500000, includeNonRetail: false, listingPolicy: "retail_only", storageCapacityGb: 1000, hddCount: 0, totalPriceWon: 1400000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, lines: [], rationale: [], warnings: [] });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const push = (id) => { history.pushState({}, "", "/budget-ladder/" + id); window.dispatchEvent(new PopStateEvent("popstate")); };
      const waitForHeading = async (name) => { for (let index = 0; index < 60 && !(document.querySelector("h1")?.textContent ?? "").includes(name); index += 1) await wait(25); return (document.querySelector("h1")?.textContent ?? "").includes(name); };
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const requestUrl = new URL(url, location.href);
        if (requestUrl.pathname === "/api/budget-ladders/browser-budget-save-a" || requestUrl.pathname === "/api/budget-ladders/browser-budget-save-b" || requestUrl.pathname === "/api/budget-ladders/browser-budget-revoke-a" || requestUrl.pathname === "/api/budget-ladders/browser-budget-revoke-b") return response(snapshotFor(requestUrl.pathname.split("/").at(-1), "예산 mutation " + requestUrl.pathname.split("/").at(-1)));
        if (requestUrl.pathname.endsWith("/lineage")) return response({ lineageId: "browser-budget-mutation-lineage", currentId: requestUrl.pathname.includes("revoke") ? "browser-budget-revoke-a" : requestUrl.pathname.includes("save") ? "browser-budget-save-a" : "browser-budget-save-a", entries: [] });
        if (requestUrl.pathname === "/api/meta") return response({ catalogUpdatedAt: "2026-09-08T00:00:00.000Z" });
        if (requestUrl.pathname === "/api/builds/recommend") return response(buildResult(typeof init?.body === "string" ? JSON.parse(init.body) : undefined));
        if (requestUrl.pathname === "/api/budget-ladders" && init?.method === "POST") {
          const saveId = location.pathname.includes("revoke-a") ? "browser-budget-saved-revoke" : "browser-budget-saved-route";
          if (location.pathname.includes("save-a")) await wait(400);
          return response({ ...snapshotFor(saveId, "현재 기준 · mutation"), ownerToken: "probe-owner", parentId: location.pathname.split("/").at(-1), versionNumber: 2 });
        }
        if (requestUrl.pathname === "/api/budget-ladders/browser-budget-saved-revoke" && init?.method === "DELETE") {
          await wait(400);
          return response({ ok: true });
        }
        return originalFetch(input, init);
      };
      try {
        push("browser-budget-save-a");
        if (!(await waitForHeading("예산 mutation browser-budget-save-a"))) return { stage: "missing-save-a" };
        const refreshA = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("현재 기준 재생성"));
        if (!(refreshA instanceof HTMLButtonElement)) return { stage: "missing-save-refresh" };
        refreshA.click();
        for (let index = 0; index < 160 && !document.querySelector(".shared-budget-ladder-refresh"); index += 1) await wait(25);
        const saveButton = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("새 저장본으로 공유"));
        if (!(saveButton instanceof HTMLButtonElement)) return { stage: "missing-save-button" };
        saveButton.click();
        await wait(25);
        push("browser-budget-save-b");
        const saveBLoaded = await waitForHeading("예산 mutation browser-budget-save-b");
        await wait(500);
        const saveStale = Boolean(document.querySelector(".shared-budget-ladder-refresh-share-preview")) || (document.body?.innerText ?? "").includes("새 저장본 저장 중");

        push("browser-budget-revoke-a");
        const revokeALoaded = await waitForHeading("예산 mutation browser-budget-revoke-a");
        for (let index = 0; index < 160; index += 1) {
          const candidate = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("현재 기준 재생성"));
          if (candidate instanceof HTMLButtonElement && !candidate.disabled && !(candidate.textContent ?? "").includes("생성 중")) break;
          await wait(25);
        }
        const refreshRevoke = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("현재 기준 재생성"));
        if (!(refreshRevoke instanceof HTMLButtonElement)) return { stage: "missing-revoke-refresh", saveBLoaded, saveStale };
        refreshRevoke.click();
        for (let index = 0; index < 160 && !document.querySelector(".shared-budget-ladder-refresh"); index += 1) await wait(25);
        const saveRevoke = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("새 저장본으로 공유"));
        if (!(saveRevoke instanceof HTMLButtonElement)) return { stage: "missing-revoke-save", saveBLoaded, saveStale, revokeALoaded, refreshDisabled: refreshRevoke.disabled, refreshLabel: refreshRevoke.textContent ?? "", comparison: Boolean(document.querySelector(".shared-budget-ladder-refresh")), body: (document.body?.innerText ?? "").slice(-1200) };
        saveRevoke.click();
        for (let index = 0; index < 160 && !document.querySelector(".shared-budget-ladder-refresh-share-preview"); index += 1) await wait(25);
        window.confirm = () => true;
        const revokeButton = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").includes("공유 취소"));
        if (!(revokeButton instanceof HTMLButtonElement)) return { stage: "missing-revoke-button", saveBLoaded, saveStale, revokeALoaded };
        revokeButton.click();
        await wait(25);
        push("browser-budget-revoke-b");
        const revokeBLoaded = await waitForHeading("예산 mutation browser-budget-revoke-b");
        await wait(500);
        const revokeStale = Boolean(document.querySelector(".shared-budget-ladder-refresh-share-preview")) || (document.body?.innerText ?? "").includes("공유 저장본을 취소했습니다");
        return { stage: "checked", saveBLoaded, saveStale, revokeALoaded, revokeBLoaded, revokeStale, path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        window.confirm = originalConfirm;
      }
    })()`);
    assert(sharedBudgetLadderMutationRouteProbe?.stage === "checked" && sharedBudgetLadderMutationRouteProbe.saveBLoaded === true && sharedBudgetLadderMutationRouteProbe.saveStale === false && sharedBudgetLadderMutationRouteProbe.revokeALoaded === true && sharedBudgetLadderMutationRouteProbe.revokeBLoaded === true && sharedBudgetLadderMutationRouteProbe.revokeStale === false && sharedBudgetLadderMutationRouteProbe.path === "/budget-ladder/browser-budget-revoke-b", "공유 예산 ladder snapshot 저장·취소 중 route 전환에서 stale mutation 상태가 남았습니다. probe=" + JSON.stringify(sharedBudgetLadderMutationRouteProbe));
    await client.send("Page.navigate", { url: `${baseUrl}/accessories` });
    await waitForValue(client, "document.querySelector('.accessory-page') !== null && document.querySelector('.accessory-watch-button') !== null", "주변 부품 가격 추적 액션");
    await client.evaluate("(() => { history.pushState({}, '', '/accessories?category=cooling_fan&brand=ASUS'); window.dispatchEvent(new PopStateEvent('popstate')); })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-brand-filter\"] input')?.value === 'ASUS' && document.querySelector('[aria-label=\"주변 부품 분류\"]')?.value === 'cooling_fan'", "주변 부품 route history 필터 복원");
    await goBack(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-brand-filter\"] input')?.value === '' && document.querySelector('[aria-label=\"주변 부품 분류\"]')?.value === 'all' && new URLSearchParams(location.search).get('category') === null", "주변 부품 route history 뒤로 가기 전체 목록 복원");
    recordRouteHistoryFlow("accessory-route-history");
    await client.send("Page.navigate", { url: `${baseUrl}/accessories?category=cooling_fan&brand=ASUS` });
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-brand-filter\"] input')?.value === 'ASUS' && new URLSearchParams(location.search).get('brand') === 'ASUS' && document.querySelectorAll('.accessory-item').length > 0", "주변 부품 제조사 필터");
    assert(await client.evaluate("(() => { const cards = [...document.querySelectorAll('.accessory-item')]; return cards.length > 0 && cards.every((card) => (card.textContent ?? '').includes('ASUS')); })()"), "주변 부품 제조사 필터 결과에 다른 제조사 부품이 섞였습니다.");
    await client.send("Page.navigate", { url: `${baseUrl}/accessories` });
    await waitForValue(client, "document.querySelector('.accessory-page') !== null && document.querySelector('.accessory-watch-button') !== null", "주변 부품 기본 목록 복귀");
    const accessoryWatchStorageProbe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const card = document.querySelector('.accessory-item');
      const detailButton = card?.querySelector('[data-testid^="accessory-detail-"]');
      const watchButton = card?.querySelector('.accessory-watch-button');
      const itemId = detailButton?.getAttribute('data-testid')?.replace(/^accessory-detail-/, '') ?? "";
      const entry = { itemId, itemName: "cross-tab accessory watch probe", category: "cooling_fan", kind: "accessory", addedAt: "2026-09-10T00:00:00.000Z" };
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key: watchlistKey, newValue: value, storageArea: localStorage }));
      try {
        if (!(watchButton instanceof HTMLButtonElement) || !itemId) return { stage: "missing-controls", itemId };
        const serialized = JSON.stringify([entry]);
        localStorage.setItem(watchlistKey, serialized);
        dispatch(serialized);
        for (let index = 0; index < 80 && !watchButton.classList.contains('watched'); index += 1) await wait(25);
        const added = watchButton.classList.contains('watched');
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && watchButton.classList.contains('watched'); index += 1) await wait(25);
        const removed = !watchButton.classList.contains('watched');
        return { stage: "checked", itemId, added, removed };
      } finally {
        if (originalWatchlist === null) localStorage.removeItem(watchlistKey); else localStorage.setItem(watchlistKey, originalWatchlist);
        dispatch(originalWatchlist);
        await wait(100);
      }
    })()`);
    assert(accessoryWatchStorageProbe?.stage === "checked" && accessoryWatchStorageProbe.added === true && accessoryWatchStorageProbe.removed === true, "주변 부품 가격 추적 버튼이 다른 탭의 watch-list 추가·제거를 반영하지 못했습니다. probe=" + JSON.stringify(accessoryWatchStorageProbe));
    await waitForValue(client, "document.querySelector('[data-testid^=\"accessory-price-evidence-\"]') !== null", "주변 부품 목록 가격 근거");
    const accessoryDeepLinkId = await client.evaluate("(() => { const button = document.querySelector('[data-testid^=\"accessory-detail-\"]'); return button?.getAttribute('data-testid')?.replace(/^accessory-detail-/, '') ?? undefined; })()");
    assert(typeof accessoryDeepLinkId === 'string' && accessoryDeepLinkId.length > 0, "주변 부품 상세 deep-link 대상이 없습니다.");
    await client.send("Page.navigate", { url: `${baseUrl}/accessories?itemId=${encodeURIComponent(accessoryDeepLinkId)}` });
    await waitForValue(client, "new URLSearchParams(location.search).get('itemId') !== null && document.querySelector('[data-testid=\"accessory-detail-panel\"]') !== null", "주변 부품 상세 deep-link");
    await sleep(350);
    assert(await setInputValue(client, '.accessory-search input', '팬'), "주변 부품 검색 조건 입력을 설정하지 못했습니다.");
    await waitForValue(client, "new URLSearchParams(location.search).get('itemId') === null && document.querySelector('[data-testid=\"accessory-detail-panel\"]') === null", "주변 부품 조건 변경 시 상세 선택 해제");
    await client.send("Page.navigate", { url: `${baseUrl}/accessories` });
    await waitForValue(client, "((document.body?.innerText ?? '').includes('주변 부품 찾기') || (document.body?.innerText ?? '').includes('주변 부품 카탈로그')) && document.querySelector('[data-testid^=\"accessory-price-evidence-\"]') !== null", "주변 부품 캐시 준비 목록 복귀");
    await waitForValue(client, "(() => { try { const value = JSON.parse(localStorage.getItem('pc-supporter-accessory-catalog-cache-v1') ?? 'null'); return value?.schemaVersion === 1 && typeof value?.cachedAt === 'string' && Array.isArray(value?.items) && value.items.length > 0; } catch { return false; } })()", "주변 부품 캐시 생성");
    await client.evaluate("sessionStorage.clear()");
    const accessoryOfflineProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; let blocked = 0; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const requestUrl = new URL(url, location.href); if (requestUrl.pathname === '/api/accessories') { blocked += 1; throw new TypeError('Failed to fetch'); } return originalFetch(input, init); }; try { const input = document.querySelector('.accessory-search input'); if (!(input instanceof HTMLInputElement)) return { stage: 'no-input', blocked }; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, '팬'); input.dispatchEvent(new Event('input', { bubbles: true })); for (let index = 0; index < 60; index += 1) { if (document.querySelector('[data-testid=\"accessory-cached-fallback\"]') && document.querySelectorAll('[data-testid=\"accessory-cached-catalog-list\"] .accessory-item').length > 0) return { stage: 'fallback', blocked }; await new Promise((resolve) => setTimeout(resolve, 50)); } return { stage: 'timeout', blocked, cache: localStorage.getItem('pc-supporter-accessory-catalog-cache-v1'), dialog: Boolean(document.querySelector('[data-testid=\"accessory-cached-fallback\"]')), error: document.querySelector('.fetch-error')?.textContent ?? '', body: (document.body?.innerText ?? '').slice(-4000) }; } finally { window.fetch = originalFetch; } })()");
    assert(accessoryOfflineProbe?.stage === "fallback", "주변 부품 요청 실패 시 브라우저 캐시 fallback이 표시되지 않았습니다. probe=" + JSON.stringify(accessoryOfflineProbe));
    const accessoryCacheStorageProbe = await client.evaluate(`(async () => { const key = "pc-supporter-accessory-catalog-cache-v1"; const original = localStorage.getItem(key); const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)); const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage })); try { if (!original) return { stage: "missing-cache" }; const parsed = JSON.parse(original); parsed.items = [...(Array.isArray(parsed.items) ? parsed.items : []), { ...(parsed.items?.[0] ?? {}), id: "smoke-accessory-cache-item", name: "smoke accessory cache probe 팬", category: "cooling_fan", rawSpecText: "storage probe", priceWon: 1 }]; const serialized = JSON.stringify(parsed); localStorage.setItem(key, serialized); dispatch(serialized); await wait(100); const sentinelVisible = (document.body?.innerText ?? "").includes("smoke accessory cache probe 팬"); localStorage.removeItem(key); dispatch(null); for (let index = 0; index < 80 && (document.body?.innerText ?? "").includes("smoke accessory cache probe 팬"); index += 1) await wait(25); return { stage: "checked", sentinelVisible, sentinelCleared: !(document.body?.innerText ?? "").includes("smoke accessory cache probe 팬") }; } finally { if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original); dispatch(original); await wait(100); } })()`);
    assert(accessoryCacheStorageProbe?.stage === "checked" && accessoryCacheStorageProbe.sentinelVisible === true && accessoryCacheStorageProbe.sentinelCleared === true, "주변 부품 cache storage 삭제가 storage-only 항목을 현재 fallback에서 제거하지 못했습니다. probe=" + JSON.stringify(accessoryCacheStorageProbe));
    assert((await clickSelector(client, '[data-testid^="accessory-cached-detail-"]', 1)) === 1, "주변 부품 캐시 fallback 상세 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-detail-cache-state\"]') !== null && (document.body?.innerText ?? '').includes('캐시 기반 상세')", "주변 부품 캐시 상세 상태");
    assert(await client.evaluate("(document.body?.innerText ?? '').includes('캐시 저장')"), "주변 부품 캐시 상세에 저장 시각이 표시되지 않았습니다.");
    const accessoryDetailRefreshAvailable = await client.evaluate("document.querySelector('[data-testid=\"accessory-detail-refresh\"]') !== null");
    if (accessoryDetailRefreshAvailable) {
      const refreshMockInstalled = await client.evaluate("(() => { const originalFetch = window.fetch; window.__pcSupporterAccessoryRefreshFetch = originalFetch; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname.startsWith('/api/accessories/') && requestUrl.pathname.endsWith('/refresh') && (init?.method ?? 'GET').toUpperCase() === 'POST') { const parts = requestUrl.pathname.split('/'); const itemId = decodeURIComponent(parts[parts.length - 2] ?? ''); let current; try { const cache = JSON.parse(localStorage.getItem('pc-supporter-accessory-catalog-cache-v1') ?? 'null'); current = cache?.items?.find((item) => item.id === itemId); } catch {} if (current) { const refreshedAt = new Date().toISOString(); const previousPrice = typeof current.priceWon === 'number' ? current.priceWon : 1000; const nextPrice = previousPrice + 100; return new Response(JSON.stringify({ item: { ...current, priceWon: nextPrice, updatedAt: refreshedAt }, previousDataQuality: current.dataQuality, previousMissingFields: current.missingFields ?? [], changedFields: ['가격'], valueDiffs: [{ field: '가격', previous: previousPrice.toLocaleString('ko-KR') + '원', next: nextPrice.toLocaleString('ko-KR') + '원' }], refreshedAt }), { status: 200, headers: { 'content-type': 'application/json' } }); } } return originalFetch(input, init); }; return true; })()");
      assert(refreshMockInstalled === true, "주변 부품 원문 재확인 테스트 mock을 설치하지 못했습니다.");
      assert((await clickSelector(client, '[data-testid="accessory-detail-refresh"]', 1)) === 1, "주변 부품 캐시 상세 원문 재확인 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"accessory-detail-refresh-success\"]') !== null && document.querySelector('[data-testid=\"accessory-detail-refresh-diff\"]') !== null && (document.body?.innerText ?? '').includes('가격')", "주변 부품 원문 재확인 값 변화");
      assert(await client.evaluate("(() => { const originalFetch = window.__pcSupporterAccessoryRefreshFetch; if (!originalFetch) return false; window.fetch = originalFetch; delete window.__pcSupporterAccessoryRefreshFetch; return true; })()"), "주변 부품 원문 재확인 테스트 mock을 복원하지 못했습니다.");
    } else {
      assert(await client.evaluate("document.querySelector('[data-testid=\"accessory-detail-refresh-bar\"]') === null"), "수동·starter 주변 부품에 실제 원문 재확인 버튼이 잘못 노출되었습니다.");
      assert((await clickSelector(client, '[data-testid="fetch-retry-button"]', 1)) === 1, "주변 부품 캐시 목록 재시도 버튼을 찾지 못했습니다.");
    }
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-cached-fallback\"]') === null && document.querySelector('[data-testid=\"accessory-detail-cache-state\"]') === null && document.querySelectorAll('.accessory-list .accessory-item').length > 0", "주변 부품 캐시 상세 원문 재확인 후 최신 목록 복구");
    assert((await clickSelector(client, '.accessory-watch-button', 1)) === 1, "주변 부품 가격 추적 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.accessory-watch-button.watched') !== null", "주변 부품 가격 추적 등록");
    assert((await clickSelector(client, '.accessory-detail-toggle', 1)) === 1, "주변 부품 상세 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-detail-panel\"]') !== null && (document.body?.innerText ?? '').includes('가격 추적 화면')", "주변 부품 상세 패널");
    await waitForValue(client, "new URLSearchParams(location.search).get('itemId') !== null", "주변 부품 상세 deep link");
    await waitForValue(client, "document.querySelector('[data-testid=\"accessory-detail-price-history\"]') !== null && document.querySelector('[aria-label=\"주변 부품 가격 이력 기간\"]') !== null", "주변 부품 가격 이력");
    assert(await client.evaluate("(() => { const select = document.querySelector('[aria-label=\"주변 부품 가격 이력 기간\"]'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, '90'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === '90'; })()"), "주변 부품 가격 이력 기간을 변경하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"주변 부품 가격 이력 기간\"]')?.value === '90'", "주변 부품 가격 이력 기간");
    await client.send("Page.navigate", { url: baseUrl + "/" });
    await waitForValue(client, "document.querySelector('[data-testid=\"home-catalog-cache\"]') !== null && document.querySelector('[data-testid=\"home-catalog-cache-clear-all\"]') !== null", "홈 카탈로그 캐시 관리");
    const savedBuildsLatestResponseProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; const originalSavedIds = localStorage.getItem('pc-supporter-saved-build-ids'); const headers = { 'Content-Type': 'application/json' }; const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers }); const stamp = '2026-09-08T00:00:00.000Z'; const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false }; const preferences = { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 }; const savedFor = (id, name) => ({ id, name, selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, totalPriceWon: 100000, priceComplete: true }); let calls = 0; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.has('ids')) { calls += 1; if (calls === 1) { await new Promise((resolve) => setTimeout(resolve, 350)); return response({ items: [savedFor('saved-build-probe-a', 'saved-build-stale-probe')] }); } return response({ items: [savedFor('saved-build-probe-b', 'saved-build-fresh-probe')] }); } return originalFetch(input, init); }; const dispatchIds = (ids) => { const serialized = JSON.stringify(ids); localStorage.setItem('pc-supporter-saved-build-ids', serialized); window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: serialized, storageArea: localStorage })); }; const restoreSavedIds = () => { if (originalSavedIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalSavedIds); }; try { dispatchIds(['saved-build-probe-a']); await new Promise((resolve) => setTimeout(resolve, 25)); dispatchIds(['saved-build-probe-b']); for (let index = 0; index < 60 && calls < 2; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); history.pushState({}, '', '/history'); window.dispatchEvent(new PopStateEvent('popstate')); for (let index = 0; index < 60; index += 1) { const body = document.body?.innerText ?? ''; if (body.includes('saved-build-fresh-probe') && !body.includes('saved-build-stale-probe')) break; await new Promise((resolve) => setTimeout(resolve, 25)); } await new Promise((resolve) => setTimeout(resolve, 450)); const body = document.body?.innerText ?? ''; const result = { stage: 'checked', calls, fresh: body.includes('saved-build-fresh-probe'), stale: body.includes('saved-build-stale-probe'), path: location.pathname }; restoreSavedIds(); return result; } finally { window.fetch = originalFetch; restoreSavedIds(); } })()");
    assert(savedBuildsLatestResponseProbe?.stage === 'checked' && savedBuildsLatestResponseProbe.calls === 2 && savedBuildsLatestResponseProbe.stale === false && savedBuildsLatestResponseProbe.path === '/history', "cross-tab saved-build 동기화의 이전 응답이 최신 목록을 덮었습니다. probe=" + JSON.stringify(savedBuildsLatestResponseProbe));
    const appServerAlertContextProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalIds = localStorage.getItem("pc-supporter-saved-build-ids");
      const originalTokens = localStorage.getItem("pc-supporter-saved-build-owner-tokens");
      const originalAlerts = localStorage.getItem("pc-supporter-saved-build-monitor-alerts");
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const id = "app-alert-context-race-build";
      const token = "x".repeat(48);
      const stampA = "2026-09-09T00:00:00.000Z";
      const stampB = "2026-09-09T00:01:00.000Z";
      const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
      const preferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 };
      const buildFor = (updatedAt) => ({ id, name: "app alert context build", selection, recommendationPreferences: preferences, createdAt: stampA, updatedAt, totalPriceWon: 100000, priceComplete: true });
      const staleAlert = { id: "app-alert-stale-server", buildId: id, buildName: "app alert context build", kind: "critical", title: "stale app server alert", message: "stale app monitor response", createdAt: stampA, checkedAt: stampA };
      let listCalls = 0;
      let monitorCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) { listCalls += 1; return response({ items: [buildFor(listCalls === 1 ? stampA : stampB)] }); }
        if (requestUrl.pathname === "/api/builds/" + id + "/monitor") { monitorCalls += 1; if (monitorCalls === 1) await wait(600); return response({ buildId: id, buildName: "app alert context build", subscription: { enabled: false, intervalMinutes: 360, alertPolicy: "all", updatedAt: listCalls > 1 ? stampB : stampA, alerts: monitorCalls === 1 ? [staleAlert] : [] } }); }
        return originalFetch(input, init);
      };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        history.pushState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await wait(100);
        localStorage.setItem("pc-supporter-saved-build-owner-tokens", JSON.stringify({ [id]: token }));
        localStorage.removeItem("pc-supporter-saved-build-monitor-alerts");
        const ids = JSON.stringify([id]);
        localStorage.setItem("pc-supporter-saved-build-ids", ids);
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-ids", newValue: ids, storageArea: localStorage }));
        for (let index = 0; index < 100 && monitorCalls < 1; index += 1) await wait(25);
        const sync = JSON.stringify({ id, updatedAt: stampB, nonce: Date.now() });
        localStorage.setItem("pc-supporter-saved-build-metadata-sync", sync);
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-metadata-sync", newValue: sync, storageArea: localStorage }));
        for (let index = 0; index < 100 && listCalls < 2; index += 1) await wait(25);
        await wait(900);
        return { stage: "checked", listCalls, monitorCalls, staleInStorage: (localStorage.getItem("pc-supporter-saved-build-monitor-alerts") ?? "").includes("app-alert-stale-server") };
      } finally {
        window.fetch = originalFetch;
        setStored("pc-supporter-saved-build-ids", originalIds);
        setStored("pc-supporter-saved-build-owner-tokens", originalTokens);
        setStored("pc-supporter-saved-build-monitor-alerts", originalAlerts);
      }
    })()`);
    assert(appServerAlertContextProbe?.stage === "checked" && appServerAlertContextProbe.listCalls >= 2 && appServerAlertContextProbe.monitorCalls >= 1 && appServerAlertContextProbe.staleInStorage === false, "App server monitor alert의 이전 updatedAt context 응답이 stale alert를 재주입했습니다. probe=" + JSON.stringify(appServerAlertContextProbe));
    const appOwnerTokenAlertContextProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalIds = localStorage.getItem("pc-supporter-saved-build-ids");
      const originalTokens = localStorage.getItem("pc-supporter-saved-build-owner-tokens");
      const originalAlerts = localStorage.getItem("pc-supporter-saved-build-monitor-alerts");
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const id = "app-owner-token-alert-race-build";
      const tokenA = "a".repeat(48);
      const tokenB = "b".repeat(48);
      const stamp = "2026-09-09T00:03:00.000Z";
      const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
      const preferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 };
      const build = { id, name: "app owner token alert build", selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, totalPriceWon: 100000, priceComplete: true };
      const staleAlert = { id: "app-owner-token-stale", buildId: id, buildName: build.name, kind: "critical", title: "stale owner token alert", message: "stale owner token monitor response", createdAt: stamp, checkedAt: stamp };
      let listCalls = 0;
      let monitorCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) { listCalls += 1; return response({ items: [build] }); }
        if (requestUrl.pathname === "/api/builds/" + id + "/monitor") { monitorCalls += 1; if (monitorCalls === 1) await wait(600); return response({ buildId: id, buildName: build.name, subscription: { enabled: false, intervalMinutes: 360, alertPolicy: "all", updatedAt: stamp, alerts: monitorCalls === 1 ? [staleAlert] : [] } }); }
        return originalFetch(input, init);
      };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        history.pushState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await wait(100);
        localStorage.setItem("pc-supporter-saved-build-owner-tokens", JSON.stringify({ [id]: tokenA }));
        localStorage.removeItem("pc-supporter-saved-build-monitor-alerts");
        const ids = JSON.stringify([id]);
        localStorage.setItem("pc-supporter-saved-build-ids", ids);
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-ids", newValue: ids, storageArea: localStorage }));
        for (let index = 0; index < 100 && monitorCalls < 1; index += 1) await wait(25);
        const tokens = JSON.stringify({ [id]: tokenB });
        localStorage.setItem("pc-supporter-saved-build-owner-tokens", tokens);
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-owner-tokens", newValue: tokens, storageArea: localStorage }));
        for (let index = 0; index < 100 && (listCalls < 2 || monitorCalls < 2); index += 1) await wait(25);
        await wait(900);
        return { stage: "checked", listCalls, monitorCalls, staleInStorage: (localStorage.getItem("pc-supporter-saved-build-monitor-alerts") ?? "").includes("app-owner-token-stale") };
      } finally {
        window.fetch = originalFetch;
        setStored("pc-supporter-saved-build-ids", originalIds);
        setStored("pc-supporter-saved-build-owner-tokens", originalTokens);
        setStored("pc-supporter-saved-build-monitor-alerts", originalAlerts);
      }
    })()`);
    assert(appOwnerTokenAlertContextProbe?.stage === "checked" && appOwnerTokenAlertContextProbe.listCalls >= 2 && appOwnerTokenAlertContextProbe.monitorCalls >= 2 && appOwnerTokenAlertContextProbe.staleInStorage === false, "App owner-token storage sync 뒤 이전 monitor 응답이 stale alert를 재주입했습니다. probe=" + JSON.stringify(appOwnerTokenAlertContextProbe));
    const historyMonitorAlertLatestRouteProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalIds = localStorage.getItem("pc-supporter-saved-build-ids");
      const originalTokens = localStorage.getItem("pc-supporter-saved-build-owner-tokens");
      const originalAlerts = localStorage.getItem("pc-supporter-saved-build-monitor-alerts");
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const id = "monitor-alert-race-build";
      const token = "x".repeat(48);
      const stamp = "2026-09-09T00:00:00.000Z";
      const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
      const preferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 };
      const build = { id, name: "monitor alert race build", selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, totalPriceWon: 100000, priceComplete: true };
      const localAlert = { id: "monitor-alert-local", buildId: id, buildName: build.name, kind: "changed", title: "local monitor alert", message: "local monitor alert message", createdAt: stamp, checkedAt: stamp };
      const staleAlert = { id: "monitor-alert-stale-server", buildId: id, buildName: build.name, kind: "critical", title: "stale server monitor alert", message: "stale server monitor response", createdAt: "2026-09-09T00:01:00.000Z", checkedAt: "2026-09-09T00:01:00.000Z" };
      let buildCalls = 0;
      let alertMutationCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) { buildCalls += 1; return response({ items: [build] }); }
        if (requestUrl.pathname === "/api/builds/" + id + "/monitor/alerts/read" && (init?.method ?? "GET").toUpperCase() === "POST") { alertMutationCalls += 1; await wait(600); return response({ buildId: id, buildName: build.name, subscription: { enabled: false, intervalMinutes: 360, alertPolicy: "all", updatedAt: "2026-09-09T00:02:00.000Z", alerts: [staleAlert] } }); }
        return originalFetch(input, init);
      };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        localStorage.setItem("pc-supporter-saved-build-owner-tokens", JSON.stringify({ [id]: token }));
        localStorage.setItem("pc-supporter-saved-build-monitor-alerts", JSON.stringify([localAlert]));
        const ids = JSON.stringify([id]);
        localStorage.setItem("pc-supporter-saved-build-ids", ids);
        history.pushState({}, "", "/history");
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-ids", newValue: ids, storageArea: localStorage }));
        for (let index = 0; index < 160 && !document.querySelector('[data-testid="saved-build-monitor-alerts"]'); index += 1) await wait(25);
        let readAll;
        for (let index = 0; index < 160; index += 1) {
          readAll = [...document.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("모두 읽음") && !button.disabled);
          if (readAll instanceof HTMLButtonElement) break;
          await wait(25);
        }
        if (!(readAll instanceof HTMLButtonElement)) return { stage: "missing-read-all", buildCalls, alertMutationCalls };
        readAll.click();
        for (let index = 0; index < 80 && alertMutationCalls < 1; index += 1) await wait(25);
        history.pushState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await wait(900);
        return { stage: "checked", buildCalls, alertMutationCalls, path: location.pathname, staleInStorage: (localStorage.getItem("pc-supporter-saved-build-monitor-alerts") ?? "").includes("monitor-alert-stale-server") };
      } finally {
        window.fetch = originalFetch;
        setStored("pc-supporter-saved-build-ids", originalIds);
        setStored("pc-supporter-saved-build-owner-tokens", originalTokens);
        setStored("pc-supporter-saved-build-monitor-alerts", originalAlerts);
      }
    })()`);
    assert(historyMonitorAlertLatestRouteProbe?.stage === "checked" && historyMonitorAlertLatestRouteProbe.alertMutationCalls === 1 && historyMonitorAlertLatestRouteProbe.staleInStorage === false && historyMonitorAlertLatestRouteProbe.path === "/", "HistoryView 이탈 뒤 늦은 서버 모니터 알림 응답이 App 전역 alert storage에 stale 항목을 재주입했습니다. probe=" + JSON.stringify(historyMonitorAlertLatestRouteProbe));
    const savedBuildReadLatestRouteProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalIds = localStorage.getItem('pc-supporter-saved-build-ids');
      const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      let calls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.has('ids')) {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 700));
          return response({ items: [{ id: 'saved-build-read-fresh', name: 'saved-build-read-fresh', selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false }, recommendationPreferences: { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only' }, createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' }] });
        }
        return originalFetch(input, init);
      };
      const restore = () => {
        window.fetch = originalFetch;
        if (originalIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalIds);
      };
      try {
        const serialized = JSON.stringify(['saved-build-read-stale']);
        localStorage.setItem('pc-supporter-saved-build-ids', serialized);
        window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: serialized, storageArea: localStorage }));
        for (let index = 0; index < 80 && calls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        history.pushState({}, '', '/catalog');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await new Promise((resolve) => setTimeout(resolve, 900));
        let storedIds = [];
        try { storedIds = JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]'); } catch { storedIds = []; }
        return { stage: 'checked', calls, path: location.pathname, staleIdsPreserved: Array.isArray(storedIds) && storedIds.length === 1 && storedIds[0] === 'saved-build-read-stale' };
      } finally {
        restore();
      }
    })()`);
    assert(savedBuildReadLatestRouteProbe?.stage === 'checked' && savedBuildReadLatestRouteProbe.calls === 1 && savedBuildReadLatestRouteProbe.path === '/catalog' && savedBuildReadLatestRouteProbe.staleIdsPreserved === true, "saved-build read route 이탈 뒤 늦은 목록 응답이 localStorage를 덮었습니다. probe=" + JSON.stringify(savedBuildReadLatestRouteProbe));
    await client.send("Page.navigate", { url: `${baseUrl}/history` });
    await waitForValue(client, "location.pathname === '/history' && (document.body?.innerText ?? '').includes('SAVED BUILDS')", "saved-build read route probe 이후 history 복귀");
    const savedBuildMutationLatestResponseProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; const originalIds = localStorage.getItem('pc-supporter-saved-build-ids'); const originalTokens = localStorage.getItem('pc-supporter-saved-build-owner-tokens'); const headers = { 'Content-Type': 'application/json' }; const id = 'saved-build-mutation-probe'; const token = 'x'.repeat(48); const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false }; const preferences = { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 }; const buildFor = (name, updatedAt) => ({ id, name, selection, recommendationPreferences: preferences, createdAt: '2026-09-08T00:00:00.000Z', updatedAt, totalPriceWon: 100000, priceComplete: true }); const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers }); let listCalls = 0; let patchCalls = 0; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.has('ids')) { listCalls += 1; await new Promise((resolve) => setTimeout(resolve, listCalls === 1 ? 100 : 500)); return response({ items: [buildFor(listCalls === 1 ? 'saved-build-stale-initial' : 'saved-build-stale-after-mutation', '2026-09-08T00:00:0' + listCalls + '.000Z')] }); } if (requestUrl.pathname === '/api/builds/' + id && (init?.method ?? 'GET').toUpperCase() === 'PATCH') { patchCalls += 1; return response(buildFor('saved-build-mutation-fresh', '2026-09-08T00:01:00.000Z')); } return originalFetch(input, init); }; const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }; const dispatchIds = () => { const serialized = JSON.stringify([id]); localStorage.setItem('pc-supporter-saved-build-ids', serialized); window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: serialized, storageArea: localStorage })); }; try { localStorage.setItem('pc-supporter-saved-build-owner-tokens', JSON.stringify({ [id]: token })); history.pushState({}, '', '/history'); window.dispatchEvent(new PopStateEvent('popstate')); dispatchIds(); for (let index = 0; index < 80 && !(document.body?.innerText ?? '').includes('saved-build-stale-initial'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); dispatchIds(); for (let index = 0; index < 80 && !document.querySelector('[data-testid=\"saved-build-edit-metadata-' + id + '\"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const edit = document.querySelector('[data-testid=\"saved-build-edit-metadata-' + id + '\"]'); if (!(edit instanceof HTMLButtonElement)) return { stage: 'missing-edit', listCalls, patchCalls, body: (document.body?.innerText ?? '').slice(-1500) }; edit.click(); for (let index = 0; index < 40 && !document.querySelector('#edit-saved-build-name'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const input = document.querySelector('#edit-saved-build-name'); const save = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('변경사항 저장')); if (!(input instanceof HTMLInputElement) || !(save instanceof HTMLButtonElement)) return { stage: 'missing-dialog', listCalls, patchCalls }; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, 'saved-build-mutation-fresh'); input.dispatchEvent(new Event('input', { bubbles: true })); save.click(); for (let index = 0; index < 80 && patchCalls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 550)); const body = document.body?.innerText ?? ''; return { stage: 'checked', listCalls, patchCalls, fresh: body.includes('saved-build-mutation-fresh'), stale: body.includes('saved-build-stale-after-mutation'), path: location.pathname }; } finally { window.fetch = originalFetch; setStored('pc-supporter-saved-build-ids', originalIds); setStored('pc-supporter-saved-build-owner-tokens', originalTokens); } })()");
    assert(savedBuildMutationLatestResponseProbe?.stage === 'checked' && savedBuildMutationLatestResponseProbe.patchCalls === 1 && savedBuildMutationLatestResponseProbe.fresh === true && savedBuildMutationLatestResponseProbe.stale === false && savedBuildMutationLatestResponseProbe.path === '/history', "saved-build metadata mutation 이후 늦은 목록 응답이 최신 이름을 덮었습니다. probe=" + JSON.stringify(savedBuildMutationLatestResponseProbe));
    const savedBuildMetadataRouteProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalIds = localStorage.getItem('pc-supporter-saved-build-ids');
      const originalTokens = localStorage.getItem('pc-supporter-saved-build-owner-tokens');
      const originalSync = localStorage.getItem('pc-supporter-saved-build-metadata-sync');
      const id = 'saved-build-metadata-route-probe';
      const token = 'm'.repeat(48);
      const stamp = '2026-09-09T00:00:00.000Z';
      const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
      const preferences = { profile: 'general', priority: 'balanced', listingPolicy: 'retail_only', gamingResolution: '1080p', gamingRefreshRate: 144 };
      const base = { id, name: 'metadata-route-before', selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, totalPriceWon: 100000, priceComplete: true };
      const updated = { ...base, name: 'metadata-route-after', updatedAt: '2026-09-09T00:01:00.000Z' };
      const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      let patchCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (requestUrl.pathname === '/api/builds' && requestUrl.searchParams.has('ids')) return response({ items: [base] });
        if (requestUrl.pathname === '/api/builds/' + id && (init?.method ?? 'GET').toUpperCase() === 'PATCH') { patchCalls += 1; await new Promise((resolve) => setTimeout(resolve, 900)); return response(updated); }
        return originalFetch(input, init);
      };
      const restore = () => {
        window.fetch = originalFetch;
        if (originalIds === null) localStorage.removeItem('pc-supporter-saved-build-ids'); else localStorage.setItem('pc-supporter-saved-build-ids', originalIds);
        if (originalTokens === null) localStorage.removeItem('pc-supporter-saved-build-owner-tokens'); else localStorage.setItem('pc-supporter-saved-build-owner-tokens', originalTokens);
        if (originalSync === null) localStorage.removeItem('pc-supporter-saved-build-metadata-sync'); else localStorage.setItem('pc-supporter-saved-build-metadata-sync', originalSync);
      };
      try {
        const serializedIds = JSON.stringify([id]);
        localStorage.setItem('pc-supporter-saved-build-ids', serializedIds);
        localStorage.setItem('pc-supporter-saved-build-owner-tokens', JSON.stringify({ [id]: token }));
        history.pushState({}, '', '/history');
        window.dispatchEvent(new PopStateEvent('popstate'));
        window.dispatchEvent(new StorageEvent('storage', { key: 'pc-supporter-saved-build-ids', newValue: serializedIds, storageArea: localStorage }));
        for (let index = 0; index < 80 && !document.querySelector('[data-testid="saved-build-edit-metadata-' + id + '"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        const edit = document.querySelector('[data-testid="saved-build-edit-metadata-' + id + '"]');
        if (!(edit instanceof HTMLButtonElement)) return { stage: 'missing-edit', patchCalls };
        edit.click();
        for (let index = 0; index < 40 && !document.querySelector('#edit-saved-build-name'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        const input = document.querySelector('#edit-saved-build-name');
        const save = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('변경사항 저장'));
        if (!(input instanceof HTMLInputElement) || !(save instanceof HTMLButtonElement)) return { stage: 'missing-dialog', patchCalls };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'metadata-route-after');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        save.click();
        for (let index = 0; index < 80 && patchCalls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return { stage: 'checked', patchCalls, path: location.pathname, home: document.querySelector('.home-page') !== null, syncChanged: localStorage.getItem('pc-supporter-saved-build-metadata-sync') !== originalSync };
      } finally {
        restore();
      }
    })()`);
    assert(savedBuildMetadataRouteProbe?.stage === 'checked' && savedBuildMetadataRouteProbe.patchCalls === 1 && savedBuildMetadataRouteProbe.path === '/' && savedBuildMetadataRouteProbe.home === true && savedBuildMetadataRouteProbe.syncChanged === false, "저장 견적 metadata PATCH 중 route 이탈 뒤 늦은 응답이 metadata sync 상태를 덮었습니다. probe=" + JSON.stringify(savedBuildMetadataRouteProbe));
    await client.send("Page.navigate", { url: `${baseUrl}/history` });
    await waitForValue(client, "location.pathname === '/history' && (document.body?.innerText ?? '').includes('SAVED BUILDS')", "저장 견적 metadata route probe 이후 history 복귀");
    const savedBuildVersionShareDuplicateProbe = await client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalIds = localStorage.getItem("pc-supporter-saved-build-ids");
      const originalTokens = localStorage.getItem("pc-supporter-saved-build-owner-tokens");
      const headers = { "Content-Type": "application/json" };
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
      const stamp = "2026-09-08T00:00:00.000Z";
      const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false };
      const preferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only", gamingResolution: "1080p", gamingRefreshRate: 144 };
      const beforeId = "version-share-probe-before";
      const afterId = "version-share-probe-after";
      const before = { id: beforeId, name: "version share probe before", selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, versionGroupId: "version-share-probe-group", versionNumber: 1, totalPriceWon: 100000, priceComplete: true };
      const after = { id: afterId, name: "version share probe after", selection, recommendationPreferences: preferences, createdAt: stamp, updatedAt: stamp, versionGroupId: "version-share-probe-group", versionNumber: 2, derivedFromBuildId: beforeId, totalPriceWon: 100000, priceComplete: true };
      const check = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 100000, priceComplete: true, analysisScore: 80, analysisScoreLabel: "균형형", analysisConfidence: "high", findings: [], engineVersion: "2.58.0", catalogSnapshotAt: stamp, checkedAt: stamp };
      const payload = { schemaVersion: 1, kind: "pc-supporter.saved-build-version-comparison-share", generatedAt: stamp, before: { id: beforeId, label: "변경 전", versionNumber: 1, name: before.name, updatedAt: stamp, check }, after: { id: afterId, label: "변경 후", versionNumber: 2, name: after.name, updatedAt: stamp, check }, summary: { direction: "same", selectionChangedCategoryCount: 0 }, transition: { direction: "same", statusChanged: false, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, priceCompletenessChanged: false, resourceBudgetChanged: false, benchmarkChanged: false, benchmarkNeedsReview: false, engineChanged: false, catalogChanged: false, resolvedFindingCount: 0, newFindingCount: 0, severityChangedFindingCount: 0, detailsChangedFindingCount: 0 }, changes: [], findingChanges: [], dataBoundary: "duplicate-share probe", text: "duplicate-share probe" };
      const shareResponse = { id: "version-share-probe", name: "version share probe", payload, createdAt: stamp, updatedAt: stamp, ownerToken: "x".repeat(48) };
      let buildCalls = 0;
      let shareCalls = 0;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) {
          buildCalls += 1;
          return response({ items: [before, after] });
        }
        if (requestUrl.pathname === "/api/version-comparisons" && (init?.method ?? "GET").toUpperCase() === "POST") {
          shareCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 500));
          return response(shareResponse);
        }
        return originalFetch(input, init);
      };
      const setStored = (key, value) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); };
      try {
        localStorage.setItem("pc-supporter-saved-build-owner-tokens", JSON.stringify({ [afterId]: shareResponse.ownerToken }));
        const ids = JSON.stringify([beforeId, afterId]);
        localStorage.setItem("pc-supporter-saved-build-ids", ids);
        history.pushState({}, "", "/history");
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-ids", newValue: ids, storageArea: localStorage }));
        for (let index = 0; index < 160 && !document.querySelector('[data-testid="saved-build-version-share"]'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        const button = document.querySelector('[data-testid="saved-build-version-share"]');
        if (!(button instanceof HTMLButtonElement)) return { stage: "missing-button", buildCalls, shareCalls, body: (document.body?.innerText ?? "").slice(-2500) };
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const currentButton = document.querySelector('[data-testid="saved-build-version-share"]');
        const disabledDuring = currentButton instanceof HTMLButtonElement ? currentButton.disabled : false;
        if (currentButton instanceof HTMLButtonElement) currentButton.click();
        await new Promise((resolve) => setTimeout(resolve, 650));
        return { stage: "checked", buildCalls, shareCalls, disabledDuring, path: location.pathname };
      } finally {
        window.fetch = originalFetch;
        setStored("pc-supporter-saved-build-ids", originalIds);
        setStored("pc-supporter-saved-build-owner-tokens", originalTokens);
      }
    })()`);
    assert(savedBuildVersionShareDuplicateProbe?.stage === "checked" && savedBuildVersionShareDuplicateProbe.shareCalls === 1 && savedBuildVersionShareDuplicateProbe.path === "/history", "저장 견적 버전 비교 공유 연속 클릭이 중복 snapshot POST를 생성했습니다. probe=" + JSON.stringify(savedBuildVersionShareDuplicateProbe));
   await client.send("Page.navigate", { url: baseUrl + "/catalog" });
    await waitForValue(client, "((document.body?.innerText ?? '').includes('부품 찾기') || (document.body?.innerText ?? '').includes('부품 카탈로그 탐색')) && document.querySelector('.catalog-search input') !== null", "bootstrap 부품 목록 경합 probe 카탈로그");
    const bootstrapPartsLatestResponseProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); const cpuPart = (name) => ({ id: 'cpu-7500f', category: 'cpu', name, brand: 'bootstrap-probe', model: 'bootstrap-probe', source: 'manual', listingType: 'retail', priceWon: 100000, specs: {}, dataQuality: 'manual', missingFields: [], updatedAt: '2026-09-08T00:00:00.000Z' }); let bootstrapCalls = 0; let metaFailures = 0; const setInput = (value) => { const input = document.querySelector('.catalog-search input'); if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); return true; }; try { window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname === '/api/parts' && requestUrl.searchParams.get('q') === '__bootstrap-status-probe__') throw new TypeError('Failed to fetch'); return originalFetch(input, init); }; if (!setInput('__bootstrap-status-probe__')) return { stage: 'no-input', bootstrapCalls, metaFailures }; for (let index = 0; index < 100 && !document.querySelector('.bootstrap-notice'); index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); if (!document.querySelector('.bootstrap-notice')) return { stage: 'no-notice', bootstrapCalls, metaFailures, body: (document.body?.innerText ?? '').slice(-3000) }; window.fetch = async (input, init) => { const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href); if (requestUrl.pathname === '/api/parts' && requestUrl.searchParams.get('limit') === '100') { bootstrapCalls += 1; if (bootstrapCalls === 1) { await new Promise((resolve) => setTimeout(resolve, 450)); return response({ items: [cpuPart('bootstrap-stale-probe')] }); } return response({ items: [cpuPart('bootstrap-fresh-probe')] }); } if (requestUrl.pathname === '/api/meta' && bootstrapCalls === 1 && metaFailures === 0) { metaFailures += 1; return response({ error: 'bootstrap probe failure' }, 400); } return originalFetch(input, init); }; const retryAll = document.querySelector('.bootstrap-retry-all'); if (!(retryAll instanceof HTMLButtonElement)) return { stage: 'no-retry', bootstrapCalls, metaFailures }; retryAll.click(); for (let index = 0; index < 80 && bootstrapCalls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); if (bootstrapCalls < 1) return { stage: 'first-bootstrap-timeout', bootstrapCalls, metaFailures }; for (let index = 0; index < 80 && ![...document.querySelectorAll('.bootstrap-notice li')].some((item) => (item.textContent ?? '').includes('서비스 메타데이터')); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 150)); window.dispatchEvent(new Event('online')); for (let index = 0; index < 80 && bootstrapCalls < 2; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); await new Promise((resolve) => setTimeout(resolve, 550)); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); for (let index = 0; index < 80 && ![...document.querySelectorAll('button')].some((button) => (button.textContent ?? '').includes('문제 있는 예시 견적')); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const demo = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('문제 있는 예시 견적')); demo?.click(); for (let index = 0; index < 80 && location.pathname !== '/build'; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); for (let index = 0; index < 80 && !(document.querySelector('.selected-line strong')?.textContent ?? '').includes('bootstrap-fresh-probe'); index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const selectedName = document.querySelector('.selected-line strong')?.textContent ?? ''; return { stage: 'checked', bootstrapCalls, metaFailures, fresh: selectedName.includes('bootstrap-fresh-probe'), stale: selectedName.includes('bootstrap-stale-probe'), selectedName, path: location.pathname }; } finally { window.fetch = originalFetch; } })()");
    assert(bootstrapPartsLatestResponseProbe?.stage === "checked" && bootstrapPartsLatestResponseProbe.bootstrapCalls === 2 && bootstrapPartsLatestResponseProbe.fresh === true && bootstrapPartsLatestResponseProbe.stale === false && bootstrapPartsLatestResponseProbe.path === "/build", "bootstrap 부품 목록의 이전 응답이 최신 부품 상태를 덮었습니다. probe=" + JSON.stringify(bootstrapPartsLatestResponseProbe));
    await client.send("Page.navigate", { url: baseUrl + "/" });
    await waitForValue(client, "document.querySelector('[data-testid=\"home-catalog-cache\"]') !== null && document.querySelector('[data-testid=\"home-catalog-cache-clear-all\"]') !== null", "저장 견적 probe 이후 홈 카탈로그 캐시 관리");
    const cacheManagementProbe = await client.evaluate("(async () => { const before = { parts: localStorage.getItem('pc-supporter-catalog-picker-cache-v1'), accessories: localStorage.getItem('pc-supporter-accessory-catalog-cache-v1'), draft: localStorage.getItem('pc-supporter-draft'), savedIds: localStorage.getItem('pc-supporter-saved-build-ids') }; const originalConfirm = window.confirm; window.confirm = () => true; try { const button = document.querySelector('[data-testid=\"home-catalog-cache-clear-all\"]'); if (!(button instanceof HTMLButtonElement)) return { stage: 'no-button', before }; button.click(); for (let index = 0; index < 40; index += 1) { const node = document.querySelector('[data-testid=\"home-catalog-cache\"]'); if (node?.textContent?.includes('아직 보관된 카탈로그 탐색 캐시가 없습니다')) { return { stage: 'cleared', before, after: { parts: localStorage.getItem('pc-supporter-catalog-picker-cache-v1'), accessories: localStorage.getItem('pc-supporter-accessory-catalog-cache-v1'), draft: localStorage.getItem('pc-supporter-draft'), savedIds: localStorage.getItem('pc-supporter-saved-build-ids') } }; } await new Promise((resolve) => setTimeout(resolve, 50)); } return { stage: 'timeout', before, body: (document.body?.innerText ?? '').slice(-3000) }; } finally { window.confirm = originalConfirm; } })()");
    assert(cacheManagementProbe?.stage === "cleared", "카탈로그 캐시 전체 초기화가 완료되지 않았습니다. probe=" + JSON.stringify(cacheManagementProbe));
    assert(cacheManagementProbe.before.parts && cacheManagementProbe.before.accessories && cacheManagementProbe.after.parts === null && cacheManagementProbe.after.accessories === null, "카탈로그 캐시 초기화 전후 값이 올바르지 않습니다.");
    assert(cacheManagementProbe.before.draft === cacheManagementProbe.after.draft && cacheManagementProbe.before.savedIds === cacheManagementProbe.after.savedIds, "카탈로그 캐시 초기화가 견적 초안 또는 저장 견적 식별자를 변경했습니다. probe=" + JSON.stringify(cacheManagementProbe));
    assert(BROWSER_ROUTE_HISTORY_FLOW_IDS.every((id) => executedRouteHistoryFlowIds.has(id)), "route-history manifest 항목 중 실행되지 않은 probe가 있습니다. manifest=" + JSON.stringify(BROWSER_ROUTE_HISTORY_FLOW_IDS) + " executed=" + JSON.stringify([...executedRouteHistoryFlowIds]));

 console.log(JSON.stringify({ ok: true, flow: ["home-demo", "generator-brief", "budget-ladder-tradeoff", "generator-route-history", "generator-preset-storage-sync", "share-route-latest-cancel", "result-route-history", "check-latest-route", "save-build-latest-route", "catalog-spec-coverage", "admin-pcie-evidence-coverage", "admin-pcie-review-queue", "admin-3dmark-work-package", "admin-3dmark-storage-sync", "admin-3dmark-review-deep-link", "catalog-data-priority-actions", "admin-catalog-watchlist-storage-sync", "admin-catalog-watchlist-mutation-context", "catalog-spec-review", "catalog-pcie-refresh-progress", "catalog-spec-override", "admin-search-latest-response", "admin-meta-latest-response", "admin-migration-latest-response", "admin-login-mutation-latest-response", "admin-backup-detail-latest-response", "admin-crawl-mutation-latest-response", "admin-load-override-mutation-latest-response", "admin-gpu-physical-mutation-latest-response", "admin-m2-mutation-latest-response", "admin-benchmark-mutation-latest-response", "catalog-part-refresh", "candidate-data-gap", "build-ready", "price-summary-partial", "catalog-refresh-report-failure", "price-summary-complete", "compatibility-result", "result-render-loop", "part-watch-storage-sync", "candidate-watch-storage-sync", "purchase-checklist-storage-sync", "assembly-verification-storage-sync", "accessory-recommendation-controls", "accessory-recommendation-price-watch", "accessory-recommendation-add-and-target", "accessory-cart-price-evidence", "accessory-recommendation-compare", "purchase-list-price-review", "purchase-list-latest-context", "purchase-list-targeted-price-refresh", "purchase-list-data-review-queue", "purchase-list-action-center", "purchase-list-price-evidence", "purchase-list-catalog-detail", "catalog-result-return", "benchmark-evidence", "catalog-watch-storage-sync", "part-picker", "picker-cache-write", "picker-pcie-slot-filter", "modal-keyboard-accessibility", "no-blocker-mode", "candidate-compare", "candidate-detail", "catalog-candidate-evidence", "catalog-comparison-baseline", "shared-comparison-benchmark-evidence", "shared-comparison-benchmark-recheck", "shared-comparison-benchmark-impact", "shared-comparison-watch-storage-sync", "shared-comparison-latest-route", "shared-version-comparison-latest-route", "catalog-route-history", "catalog-query-history-coalesce", "catalog-spec-filter", "catalog-pcie-info-filter", "catalog-benchmark-sort", "catalog-sort-normalization", "catalog-spec-preset", "api-recovery", "picker-offline-cache", "picker-cache-storage-sync", "admin-session-expiry-recovery", "applied-build-result-comparison", "purchase-item-status", "purchase-decision-gate-progress", "assembly-plan-execution-progress", "assembly-plan-resume-action", "mobile-layout", "admin-mobile-layout", "price-watchlist-decision-filter", "price-watchlist-target-switch", "price-watchlist-empty-refresh", "price-watchlist-storage-sync", "price-watch-alert-context-latest", "price-watch-owner-token-context-latest", "price-watchlist-route-history", "shared-watchlist-latest-refresh", "shared-budget-ladder-latest-refresh", "shared-budget-ladder-selection-apply", "shared-budget-ladder-mutation-route", "price-watchlist-transfer", "accessory-route-history", "accessory-watch-storage-sync", "accessory-cache-storage-sync", "accessory-list-price-evidence", "accessory-cache-write", "accessory-offline-cache", "accessory-cache-detail-recheck", "accessory-watchlist", "accessory-detail", "accessory-detail-deep-link", "accessory-detail-filter-clear", "accessory-price-history", "saved-builds-latest-response", "app-server-alert-context-latest", "app-owner-token-alert-context-latest", "history-monitor-alert-latest-route", "saved-build-read-latest-route", "saved-build-metadata-latest-route", "saved-build-version-share-duplicate", "bootstrap-parts-latest-response", "catalog-cache-management"], routeHistoryManifest: BROWSER_ROUTE_HISTORY_MANIFEST, executedRouteHistoryFlowIds: [...executedRouteHistoryFlowIds], mobile: { home: homeWidth, build: buildWidth, catalog: catalogWidth, generator: generatorWidth, guidance: guidanceWidth, admin: adminWidth } }, null, 2));
  } finally {
    client?.close();
    if (!chromeExited) {
      signalProcessGroup(chrome, "SIGTERM");
      await Promise.race([chromeExit, sleep(2_000)]);
      if (!chromeExited) {
        signalProcessGroup(chrome, "SIGKILL");
        await Promise.race([chromeExit, sleep(1_000)]);
        if (!chromeExited) chrome.unref();
      }
    }
    await rm(profileDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
