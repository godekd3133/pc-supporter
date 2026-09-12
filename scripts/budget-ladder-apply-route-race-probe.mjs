import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

const source = await readFile(new URL("./browser-smoke.mjs", import.meta.url), "utf8");
const expressionMarker = "const sharedBudgetLadderSelectionApplyProbe = await client.evaluate(`";
const expressionStart = source.indexOf(expressionMarker);
if (expressionStart < 0) throw new Error("기존 shared-budget-ladder-selection-apply probe를 찾지 못했습니다.");
const expressionBodyStart = expressionStart + expressionMarker.length;
const expressionEnd = source.indexOf("`);", expressionBodyStart);
if (expressionEnd < 0) throw new Error("기존 shared-budget-ladder-selection-apply probe 종료를 찾지 못했습니다.");
let expression = source.slice(expressionBodyStart, expressionEnd);
const fetchMarker = "const requestUrl = new URL(url, location.href); if (['browser-budget-a'";
if (!expression.includes(fetchMarker)) throw new Error("budget probe fetch seam을 찾지 못했습니다.");
expression = expression.replace("window.fetch = async", "let partsBatchCalls = 0; window.fetch = async");
expression = expression.replace(fetchMarker, "const requestUrl = new URL(url, location.href); if (requestUrl.pathname === '/api/parts/batch') { partsBatchCalls += 1; await new Promise((resolve) => setTimeout(resolve, 700)); return response({ items: [] }); } if (['browser-budget-a'");
const applyMarker = "if (applied) apply.click(); for (let index = 0; index < 60 && location.pathname !== '/build'; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); const editorPath = location.pathname;";
if (!expression.includes(applyMarker)) throw new Error("budget probe apply seam을 찾지 못했습니다.");
expression = expression.replace(applyMarker, "if (applied) apply.click(); for (let index = 0; index < 60 && partsBatchCalls < 1; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); await new Promise((resolve) => setTimeout(resolve, 900)); return { stage: 'checked', partsBatchCalls, path: location.pathname, home: Boolean(document.querySelector('.home-page')), editor: location.pathname === '/build' };");

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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-budget-ladder-apply-probe-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `${baseUrl}/`], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
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
  const result = await client.evaluate(expression);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.partsBatchCalls < 1 || result.path !== "/" || result.home !== true || result.editor !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome, "SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
