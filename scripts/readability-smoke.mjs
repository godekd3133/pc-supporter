import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CdpClient, assert, clickText, firstAvailable, freePort, openDetails, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.READABILITY_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const settleMs = Number(process.env.READABILITY_SMOKE_SETTLE_MS ?? 900);
const reportPath = process.env.READABILITY_SMOKE_REPORT;

const viewportMatrix = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 900, mobile: false }
];

const routes = [
  { path: "/", label: "홈" },
  { path: "/build", label: "견적 구성" },
  { path: "/catalog?category=cpu", label: "부품 카탈로그" },
  { path: "/accessories", label: "주변 부품" },
  { path: "/recommend?profile=gaming", label: "자동 구성" },
  { path: "/history", label: "저장 견적" },
  { path: "/watchlist", label: "가격 추적" },
  { path: "/admin", label: "관리자" }
];

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The process group may already have exited.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Cleanup is best effort after the browser exits.
  }
}

function readabilityProbe() {
  const parseColor = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return undefined;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return undefined;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const blend = (foreground, background) => {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      a: alpha
    };
  };
  const luminance = (color) => {
    const channels = [color.r, color.g, color.b].map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrastRatio = (first, second) => {
    const firstLuminance = luminance(first);
    const secondLuminance = luminance(second);
    return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
  };
  const htmlBackground = parseColor(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  const textFor = (element) => {
    if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value.trim();
    return (element.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && !element.closest('[aria-hidden="true"]');
  };
  const effectiveBackground = (element) => {
    let background = htmlBackground;
    const ancestors = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) ancestors.push(node);
    for (const node of ancestors.reverse()) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) background = blend(color, background);
    }
    return background;
  };
  const backgroundText = (background) => `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`;
  const candidates = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,label,button,a,summary,small,strong,em,span,code,li,dt,dd,td,th,input,textarea,select")];
  const violations = [];
  const lightSurfaceLeaks = [];
  const tinyText = [];
  const seen = new Set();
  for (const element of candidates) {
    if (!visible(element)) continue;
    const text = textFor(element);
    const isInput = element.matches("input,textarea");
    if (!text && !(isInput && element.getAttribute("placeholder"))) continue;
    const style = getComputedStyle(element);
    const background = effectiveBackground(element);
    const foreground = parseColor(style.color);
    if (foreground && text) {
      const ratio = contrastRatio(blend(foreground, background), background);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const largeText = fontSize >= 18 || (fontSize >= 14 && Number.parseInt(style.fontWeight, 10) >= 700);
      const disabled = element.matches(":disabled") || Boolean(element.closest(":disabled"));
      const threshold = disabled ? 3 : largeText ? 3 : 4.5;
      const key = [element.tagName, typeof element.className === "string" ? element.className : "", text.slice(0, 100), Math.round(ratio * 100) / 100].join("|");
      if (ratio < threshold && !seen.has(key)) {
        seen.add(key);
        violations.push({
          kind: disabled ? "disabled-text" : "text",
          ratio: Number(ratio.toFixed(2)),
          threshold,
          text: text.slice(0, 140),
          tag: element.tagName,
          className: typeof element.className === "string" ? element.className : "",
          foreground: style.color,
          background: backgroundText(background),
          fontSize: style.fontSize,
          fontWeight: style.fontWeight
        });
      }
      if (fontSize < 12 && !element.matches(".eyebrow,.mobile-kicker,.panel-kicker,.mini-label")) {
        tinyText.push({ text: text.slice(0, 100), tag: element.tagName, className: typeof element.className === "string" ? element.className : "", fontSize: style.fontSize });
      }
      const backgroundLuminance = luminance(background);
      if ((document.documentElement.dataset.theme ?? "light") === "dark" && backgroundLuminance > 0.82 && !element.closest("img,svg")) {
        lightSurfaceLeaks.push({ text: text.slice(0, 100), tag: element.tagName, className: typeof element.className === "string" ? element.className : "", background: backgroundText(background), foreground: style.color });
      }
    }
    if (isInput && element.getAttribute("placeholder")) {
      const placeholderStyle = getComputedStyle(element, "::placeholder");
      const placeholderForeground = parseColor(placeholderStyle.color);
      if (placeholderForeground) {
        const ratio = contrastRatio(blend(placeholderForeground, background), background);
        if (ratio < 4.5) violations.push({ kind: "placeholder", ratio: Number(ratio.toFixed(2)), threshold: 4.5, text: element.getAttribute("placeholder"), tag: element.tagName, className: typeof element.className === "string" ? element.className : "", foreground: placeholderStyle.color, background: backgroundText(background), fontSize: style.fontSize, fontWeight: style.fontWeight });
      }
    }
  }
  return {
    route: location.pathname + location.search,
    theme: document.documentElement.dataset.theme ?? "light",
    viewport: { width: innerWidth, height: innerHeight },
    visibleTextNodes: candidates.filter(visible).length,
    violations: violations.sort((first, second) => first.ratio - second.ratio),
    lightSurfaceLeaks,
    tinyText: tinyText.slice(0, 30),
    runtimeErrors: window.__pcSupporterReadabilityErrors ?? []
  };
}

const probeExpression = `(${readabilityProbe.toString()})()`;

async function launchBrowser() {
  const chromePath = await firstAvailable([
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean));
  if (!chromePath) throw new Error("Chrome 또는 Chromium 실행 파일을 찾지 못했습니다. CHROME_BIN으로 경로를 지정해 주세요.");
  const port = await freePort();
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-readability-smoke-"));
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
  let exited = false;
  const exitPromise = new Promise((resolve) => chrome.once("exit", () => { exited = true; resolve(); }));
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("Chrome 페이지 target을 찾지 못했습니다.");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  return { chrome, client, profileDir, exited, exitPromise };
}

async function setViewport(client, viewport) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
}

async function installRuntimeErrorProbe(client) {
  const probeScript = `(() => {
    const errors = [];
    const add = (kind, value) => { if (errors.length < 30) errors.push({ kind, message: String(value ?? '').slice(0, 500) }); };
    window.__pcSupporterReadabilityErrors = errors;
    window.addEventListener('error', (event) => add('error', event.error?.stack ?? event.message));
    window.addEventListener('unhandledrejection', (event) => add('unhandledrejection', event.reason?.stack ?? event.reason));
  })()`;
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: probeScript });
  await client.evaluate(probeScript);
}

async function waitForApp(client, label) {
  await waitForValue(client, `location.href.startsWith(${JSON.stringify(baseUrl)}) && document.querySelector('.app-shell') !== null && !(document.body?.innerText ?? '').includes('[plugin:vite')`, label);
  await sleep(settleMs);
}

async function navigate(client, path, label) {
  await client.send("Page.navigate", { url: `${baseUrl}${path}` });
  await waitForApp(client, label);
}

async function setDarkTheme(client) {
  await navigate(client, "/", "다크 모드 초기화용 홈");
  await client.evaluate(`(() => { localStorage.setItem('pc-supporter-theme', 'dark'); document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark'; return true; })()`);
  await client.send("Page.reload", { ignoreCache: false });
  await waitForValue(client, `document.documentElement.dataset.theme === 'dark' && document.querySelector('.app-shell') !== null`, "다크 모드 초기화");
  await sleep(settleMs);
}

async function clickVisibleText(client, text) {
  return client.evaluate(`(() => { const target = [...document.querySelectorAll('button')].find((button) => { const style = getComputedStyle(button); return !button.disabled && style.display !== 'none' && style.visibility !== 'hidden' && (button.textContent ?? '').includes(${JSON.stringify(text)}); }); if (!target) return false; target.click(); return true; })()`);
}

async function prepareResult(client) {
  await navigate(client, "/", "결과 검수용 홈");
  await openDetails(client, "details.hero-demo-tools, details.mobile-demo-tools, details.home-secondary-details", "결과 검수용 예시 도구");
  await waitForValue(client, "(document.body?.innerText ?? '').includes('문제 있는 예시 견적')", "결과 검수용 예시 견적 버튼");
  assert(await clickText(client, "문제 있는 예시 견적"), "결과 검수용 예시 견적을 선택하지 못했습니다.");
  await waitForValue(client, "location.pathname === '/build' && document.querySelector('.workspace-page') !== null", "결과 검수용 견적 구성");
  await waitForValue(client, "[...document.querySelectorAll('button')].some((button) => !button.disabled && (button.textContent ?? '').includes('호환성 검사하기'))", "결과 검수용 검사 버튼");
  assert(await clickVisibleText(client, "호환성 검사하기"), "결과 검수용 호환성 검사 버튼을 클릭하지 못했습니다.");
  await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-page') !== null", "결과 검수용 검사 결과");
  await sleep(settleMs);
}

async function openPicker(client) {
  await navigate(client, "/build", "부품 선택 패널 검수용 견적 구성");
  const opened = await client.evaluate(`(() => {
    const visible = (node) => { const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden'; };
    const desktop = [...document.querySelectorAll('button')].find((button) => visible(button) && !button.disabled && (button.textContent ?? '').includes('다른 부품으로 변경'));
    const mobile = [...document.querySelectorAll('.mobile-editor-row')].find((button) => visible(button) && !button.disabled);
    const target = desktop ?? mobile;
    if (!(target instanceof HTMLButtonElement)) return false;
    target.click();
    return true;
  })()`);
  assert(opened, "부품 선택 패널을 여는 버튼을 찾지 못했습니다.");
  await waitForValue(client, "document.querySelector('.picker-modal') !== null", "부품 선택 패널");
  await sleep(settleMs);
}

async function scan(client, label) {
  await client.evaluate("(() => { document.querySelectorAll('details').forEach((node) => { if (node instanceof HTMLDetailsElement) node.open = true; }); return true; })()");
  await sleep(120);
  const result = await client.evaluate(probeExpression);
  return { label, ...result, violationCount: result.violations.length, lightSurfaceLeakCount: result.lightSurfaceLeaks.length, tinyTextCount: result.tinyText.length, runtimeErrorCount: result.runtimeErrors.length };
}

async function main() {
  const healthResponse = await fetch(`${baseUrl}/api/health`).catch(() => undefined);
  if (!healthResponse?.ok) throw new Error(`개발 서버가 실행 중이지 않습니다. ${baseUrl}에서 npm run dev를 먼저 실행해 주세요.`);
  const browser = await launchBrowser();
  const report = { ok: true, baseUrl, theme: "dark", viewports: viewportMatrix, screens: [], generatedAt: new Date().toISOString() };
  try {
    await installRuntimeErrorProbe(browser.client);
    for (const viewport of viewportMatrix) {
      await setViewport(browser.client, viewport);
      await setDarkTheme(browser.client);
      for (const route of routes) {
        await navigate(browser.client, route.path, `${viewport.name} ${route.label}`);
        report.screens.push(await scan(browser.client, `${viewport.name}:${route.path}`));
      }
      await prepareResult(browser.client);
      report.screens.push(await scan(browser.client, `${viewport.name}:/result`));
      await openPicker(browser.client);
      report.screens.push(await scan(browser.client, `${viewport.name}:/build#picker`));
    }
    const failures = report.screens.filter((screen) => screen.violationCount > 0 || screen.lightSurfaceLeakCount > 0 || screen.runtimeErrorCount > 0);
    report.ok = failures.length === 0;
    const summary = {
      ok: report.ok,
      theme: report.theme,
      screenCount: report.screens.length,
      violationCount: report.screens.reduce((sum, screen) => sum + screen.violationCount, 0),
      lightSurfaceLeakCount: report.screens.reduce((sum, screen) => sum + screen.lightSurfaceLeakCount, 0),
      runtimeErrorCount: report.screens.reduce((sum, screen) => sum + screen.runtimeErrorCount, 0),
      screens: report.screens.map((screen) => ({ label: screen.label, route: screen.route, viewport: screen.viewport, visibleTextNodes: screen.visibleTextNodes, violations: screen.violationCount, lightSurfaceLeaks: screen.lightSurfaceLeakCount, tinyText: screen.tinyTextCount, runtimeErrors: screen.runtimeErrorCount, top: screen.violations.slice(0, 5) }))
    };
    report.summary = summary;
    if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!report.ok) throw new Error(`가독성 검수 실패: ${failures.map((screen) => `${screen.label}(${screen.violationCount} contrast, ${screen.lightSurfaceLeakCount} light surface, ${screen.runtimeErrorCount} runtime)`).join(", ")}`);
  } finally {
    browser.client.close();
    if (!browser.exited) {
      signalProcessGroup(browser.chrome, "SIGTERM");
      await Promise.race([browser.exitPromise, sleep(2_000)]);
      if (!browser.exited) {
        signalProcessGroup(browser.chrome, "SIGKILL");
        await Promise.race([browser.exitPromise, sleep(1_000)]);
      }
    }
    await rm(browser.profileDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
