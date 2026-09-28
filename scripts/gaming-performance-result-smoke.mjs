import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, clickText, firstAvailable, freePort, sleep, waitForJson, waitForHomeDemoButtons, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.GAMING_RESULT_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const mobile = process.env.GAMING_RESULT_SMOKE_MOBILE === "true";
const dark = process.env.GAMING_RESULT_SMOKE_DARK === "true";
const screenshotPath = process.env.GAMING_RESULT_SMOKE_SCREENSHOT;

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); } catch { /* cleanup is best effort */ }
  }
  try { child.kill(signal); } catch { /* cleanup is best effort */ }
}

const assessment = {
  status: "verified",
  gameIds: ["cyberpunk", "pubg"],
  resolution: "4k",
  refreshRate: 144,
  graphicsPreset: "high",
  rayTracing: true,
  upscaling: "quality",
  gpuPartId: "gpu-rtx-4060",
  gpuName: "NVIDIA GeForce RTX 4060",
  matchedRecordIds: ["smoke-cyberpunk", "smoke-pubg"],
  matchedGameIds: ["cyberpunk", "pubg"],
  measurements: [
    { recordId: "smoke-cyberpunk", gameId: "cyberpunk", gpuName: "NVIDIA GeForce RTX 4060", averageFps: 158, onePercentLowFps: 111, measuredAt: "2026-09-10T00:00:00.000Z", sourceUrl: "https://example.com/cyberpunk" },
    { recordId: "smoke-pubg", gameId: "pubg", gpuName: "NVIDIA GeForce RTX 4060", averageFps: 171, onePercentLowFps: 128, measuredAt: "2026-09-10T00:00:00.000Z", sourceUrl: "https://example.com/pubg" }
  ],
  sourceUrls: ["https://example.com/cyberpunk", "https://example.com/pubg"],
  note: "스모크에서 연결한 exact-condition 자료입니다."
};

const injection = `(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
    if (requestUrl.pathname !== "/api/compatibility/check" || String(init?.method ?? "GET").toUpperCase() !== "POST") return originalFetch(input, init);
    const response = await originalFetch(input, init);
    const payload = await response.clone().json();
    return new Response(JSON.stringify({ ...payload, gamingPerformanceAssessment: ${JSON.stringify(assessment)} }), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  };
})();`;

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
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-gaming-result-smoke-"));
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
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: injection });
    await client.send("Page.navigate", { url: `${baseUrl}/` });
    await waitForHomeDemoButtons(client, "게임별 FPS 결과 패널 스모크 홈");
    await client.evaluate(injection);
    if (dark) await client.evaluate("document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark';");
    if (!(await clickText(client, "문제 없는 예시 견적"))) throw new Error("문제 없는 예시 견적 버튼을 찾지 못했습니다.");
    await waitForValue(client, "location.pathname === '/build' && document.querySelector('.desktop-editor-surface') !== null", "예시 견적 편집기");
    if (!(await clickText(client, "호환성 검사하기", ".desktop-editor-surface button"))) throw new Error("호환성 검사 버튼을 찾지 못했습니다.");
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "게임별 성능 데이터가 포함된 결과 화면");
    const probe = await client.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="result-gaming-performance-evidence"]');
      const measurements = [...document.querySelectorAll('[data-testid^="result-gaming-measurement-"]')];
      const body = document.body?.innerText?.replace(/\\s+/g, " ").trim() ?? "";
      return {
        path: location.pathname,
        panel: Boolean(panel),
        body,
        measurementCount: measurements.length,
        sourceCount: measurements.reduce((count, item) => count + item.querySelectorAll('a[href^="https://"]').length, 0),
        internalValuesVisible: /사이버펑크 2077|배틀그라운드|158 FPS|171 FPS|평균 FPS|1% low|게임별 FPS 결과/i.test(body)
      };
    })()`);
    if (probe.path !== "/result" || probe.panel || probe.measurementCount !== 0 || probe.internalValuesVisible) {
      throw new Error(`고객 결과 화면의 FPS 근거 비노출 검증 실패: ${JSON.stringify(probe)}`);
    }
    await sleep(350);
    if (screenshotPath) {
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
