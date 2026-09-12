import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5174";
function signalProcessGroup(child, signal) { if (!child.pid) return; try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } }
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
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-home-version-revoke-context-probe-"));
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
    const originalFetch = window.fetch;
    const originalConfirm = window.confirm;
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    const key = "pc-supporter-saved-build-version-shares";
    const original = localStorage.getItem(key);
    const stamp = "2026-09-10T00:00:00.000Z";
    const token = "v".repeat(48);
    const oldEntry = { id: "home-version-revoke-old", url: location.origin + "/version-comparison/home-version-revoke-old", name: "home version old", createdAt: stamp, beforeLabel: "v1", beforeName: "before old", beforeBuildId: "before-old", afterLabel: "v2", afterName: "after old", afterBuildId: "after-old", ownerToken: token };
    const newEntry = { id: "home-version-revoke-new", url: location.origin + "/version-comparison/home-version-revoke-new", name: "home version new", createdAt: stamp, beforeLabel: "v3", beforeName: "before new", beforeBuildId: "before-new", afterLabel: "v4", afterName: "after new", afterBuildId: "after-new", ownerToken: token };
    let deleteCalls = 0;
    window.confirm = () => true;
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
      const method = (init?.method ?? "GET").toUpperCase();
      if ((requestUrl.pathname === "/api/version-comparisons/home-version-revoke-old" || requestUrl.pathname === "/api/version-comparisons/home-version-revoke-new") && method === "GET") return response({ id: requestUrl.pathname.split("/").at(-1), payload: { before: { check: {} }, after: { check: {} } } });
      if (requestUrl.pathname === "/api/version-comparisons/home-version-revoke-old" && method === "DELETE") { deleteCalls += 1; await wait(700); return response({ ok: true }); }
      return originalFetch(input, init);
    };
    const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
    try {
      const oldSerialized = JSON.stringify([oldEntry]);
      const newSerialized = JSON.stringify([newEntry]);
      localStorage.setItem(key, oldSerialized);
      dispatch(oldSerialized);
      for (let index = 0; index < 160 && ![...document.querySelectorAll("button")].some((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("공유 취소")); index += 1) await wait(25);
      const revoke = [...document.querySelectorAll("button")].find((button) => button instanceof HTMLButtonElement && !button.disabled && (button.textContent ?? "").includes("공유 취소"));
      if (!(revoke instanceof HTMLButtonElement)) return { stage: "missing-revoke", body: (document.body?.innerText ?? "").slice(-1800) };
      revoke.click();
      for (let index = 0; index < 80 && deleteCalls < 1; index += 1) await wait(25);
      localStorage.setItem(key, newSerialized);
      dispatch(newSerialized);
      for (let index = 0; index < 80 && !(document.querySelector('[data-testid="home-saved-build-version-shares"]')?.textContent ?? "").includes(newEntry.name); index += 1) await wait(25);
      await wait(900);
      const body = document.body?.innerText ?? "";
      const panelText = document.querySelector('[data-testid="home-saved-build-version-shares"]')?.textContent ?? "";
      return { stage: "checked", deleteCalls, newEntry: panelText.includes(newEntry.name), staleToast: body.includes("견적 버전 비교 공유 링크를 취소했습니다"), path: location.pathname };
    } finally {
      window.fetch = originalFetch;
      window.confirm = originalConfirm;
      if (original === null) localStorage.removeItem(key); else localStorage.setItem(key, original);
      dispatch(original);
    }
  })()`);
  console.log(JSON.stringify(result));
  if (result?.stage !== "checked" || result.deleteCalls !== 1 || result.newEntry !== true || result.staleToast !== false) process.exitCode = 1;
} finally {
  client?.close();
  if (!chromeExited) { signalProcessGroup(chrome, "SIGTERM"); await Promise.race([chromeExit, sleep(2_000)]); if (!chromeExited) signalProcessGroup(chrome, "SIGKILL"); }
  await rm(profileDir, { recursive: true, force: true });
}
