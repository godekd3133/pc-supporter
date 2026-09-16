import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, clickText, firstAvailable, freePort, openResultDetails, sleep, waitForHomeDemoButtons, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
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
  await waitForValue(client, "location.pathname === '/'", "홈 화면");
  await waitForHomeDemoButtons(client, "홈 컨텐츠");
  if (!(await clickText(client, "문제 있는 예시 견적"))) throw new Error("문제 있는 예시 견적 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/build' && (document.body?.innerText ?? '').includes('모든 필수 부품을 선택했습니다')", "편집기 화면");
  if (!(await clickText(client, "호환성 검사하기"))) throw new Error("호환성 검사 버튼을 찾지 못했습니다.");
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "결과 화면");
  await openResultDetails(client);
  if (!(await clickText(client, "견적 저장·공유"))) throw new Error("견적 저장·공유 버튼을 찾지 못했습니다.");
  await waitForValue(client, "document.querySelector('#save-build-dialog-title') !== null", "견적 저장 창");
  const result = await client.evaluate(`(async () => {
    const originalClipboard = navigator.clipboard;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let copyCalls = 0;
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      const name = document.querySelector("#save-build-name");
      if (!(name instanceof HTMLInputElement)) return { stage: "missing-name" };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "save route probe");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      name.dispatchEvent(new Event("change", { bubbles: true }));
      const submit = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("저장하고 링크 복사"));
      if (!(submit instanceof HTMLButtonElement)) return { stage: "missing-submit" };
      submit.click();
      for (let index = 0; index < 160 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return {
        stage: "checked",
        copyCalls,
        path: location.pathname,
        home: document.querySelector(".home-page") !== null,
        editor: document.querySelector(".workspace-page") !== null,
        result: document.querySelector(".result-page") !== null,
        toastText: document.querySelector(".toast")?.textContent ?? "",
        bodyTail: body.slice(-900),
        staleToast: Boolean(document.querySelector(".toast"))
      };
    } finally {
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.copyCalls !== 1 || result.path !== "/" || result.home !== true || result.editor !== false || result.result !== false || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome);
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
