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
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC가 필요하세요?", "첫 선택 화면");
    assert(bodyText().includes("게임·작업·예산을 몇 가지 질문으로 정리해요") && bodyText().includes("현재 부품을 확인하고") && bodyText().includes("준비되면 다시 시작할 수 있어요"), "첫 선택 카드에 다음 단계 설명이 없습니다.");
    await chooseOption("새로운 견적을 맞추고 싶어요", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "새 견적은 어떤 방식으로 맞춰볼까요?", "새 견적 방식 화면");
    assert(bodyText().includes("예상 성능·RAM·SSD") && bodyText().includes("게임·작업과 목표 성능") && bodyText().includes("성능 등급·외장 GPU·RAM·SSD"), "새 견적 방식 카드에 다음 단계 설명이 없습니다.");
    await chooseOption("특정 작업이나 게임을 할 거예요", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "무엇을 주로 할까요?", "용도 선택 화면");
    await chooseOption("게임", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 게임을 할 건가요?", "게임 선택 화면");
  };
  const chooseNewTaskWork = async () => {
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC가 필요하세요?", "첫 선택 화면");
    await chooseOption("새로운 견적을 맞추고 싶어요", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "새 견적은 어떤 방식으로 맞춰볼까요?", "새 견적 방식 화면");
    await chooseOption("특정 작업이나 게임을 할 거예요", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "무엇을 주로 할까요?", "용도 선택 화면");
    await chooseOption("작업", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "주로 어떤 작업을 할 건가요?", "작업 선택 화면");
  };
  const chooseNewBudget = async () => {
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC가 필요하세요?", "첫 선택 화면");
    await chooseOption("새로운 견적을 맞추고 싶어요", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "새 견적은 어떤 방식으로 맞춰볼까요?", "새 견적 방식 화면");
    await chooseOption("예산으로 맞출래요", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산은 어디까지 생각하세요?", "예산 중심 화면");
  };
  const chooseNewSpec = async () => {
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC가 필요하세요?", "첫 선택 화면");
    await chooseOption("새로운 견적을 맞추고 싶어요", "새 견적 시작하기");
    clickButton("새 견적 시작하기");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "새 견적은 어떤 방식으로 맞춰볼까요?", "새 견적 방식 화면");
    await chooseOption("생각해둔 성능이 있어요", "다음");
    clickButton("다음");
    await waitFor(() => text(document.querySelector(".onboarding-title")) === "생각해둔 성능을 알려주세요", "직접 성능 입력 화면");
  };

  await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "온보딩 초기 화면");
  const onboardingProgress = document.querySelector("[data-testid=onboarding-progress]");
  assert(onboardingProgress?.getAttribute("role") === "progressbar" && onboardingProgress?.getAttribute("aria-valuenow") === "1", "첫 온보딩 화면에 단계 진행 표시가 없습니다.");
  history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => location.pathname === "/" && document.querySelector("[data-testid=home-guided-entry]") !== null, "첫 사용자 홈 화면");
  const guidedHomeText = document.querySelector("[data-testid=home-guided-entry]")?.textContent ?? "";
  assert(document.querySelector("[data-testid=home-guided-entry]") !== null && guidedHomeText.includes("몇 가지 질문만 답하면") && guidedHomeText.includes("게임 · 작업 · 예산"), `부품을 고르지 않은 첫 사용자가 guided quote 진입 화면을 보지 못했습니다: ${JSON.stringify({ guided: Boolean(document.querySelector("[data-testid=home-guided-entry]")), guidedHomeText, body: bodyText().slice(0, 900) })}`);
  assert((document.querySelector(".hero-secondary-action")?.textContent ?? "").includes("부품을 직접 선택하기") && (document.querySelector("[data-testid=mobile-home-recommend]")?.textContent ?? "").includes("부품을 직접 선택하기"), "첫 사용자 홈의 보조 진입이 고급 자동 구성 화면을 우회하지 않습니다.");
  if (window.innerWidth <= 760) {
    const mobileGuidedHomeText = document.querySelector("[data-testid=mobile-home-guided-entry]")?.textContent ?? "";
    assert(document.querySelector("[data-testid=mobile-home-guided-entry]") !== null && mobileGuidedHomeText.includes("몇 가지 질문으로") && mobileGuidedHomeText.includes("게임 · 작업 · 예산"), "모바일 첫 사용자 홈이 guided quote 진입 화면으로 바뀌지 않았습니다.");
  }
  history.pushState({}, "", "/start");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() => location.pathname === "/start" && document.querySelector(".onboarding-page") !== null, "첫 사용자 홈에서 온보딩 진입");
  await chooseNewTaskGaming();
  await chooseOption("사이버펑크 2077", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "원하는 성능을 골라주세요", "목표 성능 화면");
  await chooseOption("4K", "다음");
  await chooseOption("144 FPS", "다음");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("4K · 144 FPS"), "게임·해상도·FPS 조건이 화면에 보존되지 않았습니다.");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 옵션도 정해주세요", "그래픽 옵션 화면");
  await chooseOption("높음", "다음 · 예산 정하기");
  await chooseOption("DLSS·품질 참고", "다음 · 예산 정하기");
  assert(bodyText().includes("시각 효과 우선") && bodyText().includes("화질과 프레임을 함께 고려"), "그래픽 품질·업스케일링 선택 의미가 설명되지 않았습니다.");
  assert(bodyText().includes("평균 FPS 144 이상 목표") && bodyText().includes("이 조건의 참고 가격대") && bodyText().includes("실측 자료가 있을 때만"), "게임 성능 목표 기준과 참고 가격대가 선택 단계에 표시되지 않았습니다.");
  clickButton("다음 · 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산은 어디까지 생각하세요?", "예산 화면");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-adjust]")) === "권장 최저 예산(450만원)으로 맞추기", "예산이 권장 범위보다 낮을 때 바로 조정하는 CTA가 없습니다.");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-edit-target]")) === "목표 성능 다시 고르기", "예산이 부족할 때 목표 성능을 다시 고르는 CTA가 없습니다.");
  clickButton("목표 성능 다시 고르기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "원하는 성능을 골라주세요", "예산에서 목표 성능 변경 화면");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("4K") && bodyText().includes("144 FPS"), "목표 성능 변경 후 기존 게임·목표 조건이 보존되지 않았습니다.");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "게임 옵션도 정해주세요", "목표 성능 변경 후 그래픽 옵션 화면");
  clickButton("다음 · 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산은 어디까지 생각하세요?", "목표 성능 변경 후 예산 복귀");
  assert(text(document.querySelector(".onboarding-budget-value")) === "200만원", "목표 성능을 다시 골라도 기존 예산이 보존되지 않았습니다.");
  clickButton("권장 최저 예산(450만원)으로 맞추기");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "450만원", "권장 최저 예산 자동 조정");
  clickButton("500만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "500만원", "예산 선택 반영");
  const gamingBudgetText = text(document.querySelector(".onboarding-budget-range"));
  assert(/예상 가격대\s*\d+만원\s*~\s*\d+만원/.test(gamingBudgetText), "게임 목표 가격 범위가 표시되지 않았습니다.");
  assert(text(document.querySelector(".onboarding-estimate")).includes("4K · 144 FPS"), "예산에 따른 예상 성능이 표시되지 않았습니다.");
  clickButton("600만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "600만원", "여유 예산 선택 반영");
  assert(text(document.querySelector("[data-testid=onboarding-budget-range-adjust]")) === "권장 상한(530만원)으로 맞추기", "예산이 권장 범위보다 높을 때 상한 조정 CTA가 없습니다.");
  clickButton("권장 상한(530만원)으로 맞추기");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "530만원", "권장 상한 예산 자동 조정");
  clickButton("500만원");
  await waitFor(() => text(document.querySelector(".onboarding-budget-value")) === "500만원", "권장 범위 예산 복귀");
  clickButton("다음 · 조건 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "이 조건으로 맞춰볼까요?", "조건 요약 화면");
  const summaryText = bodyText();
  assert(summaryText.includes("사이버펑크 2077") && summaryText.includes("4K · 144 FPS") && summaryText.includes("500만원"), "조건 요약에 선택한 게임·목표·예산이 모두 보이지 않습니다.");
  assert([...document.querySelectorAll(".onboarding-summary-edit")].some((button) => text(button) === "예산 변경"), "요약 화면에서 예산을 바로 변경할 수 없습니다.");
  clickButton("예산 변경");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산은 어디까지 생각하세요?", "요약에서 예산 변경 화면");
  assert(text(document.querySelector(".onboarding-budget-value")) === "500만원", "요약에서 예산 변경 시 기존 금액이 보존되지 않았습니다.");
  clickButton("다음 · 조건 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "이 조건으로 맞춰볼까요?", "예산 변경 후 조건 요약 화면");
  assert(bodyText().includes("사이버펑크 2077") && bodyText().includes("4K · 144 FPS") && bodyText().includes("500만원"), "예산 변경 후 기존 게임·목표 조건이 보존되지 않았습니다.");
  clickButton("이 조건으로 견적 생성하기");
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "자동 구성 결과 handoff", 480);
  const resultText = bodyText();
  const gamingQuery = new URLSearchParams(location.search);
  assert(gamingQuery.get("profile") === "gaming" && gamingQuery.get("resolution") === "4k" && gamingQuery.get("refresh") === "144" && gamingQuery.get("games")?.includes("cyberpunk") && gamingQuery.get("budget") === "5000000", `온보딩 조건이 자동 구성 URL에 보존되지 않았습니다: ${location.href}`);
  assert(resultText.includes("4K") && resultText.includes("144 FPS") && document.querySelector("[data-testid=generator-gaming-evidence]") !== null && document.querySelector("[data-testid=generator-gaming-coverage]") !== null && document.querySelector("[data-testid=generator-gaming-evidence-request-copy]") !== null, "자동 구성 결과에 게이밍 목표·근거 coverage·측정 요청 액션이 없습니다.");
  const gaming = { path: location.pathname + location.search, budgetRange: gamingBudgetText, evidencePanel: true };

  await navigateStart();
  await chooseNewTaskWork();
  assert(bodyText().includes("FHD·4K 컷 편집과 효과 작업") && bodyText().includes("모델링·씬 구성·반복 렌더링") && bodyText().includes("IDE·빌드·컨테이너·가상 머신"), "작업 종류 카드에 대표 사용 장면 설명이 없습니다.");
  await chooseOption("영상 편집", "다음");
  clickButton("다음");
  await waitFor(() => text(document.querySelector(".onboarding-title")).includes("영상 편집을 어느 정도로 할까요?"), "작업 강도 화면");
  const intensityText = bodyText();
  assert(intensityText.includes("FHD·가벼운 컷 편집") && intensityText.includes("4K 편집·일반 효과") && intensityText.includes("4K·6K 편집·고급 효과") && intensityText.includes("64GB") && intensityText.includes("2TB SSD"), "작업 강도별 구체적인 예상 작업·사양이 표시되지 않았습니다.");
  await chooseOption("무겁게", "다음 · 예산 정하기");
  clickButton("다음 · 예산 정하기");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산은 어디까지 생각하세요?", "작업 예산 화면");
  const workEstimateText = text(document.querySelector(".onboarding-estimate"));
  assert(workEstimateText.includes("4K·6K 편집·고급 효과") && workEstimateText.includes("64GB") && workEstimateText.includes("2TB SSD"), "작업 종류·강도에 맞는 구체적인 예상 사양이 없습니다.");
  clickButton("300만원");
  clickButton("다음 · 조건 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "이 조건으로 맞춰볼까요?", "작업 조건 요약 화면");
  assert(bodyText().includes("영상 편집") && bodyText().includes("무겁게") && bodyText().includes("4K·6K 편집·고급 효과"), "작업 조건 요약이 선택값을 보존하지 않았습니다.");
  clickButton("이 조건으로 견적 생성하기");
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
  clickButton("다음 · 조건 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "이 조건으로 맞춰볼까요?", "예산 중심 요약 화면");
  assert(bodyText().includes("400만원") && bodyText().includes("상급 일반 구성"), "예산 중심 요약에 예산·예상 수준이 보이지 않습니다.");
  clickButton("이 조건으로 견적 생성하기");
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
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "예산은 어디까지 생각하세요?", "직접 성능 예산 화면");
  clickButton("300만원");
  clickButton("다음 · 조건 확인");
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "이 조건으로 맞춰볼까요?", "직접 성능 요약 화면");
  assert(bodyText().includes("최상급 성능") && bodyText().includes("외장 GPU 포함") && bodyText().includes("64GB") && bodyText().includes("2TB"), "직접 성능 요약에 선택한 조건이 보이지 않습니다.");
  clickButton("이 조건으로 견적 생성하기");
  await waitFor(() => location.pathname === "/recommend" && document.querySelector(".generator-result") !== null, "직접 성능 자동 구성 handoff", 480);
  const specQuery = new URLSearchParams(location.search);
  assert(specQuery.get("profile") === "general" && specQuery.get("priority") === "performance" && specQuery.get("tier") === "top" && specQuery.get("ram") === "64" && specQuery.get("ssd") === "2000" && specQuery.get("budget") === "3000000" && specQuery.get("gpu") === null, "직접 성능 조건이 자동 구성 URL에 보존되지 않았습니다.");
  const specResultText = bodyText();
  assert(document.querySelector("[data-testid=generator-general-context]") !== null && specResultText.includes("최상급 성능") && specResultText.includes("외장 GPU 포함") && specResultText.includes("64GB") && specResultText.includes("2TB SSD"), "직접 성능 결과에 입력 기준 카드가 없습니다.");
  const spec = { path: location.pathname + location.search };

  await navigateStart();
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC가 필요하세요?", "나중에 선택 초기 화면");
  await chooseOption("나중에 할래요", "홈으로 돌아가기");
  clickButton("홈으로 돌아가기");
  await waitFor(() => location.pathname === "/" && document.querySelector(".home-page") !== null, "나중에 선택 후 홈 이동");
  const later = { path: location.pathname, home: true };

  await navigateStart();
  await waitFor(() => text(document.querySelector(".onboarding-title")) === "어떤 PC가 필요하세요?", "업그레이드 초기 화면");
  await chooseOption("이미 가지고 있는 컴퓨터를 업그레이드하고 싶어요", "다음");
  clickButton("다음");
  await waitFor(() => document.querySelector(".onboarding-steps-list") !== null, "업그레이드 안내 화면");
  clickButton("현재 부품 고르기");
  await waitFor(() => location.pathname === "/build" && new URLSearchParams(location.search).get("entry") === "upgrade", "업그레이드 편집기 handoff");
  const upgrade = { path: location.pathname + location.search, entry: "upgrade" };

  if (errors.length > 0) throw new Error(`온보딩 브라우저 오류: ${errors.join(" | ")}`);
  return { stage: "passed", gaming, work, budgetOnly, spec, later, upgrade };
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
