import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BUDGET_LADDER_SUMMARY_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const mobile = process.env.BUDGET_LADDER_SUMMARY_SMOKE_MOBILE === "true";
const dark = process.env.BUDGET_LADDER_SUMMARY_SMOKE_DARK === "true";
const screenshotPath = process.env.BUDGET_LADDER_SUMMARY_SMOKE_SCREENSHOT;

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); } catch { /* cleanup is best effort */ }
  }
  try { child.kill(signal); } catch { /* cleanup is best effort */ }
}

async function main() {
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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-budget-ladder-summary-smoke-"));
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
    "about:blank"
  ], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  let client;
  let chromeExited = false;
  const chromeExit = new Promise((resolve) => chrome.once("exit", () => { chromeExited = true; resolve(); }));
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
    const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!target) throw new Error("Chrome 페이지 target을 찾지 못했습니다.");
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1280, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: `${baseUrl}/recommend?profile=gaming&priority=balanced&resolution=1440p&refresh=144&games=cyberpunk&graphics=high&rt=1&upscaling=quality&budget=2200000` });
    await waitForValue(client, "location.pathname === '/recommend' && document.querySelector('.generator-form') !== null", "자동 견적 입력 화면");
    const clicked = await client.evaluate("(() => { const node = [...document.querySelectorAll('.generator-form button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('예산 구간 3안 비교')); if (!node) return false; node.click(); return true; })()");
    if (!clicked) throw new Error("예산 구간 3안 비교 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('.generator-budget-ladder') !== null && document.querySelector('[data-testid=\"generator-budget-comparison-summary\"]') !== null", "예산 구간 비교 결과와 핵심 요약");
    if (dark) await client.evaluate("document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark';");
    await sleep(350);
    const probe = await client.evaluate(`(() => {
      const panel = document.querySelector('.generator-budget-ladder');
      const summary = document.querySelector('[data-testid="generator-budget-comparison-summary"]');
      const table = panel?.querySelector('.generator-budget-table-wrap');
      const budgetErrors = panel?.querySelector('.generator-budget-errors');
      const empty = panel?.querySelector('.generator-budget-empty');
      const deltas = document.querySelector('.generator-budget-deltas');
      const cards = [...(panel?.querySelectorAll('.generator-budget-card') ?? [])].map((card) => {
        const labeledValue = (label) => {
          const row = [...card.querySelectorAll('.generator-budget-card-total > div')].find((candidate) => (candidate.querySelector('span')?.textContent ?? '').includes(label));
          const text = row?.querySelector('strong')?.textContent ?? '';
          return Number(text.replace(/[^0-9]/g, '')) || 0;
        };
        const gpuRow = [...card.querySelectorAll('.generator-budget-card-lines > div')].find((row) => /그래픽카드|GPU/.test(row.querySelector('span')?.textContent ?? ''));
        return {
          failed: card.classList.contains('error'),
          targetBudgetWon: labeledValue('목표 예산'),
          totalPriceWon: labeledValue('합계'),
          gpu: gpuRow?.querySelector('strong')?.textContent?.trim() ?? ''
        };
      });
      const summaryText = summary?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
      const errorText = budgetErrors?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
      return {
        path: location.pathname,
        summary: Boolean(summary),
        summaryLabel: summary?.getAttribute('aria-label') ?? '',
        table: Boolean(table),
        deltas: Boolean(deltas),
        cards,
        summaryText,
        tradeoffText: deltas?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
        errorText,
        empty: Boolean(empty),
        progressText: panel?.querySelector('.generator-budget-ladder-heading-actions > span')?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
        width: document.body?.getBoundingClientRect().width ?? 0,
        documentWidth: document.documentElement?.scrollWidth ?? 0
      };
    })()`);
    const successfulCards = probe.cards.filter((card) => !card.failed);
    const failedCards = probe.cards.filter((card) => card.failed);
    const successfulTotals = successfulCards.map((card) => card.totalPriceWon);
    const distinctTotals = new Set(successfulTotals).size;
    const distinctGpus = new Set(successfulCards.map((card) => card.gpu).filter(Boolean)).size;
    const successfulBudgetsFit = successfulCards.every((card) => card.targetBudgetWon > 0 && card.totalPriceWon > 0 && card.totalPriceWon <= card.targetBudgetWon);
    const successfulSummary = successfulCards.length > 0
      && probe.summary
      && probe.table
      && probe.deltas
      && successfulBudgetsFit
      && (distinctTotals > 1 || distinctGpus > 1 || probe.summaryText.includes("같은 구성"))
      && probe.summaryLabel === "예산 구간 비교 결과"
      && /가격|예상 금액/.test(probe.summaryText)
      && probe.summaryText.includes("부품 변경")
      && /\d+종 구성/.test(probe.summaryText)
      && /합계 차이|총액 차이/.test(probe.summaryText)
      && probe.tradeoffText.includes("예산 증액으로 바뀐 것")
      && probe.tradeoffText.includes("실제 합계")
      && (probe.tradeoffText.includes("변경 부품") || probe.tradeoffText.includes("부품 구성이 같아요"));
    const explicitNoBudgetResults = successfulCards.length === 0
      && failedCards.length === 0
      && probe.empty
      && /예산|구성|데이터/.test(probe.errorText);
    if (probe.path !== "/recommend" || !/3개 생성 완료/.test(probe.progressText) || !(successfulSummary || explicitNoBudgetResults)) {
      throw new Error(`예산 구간 비교 핵심 요약 화면 검증 실패: ${JSON.stringify(probe)}`);
    }
    if (screenshotPath) await client.evaluate("window.__enableBudgetLadderFailureCapture = true");
    const budgetLadderFailureProbePromise = client.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const requests = [];
      const unhandledRejections = [];
      const onUnhandledRejection = (event) => {
        unhandledRejections.push(event.reason instanceof Error ? event.reason.message : String(event.reason));
        event.preventDefault();
      };
      const recoveryOption = {
        id: "budget-ladder-probe-relaxed-budget",
        label: "목표 예산 180만 원",
        summary: "180만 원 예산 안에서 부품을 다시 찾아요.",
        changedFields: ["목표 예산"],
        request: { profile: "gaming", budgetWon: 1800000, includeGpu: true, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, hddCapacityGb: 4000, listingPolicy: "retail_only" },
        preview: { totalPriceWon: 1700000, budgetDeltaWon: 100000, withinBudget: true, priceComplete: true, status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 }
      };
      const diagnostic = { id: "budget-ladder-probe-data-gap", title: "합성 진단", summary: "예산 추천 실패 경로 검증", facts: [{ label: "경로", value: "isolated probe" }] };
      const serviceFailureMessage = "저장소에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";
      let observedServiceErrorCode = "";
      let phase = "api-failure";
      const budgetInput = document.querySelector(".generator-input-with-unit input[type=number]");
      const button = document.querySelector(".generator-budget-submit");
      if (!(budgetInput instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) return { stage: "missing-controls" };
      const initialBudget = budgetInput.value;
      const comparisonDetails = document.querySelector(".generator-comparison-actions");
      if (comparisonDetails instanceof HTMLDetailsElement) comparisonDetails.open = true;
      window.addEventListener("unhandledrejection", onUnhandledRejection);
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        const method = (init?.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")).toUpperCase();
        if (requestUrl.pathname === "/api/builds/recommend/budget-ladder" && method === "POST") {
          requests.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
          if (phase === "api-failure") {
            const errorPayload = {
              error: serviceFailureMessage,
              code: "PERSISTENCE_UNAVAILABLE",
              diagnostics: [diagnostic],
              recoveryOptions: [recoveryOption],
              internalDetails: { message: "PostgresError: password authentication failed", stack: "Error: database unavailable\\n at connect (internal/db.ts:1:1)" }
            };
            observedServiceErrorCode = errorPayload.code;
            return new Response(JSON.stringify(errorPayload), { status: 503, headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ scenarios: [{ id: "malformed-hydration", draft: { selection: null } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(input, init);
      };
      try {
        const waitForFailure = async (matches) => {
          for (let index = 0; index < 200; index += 1) {
            const message = document.querySelector(".generator-request-error p")?.textContent ?? "";
            if (matches(message)) return message;
            await wait(25);
          }
          return document.querySelector(".generator-request-error p")?.textContent ?? "";
        };
        button.click();
        const apiFailureMessage = await waitForFailure((message) => message.includes(serviceFailureMessage));
        const apiFailureAlertText = document.querySelector('.generator-request-error[role="alert"]')?.textContent ?? "";
        const apiFailure = {
          message: apiFailureMessage,
          requestErrorAlertVisible: document.querySelector('.generator-request-error[role="alert"]') !== null,
          errorCode: observedServiceErrorCode,
          alertText: apiFailureAlertText,
          internalDetailsVisible: /PostgresError|password authentication|DATABASE_URL|stack trace|at connect|PERSISTENCE_UNAVAILABLE/i.test(apiFailureAlertText),
          recoveryOptionVisible: (document.querySelector(".generator-recovery-options")?.textContent ?? "").includes("목표 예산 180만 원"),
          toastVisible: document.querySelector(".toast") !== null,
          budget: budgetInput.value,
          retryEnabled: !button.disabled,
          requestCount: requests.length
        };
        if (window.__enableBudgetLadderFailureCapture) {
          window.__budgetLadderFailureCaptureReady = true;
          await new Promise((resolve) => { window.__budgetLadderFailureCaptureRelease = resolve; });
          delete window.__budgetLadderFailureCaptureReady;
          delete window.__budgetLadderFailureCaptureRelease;
        }
        phase = "hydration-failure";
        button.click();
        const hydrationFailureMessage = await waitForFailure((message) => message.toLowerCase().includes("null") && message.toLowerCase().includes("cpu"));
        await wait(250);
        return {
          stage: "checked",
          initialBudget,
          apiFailure,
          hydrationFailureMessage,
          hydrationErrorAlertVisible: document.querySelector('.generator-request-error[role="alert"]') !== null,
          toastVisibleAfterHydration: document.querySelector(".toast") !== null,
          requestCount: requests.length,
          requestBudgets: requests.map((request) => request.budgetWon),
          currentBudget: budgetInput.value,
          retryEnabled: !button.disabled,
          unhandledRejections
        };
      } finally {
        window.fetch = originalFetch;
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
      }
    })()`);
    if (screenshotPath) {
      await waitForValue(client, "window.__budgetLadderFailureCaptureReady === true", "503 예산 복구 안내 캡처 지점");
      await client.evaluate("document.querySelector('.generator-request-error')?.scrollIntoView({ block: 'center', behavior: 'instant' })");
      await sleep(250);
      const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await mkdir(dirname(screenshotPath), { recursive: true });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      await client.evaluate("window.__budgetLadderFailureCaptureRelease?.()");
    }
    const budgetLadderFailureProbe = await budgetLadderFailureProbePromise;
    if (budgetLadderFailureProbe?.stage !== "checked"
      || budgetLadderFailureProbe.initialBudget !== "2200000"
      || budgetLadderFailureProbe.apiFailure?.message !== "저장소에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."
      || budgetLadderFailureProbe.apiFailure?.requestErrorAlertVisible !== true
      || budgetLadderFailureProbe.apiFailure?.errorCode !== "PERSISTENCE_UNAVAILABLE"
      || !budgetLadderFailureProbe.apiFailure?.alertText.includes("저장소에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.")
      || budgetLadderFailureProbe.apiFailure?.internalDetailsVisible !== false
      || budgetLadderFailureProbe.apiFailure?.recoveryOptionVisible !== true
      || budgetLadderFailureProbe.apiFailure?.toastVisible !== false
      || budgetLadderFailureProbe.apiFailure?.budget !== "2200000"
      || budgetLadderFailureProbe.apiFailure?.retryEnabled !== true
      || budgetLadderFailureProbe.apiFailure?.requestCount !== 3
      || !budgetLadderFailureProbe.hydrationFailureMessage.toLowerCase().includes("null")
      || !budgetLadderFailureProbe.hydrationFailureMessage.toLowerCase().includes("cpu")
      || budgetLadderFailureProbe.hydrationErrorAlertVisible !== true
      || budgetLadderFailureProbe.toastVisibleAfterHydration !== false
      || budgetLadderFailureProbe.requestCount !== 4
      || budgetLadderFailureProbe.requestBudgets.length !== 4
      || budgetLadderFailureProbe.requestBudgets.some((budget) => budget !== 2_200_000)
      || budgetLadderFailureProbe.currentBudget !== "2200000"
      || budgetLadderFailureProbe.retryEnabled !== true
      || budgetLadderFailureProbe.unhandledRejections.length !== 0) {
      throw new Error(`예산 구간 POST·부품 정보 수화 실패 경로 검증 실패: ${JSON.stringify(budgetLadderFailureProbe)}`);
    }
    console.log(JSON.stringify({ ok: true, viewport: mobile ? "mobile" : "desktop", theme: dark ? "dark" : "light", ...probe, budgetLadderFailureProbe, ...(screenshotPath ? { screenshotPath } : {}) }, null, 2));
  } finally {
    client?.close();
    if (!chromeExited) {
      signalProcessGroup(chrome, "SIGTERM");
      await Promise.race([chromeExit, sleep(2_000)]);
      if (!chromeExited) {
        signalProcessGroup(chrome, "SIGKILL");
        await Promise.race([chromeExit, sleep(1_000)]);
      }
    }
    await rm(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
