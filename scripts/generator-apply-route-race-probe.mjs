import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";
const probePartId = "generator-apply-route-probe-cpu";

function signalProcessGroup(child, signal) {
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-generator-apply-probe-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-allow-origins=*", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `${baseUrl}/recommend`], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
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
  await waitForValue(client, "location.pathname === '/recommend' && document.querySelector('.generator-submit') !== null", "자동 구성 화면");
  const result = await client.evaluate(`(async () => {
    const originalFetch = window.fetch;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    const part = { id: ${JSON.stringify(probePartId)}, category: "cpu", name: "generator apply route probe CPU", brand: "probe", model: "probe-cpu", source: "manual", listingType: "retail", priceWon: 100000, specs: {}, dataQuality: "manual", missingFields: [], updatedAt: "2026-09-10T00:00:00.000Z" };
    const selection = { cpu: { partId: ${JSON.stringify(probePartId)}, quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };
    const draft = { selection, profile: "general", priority: "balanced", gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 32, budgetWon: 1000000, includeNonRetail: false, listingPolicy: "retail_only", storageCapacityGb: 500, hddCapacityGb: 4000, hddCount: 0, totalPriceWon: 100000, budgetDeltaWon: 900000, withinBudget: true, priceComplete: true, status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, lines: [{ category: "cpu", partId: ${JSON.stringify(probePartId)}, name: part.name, quantity: 1, priceWon: 100000 }], rationale: ["generator route race probe"], warnings: [] };
    let recommendCalls = 0;
    let batchCalls = 0;
    let batchSignalCalls = 0;
    let batchAbortedCalls = 0;
    let controlPhase = false;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      if (requestUrl.pathname === "/api/builds/recommend" && (init?.method ?? "GET").toUpperCase() === "POST") {
        recommendCalls += 1;
        return response(draft);
      }
      if (requestUrl.pathname === "/api/parts/batch" && (init?.method ?? "GET").toUpperCase() === "POST") {
        batchCalls += 1;
        if (controlPhase) return response({ items: [part] });
        if (batchCalls < 2) return response({ items: [] });
        if (init?.signal) batchSignalCalls += 1;
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          const abort = () => { batchAbortedCalls += 1; const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; reject(error); };
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(response({ items: [part] })); }, 700);
        });
      }
      return originalFetch(input, init);
    };
    try {
      const generate = [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? "").includes("자동 견적 생성"));
      if (!(generate instanceof HTMLButtonElement)) return { stage: "missing-generate" };
      generate.click();
      for (let index = 0; index < 100 && !document.querySelector(".generator-result"); index += 1) await wait(25);
      if (!document.querySelector(".generator-result")) return { stage: "missing-result", recommendCalls, batchCalls, body: (document.body?.innerText ?? "").slice(-1800) };
      const apply = [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? "").includes("편집기로 가져가기"));
      if (!(apply instanceof HTMLButtonElement)) return { stage: "missing-apply", recommendCalls, batchCalls };
      apply.click();
      for (let index = 0; index < 80 && batchCalls < 2; index += 1) await wait(25);
      if (batchCalls < 2) return { stage: "missing-delayed-batch", recommendCalls, batchCalls };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const raceResult = { recommendCalls, batchCalls, batchSignalCalls, batchAbortedCalls, path: location.pathname, home: Boolean(document.querySelector(".home-page")), editor: location.pathname === "/build", routeKey: document.querySelector(".app-shell")?.getAttribute("data-route-key") ?? "" };
      controlPhase = true;
      batchCalls = 0;
      history.pushState({}, "", "/recommend");
      window.dispatchEvent(new PopStateEvent("popstate"));
      for (let index = 0; index < 160 && document.querySelector(".generator-submit") === null; index += 1) await wait(25);
      const controlGenerate = [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? "").includes("자동 견적 생성"));
      if (!(controlGenerate instanceof HTMLButtonElement)) return { stage: "control-missing-generate", ...raceResult };
      controlGenerate.click();
      for (let index = 0; index < 160 && document.querySelector(".generator-result") === null; index += 1) await wait(25);
      const controlApply = [...document.querySelectorAll("button")].find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent ?? "").includes("편집기로 가져가기"));
      if (!(controlApply instanceof HTMLButtonElement)) return { stage: "control-missing-apply", ...raceResult, controlBatchCalls: batchCalls };
      controlApply.click();
      for (let index = 0; index < 200 && location.pathname !== "/build"; index += 1) await wait(25);
      return { stage: "checked", ...raceResult, controlBatchCalls: batchCalls, controlAppliedPath: location.pathname };
    } finally {
      window.fetch = originalFetch;
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.recommendCalls !== 1 || result.batchCalls < 2 || result.batchSignalCalls !== 1 || result.batchAbortedCalls < 1 || result.path !== "/" || result.home !== true || result.editor !== false || result.controlAppliedPath !== "/build") process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) {
    signalProcessGroup(chrome, "SIGTERM");
    await Promise.race([chromeExit, sleep(2_000)]);
    if (!chromeExited) signalProcessGroup(chrome, "SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true });
}
