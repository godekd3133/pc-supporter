import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, firstAvailable, freePort, openDetails, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.GENERATOR_REASONS_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const mobile = process.env.GENERATOR_REASONS_SMOKE_MOBILE === "true";
const dark = process.env.GENERATOR_REASONS_SMOKE_DARK === "true";
const variantsMode = process.env.GENERATOR_REASONS_SMOKE_VARIANTS === "true";
const budget = process.env.GENERATOR_REASONS_SMOKE_BUDGET ?? "3000000";
const screenshotPath = process.env.GENERATOR_REASONS_SMOKE_SCREENSHOT;
const viewportHeight = Number(process.env.GENERATOR_REASONS_SMOKE_HEIGHT ?? (mobile ? 844 : 900));
const captureTarget = process.env.GENERATOR_REASONS_SMOKE_CAPTURE ?? "summary";

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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-generator-reasons-smoke-"));
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
    await client.send("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1280, height: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : (mobile ? 844 : 900), deviceScaleFactor: 1, mobile });
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: `${baseUrl}/recommend?profile=gaming&priority=balanced&resolution=4k&refresh=144&games=cyberpunk&graphics=high&rt=1&upscaling=quality&budget=${encodeURIComponent(budget)}${variantsMode ? "" : "&autorun=1"}` });
    await waitForValue(client, "location.pathname === '/recommend' && document.querySelector('.generator-form') !== null", "자동 견적 입력 화면");
    if (variantsMode) {
      await client.evaluate(`(() => {
        const originalFetch = window.fetch.bind(window);
        window.__generatorRecommendationRequests = [];
        window.fetch = (input, init) => {
          const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
          const requestUrl = new URL(rawUrl, location.href);
          if ((init?.method ?? "GET").toUpperCase() === "POST" && requestUrl.pathname.startsWith("/api/builds/recommend")) window.__generatorRecommendationRequests.push(requestUrl.pathname);
          return originalFetch(input, init);
        };
      })()`);
      const clicked = await client.evaluate("(() => { const node = [...document.querySelectorAll('.generator-form button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('균형형·가성비·성능 3안 비교')); if (!node) return false; node.click(); return true; })()");
      if (!clicked) throw new Error("3안 비교 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('.generator-variants') !== null && document.querySelectorAll('[data-testid^=\"generator-variant-reasons-\"]').length === 3", "자동 구성 3안·선택 이유");
      await openDetails(client, "details.generator-variant-reasons", "3안 선택 이유 상세");
      await client.evaluate("document.querySelector('.generator-variant-reasons')?.scrollIntoView({ block: 'center', behavior: 'instant' });");
      if (dark) await client.evaluate("document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark';");
      await sleep(350);
      const probe = await client.evaluate(`(() => {
        const panels = [...document.querySelectorAll('[data-testid^="generator-variant-reasons-"]')];
        const equivalenceNotice = document.querySelector('[data-testid="generator-variant-equivalence-notice"]');
        const tradeoffSummary = document.querySelector('[data-testid="generator-variant-tradeoff-summary"]');
        const decisionSummary = document.querySelector('.generator-decision-summary');
        const adjustConditionsButton = document.querySelector('[data-testid="generator-variant-adjust-conditions"]');
        const comparisonText = document.querySelector('.generator-variants-table-wrap')?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        const headingText = document.querySelector('.generator-variants-heading > span')?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        const configurationCount = Number(headingText.match(/구성\\s+(\\d+)종/)?.[1] ?? 0);
        const expectedEquivalence = configurationCount === 1 && panels.length > 1;
        const recommendationRequests = Array.isArray(window.__generatorRecommendationRequests) ? window.__generatorRecommendationRequests : [];
        const body = panels.map((panel) => panel.textContent ?? "").join(" ").replace(/\\s+/g, " ").trim();
        return { path: location.pathname, panelCount: panels.length, openCount: panels.filter((panel) => panel instanceof HTMLDetailsElement && panel.open).length, articleCounts: panels.map((panel) => panel.querySelectorAll('article').length), configurationCount, expectedEquivalence, recommendationRequests, equivalenceNotice: Boolean(equivalenceNotice), equivalenceText: equivalenceNotice?.textContent?.replace(/\\s+/g, " ").trim() ?? "", adjustConditionsButton: Boolean(adjustConditionsButton), tradeoffSummary: Boolean(tradeoffSummary), tradeoffText: tradeoffSummary?.textContent?.replace(/\\s+/g, " ").trim() ?? "", decisionSummary: Boolean(decisionSummary), decisionCardCount: decisionSummary?.querySelectorAll('.generator-decision-card').length ?? 0, decisionText: decisionSummary?.textContent?.replace(/\\s+/g, " ").trim() ?? "", comparisonText, body };
      })()`);
      if (probe.path !== "/recommend" || probe.panelCount !== 3 || probe.openCount !== 3 || probe.articleCounts.some((count) => count < 6) || probe.recommendationRequests.length !== 1 || probe.recommendationRequests[0] !== "/api/builds/recommend/variants" || !probe.tradeoffSummary || !probe.decisionSummary || probe.decisionCardCount !== 3 || !probe.decisionText.includes("기준별 비교 결과") || probe.equivalenceNotice !== probe.expectedEquivalence || probe.adjustConditionsButton !== probe.expectedEquivalence || (probe.expectedEquivalence && (!probe.equivalenceText.includes("세 안이 같은 구성") || !probe.decisionText.includes("같은 구성을 가리킵니다") || !probe.tradeoffText.includes("비교 결과") || !probe.tradeoffText.includes("총액 차이 없음") || !probe.tradeoffText.includes("부품 변경없음"))) || !probe.comparisonText.includes("구성 차이") || !probe.comparisonText.includes("기준 구성") || (probe.expectedEquivalence && !probe.comparisonText.includes("직전 안과 동일")) || (!probe.expectedEquivalence && (!probe.comparisonText.includes("변경") || !probe.comparisonText.includes("균형형과 동일") || !probe.tradeoffText.includes("구성2종") || !probe.tradeoffText.includes("가격 차이") || !probe.tradeoffText.includes("부품 변경8개 항목"))) || !probe.body.includes("사이버펑크 2077") || !probe.body.includes("권장 VRAM") || !probe.body.includes("정격")) {
        throw new Error(`3안 선택 이유 화면 검증 실패: ${JSON.stringify(probe)}`);
      }
      if (screenshotPath) {
        const captureSelector = captureTarget === "decision" ? ".generator-decision-summary" : "[data-testid=\"generator-variant-equivalence-notice\"], [data-testid=\"generator-variant-tradeoff-summary\"], .generator-variants-heading";
        await client.evaluate(`document.querySelector(${JSON.stringify(captureSelector)})?.scrollIntoView({ block: 'center', behavior: 'instant' }); window.scrollBy(0, -110);`);
        await sleep(350);
        const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      }
      console.log(JSON.stringify({ ok: true, viewport: mobile ? "mobile" : "desktop", theme: dark ? "dark" : "light", mode: "variants", ...probe, ...(screenshotPath ? { screenshotPath } : {}) }, null, 2));
    } else {
      await waitForValue(client, "document.querySelector('.generator-result') !== null && document.querySelector('[data-testid=\"generator-selection-reasons\"]') !== null", "자동 견적 생성·선택 이유");
      await openDetails(client, "details.generator-selection-reasons", "부품 선택 이유 상세");
      await client.evaluate("document.querySelector('[data-testid=\"generator-selection-reasons\"]')?.scrollIntoView({ block: 'center', behavior: 'instant' });");
      if (dark) await client.evaluate("document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark';");
      await sleep(350);
      const probe = await client.evaluate(`(() => {
        const panel = document.querySelector('[data-testid="generator-selection-reasons"]');
        const body = panel?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        return { path: location.pathname, panel: Boolean(panel), open: panel instanceof HTMLDetailsElement ? panel.open : false, reasonCount: panel?.querySelectorAll('article').length ?? 0, body };
      })()`);
      if (probe.path !== "/recommend" || !probe.panel || !probe.open || probe.reasonCount < 6 || !probe.body.includes("사이버펑크 2077") || !probe.body.includes("권장 VRAM") || !probe.body.includes("메인보드") || !probe.body.includes("정격")) {
        throw new Error(`부품 선택 이유 화면 검증 실패: ${JSON.stringify(probe)}`);
      }
      if (screenshotPath) {
        const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      }
      console.log(JSON.stringify({ ok: true, viewport: mobile ? "mobile" : "desktop", theme: dark ? "dark" : "light", mode: "single", ...probe, ...(screenshotPath ? { screenshotPath } : {}) }, null, 2));
    }
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
