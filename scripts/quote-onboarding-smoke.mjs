import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, sleep, waitForJson } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const timeoutMs = Number(process.env.QUOTE_ONBOARDING_SMOKE_TIMEOUT_MS ?? 120_000);

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
  const clickButton = (needle) => {
    const button = [...document.querySelectorAll("button")].find((candidate) => !candidate.disabled && (candidate.textContent ?? "").replace(/\s+/g, " ").includes(needle));
    if (!(button instanceof HTMLButtonElement)) throw new Error(`버튼을 찾지 못했습니다: ${needle}`);
    button.click();
  };
  const waitForCta = async (needle) => {
    await waitFor(() => [...document.querySelectorAll(".onboarding-cta")].some((candidate) => !candidate.disabled && text(candidate).includes(needle)), `온보딩 CTA 활성화: ${needle}`);
  };
  const chooseOption = async (option, nextCta) => {
    clickButton(option);
    await waitForCta(nextCta);
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
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC 견적을 볼까요?", "첫 선택 화면");
    await chooseOption("새 PC 견적 보기", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 기준으로 부품을 고를까요?", "새 견적 방식 화면");
    assert(bodyText().includes("예산에 맞는 기본 구성") && bodyText().includes("주로 할 게임이나 작업") && bodyText().includes("성능 등급과 그래픽·메모리·저장공간"), "새 견적 방식에 선택 기준 설명이 없습니다.");
    await chooseOption("게임·작업을 기준으로 고르기", "이 기준으로 계속");
    clickButton("이 기준으로 계속");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 용도로 쓸 PC인가요?", "용도 선택 화면");
    await chooseOption("게임", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "주로 할 게임을 골라주세요", "게임 선택 화면");
  };
  const chooseNewTaskWork = async () => {
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC 견적을 볼까요?", "첫 선택 화면");
    await chooseOption("새 PC 견적 보기", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 기준으로 부품을 고를까요?", "새 견적 방식 화면");
    await chooseOption("게임·작업을 기준으로 고르기", "이 기준으로 계속");
    clickButton("이 기준으로 계속");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 용도로 쓸 PC인가요?", "용도 선택 화면");
    await chooseOption("작업", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "주로 하는 작업을 골라주세요", "작업 선택 화면");
  };
  const chooseNewBudget = async () => {
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC 견적을 볼까요?", "첫 선택 화면");
    await chooseOption("새 PC 견적 보기", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 기준으로 부품을 고를까요?", "새 견적 방식 화면");
    await chooseOption("예산을 기준으로 고르기", "이 기준으로 계속");
    clickButton("이 기준으로 계속");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산을 정해주세요", "예산 중심 화면");
  };
  const chooseNewSpec = async () => {
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC 견적을 볼까요?", "첫 선택 화면");
    await chooseOption("새 PC 견적 보기", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 기준으로 부품을 고를까요?", "새 견적 방식 화면");
    await chooseOption("원하는 사양 직접 입력하기", "이 기준으로 계속");
    clickButton("이 기준으로 계속");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "성능 목표를 정하세요", "직접 성능 입력 화면");
  };

  await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "온보딩 초기 화면");
  const onboardingProgress = document.querySelector("[data-testid=onboarding-progress]");
  assert(onboardingProgress?.getAttribute("role") === "progressbar" && onboardingProgress?.getAttribute("aria-valuenow") === "1", "첫 온보딩 화면에 단계 진행 표시가 없습니다.");
  history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => location.pathname === "/" && document.querySelector("[data-testid=home-guided-entry]") !== null, "첫 사용자 홈 화면");
  const guidedHomeText = document.querySelector("[data-testid=home-guided-entry]")?.textContent ?? "";
  assert(document.querySelector("[data-testid=home-guided-entry]") !== null && guidedHomeText.includes("용도와 예산 선택") && guidedHomeText.includes("게임 · 작업") && guidedHomeText.includes("원하는 금액"), `부품을 고르지 않은 첫 사용자가 견적 시작 안내를 보지 못했습니다: ${JSON.stringify({ guided: Boolean(document.querySelector("[data-testid=home-guided-entry]")), guidedHomeText, body: bodyText().slice(0, 900) })}`);
  assert((document.querySelector(".hero-secondary-action")?.textContent ?? "").includes("부품을 직접 선택하기") && (document.querySelector("[data-testid=mobile-home-recommend]")?.textContent ?? "").includes("부품을 직접 선택하기"), "첫 사용자 홈의 보조 진입이 고급 자동 구성 화면을 우회하지 않습니다.");
  if (window.innerWidth <= 760) {
    const mobileGuidedHomeText = document.querySelector("[data-testid=mobile-home-guided-entry]")?.textContent ?? "";
    assert(document.querySelector("[data-testid=mobile-home-guided-entry]") !== null && mobileGuidedHomeText.includes("용도와 예산으로") && mobileGuidedHomeText.includes("PC 견적을 구성합니다.") && mobileGuidedHomeText.includes("부품 이름을 몰라도"), "모바일 첫 사용자 홈에 견적 시작 안내가 없습니다.");
  }
  history.pushState({}, "", "/start");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "첫 사용자 홈에서 온보딩 진입");
  await chooseNewTaskGaming();
  await chooseOption("사이버펑크 2077", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 성능 목표를 정해주세요", "목표 성능 화면");
  await chooseOption("4K", "다음");
  await chooseOption("144Hz", "다음");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("희망 주사율 144Hz"), "게임·해상도·희망 주사율 조건이 화면에 보존되지 않았습니다.");
  assert(bodyText().includes("실제 게임 FPS를 보장하지 않아요"), "희망 주사율이 실제 FPS 보장으로 오해되지 않도록 안내하지 않았습니다.");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 옵션도 정해주세요", "그래픽 옵션 화면");
  await chooseOption("높음", "다음 · 예산 정하기");
  await chooseOption("DLSS·품질 참고", "다음 · 예산 정하기");
  assert(bodyText().includes("시각 효과 우선") && bodyText().includes("화질 저하를 줄이면서 프레임 부담을 낮추는"), "그래픽 품질·업스케일링 선택 의미가 설명되지 않았습니다.");
  assert(bodyText().includes("희망 주사율") && bodyText().includes("PC 가격대") && bodyText().includes("실시간 가격·재고는 반영되지 않아요"), "사용자 희망 주사율과 가격대 안내가 선택 단계에 표시되지 않았습니다.");
  clickButton("다음 · 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산을 정해주세요", "예산 화면");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-adjust]")) === "최저 권장 금액 450만원으로 변경", "예산이 권장 범위보다 낮을 때 바로 조정하는 CTA가 없습니다.");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-edit-target]")) === "목표 성능 다시 고르기", "예산이 부족할 때 목표 성능을 다시 고르는 CTA가 없습니다.");
  clickButton("목표 성능 다시 고르기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 성능 목표를 정해주세요", "예산에서 목표 성능 변경 화면");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("4K") && bodyText().includes("희망 주사율 144Hz"), "주사율 변경 후 기존 게임·희망 주사율 조건이 보존되지 않았습니다.");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 옵션도 정해주세요", "목표 성능 변경 후 그래픽 옵션 화면");
  clickButton("다음 · 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산을 정해주세요", "목표 성능 변경 후 예산 복귀");
  assert(text(document.querySelector(".onboarding-budget-value")) === "200만원", "목표 성능을 다시 골라도 기존 예산이 보존되지 않았습니다.");
  clickButton("최저 권장 금액 450만원으로 변경");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "450만원", "권장 최저 예산 자동 조정");
  clickButton("500만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "500만원", "예산 선택 반영");
  const gamingBudgetText = text(document.querySelector(".onboarding-budget-range"));
  assert(/가격대\s*\d+만원\s*~\s*\d+만원/.test(gamingBudgetText), "게임 목표 가격 범위가 표시되지 않았습니다.");
  assert(text(document.querySelector(".onboarding-estimate")).includes("4K · 144Hz 주사율 목표"), "예산에 따른 예상 주사율 목표가 표시되지 않았습니다.");
  clickButton("600만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "600만원", "여유 예산 선택 반영");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-adjust]")) === "권장 상한 530만원으로 변경", "예산이 권장 범위보다 높을 때 상한 조정 CTA가 없습니다.");
  clickButton("권장 상한 530만원으로 변경");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "530만원", "권장 상한 예산 자동 조정");
  clickButton("500만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "500만원", "권장 범위 예산 복귀");
  clickButton("예상 구성 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "견적 내용을 확인하세요", "조건 요약 화면");
  const summaryText = bodyText();
  assert(summaryText.includes("사이버펑크 2077") && summaryText.includes("희망 주사율") && summaryText.includes("4K · 144Hz") && summaryText.includes("500만원"), "조건 요약에 선택한 게임·희망 주사율·예산이 모두 보이지 않습니다.");
  assert([...document.querySelectorAll(".onboarding-summary-edit")].some((button) => text(button) === "예산 변경"), "요약 화면에서 예산을 바로 변경할 수 없습니다.");
  clickButton("예산 변경");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산을 정해주세요", "요약에서 예산 변경 화면");
  assert(text(document.querySelector(".onboarding-budget-value")) === "500만원", "요약에서 예산 변경 시 기존 금액이 보존되지 않았습니다.");
  clickButton("예상 구성 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "견적 내용을 확인하세요", "예산 변경 후 조건 요약 화면");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("희망 주사율") && bodyText().includes("4K · 144Hz") && bodyText().includes("500만원"), "예산 변경 후 기존 게임·희망 주사율 조건이 보존되지 않았습니다.");
  clickButton("견적 만들기");
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "자동 구성 결과 handoff", 480);
  const resultText = bodyText();
  const gamingQuery = new URLSearchParams(location.search);
  assert(gamingQuery.get("profile") === "gaming" && gamingQuery.get("resolution") === "4k" && gamingQuery.get("refresh") === "144" && gamingQuery.get("games")?.includes("cyberpunk") && gamingQuery.get("budget") === "5000000", `온보딩 조건이 자동 구성 URL에 보존되지 않았습니다: ${location.href}`);
  const gamingContextText = text(document.querySelector("[data-testid=generator-gaming-context]"));
  assert(gamingContextText.includes("사이버펑크 2077") && gamingContextText.includes("4K") && gamingContextText.includes("144Hz") && gamingContextText.includes("실제 게임 FPS"), "게임·해상도·주사율 목표가 생성 결과에 보존되지 않았습니다.");
  const gamingLineCount = document.querySelectorAll(".generator-result .generator-line").length;
  assert(resultText.includes("4K") && resultText.includes("144Hz") && gamingLineCount >= 6, "자동 구성 결과에 게이밍 목표·부품 라인이 없습니다.");
  assert([...document.querySelectorAll(".generator-result .generator-line")].every((line) => (line.querySelector("strong")?.textContent ?? "").trim().length > 0 && /원|-/.test(line.textContent ?? "")), "자동 구성 부품 라인에 부품명·가격이 없습니다.");
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
  await chooseOption("영상 편집", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")).includes("영상 편집은 어느 정도 규모인가요?"), "작업 강도 화면");
  const intensityText = bodyText();
  assert(intensityText.includes("FHD·가벼운 컷 편집") && intensityText.includes("4K 편집·일반 효과") && intensityText.includes("4K·6K 편집·고급 효과") && intensityText.includes("64GB") && intensityText.includes("2TB SSD"), "작업 강도별 구체적인 예상 작업·사양이 표시되지 않았습니다.");
  await chooseOption("무겁게", "다음 · 예산 정하기");
  clickButton("다음 · 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산을 정해주세요", "작업 예산 화면");
  const workEstimateText = text(document.querySelector(".onboarding-estimate"));
  assert(workEstimateText.includes("4K·6K 편집·고급 효과") && workEstimateText.includes("64GB") && workEstimateText.includes("2TB SSD"), "작업 종류·강도에 맞는 구체적인 예상 사양이 없습니다.");
  clickButton("300만원");
  clickButton("예상 구성 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "견적 내용을 확인하세요", "작업 조건 요약 화면");
  assert(bodyText().includes("영상 편집") && bodyText().includes("무겁게") && bodyText().includes("4K·6K 편집·고급 효과"), "작업 조건 요약이 선택값을 보존하지 않았습니다.");
  clickButton("견적 만들기");
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "작업 자동 구성 handoff", 480);
  const workQuery = new URLSearchParams(location.search);
  assert(workQuery.get("profile") === "creator" && workQuery.get("work") === "video" && workQuery.get("intensity") === "heavy" && workQuery.get("ram") === "64" && workQuery.get("ssd") === "2000" && workQuery.get("budget") === "3000000", "작업 조건이 자동 구성 URL에 보존되지 않았습니다.");
  const workResultText = bodyText();
  assert(document.querySelector("[data-testid=generator-work-context]") !== null && workResultText.includes("4K·6K 편집·고급 효과") && workResultText.includes("64GB") && workResultText.includes("2TB SSD"), "작업 결과 화면에 work context가 없습니다.");
  const work = { estimate: workEstimateText, path: location.pathname + location.search, context: true };

  await navigateStart();
  await chooseNewBudget();
  clickButton("400만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "400만원", "예산 중심 금액 선택 반영");
  const budgetOnlyEstimate = text(document.querySelector(".onboarding-estimate"));
  assert(budgetOnlyEstimate.includes("상급 일반 구성") && budgetOnlyEstimate.includes("64GB") && budgetOnlyEstimate.includes("2TB SSD"), "예산 중심 분기의 예상 사양이 표시되지 않았습니다.");
  clickButton("예상 구성 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "견적 내용을 확인하세요", "예산 중심 요약 화면");
  assert(bodyText().includes("400만원") && bodyText().includes("상급 일반 구성"), "예산 중심 요약에 예산·예상 수준이 보이지 않습니다.");
  clickButton("견적 만들기");
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "예산 중심 자동 구성 handoff", 480);
  const budgetQuery = new URLSearchParams(location.search);
  assert(budgetQuery.get("profile") === "general" && budgetQuery.get("budget") === "4000000" && budgetQuery.get("ram") === "64" && budgetQuery.get("ssd") === "2000", "예산 중심 조건이 자동 구성 URL에 보존되지 않았습니다.");
  const budgetResultText = bodyText();
  assert(document.querySelector("[data-testid=generator-general-context]") !== null && budgetResultText.includes("상급 일반 구성") && budgetResultText.includes("64GB") && budgetResultText.includes("2TB SSD"), "예산 중심 결과에 입력 기준 카드가 없습니다.");
  const budgetOnly = { path: location.pathname + location.search, estimate: budgetOnlyEstimate };

  await navigateStart();
  await chooseNewSpec();
  await chooseOption("최상급", "다음");
  await chooseOption("64GB", "다음");
  await chooseOption("2TB", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산을 정해주세요", "직접 성능 예산 화면");
  clickButton("300만원");
  clickButton("예상 구성 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "견적 내용을 확인하세요", "직접 성능 요약 화면");
  assert(bodyText().includes("최상급 성능") && bodyText().includes("외장 GPU 포함") && bodyText().includes("64GB") && bodyText().includes("2TB"), "직접 성능 요약에 선택한 조건이 보이지 않습니다.");
  clickButton("견적 만들기");
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-request-error") !== null, "예산이 모자란 직접 성능 진단 handoff", 480);
  const specQuery = new URLSearchParams(location.search);
  assert(specQuery.get("profile") === "general" && specQuery.get("priority") === "performance" && specQuery.get("tier") === "top" && specQuery.get("ram") === "64" && specQuery.get("ssd") === "2000" && specQuery.get("budget") === "3000000" && specQuery.get("gpu") === null, "직접 성능 조건이 자동 구성 URL에 보존되지 않았습니다.");
  const specFailureText = document.querySelector(".generator-request-error")?.textContent ?? "";
  assert(specFailureText.includes("요청 예산 3,000,000원 안에 자동 구성을 찾지 못했습니다."), "예산 안에 구성이 없는 경우 초과 견적을 막고 진단을 표시하지 않았습니다.");
  assert(specFailureText.includes("가능한 조건 완화안") && document.querySelectorAll(".generator-recovery-option").length > 0 && document.querySelector(".generator-result") === null, "직접 성능 예산 실패에서 입력을 유지하고 선택 가능한 조건 완화안을 표시하지 않았습니다.");
  const spec = { path: location.pathname + location.search, budgetInfeasible: true, recoveryOptions: document.querySelectorAll(".generator-recovery-option").length };

  await navigateStart();
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC 견적을 볼까요?", "나중에 선택 초기 화면");
  await chooseOption("나중에 하기", "홈으로 돌아가기");
  clickButton("홈으로 돌아가기");
  await waitFor(() => location.pathname === "/" && document.querySelector(".home-page") !== null, "나중에 선택 후 홈 이동");
  const later = { path: location.pathname, home: true };

  await navigateStart();
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC 견적을 볼까요?", "업그레이드 초기 화면");
  await chooseOption("쓰던 PC 업그레이드하기", "다음");
  clickButton("다음");
  await waitFor(() => document.querySelector(".onboarding-steps-list") !== null, "업그레이드 안내 화면");
  clickButton("현재 부품 고르기");
  await waitFor(() => location.pathname === "/build" && new URLSearchParams(location.search).get("entry") === "upgrade", "업그레이드 편집기 handoff");
  const upgrade = { path: location.pathname + location.search, entry: "upgrade" };

  if (errors.length > 0) throw new Error(`온보딩 브라우저 오류: ${errors.join(" | ")}`);
  return { stage: "passed", gaming, gamingLowBudget, work, budgetOnly, spec, later, upgrade };
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

const port = await freePort();
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
