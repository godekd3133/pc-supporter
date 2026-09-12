import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
function signalProcessGroup(child) { if (!child.pid) return; try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} } }
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-home-version-copy-route-probe-"));
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
  await waitForValue(client, "(document.body?.innerText ?? '').includes('시연용 구성 보기')", "홈 컨텐츠");
  const result = await client.evaluate(`(async () => {
    const originalClipboard = navigator.clipboard;
    const originalShares = localStorage.getItem("pc-supporter-saved-build-version-shares");
    const key = "pc-supporter-saved-build-version-shares";
    const stamp = "2026-09-10T00:00:00.000Z";
    const entry = { id: "home-version-copy-old", url: location.origin + "/version-comparison/home-version-copy-old", name: "home version copy old", createdAt: stamp, beforeLabel: "v1", beforeName: "before", beforeBuildId: "before", afterLabel: "v2", afterName: "after", afterBuildId: "after", ownerToken: "c".repeat(48) };
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const serialized = JSON.stringify([entry]);
    let copyCalls = 0;
    const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
    try {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { copyCalls += 1; await wait(700); } } });
      localStorage.setItem(key, serialized);
      dispatch(serialized);
      for (let index = 0; index < 160 && ![...document.querySelectorAll('[data-testid="home-saved-build-version-shares"] button')].some((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("링크 복사")); index += 1) await wait(25);
      const copy = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("링크 복사"));
      if (!(copy instanceof HTMLButtonElement)) return { stage: "missing-copy", panel: document.querySelector('[data-testid="home-saved-build-version-shares"]')?.textContent?.slice(0, 900) ?? "", body: (document.body?.innerText ?? "").slice(-1200) };
      copy.click();
      for (let index = 0; index < 80 && copyCalls < 1; index += 1) await wait(25);
      if (copyCalls < 1) return { stage: "missing-clipboard" };
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(950);
      const body = document.body?.innerText ?? "";
      return { stage: "checked", copyCalls, path: location.pathname, staleToast: body.includes("견적 버전 비교 공유 링크를 복사했습니다") || body.includes("견적 버전 비교 공유 링크:") };
    } finally {
      if (originalClipboard === undefined) { try { delete navigator.clipboard; } catch {} } else Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
      if (originalShares === null) localStorage.removeItem(key); else localStorage.setItem(key, originalShares);
      dispatch(originalShares);
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.copyCalls !== 1 || result.path !== "/" || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) { signalProcessGroup(chrome); await Promise.race([chromeExit, sleep(2_000)]); if (!chromeExited) { try { process.kill(-chrome.pid, "SIGKILL"); } catch {} } }
  await rm(profileDir, { recursive: true, force: true });
}
