import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const outputDir = process.env.QUOTE_ONBOARDING_CAPTURE_DIR ?? join(process.cwd(), "artifacts", "quote-onboarding");
const timeoutMs = Number(process.env.QUOTE_ONBOARDING_CAPTURE_TIMEOUT_MS ?? 120_000);
const captureTheme = process.env.QUOTE_ONBOARDING_CAPTURE_THEME ?? "light";
if (captureTheme !== "light" && captureTheme !== "dark") throw new Error("QUOTE_ONBOARDING_CAPTURE_THEME must be light or dark.");
const assertNoApiFetch = process.env.QUOTE_ONBOARDING_CAPTURE_ASSERT_NO_API_FETCH === "true";
const captureCoreOnly = process.env.QUOTE_ONBOARDING_CAPTURE_CORE_ONLY === "true";
const denyLocalStorage = process.env.QUOTE_ONBOARDING_CAPTURE_DENY_LOCAL_STORAGE === "true";
const corruptDraftBackupFailure = process.env.QUOTE_ONBOARDING_CAPTURE_CORRUPT_DRAFT_BACKUP_FAILURE === "true";
let corruptDraftPreservedBeforeExport = false;
let draftBackupFailureNoticeWasVisible = false;
let corruptDraftWasExported = false;
let corruptDraftReplacedAfterExport = false;

async function waitForCorruptDraftDownload(directory) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const filename = (await readdir(directory)).find((entry) => entry.startsWith("pc-supporter-unreadable-draft-") && entry.endsWith(".json"));
    if (filename) return { filename, contents: await readFile(join(directory, filename), "utf8") };
    await sleep(100);
  }
  throw new Error("Corrupt draft export did not produce a downloaded JSON file.");
}

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
  if (!clicked) {
    const diagnostic = await client.evaluate("JSON.stringify({ href: location.href, title: document.querySelector('.onboarding-title')?.textContent?.trim(), buttons: [...document.querySelectorAll('button')].map((button) => (button.textContent ?? '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 40) })").catch(() => "브라우저 버튼 상태를 읽지 못했습니다.");
    throw new Error(`버튼을 찾지 못했습니다: ${text}. state=${diagnostic}`);
  }
}

async function waitForTitle(client, title, label) {
  await waitForValueWithTimeout(client, `document.querySelector(".onboarding-title")?.textContent?.replace(/\\s+/g, " ").trim() === ${JSON.stringify(title)}`, label);
}

async function navigateToStart(client) {
  await client.evaluate("(() => { const key = 'pc-supporter-offline-capture-api-attempts'; const attempts = sessionStorage.getItem(key); sessionStorage.clear(); if (attempts) sessionStorage.setItem(key, attempts); history.pushState({}, '', '/start'); window.dispatchEvent(new PopStateEvent('popstate')); })()");
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "온보딩 시작 화면");
}

async function runFlow(client, { prefix, viewport }) {
  await client.send("Emulation.setDeviceMetricsOverride", viewport);
  await client.evaluate("(() => { const key = 'pc-supporter-offline-capture-api-attempts'; const attempts = sessionStorage.getItem(key); sessionStorage.clear(); if (attempts) sessionStorage.setItem(key, attempts); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); })()");
  await waitForValueWithTimeout(client, "location.pathname === '/' && document.querySelector('[data-testid=home-guided-entry], [data-testid=home-current-build-preview], .mobile-home-view') !== null", "홈 첫 화면");
  const manifest = [];
  const record = async (id, label, route) => {
    const path = await capture(client, `${prefix}-${id}`);
    manifest.push({ id, label, route: route ?? await client.evaluate("location.pathname + location.search"), path });
  };

  await record("01-home-guided", "홈 시작 화면 · 새 견적 또는 현재 견적");
  if (corruptDraftBackupFailure && prefix === "mobile") {
    draftBackupFailureNoticeWasVisible = await client.evaluate("document.querySelector('[data-testid=draft-recovery-notice]') !== null");
    corruptDraftPreservedBeforeExport = await client.evaluate("Boolean(window.__pcSupporterExpectedCorruptDraft) && window.localStorage.getItem('pc-supporter-draft') === window.__pcSupporterExpectedCorruptDraft");
    const recoveryActionVisible = await client.evaluate("document.querySelector('[data-testid=draft-recovery-notice] button:not(:disabled)')?.textContent?.includes('이전 견적 JSON 저장') === true");
    if (!draftBackupFailureNoticeWasVisible || !corruptDraftPreservedBeforeExport || !recoveryActionVisible) throw new Error(`The corrupted draft export action is not available. notice=${draftBackupFailureNoticeWasVisible}; preserved=${corruptDraftPreservedBeforeExport}; action=${recoveryActionVisible}`);
    await clickButton(client, "이전 견적 JSON 저장");
    await waitForValueWithTimeout(client, "document.querySelector('[data-testid=draft-recovery-notice] button:last-child')?.disabled === false", "이전 견적 원본 내보내기 확인");
    const download = await waitForCorruptDraftDownload(join(profileDir, "downloads"));
    if (!download.contents.startsWith("synthetic-corrupt-draft:")) throw new Error("Corrupt draft export contents did not match the original source value.");
    corruptDraftWasExported = true;
    await record("draft-backup-exported", "이전 견적 원본 내보내기 후 새 견적 저장 선택");
    await clickButton(client, "원본을 내보냈고 새 견적으로 계속");
    await waitForValueWithTimeout(client, "document.querySelector('[data-testid=draft-recovery-notice]') === null && window.localStorage.getItem('pc-supporter-draft') !== window.__pcSupporterExpectedCorruptDraft", "원본 내보낸 뒤 새 견적 저장 재개");
    corruptDraftReplacedAfterExport = true;
  }
  await navigateToStart(client);
  await record("02-start-intent", "시작 선택 · 새 견적 / 업그레이드 / 나중에");
  await clickButton(client, "새 PC 견적 보기");
  await clickButton(client, "새 견적 시작하기");
  await waitForTitle(client, "어떤 기준으로 부품을 고를까요?", "새 견적 방식 화면");
  await record("03-new-quote", "새 견적 방식");
  await clickButton(client, "게임·작업을 기준으로 고르기");
  await clickButton(client, "이 기준으로 계속");
  await waitForTitle(client, "어떤 용도로 쓸 PC인가요?", "용도 선택 화면");
  await record("04-usecase", "게임 또는 작업 선택");
  await clickButton(client, "게임");
  await clickButton(client, "다음");
  await waitForTitle(client, "주로 할 게임을 골라주세요", "게임 선택 화면");
  await clickButton(client, "사이버펑크 2077");
  await clickButton(client, "다음");
  await waitForTitle(client, "게임 성능 목표를 정해주세요", "성능 목표 화면");
  await record("05-game-performance", "게임 · 4K · 희망 주사율 144Hz");
  await clickButton(client, "4K");
  await clickButton(client, "144Hz");
  await clickButton(client, "다음");
  await waitForTitle(client, "게임 옵션도 정해주세요", "그래픽 옵션 화면");
  await clickButton(client, "높음");
  await clickButton(client, "DLSS·품질 참고");
  await record("06-graphics-contract", "그래픽 옵션 · 입력한 목표 확인");
  await clickButton(client, "다음 · 예산 정하기");
  await waitForTitle(client, "예산을 정해주세요", "예산 화면");
  await clickButton(client, "500만원");
  await waitForValueWithTimeout(client, "document.querySelector('.onboarding-budget-value')?.textContent?.trim() === '500만원'", "예산 500만원 선택");
  await record("07-budget-range", "예산 · 가격대 · 사양");
  await clickButton(client, "예상 구성 확인");
  await waitForTitle(client, "견적 내용을 확인하세요", "조건 요약 화면");
  await record("08-summary", "조건 요약 · 항목별 변경");
  await clickButton(client, "견적 만들기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "자동 구성 결과");
  await record("09-generator-result", "자동 구성 결과 · 선택한 게임 목표");
  return manifest;
}

async function captureOfflineCoreFlow(client, prefix) {
  const recommendation = await client.evaluate(`(() => ({
    lines: document.querySelectorAll('.generator-result .generator-line').length,
    total: document.querySelector('.generator-result .generator-total strong')?.textContent?.trim() ?? null
  }))()`);
  if (!recommendation || recommendation.lines < 1 || !recommendation.total) {
    throw new Error(`로컬 추천 결과가 비어 있습니다: ${JSON.stringify(recommendation)}`);
  }
  await client.evaluate("(() => { const target = document.querySelector('.generator-result'); if (!target) return; const headerHeight = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0; window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - headerHeight - 12), behavior: 'instant' }); })()");
  const recommendationPath = await capture(client, `${prefix}-offline-generated-result`);
  await clickButton(client, "호환성 확인");
  await waitForValueWithTimeout(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null && document.querySelector('[data-testid=result-findings]') !== null", "로컬 호환 검사 결과");
  const compatibility = await client.evaluate(`(() => ({
    heading: document.querySelector('.result-hero h1, .result-hero-main h1')?.textContent?.trim() ?? document.querySelector('.result-page h1')?.textContent?.trim() ?? null,
    findings: document.querySelectorAll('[data-testid=result-findings] .finding-card').length,
    resultReady: Boolean(document.querySelector('[data-testid=result-findings]'))
  }))()`);
  if (!compatibility?.resultReady) throw new Error("로컬 호환 검사 결과 영역을 찾지 못했습니다.");
  await client.evaluate("window.scrollTo(0, 0)");
  const compatibilityPath = await capture(client, `${prefix}-offline-compatibility-result`);
  return {
    recommendation: { lineCount: recommendation.lines, total: recommendation.total, path: recommendationPath },
    compatibility: { ...compatibility, path: compatibilityPath }
  };
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
    await clickButton(client, "새 PC 견적 보기");
    await clickButton(client, "새 견적 시작하기");
    await waitForTitle(client, "어떤 기준으로 부품을 고를까요?", "새 견적 방식 화면");
  };

  await startNewQuote();
  await clickButton(client, "게임·작업을 기준으로 고르기");
  await clickButton(client, "이 기준으로 계속");
  await waitForTitle(client, "어떤 용도로 쓸 PC인가요?", "작업 용도 화면");
  await clickButton(client, "작업");
  await clickButton(client, "다음");
  await waitForTitle(client, "주로 하는 작업을 골라주세요", "작업 선택 화면");
  await record("work", "01-work-select", "작업 선택");
  await clickButton(client, "영상 편집");
  await clickButton(client, "다음");
  await waitForTitle(client, "영상 편집은 어느 정도 규모인가요?", "작업 강도 화면");
  await record("work", "02-intensity", "영상 편집 강도 · 구체적 예상 사양");
  await clickButton(client, "무겁게");
  await clickButton(client, "다음 · 예산 정하기");
  await waitForTitle(client, "예산을 정해주세요", "작업 예산 화면");
  await clickButton(client, "300만원");
  await record("work", "03-budget", "작업 예산 · 4K·6K · 64GB · 2TB");
  await clickButton(client, "예상 구성 확인");
  await waitForTitle(client, "견적 내용을 확인하세요", "작업 조건 요약");
  await record("work", "04-summary", "작업 조건 요약");
  await clickButton(client, "견적 만들기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "작업 자동 구성 결과");
  await record("work", "05-result", "작업 결과 · WORK TARGET");

  await startNewQuote();
  await clickButton(client, "예산을 기준으로 고르기");
  await clickButton(client, "이 기준으로 계속");
  await waitForTitle(client, "예산을 정해주세요", "예산-only 화면");
  await clickButton(client, "400만원");
  await record("budget", "01-budget", "예산-only · 상급 일반 구성");
  await clickButton(client, "예상 구성 확인");
  await waitForTitle(client, "견적 내용을 확인하세요", "예산-only 요약");
  await record("budget", "02-summary", "예산-only 조건 요약");
  await clickButton(client, "견적 만들기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "예산-only 결과");
  await record("budget", "03-result", "예산-only 결과 · GENERAL TARGET");

  await startNewQuote();
  await clickButton(client, "원하는 사양 직접 입력하기");
  await clickButton(client, "이 기준으로 계속");
  await waitForTitle(client, "성능 목표를 정하세요", "직접 성능 화면");
  await record("spec", "01-spec", "직접 성능 · 최상급 · RAM · SSD");
  await clickButton(client, "최상급");
  await clickButton(client, "64GB");
  await clickButton(client, "2TB");
  await clickButton(client, "다음");
  await waitForTitle(client, "예산을 정해주세요", "직접 성능 예산 화면");
  await clickButton(client, "300만원");
  await clickButton(client, "예상 구성 확인");
  await waitForTitle(client, "견적 내용을 확인하세요", "직접 성능 요약");
  await record("spec", "02-summary", "직접 성능 조건 요약");
  await clickButton(client, "견적 만들기");
  await waitForValueWithTimeout(client, "location.pathname === '/recommend' && document.querySelector('.generator-result') !== null", "직접 성능 결과");
  await record("spec", "03-result", "직접 성능 결과 · GENERAL TARGET");

  await navigateToStart(client);
  await clickButton(client, "쓰던 PC 업그레이드하기");
  await clickButton(client, "다음");
  await waitForValueWithTimeout(client, "document.querySelector('.onboarding-steps-list') !== null", "업그레이드 안내");
  await record("upgrade", "01-entry", "업그레이드 진입 안내");
  await clickButton(client, "현재 부품 고르기");
  await waitForValueWithTimeout(client, "location.pathname === '/build'", "업그레이드 편집기");
  await record("upgrade", "02-editor", "업그레이드 편집기");

  await navigateToStart(client);
  await clickButton(client, "나중에 하기");
  await clickButton(client, "홈으로 돌아가기");
  await waitForValueWithTimeout(client, "location.pathname === '/' && document.querySelector('[data-testid=home-guided-entry], [data-testid=home-current-build-preview], .mobile-home-view') !== null", "나중에 선택 후 홈");
  await record("later", "01-home", "나중에 선택 후 홈");
  return branches;
}

async function captureMobileHomeBuildSummary(client, prefix = "mobile-home", { reuseCurrentBuild = false } = {}) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const hasCurrentBuild = await client.evaluate("location.pathname === '/' && document.querySelector('[data-testid=mobile-home-required-count]') !== null");
  if (reuseCurrentBuild || hasCurrentBuild) {
    await client.evaluate("(() => { if (location.pathname !== '/') { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); } const details = document.querySelector('.mobile-build-additional'); if (details instanceof HTMLDetailsElement) details.open = false; window.scrollTo({ top: 0, behavior: 'instant' }); })()");
  } else {
    await client.evaluate("localStorage.removeItem('pc-supporter-draft'); sessionStorage.clear(); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));");
    await waitForValueWithTimeout(client, "location.pathname === '/' && document.querySelector('[data-testid=home-guided-entry]') !== null", "모바일 홈 예시 구성 초기화");
    const opened = await client.evaluate("(() => { const summary = document.querySelector('.mobile-demo-tools > summary'); if (!(summary instanceof HTMLElement)) return false; summary.click(); return true; })()");
    if (!opened) throw new Error("모바일 홈 예시 구성 메뉴를 열지 못했습니다.");
    await clickButton(client, "문제 없는 예시 견적");
    await waitForValueWithTimeout(client, "location.pathname === '/build'", "예시 구성 편집 화면");
    await client.evaluate("history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));");
  }
  await waitForValueWithTimeout(client, "location.pathname === '/' && document.querySelector('[data-testid=mobile-home-required-count]') !== null && document.querySelector('[data-testid=mobile-home-additional-selections]') !== null", "모바일 홈 구성 요약");
  await waitForValueWithTimeout(client, "(() => { const rows = [...document.querySelectorAll('.mobile-build-row .mobile-build-copy small')]; return rows.length >= 4 && !rows.some((row) => row.textContent?.includes('부품 정보 없음')); })()", "모바일 홈 카탈로그 이름 hydration");
  const collapsedPath = await capture(client, `${prefix}-current-build`);
  const expanded = await client.evaluate("(() => { const summary = document.querySelector('.mobile-build-additional > summary'); if (!(summary instanceof HTMLElement)) return false; summary.click(); return true; })()");
  if (!expanded) throw new Error("모바일 홈 추가 구성 요약을 열지 못했습니다.");
  await waitForValueWithTimeout(client, "document.querySelector('.mobile-build-additional[open]') !== null", "모바일 홈 추가 구성 펼치기");
  await client.evaluate("(() => { const details = document.querySelector('.mobile-build-additional'); if (!details) return false; const top = details.getBoundingClientRect().top + window.scrollY - 130; window.scrollTo({ top: Math.max(0, top), behavior: 'instant' }); return true; })()");
  const expandedPath = await capture(client, `${prefix}-additional-open`);
  return { collapsedPath, expandedPath };
}

async function captureMobilePriceWatchlist(client) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const itemName = await client.evaluate("(async () => { const response = await fetch('/api/parts?category=cpu&limit=1'); if (!response.ok) return null; const payload = await response.json(); const item = payload.items?.[0]; if (!item) return null; const entry = { kind: 'part', itemId: item.id, itemName: item.name, category: item.category, addedAt: new Date().toISOString(), targetPriceWon: typeof item.priceWon === 'number' && item.priceWon > 0 ? Math.floor(item.priceWon * 0.9) : undefined }; localStorage.setItem('pc-supporter-catalog-watchlist', JSON.stringify([entry])); return item.name; })()");
  if (typeof itemName !== "string" || !itemName) throw new Error("가격 추적 캡처용 부품을 찾지 못했습니다.");
  await client.send("Page.navigate", { url: `${baseUrl}/watchlist` });
  await waitForValueWithTimeout(client, `document.querySelector('.price-watchlist-tracked-item')?.innerText?.includes(${JSON.stringify(itemName)}) === true`, "모바일 가격 추적 목록");
  await waitForValueWithTimeout(client, "document.querySelector('.price-watchlist-current')?.innerText?.includes('기본 카탈로그') === true", "가격 출처와 신선도 정보");
  const itemLayout = await client.evaluate("(() => { const item = document.querySelector('.price-watchlist-tracked-item'); const current = item?.querySelector('.price-watchlist-current'); if (!item || !current) return null; const itemRect = item.getBoundingClientRect(); const currentRect = current.getBoundingClientRect(); const itemStyle = getComputedStyle(item); return { viewportWidth: innerWidth, documentWidth: document.documentElement.clientWidth, mobile500: matchMedia('(max-width: 500px)').matches, mobile760: matchMedia('(max-width: 760px)').matches, itemWidth: Math.round(itemRect.width), currentPriceWidth: Math.round(currentRect.width), gridColumns: itemStyle.gridTemplateColumns, gridDisplay: itemStyle.display, currentGridColumn: getComputedStyle(current).gridColumn }; })()")
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const documentTree = await client.send("DOM.getDocument", { depth: 1 });
  const trackedItemNode = await client.send("DOM.querySelector", { nodeId: documentTree.root.nodeId, selector: ".price-watchlist-tracked-item" });
  if (trackedItemNode.nodeId && itemLayout) {
    const matchedStyles = await client.send("CSS.getMatchedStylesForNode", { nodeId: trackedItemNode.nodeId });
    itemLayout.matchedGridRules = (matchedStyles.matchedCSSRules ?? []).filter(({ rule }) => rule.selectorList?.text.includes(".price-watchlist-tracked-item")).map(({ rule }) => ({ selector: rule.selectorList.text, media: rule.media?.map((entry) => entry.text) ?? [], columns: rule.style.cssProperties.filter((property) => property.name === "grid-template-columns").map((property) => ({ value: property.value, important: property.important })) }));
  }
  if (!itemLayout || itemLayout.currentPriceWidth < itemLayout.itemWidth * 0.9) throw new Error(`모바일 가격 카드가 전체 너비를 사용하지 않습니다. layout=${JSON.stringify(itemLayout)}`);
  const path = await capture(client, "mobile-price-watchlist-source-and-freshness");
  const focused = await client.evaluate("(() => { const item = document.querySelector('.price-watchlist-tracked-item'); if (!item) return false; item.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()");
  if (!focused) throw new Error("가격 추적 상세 항목을 화면에 표시하지 못했습니다.");
  await waitForValueWithTimeout(client, "document.querySelector('.price-watchlist-tracked-item')?.innerText?.includes('기본 카탈로그') === true", "가격 추적 출처와 최신성 표시");
  const detailPath = await capture(client, "mobile-price-watchlist-item-detail");
  return { itemName, itemLayout, path, detailPath };
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
  if (corruptDraftBackupFailure) {
    const downloadDirectory = join(profileDir, "downloads");
    await mkdir(downloadDirectory, { recursive: true });
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory });
  }
  if (assertNoApiFetch || denyLocalStorage) {
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        ${denyLocalStorage ? "Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('localStorage disabled by capture', 'SecurityError'); } });" : ""}
        ${corruptDraftBackupFailure ? "(() => { const native = window.localStorage; const key = 'pc-supporter-draft'; const payload = 'synthetic-corrupt-draft:' + 'x'.repeat(800); native.setItem(key, payload); window.__pcSupporterExpectedCorruptDraft = payload; const proxy = new Proxy(native, { get(target, property) { if (property === 'setItem') return (itemKey, value) => { if (itemKey === 'pc-supporter-invalid-draft-backup') throw new DOMException('synthetic backup quota failure', 'QuotaExceededError'); return target.setItem(itemKey, value); }; const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } }); Object.defineProperty(window, 'localStorage', { configurable: true, get() { return proxy; } }); })();" : ""}
        ${assertNoApiFetch ? "const key = 'pc-supporter-offline-capture-api-attempts'; let attempts = []; try { const saved = JSON.parse(sessionStorage.getItem(key) ?? '[]'); if (Array.isArray(saved)) attempts = saved; } catch {} window.__pcSupporterApiFetchAttempts = attempts; const nativeFetch = window.fetch.bind(window); window.fetch = (input, init) => { const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input); let url; try { url = new URL(rawUrl, location.href); } catch { return nativeFetch(input, init); } if (url.pathname === '/api' || url.pathname.startsWith('/api/')) { const attempt = { method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname }; window.__pcSupporterApiFetchAttempts.push(attempt); try { sessionStorage.setItem(key, JSON.stringify(window.__pcSupporterApiFetchAttempts)); } catch {} return Promise.reject(new TypeError('API fetch blocked by offline capture assertion')); } return nativeFetch(input, init); };" : ""}
      })();`
    });
  }
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "캡처 앱 초기화");
  if (captureTheme === "dark") {
    await clickButton(client, "다크 모드");
    await waitForValueWithTimeout(client, "document.documentElement.dataset.theme === 'dark'", "다크 테마 적용");
  }
  const desktop = await runFlow(client, { prefix: "desktop", viewport: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false } });
  const desktopOfflineCoreFlow = assertNoApiFetch ? await captureOfflineCoreFlow(client, "desktop") : undefined;
  const emptyBranches = () => ({ work: [], budget: [], spec: [], upgrade: [], later: [] });
  const desktopBranches = captureCoreOnly ? emptyBranches() : await runRepresentativeBranches(client, { prefix: "desktop", viewport: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false } });
  await client.evaluate("(() => { const key = 'pc-supporter-offline-capture-api-attempts'; const attempts = sessionStorage.getItem(key); sessionStorage.clear(); if (attempts) sessionStorage.setItem(key, attempts); })()");
  await client.send("Page.navigate", { url: `${baseUrl}/start` });
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "모바일 캡처 앱 초기화");
  const mobile = await runFlow(client, { prefix: "mobile", viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } });
  const mobileOfflineCoreFlow = assertNoApiFetch ? await captureOfflineCoreFlow(client, "mobile") : undefined;
  const mobileBranches = captureCoreOnly ? emptyBranches() : await runRepresentativeBranches(client, { prefix: "mobile", viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } });
  const mobileHomeBuild = captureCoreOnly ? undefined : await captureMobileHomeBuildSummary(client);
  let mobileHomeBuildDark;
  if (!captureCoreOnly && captureTheme === "dark") {
    mobileHomeBuildDark = await captureMobileHomeBuildSummary(client, "mobile-home-dark", { reuseCurrentBuild: true });
  } else if (!captureCoreOnly) {
    await clickButton(client, "다크 모드");
    await waitForValueWithTimeout(client, "document.documentElement.dataset.theme === 'dark'", "모바일 홈 다크 테마");
    mobileHomeBuildDark = await captureMobileHomeBuildSummary(client, "mobile-home-dark", { reuseCurrentBuild: true });
    await clickButton(client, "라이트 모드");
    await waitForValueWithTimeout(client, "document.documentElement.dataset.theme === 'light'", "라이트 테마 복원");
  }
  const offlineMode = await client.evaluate("document.querySelector('.offline-local-mode-banner') !== null");
  const storageUnavailableVisible = await client.evaluate("document.querySelector('[data-testid=storage-health-notice]') !== null");
  const localStorageActuallyDenied = denyLocalStorage ? await client.evaluate("(() => { try { void window.localStorage; return false; } catch { return true; } })()") : undefined;
  const corruptDraftPreserved = corruptDraftBackupFailure ? corruptDraftPreservedBeforeExport : undefined;
  const draftBackupFailureNoticeVisible = corruptDraftBackupFailure ? draftBackupFailureNoticeWasVisible : undefined;
  const mobilePriceWatchlist = offlineMode ? undefined : await captureMobilePriceWatchlist(client);
  const blockedApiFetchAttempts = assertNoApiFetch ? await client.evaluate("JSON.parse(sessionStorage.getItem('pc-supporter-offline-capture-api-attempts') ?? '[]')") : undefined;
  if (assertNoApiFetch && (!offlineMode || !Array.isArray(blockedApiFetchAttempts) || blockedApiFetchAttempts.length !== 0)) {
    throw new Error(`local offline runtime attempted API network fetches. attempts=${JSON.stringify(blockedApiFetchAttempts)}`);
  }
  if (denyLocalStorage && (!localStorageActuallyDenied || !storageUnavailableVisible)) throw new Error("The localStorage denial scenario did not reach the visible storage-degraded state.");
  if (corruptDraftBackupFailure && (!corruptDraftPreserved || !draftBackupFailureNoticeVisible || !corruptDraftWasExported || !corruptDraftReplacedAfterExport)) {
    throw new Error(`Corrupt draft recovery contract failed. preserved=${corruptDraftPreserved}; notice=${draftBackupFailureNoticeVisible}; exported=${corruptDraftWasExported}; replaced=${corruptDraftReplacedAfterExport}`);
  }
  const manifest = { generatedAt: new Date().toISOString(), baseUrl, theme: captureTheme, offlineMode, coreOnly: captureCoreOnly, ...(denyLocalStorage ? { localStorageDenied: localStorageActuallyDenied, storageUnavailableVisible } : {}), ...(corruptDraftBackupFailure ? { corruptDraftPreservedBeforeExport: corruptDraftPreserved, draftBackupFailureNoticeVisible, corruptDraftExported: corruptDraftWasExported, draftReplacedAfterExport: corruptDraftReplacedAfterExport } : {}), ...(assertNoApiFetch ? { blockedApiFetchAttempts, offlineCoreFlow: { desktop: desktopOfflineCoreFlow, mobile: mobileOfflineCoreFlow } } : {}), desktopViewport: { width: 1280, height: 900 }, mobileViewport: { width: 390, height: 844 }, desktop, mobile, desktopBranches, mobileBranches, ...(mobileHomeBuild ? { mobileHomeBuild } : {}), ...(mobileHomeBuildDark ? { mobileHomeBuildDark } : {}), ...(mobilePriceWatchlist ? { mobilePriceWatchlist } : {}) };
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
