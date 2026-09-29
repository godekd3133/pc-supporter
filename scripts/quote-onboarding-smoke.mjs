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
  const stepTitles = { intent: "어떤 PC 견적을 볼까요?", mode: "어떤 기준으로 부품을 고를까요?", usecase: "어떤 용도로 쓸 PC인가요?", games: "주로 할 게임을 골라주세요", works: "주로 하는 작업을 골라주세요", performance: "게임 성능 목표를 정해주세요", graphics: "게임 옵션도 정해주세요", budget: "예산을 정해주세요", summary: "견적 내용을 확인하세요", spec: "성능 목표를 정하세요" };
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
    throw new Error(`버튼 또는 선택지를 찾지 못했습니다: ${needle}`);
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
  const assertHydratedResult = (branch) => {
    const result = document.querySelector(".generator-result");
    const lines = [...document.querySelectorAll(".generator-result .generator-line")];
    assert(result && lines.length >= 6, `${branch} 분기에서 추천 결과와 부품 라인이 hydration되지 않았습니다: ${lines.length}개`);
    assert(lines.every((line) => (line.querySelector("strong")?.textContent ?? "").trim().length > 0 && /원|가격 확인 중/.test(line.textContent ?? "")), `${branch} 분기 추천 결과의 부품명·가격 정보가 불완전합니다.`);
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
  const chooseNewTaskGaming = async () => {
    await waitForStep("intent", "첫 선택 화면");
    assert(bodyText().includes("새 PC 견적 보기") && bodyText().includes("쓰던 PC 업그레이드하기") && bodyText().includes("나중에 하기"), "첫 화면에 새 견적·업그레이드·나중에 선택지가 모두 표시되지 않았습니다.");
    await chooseOption("새 PC 견적 보기");
    clickCta();
    await waitForStep("mode", "새 견적 기준 화면");
    assert(bodyText().includes("예산을 기준으로 고르기") && bodyText().includes("게임·작업을 기준으로 고르기") && bodyText().includes("원하는 사양 직접 입력하기"), "새 견적 기준 선택지가 모두 표시되지 않았습니다.");
    assert(bodyText().includes("성능 등급과 그래픽·메모리·저장공간"), "성능을 직접 고르는 방식의 설명이 없습니다.");
    await chooseOption("게임·작업을 기준으로 고르기");
    clickCta();
    await waitForStep("usecase", "용도 선택 화면");
    await chooseOption("게임");
    clickCta();
    await waitForStep("games", "게임 선택 화면");
  };
  const chooseNewTaskWork = async () => {
    await waitForStep("intent", "첫 선택 화면");
    await chooseOption("새 PC 견적 보기");
    clickCta();
    await waitForStep("mode", "새 견적 기준 화면");
    await chooseOption("게임·작업을 기준으로 고르기");
    clickCta();
    await waitForStep("usecase", "용도 선택 화면");
    await chooseOption("작업");
    clickCta();
    await waitForStep("works", "작업 선택 화면");
  };
  const chooseNewBudget = async () => {
    await waitForStep("intent", "첫 선택 화면");
    await chooseOption("새 PC 견적 보기");
    clickCta();
    await waitForStep("mode", "새 견적 기준 화면");
    await chooseOption("예산을 기준으로 고르기");
    clickCta();
    await waitForStep("budget", "예산 중심 화면");
  };
  const chooseNewSpec = async () => {
    await waitForStep("intent", "첫 선택 화면");
    await chooseOption("새 PC 견적 보기");
    clickCta();
    await waitForStep("mode", "새 견적 기준 화면");
    await chooseOption("원하는 사양 직접 입력하기");
    clickCta();
    await waitForStep("spec", "직접 성능 입력 화면");
  };
  };

  await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "온보딩 초기 화면");
  const onboardingProgress = document.querySelector("[data-testid=onboarding-progress]");
  assert(onboardingProgress?.getAttribute("role") === "progressbar" && onboardingProgress?.getAttribute("aria-valuenow") === "1", "첫 온보딩 화면에 단계 진행 표시가 없습니다.");
  history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => location.pathname === "/" && document.querySelector("[data-testid=home-guided-entry]") !== null, "첫 사용자 홈 화면");
  const guidedHome = document.querySelector("[data-testid=home-guided-entry]");
  const guidedHomeText = text(guidedHome);
  assert(guidedHome && guidedHomeText.includes("용도와 예산 선택") && guidedHomeText.includes("게임 · 작업") && guidedHomeText.includes("원하는 금액"), `부품을 고르지 않은 첫 사용자가 견적 시작 안내를 보지 못했습니다: ${JSON.stringify({ guided: Boolean(guidedHome), guidedHomeText, body: bodyText().slice(0, 900) })}`);
  assert((document.querySelector(".hero-secondary-action")?.textContent ?? "").includes("부품을 직접 선택하기") && /부품(을 )?직접 선택하기|부품 선택하기/.test(text(document.querySelector("[data-testid=mobile-home-recommend]"))), "첫 사용자 홈의 보조 진입이 부품 직접 선택으로 이어지지 않습니다.");
  if (window.innerWidth <= 760) {
    const mobileGuidedHome = document.querySelector("[data-testid=mobile-home-guided-entry]");
    const mobileGuidedHomeText = text(mobileGuidedHome);
    assert(mobileGuidedHome && mobileGuidedHomeText.includes("용도와 예산으로") && mobileGuidedHomeText.includes("PC 견적을 구성합니다."), "모바일 첫 사용자 홈에 견적 시작 안내가 없습니다.");
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
  assert(text(document.querySelector(".onboarding-title")) === "게임 성능 목표를 정해주세요", "게임 목표 화면의 제목이 바뀌었습니다.");
  await chooseOption("4K");
  await chooseOption("144Hz");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("희망 주사율 144Hz"), "게임·해상도·희망 주사율 조건이 화면에 보존되지 않았습니다.");
  const performanceTargetNote = text(document.querySelector(".onboarding-callout"));
  assert(bodyText().includes("실제 게임 FPS를 보장하지 않아요") || (performanceTargetNote.includes("견적 목표") && performanceTargetNote.includes("실제 게임 프레임") && performanceTargetNote.includes("달라질 수")), "희망 주사율이 실제 게임 FPS 보장과 구분되지 않았습니다.");
  clickButton("다음");
  await waitForStep("graphics", "그래픽 옵션 화면");
  await chooseOption("높음");
  await chooseOption("DLSS·품질 참고");
  const graphicsTarget = document.querySelector('[aria-label="게이밍 성능 목표 기준"]');
  const graphicsNotes = [...document.querySelectorAll(".onboarding-choice-note")];
  const referencePriceNotes = [...document.querySelectorAll(".onboarding-note")].map(text);
  const qualityChecked = document.querySelector('input[name="onboarding-graphics-preset"][value="high"]')?.checked;
  const upscalingChecked = document.querySelector('input[name="onboarding-upscaling"][value="quality"]')?.checked;
  assert((qualityChecked === undefined || qualityChecked) && (upscalingChecked === undefined || upscalingChecked) && (graphicsNotes.length === 0 || graphicsNotes.length >= 2) && ((graphicsTarget && text(graphicsTarget).includes("144Hz")) || bodyText().includes("희망 주사율 144Hz")), "그래픽·업스케일링 선택과 성능 목표 기준이 표시되지 않았습니다.");
  assert(bodyText().includes("시각 효과 우선") || graphicsNotes.some((note) => text(note).includes("화질 저하를 줄이면서 프레임 부담을 낮추는")), "그래픽 품질·업스케일링 선택 의미가 설명되지 않았습니다.");
  assert((bodyText().includes("희망 주사율") && bodyText().includes("PC 가격대") && bodyText().includes("실시간 가격·재고는 반영되지 않아요")) || (text(graphicsTarget).includes("희망 주사율") && text(graphicsTarget).includes("예상 PC 가격대") && referencePriceNotes.some((note) => note.includes("실시간 가격·재고"))), "희망 주사율과 참고 가격의 한계가 선택 단계에 표시되지 않았습니다.");
  clickButton("다음 · 예산 정하기");
  await waitForStep("budget", "예산 화면");
  assert(/450만원/.test(text(document.querySelector("[data-testid=onboarding-budget-range-adjust]"))), "예산이 권장 범위보다 낮을 때 바로 조정하는 CTA가 없습니다.");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-edit-target]")) === "목표 성능 다시 고르기", "예산이 부족할 때 목표 성능을 다시 고르는 CTA가 없습니다.");
  clickButton("목표 성능 다시 고르기");
  await waitForStep("performance", "예산에서 목표 성능 변경 화면");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("4K") && bodyText().includes("희망 주사율 144Hz"), "주사율 변경 후 기존 게임·희망 주사율 조건이 보존되지 않았습니다.");
  clickButton("다음");
  await waitForStep("graphics", "목표 성능 변경 후 그래픽 옵션 화면");
  clickButton("다음 · 예산 정하기");
  await waitForStep("budget", "목표 성능 변경 후 예산 복귀");
  assert(text(document.querySelector(".onboarding-budget-value")) === "200만원", "목표 성능을 다시 골라도 기존 예산이 보존되지 않았습니다.");
  const minimumBudgetAdjust = document.querySelector("[data-testid=onboarding-budget-range-adjust]");
  assert(/450만원/.test(text(minimumBudgetAdjust)), "권장 최저 예산으로 조정하는 CTA가 없습니다.");
  clickButton(text(minimumBudgetAdjust));
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "450만원", "권장 최저 예산 자동 조정");
  clickButton("500만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "500만원", "예산 선택 반영");
  const gamingBudgetCard = document.querySelector('[aria-label="목표별 예상 가격대"]');
  const gamingBudgetText = text(gamingBudgetCard) || text(document.querySelector(".onboarding-budget-range"));
  assert(/가격대\s*\d+만원\s*~\s*\d+만원/.test(gamingBudgetText) || (gamingBudgetText.includes("예상 PC 가격대") && gamingBudgetText.includes("만원") && gamingBudgetText.includes("~")), `게임 목표 가격 범위가 표시되지 않았습니다: ${gamingBudgetText}`);
  assert(text(document.querySelector(".onboarding-estimate")).includes("4K · 144Hz 주사율 목표") || text(document.querySelector(".onboarding-pill")).includes("4K") && text(document.querySelector(".onboarding-pill")).includes("144Hz"), "예산 단계에서 선택한 화면 목표가 보존되지 않았습니다.");
  clickButton("600만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "600만원", "여유 예산 선택 반영");
  const maximumBudgetAdjust = text(document.querySelector("[data-testid=onboarding-budget-range-adjust]"));
  assert(/530만원/.test(maximumBudgetAdjust), "예산이 권장 범위보다 높을 때 상한 조정 CTA가 없습니다.");
  clickButton(maximumBudgetAdjust);
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "530만원", "권장 상한 예산 자동 조정");
  clickButton("500만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "500만원", "권장 범위 예산 복귀");
  clickCta();
  await waitForStep("summary", "조건 요약 화면");
  const summaryText = bodyText();
  assert(summaryText.includes("사이버펑크 2077") && summaryText.includes("4K · 144Hz") && summaryText.includes("500만원"), "조건 요약에 선택한 게임·화면 목표·예산이 모두 보이지 않습니다.");
  assert([...document.querySelectorAll(".onboarding-summary-edit")].some((button) => text(button) === "예산 변경"), "요약 화면에서 예산을 바로 변경할 수 없습니다.");
  clickButton("예산 변경");
  await waitForStep("budget", "요약에서 예산 변경 화면");
  assert(text(document.querySelector(".onboarding-budget-value")) === "500만원", "요약에서 예산 변경 시 기존 금액이 보존되지 않았습니다.");
  clickCta();
  await waitForStep("summary", "예산 변경 후 조건 요약 화면");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("4K · 144Hz") && bodyText().includes("500만원"), "예산 변경 후 기존 게임·화면 목표 조건이 보존되지 않았습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "자동 구성 결과 handoff", 480);
  const resultText = bodyText();
  const gamingQuery = new URLSearchParams(location.search);
  assert(gamingQuery.get("profile") === "gaming" && gamingQuery.get("resolution") === "4k" && gamingQuery.get("refresh") === "144" && gamingQuery.get("games")?.includes("cyberpunk") && gamingQuery.get("graphics") === "high" && gamingQuery.get("upscaling") === "quality" && gamingQuery.get("ram") === "64" && gamingQuery.get("ssd") === "2000" && gamingQuery.get("budget") === "5000000", `게임 모드·게임·화면 목표·RAM·SSD·예산 조건이 자동 구성 URL에 보존되지 않았습니다: ${location.href}`);
  const gamingContextText = text(document.querySelector("[data-testid=generator-gaming-context]"));
  assert(gamingContextText.includes("사이버펑크 2077") && gamingContextText.includes("4K") && gamingContextText.includes("144Hz") && gamingContextText.includes("실제 게임 FPS"), "게임·해상도·주사율 목표가 생성 결과에 보존되지 않았습니다.");
  const gamingLineCount = assertHydratedResult("게임");
  assert(resultText.includes("4K") && resultText.includes("144Hz") && gamingLineCount >= 6, "자동 구성 결과에 게이밍 목표·부품 라인이 없습니다.");
  assert(document.querySelector(".generator-result .generator-rationale, .generator-result .generator-analysis, .generator-result .generator-selection-reasons, .generator-result .generator-gaming-evidence, .generator-result .generator-gpu-target") === null, "자동 구성 견적에 판정 근거 패널이 노출되고 있습니다.");
  const gaming = { path: location.pathname + location.search, budgetRange: gamingBudgetText, lineCount: gamingLineCount };

  await navigateStart();
  await chooseNewTaskGaming();
  await chooseOption("사이버펑크 2077", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 성능 목표를 정해주세요", "낮은 예산 게임 목표 화면");
  await chooseOption("QHD", "다음");
  await chooseOption("144Hz", "다음");
  assert(bodyText().includes("실제 게임 FPS를 보장하지 않아요"), "낮은 예산 게임 목표에서 희망 주사율이 실제 FPS 보장으로 오해되지 않도록 안내하지 않았습니다.");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 옵션도 정해주세요", "낮은 예산 그래픽 옵션 화면");
  await chooseOption("높음", "다음 · 예산 정하기");
  await chooseOption("DLSS·품질 참고", "다음 · 예산 정하기");
  clickButton("다음 · 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산을 정해주세요", "낮은 예산 선택 화면");
  assert(text(document.querySelector(".onboarding-budget-value")) === "200만원", "낮은 예산 시나리오에서 기본 200만원 예산이 보존되지 않았습니다.");
  clickButton("예상 구성 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "견적 내용을 확인하세요", "낮은 예산 조건 요약");
  assert(bodyText().includes("QHD · 144Hz") && bodyText().includes("200만원"), "낮은 예산 조건 요약에서 QHD·144Hz와 200만원을 보존하지 않았습니다.");
  clickButton("견적 만들기");
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "낮은 예산 자동 구성 결과", 480);
  const lowBudgetQuery = new URLSearchParams(location.search);
  const lowBudgetContext = text(document.querySelector("[data-testid=generator-gaming-context]"));
  assert(lowBudgetQuery.get("profile") === "gaming" && lowBudgetQuery.get("resolution") === "1440p" && lowBudgetQuery.get("refresh") === "144" && lowBudgetQuery.get("budget") === "2000000", `낮은 예산 조건이 자동 구성 URL에 보존되지 않았습니다: ${location.href}`);
  assert(lowBudgetContext.includes("QHD") && lowBudgetContext.includes("144Hz") && lowBudgetContext.includes("실제 게임 FPS"), "낮은 예산 자동 구성 결과에서 게임 목표와 FPS 비보장 안내가 빠졌습니다.");
  const gamingLowBudget = { path: location.pathname + location.search, context: lowBudgetContext };

  await navigateStart();
  await chooseNewTaskWork();
  assert(bodyText().includes("FHD·4K 컷 편집과 효과 작업") && bodyText().includes("모델링·씬 구성·반복 렌더링") && bodyText().includes("IDE·빌드·컨테이너·가상 머신"), "작업 종류 카드에 대표 사용 장면 설명이 없습니다.");
  await chooseOption("영상 편집");
  clickButton("다음");
  await waitFor(() => currentStep() === "intensity" || text(document.querySelector(".onboarding-title")).includes("영상 편집은 어느 정도 규모인가요?"), "작업 강도 화면");
  const intensityText = bodyText();
  assert(intensityText.includes("FHD·가벼운 컷 편집") && intensityText.includes("4K 편집·일반 효과") && intensityText.includes("4K·6K 편집·고급 효과") && intensityText.includes("64GB") && intensityText.includes("2TB SSD"), "작업 강도별 구체적인 예상 작업·사양이 표시되지 않았습니다.");
  await chooseOption("heavy");
  clickButton("다음 · 예산 정하기");
  await waitForStep("budget", "작업 예산 화면");
  const workEstimateText = text(document.querySelector(".onboarding-estimate"));
  assert(workEstimateText.includes("4K·6K 편집·고급 효과") && workEstimateText.includes("64GB") && workEstimateText.includes("2TB SSD"), "작업 종류·강도에 맞는 구체적인 예상 사양이 없습니다.");
  clickButton("300만원");
  clickCta();
  await waitForStep("summary", "작업 조건 요약 화면");
  assert(bodyText().includes("영상 편집") && bodyText().includes("무겁게") && bodyText().includes("4K·6K 편집·고급 효과"), "작업 조건 요약이 선택값을 보존하지 않았습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "작업 자동 구성 handoff", 480);
  const workQuery = new URLSearchParams(location.search);
  assert(workQuery.get("profile") === "creator" && workQuery.get("work") === "video" && workQuery.get("intensity") === "heavy" && workQuery.get("ram") === "64" && workQuery.get("ssd") === "2000" && workQuery.get("budget") === "3000000", "작업 모드·작업·강도·RAM·SSD·예산 조건이 자동 구성 URL에 보존되지 않았습니다.");
  const workLineCount = assertHydratedResult("작업");
  const work = { estimate: workEstimateText, path: location.pathname + location.search, lineCount: workLineCount };

  await navigateStart();
  await chooseNewBudget();
  clickButton("400만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "400만원", "예산 중심 금액 선택 반영");
  const budgetOnlyEstimate = text(document.querySelector(".onboarding-estimate"));
  assert(budgetOnlyEstimate.includes("상급 일반 구성") && budgetOnlyEstimate.includes("64GB") && budgetOnlyEstimate.includes("2TB SSD"), "예산 중심 분기의 예상 사양이 표시되지 않았습니다.");
  clickCta();
  await waitForStep("summary", "예산 중심 요약 화면");
  assert(bodyText().includes("400만원") && bodyText().includes("상급 일반 구성"), "예산 중심 요약에 예산·예상 수준이 보이지 않습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "예산 중심 자동 구성 handoff", 480);
  const budgetQuery = new URLSearchParams(location.search);
  assert(budgetQuery.get("profile") === "general" && budgetQuery.get("priority") === null && budgetQuery.get("tier") === null && budgetQuery.get("budget") === "4000000" && budgetQuery.get("ram") === "64" && budgetQuery.get("ssd") === "2000", "예산 모드·예산·RAM·SSD 조건이 자동 구성 URL에 보존되지 않았습니다.");
  const budgetLineCount = assertHydratedResult("예산");
  const budgetOnly = { path: location.pathname + location.search, estimate: budgetOnlyEstimate, lineCount: budgetLineCount };

  await navigateStart();
  await chooseNewSpec();
  await chooseOption("top");
  await chooseOption("64");
  await chooseOption("2000");
  clickButton("다음");
  await waitForStep("budget", "직접 성능 예산 화면");
  clickButton("300만원");
  clickCta();
  await waitForStep("summary", "직접 성능 요약 화면");
  assert(bodyText().includes("최상급 성능") && bodyText().includes("외장 GPU 포함") && bodyText().includes("64GB") && bodyText().includes("2TB"), "직접 성능 요약에 선택한 조건이 보이지 않습니다.");
  clickCta();
  await waitFor(() => location.pathname === "/recommend" && (document.querySelector(".generator-request-error") !== null || document.querySelector(".generator-result") !== null), "직접 성능 예산 판정 handoff", 480);
  const specQuery = new URLSearchParams(location.search);
  assert(specQuery.get("profile") === "general" && specQuery.get("priority") === "performance" && specQuery.get("tier") === "top" && specQuery.get("ram") === "64" && specQuery.get("ssd") === "2000" && specQuery.get("budget") === "3000000" && specQuery.get("gpu") === null, "직접 성능 모드·등급·RAM·SSD·예산 조건이 자동 구성 URL에 보존되지 않았습니다.");
  const specFailure = document.querySelector(".generator-request-error");
  let spec;
  if (specFailure) {
    const specFailureText = text(specFailure);
    assert(specFailureText.includes("요청 예산 3,000,000원 안에 자동 구성을 찾지 못했습니다."), "예산 안에 구성이 없는 경우 초과 견적을 막고 진단을 표시하지 않았습니다.");
    assert(specFailureText.includes("가능한 조건 완화안") && document.querySelectorAll(".generator-recovery-option").length > 0 && document.querySelector(".generator-result") === null, "직접 성능 예산 실패에서 입력을 유지하고 선택 가능한 조건 완화안을 표시하지 않았습니다.");
    spec = { path: location.pathname + location.search, budgetInfeasible: true, recoveryOptions: document.querySelectorAll(".generator-recovery-option").length };
  } else {
    const lineCount = assertHydratedResult("직접 성능");
    spec = { path: location.pathname + location.search, lineCount };
  }

  await navigateStart();
  await chooseNewBudget();
  clickButton("400만원");
  clickCta();
  await waitForStep("summary", "요청 오류 경로 요약 화면");
  const localOfflineBuild = document.querySelector(".offline-local-mode-banner") !== null;
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
    if (localOfflineBuild) {
      clickCta();
      await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "설치 카탈로그를 사용한 자동 구성 결과", 480);
      const localQuery = new URLSearchParams(location.search);
      const localLineCount = assertHydratedResult("설치 카탈로그");
      assert(attemptedApiFetches === 0 && failedRecommendPosts === 0, `로컬 설치 모드는 원격 API 요청 없이 설치 데이터를 사용해야 합니다: ${JSON.stringify({ attemptedApiFetches, failedRecommendPosts })}`);
      assert(localQuery.get("profile") === "general" && localQuery.get("budget") === "4000000" && localQuery.get("ram") === "64" && localQuery.get("ssd") === "2000" && localLineCount >= 6, `설치 카탈로그 자동 구성 결과가 조건을 보존하지 않았습니다: ${location.href}`);
      recommendationFailure = { path: location.pathname + location.search, localOffline: true, attemptedApiFetches, lineCount: localLineCount };
    } else {
      clickCta();
      await waitFor(() => location.pathname === "/recommend" && document.querySelector('.generator-request-error[role="alert"]') !== null, "자동 구성 API 실패 안내", 480);
      const failureAlert = text(document.querySelector('.generator-request-error[role="alert"]'));
      const failureQuery = new URLSearchParams(location.search);
      assert(failedRecommendPosts === 3, `일시적인 503은 첫 요청과 최대 두 번의 제한된 재시도를 거쳐야 합니다: ${failedRecommendPosts}`);
      assert(failureAlert.includes("자동 구성 요청을 완료하지 못했습니다.") && failureAlert.includes("현재 입력은 유지됩니다."), "추천 API 실패 시 입력 보존·복구 안내가 표시되지 않았습니다.");
      assert(failureQuery.get("profile") === "general" && failureQuery.get("budget") === "4000000" && failureQuery.get("ram") === "64" && failureQuery.get("ssd") === "2000", `추천 요청 실패 후에도 입력 조건이 URL에 보존되어야 합니다: ${location.href}`);
      recommendationFailure = { path: location.pathname + location.search, alert: true, postCount: failedRecommendPosts };
    }
  } finally {
    window.fetch = originalFetch;
  }

  await navigateStart();
  await waitForStep("intent", "나중에 선택 초기 화면");
  await chooseOption("나중에 하기");
  clickButton("홈으로 돌아가기");
  await waitFor(() => location.pathname === "/" && document.querySelector(".home-page") !== null, "나중에 선택 후 홈 이동");
  const later = { path: location.pathname, home: true };

  await navigateStart();
  await waitForStep("intent", "업그레이드 초기 화면");
  await chooseOption("쓰던 PC 업그레이드하기");
  clickButton("다음");
  await waitFor(() => document.querySelector(".onboarding-steps-list") !== null, "업그레이드 안내 화면");
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

  await client.evaluate("sessionStorage.clear()");
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
