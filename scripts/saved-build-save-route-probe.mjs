import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, clickText, firstAvailable, freePort, openResultDetails, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
const screenshotPath = process.env.SAVED_BUILD_SAVE_ROUTE_SCREENSHOT_PATH;
const screenshotMobile = process.env.SAVED_BUILD_SAVE_ROUTE_VIEWPORT === "mobile";
function signalProcessGroup(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
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

const port = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-saved-build-save-route-probe-"));
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
  `${baseUrl}/`
], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
let chromeExited = false;
const chromeExit = new Promise((resolve) => chrome.once("exit", () => { chromeExited = true; resolve(); }));
let client;

try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  if (screenshotPath) await client.send("Emulation.setDeviceMetricsOverride", { width: screenshotMobile ? 390 : 1280, height: screenshotMobile ? 844 : 900, deviceScaleFactor: 1, mobile: screenshotMobile });
  await waitForValue(client, "location.pathname === '/'", "홈 화면");
  await waitForHomeDemoButtons(client, "홈 컨텐츠");
  if (!(await clickText(client, "문제 있는 예시 견적"))) throw new Error("문제 있는 예시 견적 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/build' && document.querySelector('.workspace-page') !== null && document.querySelector('.desktop-editor-surface button.button-primary.full-width')?.disabled === false", "편집기 화면");
  if (!(await clickText(client, "호환 확인하기", ".desktop-editor-surface button.button-primary.full-width"))) throw new Error("호환 확인 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "결과 화면");
  await openResultDetails(client);
  if (!(await clickText(client, "견적 저장·공유"))) throw new Error("견적 저장·공유 버튼을 찾지 못했습니다.");
  await waitForValue(client, "document.querySelector('#save-build-dialog-title') !== null", "견적 저장 창");
  if (screenshotPath) await client.evaluate("window.__enableSavedBuildRouteCapture = true");
  const resultPromise = client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let savePostCount = 0;
    let recoveryReissueCount = 0;
    let recoveryReissueStatus = 0;
    let recoveryReissuedCode = "";
    let historyListCalls = 0;
    let historyRequestedIds = [];
    let saveResponseStatus = 0;
    let saveResponsePayload = null;
    let releaseSaveResponse;
    let signalSaveResponseReachedServer;
    const saveResponseGate = new Promise((resolve) => { releaseSaveResponse = resolve; });
    const saveResponseReachedServer = new Promise((resolve) => { signalSaveResponseReachedServer = resolve; });
    const fetchOriginal = originalFetch.bind(window);
    try {
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        const method = (init?.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")).toUpperCase();
        if (requestUrl.pathname === "/api/builds" && method === "POST") {
          savePostCount += 1;
          const response = await fetchOriginal(input, init);
          saveResponseStatus = response.status;
          saveResponsePayload = await response.clone().json();
          signalSaveResponseReachedServer();
          await saveResponseGate;
          return response;
        }
        if (saveResponsePayload?.id && requestUrl.pathname === "/api/builds/" + encodeURIComponent(saveResponsePayload.id) + "/recovery-code" && method === "POST") {
          recoveryReissueCount += 1;
          const response = await fetchOriginal(input, init);
          recoveryReissueStatus = response.status;
          const payload = await response.clone().json().catch(() => ({}));
          recoveryReissuedCode = typeof payload.recoveryCode === "string" ? payload.recoveryCode : "";
          return response;
        }
        if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) {
          historyListCalls += 1;
          historyRequestedIds = requestUrl.searchParams.get("ids")?.split(",") ?? [];
        }
        return fetchOriginal(input, init);
      };
      const name = document.querySelector("#save-build-name");
      if (!(name instanceof HTMLInputElement)) return { stage: "missing-name" };
      const buildName = "saved-build-route-race-probe";
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, buildName);
      name.dispatchEvent(new Event("input", { bubbles: true }));
      name.dispatchEvent(new Event("change", { bubbles: true }));
      const submit = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("저장하고 링크 복사"));
      if (!(submit instanceof HTMLButtonElement)) return { stage: "missing-submit" };
      submit.click();
      await Promise.race([saveResponseReachedServer, wait(8_000)]);
      if (!saveResponsePayload) return { stage: "save-response-timeout", savePostCount };
      const responseId = typeof saveResponsePayload.id === "string" ? saveResponsePayload.id : "";
      const responseOwnerToken = typeof saveResponsePayload.ownerToken === "string" ? saveResponsePayload.ownerToken : "";
      const responseRecoveryCode = typeof saveResponsePayload.recoveryCode === "string" ? saveResponsePayload.recoveryCode : "";
      const responseHadCredentials = Boolean(responseId && responseOwnerToken.length >= 40 && responseRecoveryCode);
      const homeButton = document.querySelector('button[aria-label="PC Supporter 홈"]');
      if (!(homeButton instanceof HTMLButtonElement)) return { stage: "missing-home", savePostCount, saveResponseStatus, responseHadCredentials };
      homeButton.click();
      for (let index = 0; index < 80 && location.pathname !== "/"; index += 1) await wait(25);
      const pathBeforeResponseRelease = location.pathname;
      releaseSaveResponse();
      for (let index = 0; index < 160; index += 1) {
        let ids = [];
        let tokens = {};
        try { ids = JSON.parse(localStorage.getItem("pc-supporter-saved-build-ids") ?? "[]"); } catch {}
        try { tokens = JSON.parse(localStorage.getItem("pc-supporter-saved-build-owner-tokens") ?? "{}"); } catch {}
        if (responseId && ids.includes(responseId) && tokens[responseId] === responseOwnerToken) break;
        await wait(25);
      }
      await wait(250);
      let storedIds = [];
      let storedTokens = {};
      try { storedIds = JSON.parse(localStorage.getItem("pc-supporter-saved-build-ids") ?? "[]"); } catch {}
      try { storedTokens = JSON.parse(localStorage.getItem("pc-supporter-saved-build-owner-tokens") ?? "{}"); } catch {}
      const recoveryCodePersisted = Object.keys(localStorage).some((key) => key.toLowerCase().includes("recovery") || (responseRecoveryCode && (localStorage.getItem(key) ?? "").includes(responseRecoveryCode)));
      const recoveryDialogOnStaleRoute = document.querySelector('[aria-labelledby="recovery-code-dialog-title"]') !== null || (document.body?.innerText ?? "").includes(responseRecoveryCode);
      const homeStateAfterSave = location.pathname === "/" && document.querySelector(".home-page") !== null;
      const staleToast = Boolean(document.querySelector(".toast"));
      const historyButton = document.querySelector('button[aria-label="저장 견적"]');
      if (!(historyButton instanceof HTMLButtonElement)) return { stage: "missing-history", savePostCount, saveResponseStatus, responseHadCredentials, pathBeforeResponseRelease, storedId: storedIds.includes(responseId), ownerTokenStored: storedTokens[responseId] === responseOwnerToken, recoveryCodePersisted, recoveryDialogOnStaleRoute, homeStateAfterSave, staleToast };
      historyButton.click();
      for (let index = 0; index < 240 && !(document.body?.innerText ?? "").includes(buildName); index += 1) await wait(25);
      const body = document.body?.innerText ?? "";
      const recoveryButton = responseId ? document.querySelector('[data-testid="saved-build-recovery-code-' + responseId + '"]') : null;
      const ownerRecoveryControlAvailable = recoveryButton instanceof HTMLButtonElement;
      if (window.__enableSavedBuildRouteCapture) {
        window.__savedBuildRouteCaptureReady = true;
        await new Promise((resolve) => { window.__savedBuildRouteCaptureRelease = resolve; });
        delete window.__savedBuildRouteCaptureReady;
        delete window.__savedBuildRouteCaptureRelease;
      }
      if (ownerRecoveryControlAvailable) {
        recoveryButton.click();
        for (let index = 0; index < 160 && !document.querySelector('[data-testid="recovery-code-dialog"]'); index += 1) await wait(25);
      }
      const reissuedCodeVisible = (document.querySelector('[data-testid="recovery-code-value"]')?.textContent ?? "").trim();
      const recoveryCodeStoredAfterReissue = Object.keys(localStorage).some((key) => key.toLowerCase().includes("recovery") || (recoveryReissuedCode && (localStorage.getItem(key) ?? "").includes(recoveryReissuedCode)));
      return {
        stage: "checked",
        savePostCount,
        saveResponseStatus,
        responseHadCredentials,
        responseId,
        historyListCalls,
        historyRequestedIds,
        savedBuildVisibleInHistory: body.includes(buildName),
        ownerRecoveryControlAvailable,
        recoveryReissueCount,
        recoveryReissueStatus,
        recoveryDialogShowsReissuedCode: Boolean(recoveryReissuedCode) && reissuedCodeVisible === recoveryReissuedCode,
        recoveryCodeStoredAfterReissue,
        path: location.pathname,
        pathBeforeResponseRelease,
        homeStateAfterSave,
        storedId: storedIds.includes(responseId),
        ownerTokenStored: storedTokens[responseId] === responseOwnerToken,
        recoveryCodePersisted,
        recoveryDialogOnStaleRoute,
        staleToast
      };
    } finally {
      releaseSaveResponse?.();
      window.fetch = originalFetch;
    }
  })()`);
  if (screenshotPath) {
    await waitForValue(client, "window.__savedBuildRouteCaptureReady === true", "저장 견적 화면 캡처 지점");
    await client.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await mkdir(dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    await client.evaluate("window.__savedBuildRouteCaptureRelease?.()");
  }
  const result = await resultPromise;
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked"
    || result.savePostCount !== 1
    || result.saveResponseStatus !== 201
    || result.responseHadCredentials !== true
    || result.pathBeforeResponseRelease !== "/"
    || result.path !== "/history"
    || result.homeStateAfterSave !== true
    || result.storedId !== true
    || result.ownerTokenStored !== true
    || result.recoveryCodePersisted !== false
    || result.recoveryDialogOnStaleRoute !== false
    || result.ownerRecoveryControlAvailable !== true
    || result.recoveryReissueCount !== 1
    || result.recoveryReissueStatus !== 201
    || result.recoveryDialogShowsReissuedCode !== true
    || result.recoveryCodeStoredAfterReissue !== false
    || result.historyListCalls < 1
    || !result.historyRequestedIds.includes(result.responseId)
    || result.savedBuildVisibleInHistory !== true
    || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
