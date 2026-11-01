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
  const stepTitles = { intent: "어떤 견적이 필요하세요?", mode: "어떤 기준으로 부품을 고를까요?", usecase: "주 용도", games: "주로 할 게임을 골라주세요", works: "주로 하는 작업", performance: "게임 성능 목표", graphics: "게임 옵션도 정해주세요", budget: "예산", summary: "선택 내용 확인", spec: "성능 목표" };
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
  const chooseNewTaskGaming = async () => {
    await waitForStep("intent", "첫 선택 화면");
    assert(bodyText().includes("새 PC 견적 보기") && bodyText().includes("쓰던 PC 업그레이드하기") && bodyText().includes("나중에 하기"), "첫 화면에 새 견적/업그레이드/나중에 선택지가 모두 표시되지 않았습니다.");
    await chooseAutoOption("새 PC 견적 보기", "mode", "새 견적 기준 화면");
    assert(bodyText().includes("예산에 맞는 게임 견적") && bodyText().includes("용도를 기준으로 고르기") && bodyText().includes("원하는 사양 직접 입력하기"), "새 견적 기준 선택지가 모두 표시되지 않았습니다.");
    assert(bodyText().includes("성능 등급과 그래픽/메모리/저장공간"), "성능을 직접 고르는 방식의 설명이 없습니다.");
    await chooseAutoOption("용도를 기준으로 고르기", "usecase", "용도 선택 화면");
    await chooseAutoOption("게임", "games", "게임 선택 화면");
  };
  const chooseNewTaskWork = async () => {
    await waitForStep("intent", "첫 선택 화면");
    await chooseAutoOption("새 PC 견적 보기", "mode", "새 견적 기준 화면");
    await chooseAutoOption("용도를 기준으로 고르기", "usecase", "용도 선택 화면");
    await chooseAutoOption("작업", "works", "작업 선택 화면");
  };
  const chooseNewBudget = async () => {
    await waitForStep("intent", "첫 선택 화면");
    await chooseAutoOption("새 PC 견적 보기", "mode", "새 견적 기준 화면");
    await chooseAutoOption("예산에 맞는 게임 견적", "budget", "예산 중심 화면");
  };
  const chooseNewSpec = async () => {
    await waitForStep("intent", "첫 선택 화면");
    await chooseAutoOption("새 PC 견적 보기", "mode", "새 견적 기준 화면");
    await chooseAutoOption("원하는 사양 직접 입력하기", "spec", "직접 성능 입력 화면");
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
  await chooseOption("사이버펑크 2077");
  clickButton("다음");
  await waitForStep("performance", "목표 성능 화면");
  assert(text(document.querySelector(".onboarding-title")) === "게임 성능 목표", "게임 목표 화면의 제목이 바뀌었습니다.");
  await chooseOption("QHD");
  await chooseOption("144 FPS");
  assert(bodyText().includes("사이버펑크 2077 / QHD / 목표 144 FPS"), "게임/해상도/목표 FPS 조건이 화면에 보존되지 않았습니다.");
  clickButton("다음");
  await waitForStep("graphics", "그래픽 옵션 화면");
  await chooseOption("높음");
  await chooseOption("업스케일링/품질");
  const qualityChecked = document.querySelector('input[name="onboarding-graphics-preset"][value="high"]')?.checked;
  const upscalingChecked = document.querySelector('input[name="onboarding-upscaling"][value="quality"]')?.checked;
  assert((qualityChecked === undefined || qualityChecked) && (upscalingChecked === undefined || upscalingChecked), "그래픽/업스케일링 선택이 반영되지 않았습니다.");
  assert(/예상 가격대\s*\d+만원\s*~\s*\d+만원/.test(bodyText().replace(/\n+/g, " ")), "그래픽 옵션 단계에 예상 가격대가 없습니다.");
  clickButton("다음 / 예산 정하기");
  await waitForStep("budget", "예산 화면");
  const gamingBudgetText = bodyText().replace(/\n+/g, " ").match(/예상 가격대\s*(\d+만원\s*~\s*\d+만원)/)?.[1] ?? "";
  assert(gamingBudgetText.length > 0, `게임 목표 가격 범위가 표시되지 않았습니다: ${bodyText().slice(0, 600)}`);
  const minimumBudgetAdjust = document.querySelector("[data-testid=onboarding-budget-range-adjust]");
  const raisedBudget = text(minimumBudgetAdjust).match(/(\d+)만원/)?.[1];
  assert(raisedBudget && text(minimumBudgetAdjust).includes("예산 올리기"), "예산이 예상 가격보다 낮을 때 바로 올리는 CTA가 없습니다.");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-edit-target]")) === "목표 성능 다시 고르기", "예산이 부족할 때 목표 성능을 다시 고르는 CTA가 없습니다.");
  const initialBudget = text(document.querySelector(".onboarding-budget-value"));
  clickButton("목표 성능 다시 고르기");
  await waitForStep("performance", "예산에서 목표 성능 변경 화면");
  assert(bodyText().includes("사이버펑크 2077 / QHD / 목표 144 FPS"), "목표 성능으로 돌아가도 기존 게임/화면 조건이 보존되지 않았습니다.");
  clickButton("다음");
  await waitForStep("graphics", "목표 성능 변경 후 그래픽 옵션 화면");
  clickButton("다음 / 예산 정하기");
  await waitForStep("budget", "목표 성능 변경 후 예산 복귀");
  assert(text(document.querySelector(".onboarding-budget-value")) === initialBudget, "목표 성능을 다시 골라도 기존 예산이 보존되지 않았습니다.");
  clickButton(text(document.querySelector("[data-testid=onboarding-budget-range-adjust]")));
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === `${raisedBudget}만원` || currentStep() === "summary", "예상 가격 하한 예산 자동 조정");
  if (currentStep() !== "summary") clickCta();
  await waitForStep("summary", "조건 요약 화면");
  const summaryText = bodyText();
  assert(summaryText.includes("사이버펑크 2077") && summaryText.includes("QHD / 144 FPS") && summaryText.includes(`${raisedBudget}만원`), "조건 요약에 선택한 게임/화면 목표/예산이 모두 보이지 않습니다.");
  assert([...document.querySelectorAll("button")].some((button) => text(button) === "예산 변경"), "요약 화면에서 예산을 바로 변경할 수 없습니다.");
  clickButton("예산 변경");
  await waitForStep("budget", "요약에서 예산 변경 화면");
  assert(text(document.querySelector(".onboarding-budget-value")) === `${raisedBudget}만원`, "요약에서 예산 변경 시 기존 금액이 보존되지 않았습니다.");
  clickCta();
  await waitForStep("summary", "예산 변경 후 조건 요약 화면");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("QHD / 144 FPS") && bodyText().includes(`${raisedBudget}만원`), "예산 변경 후 기존 게임/화면 목표 조건이 보존되지 않았습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend", "자동 구성 handoff 경로", 480);
  const gamingHandoffSearch = location.search;
  await waitFor(() => document.querySelector(".build-workspace-parts .component-card.selected") !== null, "자동 구성 결과 handoff", 480);
  const gamingQuery = new URLSearchParams(gamingHandoffSearch);
  assert(gamingQuery.get("profile") === "gaming" && gamingQuery.get("resolution") === "1440p" && gamingQuery.get("targetFps") === "144" && gamingQuery.get("games")?.includes("cyberpunk") && gamingQuery.get("graphics") === "high" && gamingQuery.get("upscaling") === "quality" && gamingQuery.get("budget") === `${raisedBudget}0000`, `게임 모드/게임/화면 목표/예산이 자동 구성 URL로 전달되지 않았습니다: ${gamingHandoffSearch} -> ${location.search}`);
  const gamingLineCount = assertHydratedResult("게임");
  assert(gamingLineCount >= 6, "자동 구성 결과에 게이밍 부품 라인이 없습니다.");
  assert(document.querySelector(".build-workspace .generator-rationale, .build-workspace .generator-analysis, .build-workspace .generator-selection-reasons, .build-workspace .generator-gaming-evidence, .build-workspace .generator-gpu-target") === null, "자동 구성 견적에 판정 근거 패널이 노출되고 있습니다.");
  const gaming = { path: location.pathname + location.search, budgetRange: gamingBudgetText, lineCount: gamingLineCount };

  await navigateStart();
  await chooseNewTaskGaming();
  await chooseOption("사이버펑크 2077", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 성능 목표", "낮은 예산 게임 목표 화면");
  await chooseOption("QHD", "다음");
  await chooseOption("144 FPS", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 옵션도 정해주세요", "낮은 예산 그래픽 옵션 화면");
  await chooseOption("높음", "다음 / 예산 정하기");
  await chooseOption("업스케일링/품질", "다음 / 예산 정하기");
  clickButton("다음 / 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산", "낮은 예산 선택 화면");
  assert(text(document.querySelector(".onboarding-budget-value")) === "200만원", "낮은 예산 시나리오에서 기본 200만원 예산이 보존되지 않았습니다.");
  clickButton("예상 구성 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "선택 내용 확인", "낮은 예산 조건 요약");
  assert(bodyText().includes("QHD / 144 FPS") && bodyText().includes("200만원") && bodyText().includes("예상 가격보다 낮아요"), "낮은 예산 조건 요약에서 QHD/144 FPS, 200만원, 예상 가격 미달 안내를 보존하지 않았습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend", "낮은 예산 자동 구성 경로", 480);
  const lowBudgetQuery = new URLSearchParams(location.search);
  assert(lowBudgetQuery.get("profile") === "gaming" && lowBudgetQuery.get("resolution") === "1440p" && lowBudgetQuery.get("targetFps") === "144" && lowBudgetQuery.get("budget") === "2000000", `낮은 예산 조건이 자동 구성 URL에 보존되지 않았습니다: ${location.href}`);
  await waitFor(() => document.querySelector(".build-workspace-parts .component-card.selected") !== null || document.querySelector('[role="alert"]') !== null, "낮은 예산 자동 구성 결과", 480);
  const gamingLowBudget = { path: location.pathname + location.search, outcome: document.querySelector('[role="alert"]') ? "recovery" : "built" };

  await navigateStart();
  await chooseNewTaskWork();
  assert(bodyText().includes("FHD/4K 컷 편집과 효과 작업") && bodyText().includes("모델링/씬 구성/반복 렌더링") && bodyText().includes("IDE/빌드/컨테이너/가상 머신"), "작업 종류 카드에 대표 사용 장면 설명이 없습니다.");
  await chooseOption("영상 편집");
  clickButton("다음");
  await waitFor(() => currentStep() === "intensity" || text(document.querySelector(".onboarding-title")).includes("영상 편집은 어느 정도 규모인가요?"), "작업 강도 화면");
  const intensityText = bodyText();
  assert(intensityText.includes("FHD/가벼운 컷 편집") && intensityText.includes("4K 편집/일반 효과") && intensityText.includes("4K/6K 편집/고급 효과") && intensityText.includes("64GB") && intensityText.includes("2TB SSD"), "작업 강도별 구체적인 예상 작업/사양이 표시되지 않았습니다.");
  await chooseAutoOption("heavy", "budget", "작업 예산 화면");
  const workEstimateText = bodyText();
  assert(workEstimateText.includes("4K/6K 편집/고급 효과") && workEstimateText.includes("64GB") && workEstimateText.includes("2TB SSD"), "작업 종류/강도에 맞는 구체적인 예상 사양이 없습니다.");
  await pickBudget("400만원");
  await waitForStep("summary", "작업 조건 요약 화면");
  assert(bodyText().includes("영상 편집") && bodyText().includes("무겁게") && bodyText().includes("4K/6K 편집/고급 효과"), "작업 조건 요약이 선택값을 보존하지 않았습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend", "작업 자동 구성 경로", 480);
  const workQuery = new URLSearchParams(location.search);
  await waitFor(() => document.querySelector(".build-workspace-parts .component-card.selected") !== null, "작업 자동 구성 handoff", 480);
  assert(workQuery.get("profile") === "creator" && workQuery.get("work") === "video" && workQuery.get("intensity") === "heavy" && workQuery.get("ram") === "64" && workQuery.get("ssd") === "2000" && workQuery.get("budget") === "4000000", `작업 모드/작업/강도/RAM/SSD/예산 조건이 자동 구성 URL에 보존되지 않았습니다: ${workQuery}`);
  const workLineCount = assertHydratedResult("작업");
  const work = { path: location.pathname + location.search, lineCount: workLineCount };

  await navigateStart();
  await chooseNewBudget();
  const budgetOnlyEstimate = bodyText();
  assert(budgetOnlyEstimate.includes("예산에 맞는 게임 구성") && budgetOnlyEstimate.includes("GPU 성능 우선"), "예산 중심 분기의 예상 사양이 표시되지 않았습니다.");
  await pickBudget("400만원");
  await waitForStep("summary", "예산 중심 요약 화면");
  assert(bodyText().includes("400만원") && bodyText().includes("예산에 맞는 게임 구성"), "예산 중심 요약에 예산/예상 수준이 보이지 않습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend", "예산 중심 자동 구성 경로", 480);
  const budgetQuery = new URLSearchParams(location.search);
  await waitFor(() => document.querySelector(".build-workspace-parts .component-card.selected") !== null, "예산 중심 자동 구성 handoff", 480);
  assert(budgetQuery.get("profile") === "gaming" && budgetQuery.get("gamingMode") === "budget" && budgetQuery.get("budget") === "4000000", `예산 모드/예산 조건이 자동 구성 URL에 보존되지 않았습니다: ${budgetQuery}`);
  const budgetLineCount = assertHydratedResult("예산");
  const budgetOnly = { path: location.pathname + location.search, lineCount: budgetLineCount };

  await navigateStart();
  await chooseNewSpec();
  await chooseOption("top");
  await chooseOption("64");
  await chooseOption("2000");
  clickButton("다음");
  await waitForStep("budget", "직접 성능 예산 화면");
  await pickBudget("220만원");
  await waitForStep("summary", "직접 성능 요약 화면");
  assert(bodyText().includes("최상급 성능") && bodyText().includes("외장 GPU 포함") && bodyText().includes("64GB / 2TB") && bodyText().includes("220만원") && bodyText().includes("예산이 부족해요"), "직접 성능 요약에 선택한 조건과 예산 부족 안내가 보이지 않습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend", "직접 성능 자동 구성 경로", 480);
  const specQuery = new URLSearchParams(location.search);
  assert(specQuery.get("profile") === "general" && specQuery.get("priority") === "performance" && specQuery.get("tier") === "top" && specQuery.get("ram") === "64" && specQuery.get("ssd") === "2000" && specQuery.get("budget") === "2200000" && specQuery.get("gpu") === null, `직접 성능 모드/등급/RAM/SSD/예산 조건이 자동 구성 URL에 보존되지 않았습니다: ${specQuery}`);
  await waitFor(() => document.querySelector('[role="alert"]') !== null || document.querySelector(".build-workspace-parts .component-card.selected") !== null, "직접 성능 예산 판정 handoff", 480);
  const specFailure = document.querySelector('[role="alert"]');
  let spec;
  if (specFailure) {
    assert(text(specFailure).length > 0, "예산 안에 구성이 없는 경우 진단을 표시하지 않았습니다.");
    spec = { path: location.pathname + location.search, budgetInfeasible: true };
  } else {
    const lineCount = assertHydratedResult("직접 성능");
    spec = { path: location.pathname + location.search, lineCount };
  }

  await navigateStart();
  await chooseNewBudget();
  await pickBudget("400만원");
  await waitForStep("summary", "요청 오류 경로 요약 화면");
  const originalFetch = window.fetch;
  let failedRecommendPosts = 0;
  let attemptedApiFetches = 0;
  window.fetch = async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (requestUrl.pathname.startsWith("/api/")) attemptedApiFetches += 1;
    if (method === "POST" && requestUrl.pathname === "/api/builds/recommend") {
      failedRecommendPosts += 1;
      return new Response(JSON.stringify({ error: "controlled smoke failure" }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
  let recommendationFailure;
  try {
    clickCta();
    await waitFor(() => location.pathname === "/recommend" && document.querySelector('.generator-request-error[role="alert"]') !== null, "자동 구성 API 실패 안내", 480);
    const failureAlert = text(document.querySelector('.generator-request-error[role="alert"]'));
    const failureQuery = new URLSearchParams(location.search);
    assert(failedRecommendPosts >= 1 && failedRecommendPosts <= 3, `일시적인 503 재시도는 최대 두 번으로 제한되어야 합니다: ${failedRecommendPosts}`);
    assert(failureAlert.includes("견적을 만들지 못했어요") && failureAlert.includes("입력한 내용은 남아 있어요"), "추천 API 실패 시 입력 보존/복구 안내가 표시되지 않았습니다.");
    assert(failureQuery.get("profile") === "gaming" && failureQuery.get("gamingMode") === "budget" && failureQuery.get("budget") === "4000000", `추천 요청 실패 후에도 입력 조건이 URL에 보존되어야 합니다: ${location.href}`);
    recommendationFailure = { path: location.pathname + location.search, alert: true, postCount: failedRecommendPosts };
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
  return { stage: "passed", gaming, gamingLowBudget, work, budgetOnly, spec, recommendationFailure, later, upgrade };
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
  await client.evaluate("localStorage.clear(); sessionStorage.clear()");
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
