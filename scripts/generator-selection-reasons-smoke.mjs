import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, firstAvailable, freePort, openDetails, setFileInput, setInputValue, setTextValue, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.GENERATOR_REASONS_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const mobile = process.env.GENERATOR_REASONS_SMOKE_MOBILE === "true";
const dark = process.env.GENERATOR_REASONS_SMOKE_DARK === "true";
const variantsMode = process.env.GENERATOR_REASONS_SMOKE_VARIANTS === "true";
const budget = process.env.GENERATOR_REASONS_SMOKE_BUDGET ?? "3000000";
const screenshotPath = process.env.GENERATOR_REASONS_SMOKE_SCREENSHOT;
const viewportHeight = Number(process.env.GENERATOR_REASONS_SMOKE_HEIGHT ?? (mobile ? 844 : 900));
const captureTarget = process.env.GENERATOR_REASONS_SMOKE_CAPTURE ?? "summary";
const executeExportActions = process.env.GENERATOR_REASONS_SMOKE_EXECUTE_EXPORTS !== "false";
const invalidImportProbeEnabled = process.env.GENERATOR_REASONS_SMOKE_INVALID_IMPORT === "true";

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
      let localHistoryProbe = false;
      let localHistoryOpenProbe = false;
      let localHistoryDeleteProbe = false;
      let sharedVariantsProbe = false;
      let sharedVariantsRouteProbe = false;
      let sharedVariantsRefreshProbe = false;
      let sharedVariantsCurrentActionsProbe = false;
      let sharedVariantsDraftActionsProbe = false;
      let sharedVariantsRevokedProbe = false;
      const saveHistory = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"generator-variants-save-history\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
      if (!saveHistory) throw new Error("자동 구성 비교 저장 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"generator-variants-local-history\"]') !== null", "자동 구성 비교 최근 이력 저장");
      localHistoryProbe = await client.evaluate("(() => Boolean(document.querySelector('[data-testid=\"generator-variants-local-history\"]')))()");
      const openHistory = await client.evaluate("(() => { const node = document.querySelector('[data-testid^=\"generator-variants-history-open-\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
      if (!openHistory) throw new Error("자동 구성 비교 최근 이력 불러오기 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"generator-variant-import-preview\"]') !== null", "자동 구성 비교 최근 이력 미리보기");
      localHistoryOpenProbe = await client.evaluate("(() => Boolean(document.querySelector('[data-testid=\"generator-variant-import-preview\"]')))()");
      await client.evaluate("document.querySelector('[data-testid=\"generator-variants-close-import\"]')?.click()");
      await waitForValue(client, "document.querySelector('[data-testid=\"generator-variant-import-preview\"]') === null", "자동 구성 비교 최근 이력 미리보기 닫기");
      const deleteHistory = await client.evaluate("(() => { const node = document.querySelector('[data-testid^=\"generator-variants-history-delete-\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
      if (!deleteHistory) throw new Error("자동 구성 비교 최근 이력 삭제 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"generator-variants-local-history\"]') === null", "자동 구성 비교 최근 이력 삭제");
      localHistoryDeleteProbe = await client.evaluate("(() => !document.querySelector('[data-testid=\"generator-variants-local-history\"]'))()");
      await client.evaluate(`(() => {
        window.__generatorShareProbe = { response: null };
        const originalFetch = window.fetch.bind(window);
        window.__generatorShareProbe.originalFetch = originalFetch;
        window.fetch = async (input, init) => {
          const response = await originalFetch(input, init);
          const url = typeof input === "string" ? input : input.url;
          if (new URL(url, location.href).pathname === "/api/generator-variants" && (init?.method ?? "GET").toUpperCase() === "POST") {
            try { window.__generatorShareProbe.response = await response.clone().json(); } catch {}
          }
          return response;
        };
      })()`);
      const shareButton = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"generator-variants-share\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
      if (!shareButton) throw new Error("자동 구성 비교 공유 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"generator-variants-share-preview\"]') !== null && window.__generatorShareProbe?.response?.ownerToken", "자동 구성 비교 공유 링크");
      const sharedUrl = await client.evaluate("document.querySelector('input[aria-label=\"자동 구성 3안 비교 공유 링크\"]')?.value ?? ''");
      sharedVariantsProbe = typeof sharedUrl === "string" && sharedUrl.includes("/generator-variants/");
      if (!sharedVariantsProbe) throw new Error("자동 구성 비교 공유 URL을 읽지 못했습니다.");
      const sharedPath = new URL(sharedUrl, baseUrl).pathname;
      await client.evaluate(`history.pushState({}, '', ${JSON.stringify(sharedPath)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
      await waitForValue(client, "document.querySelector('.shared-generator-variants-page') !== null && document.querySelector('[data-testid=\"shared-generator-variants-summary\"]') !== null", "공유 자동 구성 비교 화면");
      sharedVariantsRouteProbe = await client.evaluate("(() => { const page = document.querySelector('.shared-generator-variants-page'); const summary = document.querySelector('[data-testid=\"shared-generator-variants-summary\"]'); const conditions = document.querySelector('[data-testid=\"shared-generator-variants-conditions\"]'); return Boolean(page && summary && conditions instanceof HTMLAnchorElement && conditions.pathname === '/recommend' && (conditions.search ?? '').includes('profile=') && (conditions.search ?? '').includes('budget=')); })()");
      const refreshShared = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"shared-generator-variants-refresh\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
      if (!refreshShared) throw new Error("공유 자동 구성 현재 기준 재생성 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"shared-generator-variants-current\"]') !== null", "공유 자동 구성 현재 기준 재생성");
      sharedVariantsRefreshProbe = await client.evaluate("(() => Boolean(document.querySelector('[data-testid=\"shared-generator-variants-current\"]')))()");
      sharedVariantsCurrentActionsProbe = await client.evaluate("(() => document.querySelectorAll('[data-testid^=\"shared-generator-variants-current-start-\"]').length === 3)()");
      sharedVariantsDraftActionsProbe = await client.evaluate("(() => ['edit', 'check', 'save'].every((mode) => document.querySelectorAll(`[data-testid^=\"shared-generator-variants-current-${mode}-\"]`).length === 3))()");
      await client.evaluate("history.back()");
      await waitForValue(client, "document.querySelector('.generator-variants') !== null", "공유 화면에서 자동 구성 화면 복귀");
      await client.evaluate("window.__generatorRecommendationRequests = ['/api/builds/recommend/variants'];");
      const shareId = sharedPath.split("/").pop() ?? "";
      const shareListVisibleBeforeRevoke = await client.evaluate("(() => Boolean(document.querySelector('[data-testid=\"generator-variants-local-shares\"]')))()");
      const revokeProbe = await client.evaluate(`(async () => {
        const originalConfirm = window.confirm;
        window.confirm = () => true;
        try {
          const button = document.querySelector('[data-testid="generator-variants-share-revoke-${shareId}"]');
          if (!(button instanceof HTMLButtonElement)) return { stage: "missing-button" };
          button.click();
          for (let index = 0; index < 80; index += 1) {
            if (!document.querySelector('[data-testid="generator-variants-local-shares"]')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const response = await fetch("/api/generator-variants/${shareId}");
          return { stage: "done", shareListCleared: !document.querySelector('[data-testid="generator-variants-local-shares"]'), getStatus: response.status };
        } finally {
          window.confirm = originalConfirm;
        }
      })()`);
      sharedVariantsRevokedProbe = Boolean(shareListVisibleBeforeRevoke && revokeProbe?.shareListCleared && revokeProbe?.getStatus === 404);
      await client.evaluate("if (window.__generatorShareProbe?.originalFetch) window.fetch = window.__generatorShareProbe.originalFetch;");
      const importFixturePath = join(profileDir, "generator-variants-import.json");
      await writeFile(importFixturePath, JSON.stringify({
        type: "pc-supporter-generator-variants",
        version: 1,
        exportedAt: "2026-09-17T00:00:00.000Z",
        items: [
          { priority: "balanced", label: "균형형", status: "호환 가능", totalPriceWon: 1_481_630, analysisScore: 82 },
          { priority: "budget", label: "가성비 우선", status: "호환 가능", totalPriceWon: 899_980, analysisScore: 23 },
          { priority: "performance", label: "성능 우선", status: "호환 가능", totalPriceWon: 1_481_630, analysisScore: 82 }
        ]
      }, null, 2));
      await client.send("DOM.enable");
      const documentTree = await client.send("DOM.getDocument", { depth: -1 });
      const importInputNode = await client.send("DOM.querySelector", { nodeId: documentTree.root.nodeId, selector: 'input[aria-label="자동 구성 3안 비교 JSON 가져오기"]' });
      if (!importInputNode.nodeId) throw new Error("자동 구성 비교 JSON input을 찾지 못했습니다.");
      await client.send("DOM.setFileInputFiles", { nodeId: importInputNode.nodeId, files: [importFixturePath] });
      await waitForValue(client, "document.querySelector('[data-testid=\"generator-variant-import-preview\"]') !== null && (document.body?.innerText ?? '').includes('가져온 비교 결과')", "자동 구성 JSON 가져오기 미리보기");
      let invalidImportProbe = false;
      if (invalidImportProbeEnabled) {
        const invalidImportFixturePath = join(profileDir, "generator-variants-invalid.json");
        await writeFile(invalidImportFixturePath, "{\"type\":\"not-a-generator-snapshot\",\"items\":[]}");
        await client.send("DOM.setFileInputFiles", { nodeId: importInputNode.nodeId, files: [invalidImportFixturePath] });
        await waitForValue(client, "document.querySelector('[data-testid=\"generator-variant-import-error\"]') !== null && document.querySelector('[data-testid=\"generator-variant-tradeoff-summary\"]') !== null", "자동 구성 JSON 오류 처리");
        invalidImportProbe = await client.evaluate("(() => Boolean(document.querySelector('[data-testid=\"generator-variant-import-error\"]') && document.querySelector('[data-testid=\"generator-variant-tradeoff-summary\"]')))() ");
      }
      let exportActionsExecuted = false;
      let exportedPayloadForTransfer = "";
      let importedStateProbe = false;
      let importedStateClearedOnRegenerateProbe = false;
      let returnedCurrentProbe = false;
      let malformedDraftProbe = false;
      let importedScreenshotCaptured = false;
      if (executeExportActions) {
        try {
          await client.evaluate(`(() => {
          window.__generatorExportProbe = { clipboardText: "", downloadName: "", downloadBlob: null };
          const clipboard = navigator.clipboard ?? {};
          try {
            Reflect.defineProperty(navigator, "clipboard", { configurable: true, value: { ...clipboard, writeText: async (value) => { window.__generatorExportProbe.clipboardText = String(value); } } });
          } catch {
            window.__generatorExportProbe.clipboardUnavailable = true;
          }
          try {
            const originalCreateObjectURL = URL.createObjectURL.bind(URL);
            Reflect.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob) => { window.__generatorExportProbe.downloadBlob = blob; return originalCreateObjectURL(blob); } });
          } catch {
            window.__generatorExportProbe.objectUrlUnavailable = true;
          }
          HTMLAnchorElement.prototype.click = function () { if (this.download) window.__generatorExportProbe.downloadName = this.download; };
          })()`);
        } catch (error) {
          throw new Error(`자동 구성 export 후킹 설치 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
        let exportActionResult;
        try {
          exportActionResult = await client.evaluate(`(async () => {
          const copy = document.querySelector('[data-testid="generator-variants-copy"]');
          const json = document.querySelector('[data-testid="generator-variants-json"]');
          if (!(copy instanceof HTMLButtonElement) || !(json instanceof HTMLButtonElement)) return { clicked: false, payload: "" };
          copy.click();
          json.click();
          await new Promise((resolve) => setTimeout(resolve, 80));
          const payload = window.__generatorExportProbe?.downloadBlob instanceof Blob
            ? await window.__generatorExportProbe.downloadBlob.text()
            : "";
          return { clicked: true, payload };
          })()`);
        } catch (error) {
          throw new Error(`자동 구성 export 실행 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
        exportActionsExecuted = Boolean(exportActionResult?.clicked);
        if (exportActionResult?.payload) {
          let exportedPayload;
          try {
            exportedPayload = JSON.parse(exportActionResult.payload);
          } catch {
            throw new Error("자동 구성 JSON 저장 결과를 다시 파싱하지 못했습니다.");
          }
          exportedPayloadForTransfer = exportActionResult.payload;
          const malformedDraftPath = join(profileDir, "generator-variants-malformed-draft.json");
          const malformedPayload = JSON.parse(JSON.stringify(exportedPayload));
          const malformedLine = malformedPayload.items?.[0]?.draft?.lines?.[0];
          if (!malformedLine) throw new Error("자동 구성 JSON 변조 검증용 draft line을 찾지 못했습니다.");
          malformedLine.quantity = -1;
          await writeFile(malformedDraftPath, JSON.stringify(malformedPayload, null, 2));
          if (!await setFileInput(client, 'input[aria-label="자동 구성 3안 비교 JSON 가져오기"]', malformedDraftPath)) throw new Error("변조된 자동 구성 JSON input을 찾지 못했습니다.");
          await waitForValue(client, "document.querySelector('[data-testid=\"generator-variant-import-preview\"]') !== null && document.querySelector('[data-testid=\"generator-variants-apply-import\"]') === null", "변조된 자동 구성 JSON 적용 차단");
          malformedDraftProbe = await client.evaluate("(() => Boolean(document.querySelector('[data-testid=\"generator-variant-import-preview\"]') && !document.querySelector('[data-testid=\"generator-variants-apply-import\"]')) )()");
          await writeFile(importFixturePath, exportActionResult.payload);
          if (!await setFileInput(client, 'input[aria-label="자동 구성 3안 비교 JSON 가져오기"]', importFixturePath)) throw new Error("복원 상태 재확인용 JSON input을 찾지 못했습니다.");
          await waitForValue(client, "document.querySelector('[data-testid=\"generator-variant-import-preview\"]') !== null && document.querySelector('[data-testid=\"generator-variants-apply-import\"]') !== null", "저장한 자동 구성 JSON 재가져오기");
          const applyImported = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"generator-variants-apply-import\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
          if (!applyImported) throw new Error("저장한 자동 구성 JSON 적용 버튼을 찾지 못했습니다.");
          await waitForValue(client, "document.querySelector('[data-testid=\"generator-variants-imported-state\"]') !== null", "가져온 자동 구성 비교 상태");
          importedStateProbe = await client.evaluate("(() => Boolean(document.querySelector('[data-testid=\"generator-variants-imported-state\"]')))()");
          if (screenshotPath && captureTarget === "imported") {
            await client.evaluate("document.querySelector('[data-testid=\"generator-variants-imported-state\"]')?.scrollIntoView({ block: 'center', behavior: 'instant' }); window.scrollBy(0, -110);");
            await sleep(4_000);
            const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
            importedScreenshotCaptured = true;
          }
          if (!await setInputValue(client, '.generator-form input[type="number"]', budget)) throw new Error("자동 구성 재생성용 예산 입력을 설정하지 못했습니다.");
          const compareAgain = await client.evaluate("(() => { const node = [...document.querySelectorAll('.generator-form button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('균형형·가성비·성능 3안 비교')); if (!node) return false; node.click(); return true; })()");
          if (!compareAgain) throw new Error("가져온 상태에서 새 자동 구성 비교 버튼을 찾지 못했습니다.");
          await waitForValue(client, "Array.isArray(window.__generatorRecommendationRequests) && window.__generatorRecommendationRequests.length === 2 && document.querySelector('[data-testid=\"generator-variants-imported-state\"]') === null && document.querySelector('.generator-variants') !== null", "새 자동 구성 결과로 복귀");
          importedStateClearedOnRegenerateProbe = await client.evaluate("(() => !document.querySelector('[data-testid=\"generator-variants-imported-state\"]'))()");
          if (!await setFileInput(client, 'input[aria-label="자동 구성 3안 비교 JSON 가져오기"]', importFixturePath)) throw new Error("복원 상태 재확인용 JSON input을 찾지 못했습니다.");
          await waitForValue(client, "document.querySelector('[data-testid=\"generator-variant-import-preview\"]') !== null && document.querySelector('[data-testid=\"generator-variants-apply-import\"]') !== null", "복원 상태 재확인 미리보기");
          const reapplyImported = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"generator-variants-apply-import\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
          if (!reapplyImported) throw new Error("복원 상태 재확인 적용 버튼을 찾지 못했습니다.");
          await waitForValue(client, "document.querySelector('[data-testid=\"generator-variants-imported-state\"]') !== null", "복원 상태 재확인");
          const returnCurrent = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"generator-variants-return-current\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
          if (!returnCurrent) throw new Error("현재 생성 결과로 돌아가기 버튼을 찾지 못했습니다.");
          await waitForValue(client, "document.querySelector('[data-testid=\"generator-variants-imported-state\"]') === null && document.querySelector('[data-testid=\"generator-variant-tradeoff-summary\"]') !== null", "현재 자동 구성 결과 복귀");
          returnedCurrentProbe = await client.evaluate("(() => !document.querySelector('[data-testid=\"generator-variants-imported-state\"]'))()");
        }
      }
      await openDetails(client, "details.generator-variant-reasons", "최종 자동 구성 선택 이유 상세");
      const probe = await client.evaluate(`(() => {
        const panels = [...document.querySelectorAll('[data-testid^="generator-variant-reasons-"]')];
        const equivalenceNotice = document.querySelector('[data-testid="generator-variant-equivalence-notice"]');
        const tradeoffSummary = document.querySelector('[data-testid="generator-variant-tradeoff-summary"]');
        const decisionSummary = document.querySelector('.generator-decision-summary');
        const exportCopyButton = document.querySelector('[data-testid="generator-variants-copy"]');
        const exportJsonButton = document.querySelector('[data-testid="generator-variants-json"]');
        const exportImportButton = document.querySelector('[data-testid="generator-variants-import"]');
        const importPreview = document.querySelector('[data-testid="generator-variant-import-preview"]');
        const importedState = document.querySelector('[data-testid="generator-variants-imported-state"]');
        const adjustConditionsButton = document.querySelector('[data-testid="generator-variant-adjust-conditions"]');
        const comparisonText = document.querySelector('.generator-variants-table-wrap')?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        const headingText = document.querySelector('.generator-variants-heading-actions > span')?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
        const configurationCount = Number(headingText.match(/구성\\s*(\\d+)종/)?.[1] ?? tradeoffSummary?.textContent?.match(/비교 결과\\s*(\\d+)종 구성/)?.[1] ?? 0);
        const expectedEquivalence = configurationCount === 1 && panels.length > 1;
        const recommendationRequests = Array.isArray(window.__generatorRecommendationRequests) ? window.__generatorRecommendationRequests : [];
        const body = panels.map((panel) => panel.textContent ?? "").join(" ").replace(/\\s+/g, " ").trim();
        const exportProbe = window.__generatorExportProbe ?? {};
        return { path: location.pathname, panelCount: panels.length, openCount: panels.filter((panel) => panel instanceof HTMLDetailsElement && panel.open).length, articleCounts: panels.map((panel) => panel.querySelectorAll('article').length), configurationCount, expectedEquivalence, recommendationRequests, equivalenceNotice: Boolean(equivalenceNotice), equivalenceText: equivalenceNotice?.textContent?.replace(/\\s+/g, " ").trim() ?? "", adjustConditionsButton: Boolean(adjustConditionsButton), tradeoffSummary: Boolean(tradeoffSummary), tradeoffText: tradeoffSummary?.textContent?.replace(/\\s+/g, " ").trim() ?? "", decisionSummary: Boolean(decisionSummary), decisionCardCount: decisionSummary?.querySelectorAll('.generator-decision-card').length ?? 0, decisionText: decisionSummary?.textContent?.replace(/\\s+/g, " ").trim() ?? "", exportCopyButton: Boolean(exportCopyButton), exportJsonButton: Boolean(exportJsonButton), exportImportButton: Boolean(exportImportButton), importPreview: Boolean(importPreview), importPreviewText: importPreview?.textContent?.replace(/\\s+/g, " ").trim() ?? "", localHistoryProbe: ${localHistoryProbe}, localHistoryOpenProbe: ${localHistoryOpenProbe}, localHistoryDeleteProbe: ${localHistoryDeleteProbe}, sharedVariantsProbe: ${sharedVariantsProbe}, sharedVariantsRouteProbe: ${sharedVariantsRouteProbe}, sharedVariantsRefreshProbe: ${sharedVariantsRefreshProbe}, sharedVariantsCurrentActionsProbe: ${sharedVariantsCurrentActionsProbe}, sharedVariantsDraftActionsProbe: ${sharedVariantsDraftActionsProbe}, sharedVariantsRevokedProbe: ${sharedVariantsRevokedProbe}, importedState: Boolean(importedState), importedStateProbe: ${importedStateProbe}, importedStateClearedOnRegenerateProbe: ${importedStateClearedOnRegenerateProbe}, returnedCurrentProbe: ${returnedCurrentProbe}, malformedDraftProbe: ${malformedDraftProbe}, invalidImportProbe: ${invalidImportProbe}, exportActionsExecuted: ${exportActionsExecuted}, exportClipboardText: exportProbe.clipboardText ?? "", exportDownloadName: exportProbe.downloadName ?? "", comparisonText, body };
      })()`);
      if (probe.path !== "/recommend" || probe.panelCount !== 3 || probe.openCount !== 3 || probe.articleCounts.some((count) => count < 6) || probe.recommendationRequests.length < 1 || probe.recommendationRequests[0] !== "/api/builds/recommend/variants" || !probe.tradeoffSummary || !probe.decisionSummary || probe.decisionCardCount !== 3 || !probe.exportCopyButton || !probe.exportJsonButton || !probe.exportImportButton || !probe.localHistoryProbe || !probe.localHistoryOpenProbe || !probe.localHistoryDeleteProbe || !probe.sharedVariantsProbe || !probe.sharedVariantsRouteProbe || !probe.sharedVariantsRefreshProbe || !probe.sharedVariantsCurrentActionsProbe || !probe.sharedVariantsDraftActionsProbe || !probe.sharedVariantsRevokedProbe || (!executeExportActions && !invalidImportProbeEnabled && (!probe.importPreview || !probe.importPreviewText.includes("가져온 비교 결과"))) || (invalidImportProbeEnabled && !probe.invalidImportProbe) || executeExportActions && (!probe.exportActionsExecuted || !probe.importedStateProbe || !probe.importedStateClearedOnRegenerateProbe || !probe.returnedCurrentProbe || !probe.malformedDraftProbe || probe.importedState || probe.importPreview || !probe.exportClipboardText.includes("PC Supporter 자동 구성 3안 비교") || !probe.exportDownloadName.endsWith(".json")) || !probe.decisionText.includes("기준별 비교 결과") || probe.equivalenceNotice !== probe.expectedEquivalence || probe.adjustConditionsButton !== probe.expectedEquivalence || (probe.expectedEquivalence && (!probe.equivalenceText.includes("세 안이 같은 구성") || !probe.decisionText.includes("같은 구성을 가리킵니다") || !probe.tradeoffText.includes("비교 결과") || !probe.tradeoffText.includes("총액 차이 없음") || !probe.tradeoffText.includes("부품 변경없음"))) || !probe.comparisonText.includes("구성 차이") || !probe.comparisonText.includes("기준 구성") || (probe.expectedEquivalence && !probe.comparisonText.includes("직전 안과 동일")) || (!probe.expectedEquivalence && (!probe.comparisonText.includes("변경") || !probe.comparisonText.includes("균형형과 동일") || !probe.tradeoffText.includes("구성2종") || !probe.tradeoffText.includes("가격 차이") || !probe.tradeoffText.includes("부품 변경8개 항목"))) || !probe.body.includes("사이버펑크 2077") || !probe.body.includes("권장 VRAM") || !probe.body.includes("정격")) {
        throw new Error(`3안 선택 이유 화면 검증 실패: ${JSON.stringify(probe)}`);
      }
      if (screenshotPath && !importedScreenshotCaptured) {
        const captureSelector = captureTarget === "decision"
          ? ".generator-decision-summary"
          : captureTarget === "imported"
            ? "[data-testid=\"generator-variants-imported-state\"]"
            : "[data-testid=\"generator-variant-equivalence-notice\"], [data-testid=\"generator-variant-tradeoff-summary\"], .generator-variants-heading";
        await client.evaluate(`document.querySelector(${JSON.stringify(captureSelector)})?.scrollIntoView({ block: 'center', behavior: 'instant' }); window.scrollBy(0, -110);`);
        await sleep(executeExportActions || captureTarget === "imported" ? 4_000 : 350);
        const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      }
      if (executeExportActions && !screenshotPath) {
        const transferShare = await client.evaluate(`(async () => { const response = await fetch('/api/generator-variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'smoke draft transfer', payload: ${JSON.stringify(exportedPayloadForTransfer ? JSON.parse(exportedPayloadForTransfer) : null)}, request: { profile: 'gaming', priority: 'balanced', budgetWon: 1500000, includeGpu: true, gamingResolution: '4k', gamingRefreshRate: 144, gamingGameIds: ['cyberpunk'], gamingGraphicsPreset: 'high', gamingRayTracing: true, gamingUpscaling: 'quality', memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: 'retail_only' }, expiresInDays: 30 }) }); return { status: response.status, payload: await response.json() }; })()`);
        if (transferShare.status !== 201 || !transferShare.payload?.id || !transferShare.payload?.ownerToken) throw new Error(`현재 draft 전달용 공유 snapshot 생성 실패: ${JSON.stringify(transferShare)}`);
        const transferPath = `/generator-variants/${transferShare.payload.id}`;
        await client.evaluate(`history.pushState({}, '', ${JSON.stringify(transferPath)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
        await waitForValue(client, "document.querySelector('.shared-generator-variants-page') !== null && document.querySelector('[data-testid=\"shared-generator-variants-summary\"]') !== null", "현재 draft 전달용 공유 화면");
        await client.evaluate("document.querySelector('[data-testid=\"shared-generator-variants-refresh\"]')?.click()");
        await waitForValue(client, "document.querySelector('[data-testid=\"shared-generator-variants-current\"]') !== null", "현재 draft 전달용 재생성 결과");
        const saveDraftButton = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"shared-generator-variants-current-save-balanced\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
        if (!saveDraftButton) throw new Error("현재 draft 새 견적 저장 버튼을 찾지 못했습니다.");
        await waitForValue(client, "document.querySelector('#save-build-name') !== null", "현재 draft 저장 다이얼로그");
        probe.draftSaveDialogProbe = true;
        const savedDraftName = "smoke 현재 draft 저장 확인";
        const savedDraftDecisionNote = "공유 비교에서 현재 결과 저장 확인";
        if (!await setInputValue(client, "#save-build-name", savedDraftName)) throw new Error("현재 draft 저장 이름을 입력하지 못했습니다.");
        if (!await setTextValue(client, "#save-build-decision-note", savedDraftDecisionNote)) throw new Error("현재 draft 선택 이유를 입력하지 못했습니다.");
        const submittedDraftSave = await client.evaluate("(() => { const form = document.querySelector('.save-build-form'); const submit = form?.querySelector('button[type=\"submit\"]'); if (!(submit instanceof HTMLButtonElement) || submit.disabled) return false; submit.click(); return true; })()");
        if (!submittedDraftSave) throw new Error("현재 draft 저장 제출 버튼을 찾지 못했습니다.");
        await waitForValue(client, "document.querySelector('#save-build-name') === null", "현재 draft 저장 완료");
        await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "현재 draft 저장 결과 재진입");
        const savedDraftProbe = await client.evaluate(`(async () => { const ids = JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') || '[]'); const tokens = JSON.parse(localStorage.getItem('pc-supporter-saved-build-owner-tokens') || '{}'); const id = ids[0]; const token = id ? tokens[id] : undefined; if (!id || !token) return { status: 0, id, token: Boolean(token), name: '', decisionNote: '', preferences: {}, origin: undefined }; const response = await fetch('/api/builds/' + encodeURIComponent(id)); const payload = await response.json().catch(() => ({})); return { status: response.status, id, token: Boolean(token), name: payload.name ?? '', decisionNote: payload.decisionNote ?? '', preferences: payload.recommendationPreferences ?? {}, origin: payload.origin, path: location.pathname, resultVisible: Boolean(document.querySelector('.result-page')) }; })()`);
        const savedPreferences = savedDraftProbe.preferences ?? {};
        const savedGamingContextPreserved = savedPreferences.profile === "gaming" && savedPreferences.priority === "balanced" && savedPreferences.budgetWon === 1_500_000 && savedPreferences.listingPolicy === "retail_only" && savedPreferences.gamingResolution === "4k" && savedPreferences.gamingRefreshRate === 144 && Array.isArray(savedPreferences.gamingGameIds) && savedPreferences.gamingGameIds.includes("cyberpunk") && savedPreferences.gamingGraphicsPreset === "high" && savedPreferences.gamingRayTracing === true && savedPreferences.gamingUpscaling === "quality";
        const savedOriginPreserved = savedDraftProbe.origin?.kind === "shared_generator_variants" && savedDraftProbe.origin?.sourceShareId === transferShare.payload.id && savedDraftProbe.origin?.sourceShareName === "smoke draft transfer" && savedDraftProbe.origin?.sourcePriority === "balanced" && savedDraftProbe.origin?.currentRecheckedAt;
        if (savedDraftProbe.status !== 200 || !savedDraftProbe.id || !savedDraftProbe.token || savedDraftProbe.name !== savedDraftName || savedDraftProbe.decisionNote !== savedDraftDecisionNote || !savedGamingContextPreserved || !savedOriginPreserved || savedDraftProbe.path !== "/result" || !savedDraftProbe.resultVisible) {
          throw new Error(`현재 draft 실제 저장 검증 실패: ${JSON.stringify(savedDraftProbe)}`);
        }
        probe.draftSaveConfirmedProbe = true;
        await client.evaluate("document.querySelector('[aria-label=\"복구 코드 창 닫기\"]')?.click()");
        await client.evaluate("history.pushState({}, '', '/history'); window.dispatchEvent(new PopStateEvent('popstate'));" );
        await waitForValue(client, `location.pathname === '/history' && document.querySelector('[data-testid="saved-build-origin-${savedDraftProbe.id}"]') !== null`, "저장 견적 생성 출처 표시");
        const originUiProbe = await client.evaluate(`(() => { const node = document.querySelector('[data-testid="saved-build-origin-${savedDraftProbe.id}"]'); const text = node?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''; const link = node?.querySelector('a'); return { visible: Boolean(node), text, href: link instanceof HTMLAnchorElement ? link.getAttribute('href') ?? '' : '' }; })()`);
        if (!originUiProbe.visible || !originUiProbe.text.includes("공유 비교") || !originUiProbe.text.includes("균형형") || !originUiProbe.text.includes("현재 catalog 재생성") || originUiProbe.href !== `/generator-variants/${transferShare.payload.id}`) throw new Error(`저장 견적 생성 출처 표시 검증 실패: ${JSON.stringify(originUiProbe)}`);
        probe.draftSaveOriginProbe = true;
        const deletedSavedDraft = await client.evaluate(`(async () => { const ids = JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') || '[]'); const tokens = JSON.parse(localStorage.getItem('pc-supporter-saved-build-owner-tokens') || '{}'); const id = ids[0]; const token = id ? tokens[id] : undefined; if (!id || !token) return 0; const response = await fetch('/api/builds/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'X-Share-Owner-Token': token } }); return response.status; })()`);
        if (deletedSavedDraft !== 200) throw new Error(`현재 draft 테스트 저장 견적 정리 실패: ${deletedSavedDraft}`);
        await client.evaluate(`history.pushState({}, '', ${JSON.stringify(transferPath)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
        await waitForValue(client, "document.querySelector('.shared-generator-variants-page') !== null && document.querySelector('[data-testid=\"shared-generator-variants-refresh\"]') !== null", "저장 확인 후 공유 화면 복귀");
        await client.evaluate("document.querySelector('[data-testid=\"shared-generator-variants-refresh\"]')?.click()");
        await waitForValue(client, "document.querySelector('[data-testid=\"shared-generator-variants-current\"]') !== null", "저장 확인 후 현재 결과 복귀");
        await client.evaluate("document.querySelector('[data-testid=\"shared-generator-variants-current-edit-balanced\"]')?.click()");
        await waitForValue(client, "location.pathname === '/build' && document.querySelector('.workspace-page') !== null", "현재 draft 편집기 전달");
        await client.evaluate(`history.pushState({}, '', ${JSON.stringify(transferPath)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
        await waitForValue(client, "document.querySelector('.shared-generator-variants-page') !== null && document.querySelector('[data-testid=\"shared-generator-variants-refresh\"]') !== null", "현재 draft 검사 전달용 공유 화면");
        const refreshAgain = await client.evaluate("(() => { const node = document.querySelector('[data-testid=\"shared-generator-variants-refresh\"]'); if (!(node instanceof HTMLButtonElement)) return false; node.click(); return true; })()");
        if (!refreshAgain) throw new Error("현재 draft 검사 전달용 재생성 버튼을 찾지 못했습니다.");
        await waitForValue(client, "document.querySelector('[data-testid=\"shared-generator-variants-current\"]') !== null", "현재 draft 검사 전달용 재생성");
        await client.evaluate("document.querySelector('[data-testid=\"shared-generator-variants-current-check-balanced\"]')?.click()");
        await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "현재 draft 호환성 검사 전달");
        probe.draftCheckTransferProbe = true;
        const deletedTransferShare = await client.evaluate(`fetch('/api/generator-variants/${transferShare.payload.id}', { method: 'DELETE', headers: { 'X-Share-Owner-Token': ${JSON.stringify(transferShare.payload.ownerToken)} } }).then((response) => response.status)`);
        if (deletedTransferShare !== 200) throw new Error(`현재 draft 전달용 공유 snapshot 취소 실패: ${deletedTransferShare}`);
        probe.draftTransferProbe = true;
      }
      if (executeExportActions && !screenshotPath && (!probe.draftSaveDialogProbe || !probe.draftSaveConfirmedProbe || !probe.draftSaveOriginProbe || !probe.draftTransferProbe || !probe.draftCheckTransferProbe)) throw new Error("현재 draft 저장·출처·편집기·검사 전달 검증에 실패했습니다.");
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
