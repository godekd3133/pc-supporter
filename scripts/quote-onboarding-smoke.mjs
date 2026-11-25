import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, sleep, waitForJson } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const timeoutMs = Number(process.env.QUOTE_ONBOARDING_SMOKE_TIMEOUT_MS ?? 120_000);
const reservedPorts = new Set([4174, 4176, 4178, 4179, 4180, 4199, 4200, 56647]);

async function smokePort() {
  let port = await freePort();
  while (reservedPorts.has(port)) port = await freePort();
  return port;
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
      // A Page.navigate can briefly destroy the current execution context.
      // Keep observing the same browser target until the new document is ready.
    }
    await sleep(25);
  }
  const diagnostic = await client.evaluate("JSON.stringify({ href: location.href, body: (document.body?.innerText ?? '').slice(-1600) })").catch(() => "브라우저 상태를 읽지 못했습니다.");
  throw new Error(`${label}을(를) ${timeoutMs}ms 안에 확인하지 못했습니다. state=${diagnostic}`);
}

const smokeExpression = `(${async function runQuoteOnboardingSmoke() {
  const errors = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  window.addEventListener("error", (event) => errors.push(String(event.error?.stack ?? event.message ?? "error").slice(0, 500)));
  window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason?.stack ?? event.reason ?? "unhandled rejection").slice(0, 500)));
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const text = (node) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
  const bodyText = () => document.body?.innerText ?? "";
  const waitFor = async (predicate, label, limit = 240) => {
    for (let index = 0; index < limit; index += 1) {
      if (predicate()) return;
      await wait(25);
    }
    throw new Error(`${label} 대기 시간 초과: ${bodyText().slice(-800)}`);
  };
  const currentStep = () => document.querySelector(".onboarding-page")?.getAttribute("data-onboarding-step") ?? "";
  const stepTitles = { intent: "어떤 견적이 필요하세요?", usecase: "어떤 용도로 쓰실 건가요?", gameTypes: "어떤 종류의 게임들을 하시나요?", gamingBudget: "해상도와 예산을 골라주세요", works: "주로 하는 작업", budget: "예산", summary: "선택 내용 확인" };
  const waitForStep = (step, label) => waitFor(() => currentStep() === step || text(document.querySelector(".onboarding-title")) === stepTitles[step], label);
  const clickButton = (needle) => {
    const button = [...document.querySelectorAll("button")].find((candidate) => !candidate.disabled && (candidate.textContent ?? "").replace(/\s+/g, " ").includes(needle));
    if (button instanceof HTMLButtonElement) {
      button.click();
      return;
    }
    const option = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')].find((candidate) => {
      if (!(candidate instanceof HTMLInputElement) || candidate.disabled) return false;
      return candidate.value === needle || text(candidate.labels?.[0]).includes(needle);
    });
    if (option instanceof HTMLInputElement) {
      option.click();
      return;
    }
    const candidates = [...document.querySelectorAll("button, input[type=radio], input[type=checkbox]")].map((el) => (el instanceof HTMLButtonElement ? el.textContent : el instanceof HTMLInputElement ? (el.value || (el.labels?.[0]?.textContent ?? "")) : "") ?? "").map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40);
    throw new Error(`버튼 또는 선택지를 찾지 못했습니다: ${needle} (step=${currentStep()}) | 후보=${JSON.stringify(candidates)}`);
  };
  const clickCta = () => {
    const cta = document.querySelector(".onboarding-cta");
    if (!(cta instanceof HTMLButtonElement) || cta.disabled) throw new Error("활성화된 온보딩 CTA를 찾지 못했습니다.");
    cta.click();
  };
  const waitForCta = async () => {
    await waitFor(() => [...document.querySelectorAll(".onboarding-cta")].some((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled), "온보딩 CTA 활성화");
  };
  const chooseOption = async (option) => {
    clickButton(option);
    await waitForCta();
  };
  // 단일 선택 스텝은 선택 즉시 자동 진행한다 — CTA 활성화를 기다리는 대신
  // 다음 스텝 화면을 바로 기다린다.
  const chooseAutoOption = async (option, nextStep, nextLabel) => {
    clickButton(option);
    await waitForStep(nextStep, nextLabel);
  };
  // Quick budget stops can move straight to the summary step; confirm only when still on the budget step.
  const pickBudget = async (label) => {
    clickButton(label);
    await wait(400);
    if (currentStep() !== "summary") clickCta();
  };
  const assertHydratedResult = (branch) => {
    const result = document.querySelector(".build-workspace-parts");
    const lines = [...document.querySelectorAll(".build-workspace-parts .component-card.selected")];
    assert(result && lines.length >= 6, `${branch} 분기에서 추천 결과와 부품 라인이 hydration되지 않았습니다: ${lines.length}개`);
    // A cooler card in the "CPU 기본 포함" state is selected but has no separate product line.
    assert(lines.filter((line) => !(line.textContent ?? "").includes("CPU 기본 포함")).every((line) => (line.querySelector("strong")?.textContent ?? "").trim().length > 0 && /원|가격 확인 중/.test(line.textContent ?? "")), `${branch} 분기 추천 결과의 부품명·가격 정보가 불완전합니다.`);
    return lines.length;
  };
  const navigateStart = async () => {
    sessionStorage.clear();
    if (location.pathname === "/start") {
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await waitFor(() => location.pathname === "/" && document.querySelector(".home-page") !== null, "온보딩 상태 초기화 홈 이동");
    }
    history.pushState({}, "", "/start");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "온보딩 시작 화면");
  };
  // 575c021부터: 의도 → 용도(사무/게임/작업). 게임은 게임 종류 → 해상도·예산 3단 → /build 견본 견적,
  // 사무는 바로 /build 견본 견적, 작업은 작업 → 강도 → 예산 → 요약 → /build 견본 견적이다.
  const chooseNewUsecase = async () => {
    await waitForStep("intent", "첫 선택 화면");
    assert(bodyText().includes("새 PC 견적 보기") && bodyText().includes("쓰던 PC 업그레이드하기") && bodyText().includes("나중에 하기"), "첫 화면에 새 견적/업그레이드/나중에 선택지가 모두 보이지 않습니다.");
    await chooseAutoOption("new", "usecase", "용도 선택 화면");
    assert(bodyText().includes("가벼운 사무") && bodyText().includes("게임") && bodyText().includes("작업"), "용도 선택지(사무/게임/작업)가 모두 보이지 않습니다.");
  };
  const chooseNewTaskGaming = async () => {
    await chooseNewUsecase();
    await chooseAutoOption("gaming", "gameTypes", "게임 종류 화면");
  };
  const chooseNewTaskWork = async () => {
    await chooseNewUsecase();
    await chooseAutoOption("work", "works", "작업 선택 화면");
  };
  // 견본 견적은 카탈로그에서 부품을 찾아 채운다. CI 고정 카탈로그에는 견본 부품 일부만 있어
  // 라인 수 대신 /build 이동, 견본 견적 제목, 최소 한 개의 채워진 부품을 handoff 근거로 본다.
  const filledLines = () => [...document.querySelectorAll(".build-workspace-parts .component-card.selected")].filter((line) => (line.querySelector("strong")?.textContent ?? "").trim().length > 0);
  const waitForSampleBuild = async (label) => {
    await waitFor(() => location.pathname === "/build" && filledLines().length >= 1 && bodyText().includes("견적 금액"), label, 480);
  };

  await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "온보딩 초기 화면");
  const onboardingProgress = document.querySelector("[data-testid=onboarding-progress]");
  assert(onboardingProgress?.getAttribute("role") === "progressbar" && onboardingProgress?.getAttribute("aria-valuenow") === "1", "첫 온보딩 화면에 단계 진행 표시가 없습니다.");
  history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => location.pathname === "/" && document.querySelector("[data-testid=home-guided-entry]") !== null, "첫 사용자 홈 화면");
  const guidedHome = document.querySelector("[data-testid=home-guided-entry]");
  const guidedHomeText = text(guidedHome);
  assert(guidedHome && guidedHomeText.includes("용도와 예산 선택") && guidedHomeText.includes("게임 / 작업") && guidedHomeText.includes("원하는 금액"), `부품을 고르지 않은 첫 사용자가 견적 시작 안내를 보지 못했습니다: ${JSON.stringify({ guided: Boolean(guidedHome), guidedHomeText, body: bodyText().slice(0, 900) })}`);
  assert((document.querySelector(".hero-secondary-action")?.textContent ?? "").includes("부품을 직접 선택하기") && /부품(을 )?직접 선택하기|부품 선택하기/.test(text(document.querySelector("[data-testid=mobile-home-recommend]"))), "첫 사용자 홈의 보조 진입이 부품 직접 선택으로 이어지지 않습니다.");
  if (window.innerWidth <= 760) {
    const mobileGuidedHome = document.querySelector("[data-testid=mobile-home-guided-entry]");
    const mobileGuidedHomeText = text(mobileGuidedHome);
    assert(mobileGuidedHome && mobileGuidedHomeText.includes("용도와 예산부터") && mobileGuidedHomeText.includes("호환 결과까지 확인"), "모바일 첫 사용자 홈에 견적 시작 안내가 없습니다.");
    const mobileSteps = mobileGuidedHome.querySelectorAll(".mobile-guided-steps li");
    if (mobileSteps.length > 0) assert(mobileSteps.length === 3 && /게임.?작업 용도/.test(mobileGuidedHomeText), "모바일 견적 진행 순서가 세 단계로 설명되지 않습니다.");
  }
  history.pushState({}, "", "/start");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "첫 사용자 홈에서 온보딩 진입");
  await chooseNewTaskGaming();
  const gameTypeText = bodyText();
  assert(gameTypeText.includes("스팀 콘솔게임") && gameTypeText.includes("인기 게임") && gameTypeText.includes("저사양 온라인 게임"), "게임 종류 선택지가 모두 보이지 않습니다.");
  await chooseOption("모던 워페어");
  clickCta();
  await waitForStep("gamingBudget", "해상도·예산 화면");
  clickButton("QHD");
  await waitFor(() => document.querySelector('input[type="radio"]:checked') !== null && text(document.querySelector('input[type="radio"]:checked')?.labels?.[0]) === "QHD", "QHD 해상도 선택");
  await waitFor(() => document.querySelectorAll(".onboarding-tier-button").length === 3 && [...document.querySelectorAll(".onboarding-tier-button")].every((tier) => /만원/.test(text(tier))), "예산 3단 가격", 480);
  const tiers = [...document.querySelectorAll(".onboarding-tier-button")].map((tier) => text(tier));
  assert(tiers[0].includes("저예산") && tiers[1].includes("가성비") && tiers[2].includes("고성능"), `예산 3단(저예산/가성비/고성능)이 표시되지 않았습니다: ${JSON.stringify(tiers)}`);
  [...document.querySelectorAll(".onboarding-tier-button")][1].click();
  await waitForSampleBuild("게임 견본 견적 handoff");
  assert(bodyText().includes("QHD") && bodyText().includes("게이밍 견적"), "선택한 해상도/게임 용도가 견적 제목에 반영되지 않았습니다.");
  assert(filledLines().some((line) => (line.textContent ?? "").includes("그래픽카드") || /RTX|RX\s?\d/.test(line.textContent ?? "")), "게임 견본 견적에 그래픽카드가 채워지지 않았습니다.");
  const gaming = { path: location.pathname + location.search, tiers, lineCount: filledLines().length };

  await navigateStart();
  await chooseNewUsecase();
  clickButton("office");
  await waitForSampleBuild("사무 견본 견적 handoff");
  const office = { path: location.pathname + location.search, lineCount: filledLines().length };

  await navigateStart();
  await chooseNewTaskWork();
  assert(bodyText().includes("FHD/4K 컷 편집과 효과 작업") && bodyText().includes("모델링/씬 구성/반복 렌더링") && bodyText().includes("IDE/빌드/컨테이너/가상 머신"), "작업 종류 카드에 대표 작업 설명이 없습니다.");
  await chooseOption("영상 편집");
  clickButton("다음");
  await waitFor(() => currentStep() === "intensity" || text(document.querySelector(".onboarding-title")).includes("영상 편집은 어느 정도 규모인가요?"), "작업 강도 화면");
  const intensityText = bodyText();
  assert(intensityText.includes("FHD/가벼운 컷 편집") && intensityText.includes("4K 편집/일반 효과") && intensityText.includes("4K/6K 편집/고급 효과") && intensityText.includes("64GB"), "작업 강도별 예상 사양이 없습니다.");
  await chooseAutoOption("heavy", "budget", "작업 예산 화면");
  const workEstimateText = bodyText();
  assert(workEstimateText.includes("4K/6K 편집/고급 효과") && workEstimateText.includes("64GB") && workEstimateText.includes("2TB SSD"), "작업 종류/강도에 맞는 구체적인 예상 사양이 없습니다.");
  await pickBudget("400만원");
  await waitForStep("summary", "작업 조건 요약 화면");
  assert(bodyText().includes("영상 편집") && bodyText().includes("무겁게") && bodyText().includes("4K/6K 편집/고급 효과"), "작업 조건 요약이 선택값을 보존하지 않았습니다.");
  assert(bodyText().includes("견적") && bodyText().includes("보여드려요"), "작업 요약에 예산에 맞춘 견본 견적 안내가 없습니다.");
  clickCta();
  await waitForSampleBuild("작업 견본 견적 handoff");
  const work = { path: location.pathname + location.search, lineCount: filledLines().length };

  await navigateStart();
  await chooseNewTaskWork();
  await chooseOption("영상 편집");
  clickButton("다음");
  await waitFor(() => currentStep() === "intensity", "요청 오류 경로 작업 강도 화면");
  await chooseAutoOption("heavy", "budget", "요청 오류 경로 예산 화면");
  await pickBudget("400만원");
  await waitForStep("summary", "요청 오류 경로 요약 화면");
  const originalFetch = window.fetch;
  let failedSampleBuildRequests = 0;
  window.fetch = async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
    if (requestUrl.pathname.startsWith("/api/sample-builds")) {
      failedSampleBuildRequests += 1;
      return new Response(JSON.stringify({ error: "controlled smoke failure" }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
  let recommendationFailure;
  try {
    clickCta();
    await waitFor(() => failedSampleBuildRequests > 0 && [...document.querySelectorAll('[role="alert"]')].some((alert) => text(alert).includes("견적 정보를 불러오지 못했어요")), "견본 견적 API 실패 안내", 480);
    assert(location.pathname === "/start" && currentStep() === "summary", `견본 견적 요청 실패 시 입력한 요약 화면에 머물러야 합니다: ${location.pathname} / ${currentStep()}`);
    assert(bodyText().includes("영상 편집") && bodyText().includes("400만원"), "견본 견적 요청 실패 후 입력 조건이 보존되지 않았습니다.");
    recommendationFailure = { path: location.pathname, step: currentStep(), alert: true, requestCount: failedSampleBuildRequests };
  } finally {
    window.fetch = originalFetch;
  }

  await navigateStart();
  await waitForStep("intent", "나중에 선택 초기 화면");
  // "나중에 하기"는 선택 즉시 홈으로 돌아간다 — 별도 CTA가 없다.
  clickButton("나중에 하기");
  await waitFor(() => location.pathname === "/" && document.querySelector(".home-page") !== null, "나중에 선택 후 홈 이동");
  const later = { path: location.pathname, home: true };

  await navigateStart();
  await waitForStep("intent", "업그레이드 초기 화면");
  clickButton("쓰던 PC 업그레이드하기");
  await waitFor(() => currentStep() === "upgrade" && document.querySelector(".onboarding-steps-list") !== null, "업그레이드 안내 자동 진행");
  clickButton("현재 부품 고르기");
  await waitFor(() => location.pathname === "/build" && new URLSearchParams(location.search).get("entry") === "upgrade", "업그레이드 편집기 handoff");
  const upgrade = { path: location.pathname + location.search, entry: "upgrade" };

  if (errors.length > 0) throw new Error(`온보딩 브라우저 오류: ${errors.join(" | ")}`);
  return { stage: "passed", gaming, office, work, recommendationFailure, later, upgrade };
}.toString()})()`;

const chromePath = await firstAvailable([
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean));
if (!chromePath) throw new Error("Chrome 또는 Chromium 실행 파일을 찾지 못했습니다.");

const port = await smokePort();
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-quote-onboarding-smoke-"));
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
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "온보딩 Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("온보딩 Chrome target을 찾지 못했습니다.");
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "온보딩 앱 초기화");
  const desktopResult = await client.evaluate(smokeExpression);
  assert(desktopResult?.stage === "passed", `데스크톱 온보딩 smoke가 통과하지 못했습니다: ${JSON.stringify(desktopResult)}`);

  // The mobile pass replays the first-visit flow, so drop the draft the desktop pass left behind.
  // Leave the app first: a live page can write its in-memory draft back after localStorage.clear().
  await client.send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await client.send("Storage.clearDataForOrigin", { origin: new URL(baseUrl).origin, storageTypes: "local_storage,session_storage" });
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await client.send("Page.navigate", { url: `${baseUrl}/start` });
  await sleep(350);
  await waitForValueWithTimeout(client, "location.pathname === '/start' && document.querySelector('.onboarding-page') !== null", "모바일 온보딩 앱 초기화");
  const mobileResult = await client.evaluate(smokeExpression);
  assert(mobileResult?.stage === "passed", `모바일 온보딩 smoke가 통과하지 못했습니다: ${JSON.stringify(mobileResult)}`);
  const mobileMetrics = await client.evaluate(`(() => {
    const viewportWidth = window.innerWidth;
    const overflowing = [...document.querySelectorAll("*")]
      .filter((element) => element.getBoundingClientRect().right > viewportWidth + 1)
      .slice(0, 10)
      .map((element) => ({ tag: element.tagName, className: typeof element.className === "string" ? element.className : "", right: element.getBoundingClientRect().right }));
    return { innerWidth: viewportWidth, bodyScrollWidth: document.body.scrollWidth, documentScrollWidth: document.documentElement.scrollWidth, overflowing };
  })()`);
  assert(mobileMetrics.innerWidth === 390 && mobileMetrics.bodyScrollWidth === 390 && mobileMetrics.documentScrollWidth === 390 && mobileMetrics.overflowing.length === 0, `모바일 온보딩 overflow가 확인되었습니다: ${JSON.stringify(mobileMetrics)}`);
  await client.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
  console.log(JSON.stringify({ stage: "passed", desktop: desktopResult, mobile: { ...mobileResult, metrics: mobileMetrics } }));
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome, "SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
