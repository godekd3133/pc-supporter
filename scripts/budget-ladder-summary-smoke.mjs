import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await waitForValue(client, "document.querySelector('.generator-budget-ladder') !== null && /\\d+ \\/ 3개 생성 완료/.test(document.querySelector('.generator-budget-ladder')?.textContent ?? '')", "예산 구간 비교 결과");
    if (dark) await client.evaluate("document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark';");
    await sleep(350);
    const probe = await client.evaluate(`(() => {
      const panel = document.querySelector('.generator-budget-ladder');
      const summary = panel?.querySelector('[data-testid="generator-budget-comparison-summary"]');
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
        table: Boolean(table),
        deltas: Boolean(deltas),
        cards,
        summaryText,
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
      && successfulBudgetsFit
      && (distinctTotals > 1 || distinctGpus > 1 || probe.summaryText.includes("같은 구성"));
    const explicitNoBudgetResults = successfulCards.length === 0
      && failedCards.length === 0
      && probe.empty
      && /예산|구성|데이터/.test(probe.errorText);
    if (probe.path !== "/recommend" || !/3개 생성 완료/.test(probe.progressText) || !(successfulSummary || explicitNoBudgetResults)) {
      throw new Error(`예산 구간 비교 핵심 요약 화면 검증 실패: ${JSON.stringify(probe)}`);
    }
    if (screenshotPath) {
      await client.evaluate("document.querySelector('[data-testid=\"generator-budget-comparison-summary\"]')?.scrollIntoView({ block: 'center', behavior: 'instant' }); window.scrollBy(0, -110);");
      await sleep(350);
      const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    }
    console.log(JSON.stringify({ ok: true, viewport: mobile ? "mobile" : "desktop", theme: dark ? "dark" : "light", ...probe, ...(screenshotPath ? { screenshotPath } : {}) }, null, 2));
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
