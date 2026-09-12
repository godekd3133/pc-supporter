import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CdpClient, assert, firstAvailable, freePort, sleep, waitForJson, waitForValue } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:4184";

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already have exited.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Cleanup is best effort.
  }
}

async function main() {
  const chromePath = await firstAvailable([
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean));
  if (!chromePath) throw new Error("Chrome 실행 파일을 찾지 못했습니다.");

  const port = await freePort();
  const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-part-watch-smoke-"));
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
  let client;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (value) => Array.isArray(value) && value.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "focused result PartWatch Chrome page");
    const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await waitForValue(client, `location.href.startsWith(${JSON.stringify(baseUrl)})`, "focused result PartWatch page");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('오류 시연 견적')", "focused result PartWatch home");
    await client.evaluate("(() => { const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('오류 시연 견적')); button?.click(); })()");
    await waitForValue(client, "location.pathname === '/build' && (document.body?.innerText ?? '').includes('나의 PC 견적 구성')", "focused result PartWatch build");
    await waitForValue(client, "[...document.querySelectorAll('button')].some((button) => (button.textContent ?? '').includes('호환성 검사하기'))", "focused result PartWatch check button");
    await client.evaluate("(() => { const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes('호환성 검사하기')); button?.click(); })()");
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.part-watch-button[data-item-id]') !== null", "focused result PartWatch control");

    const probe = await client.evaluate(`(async () => {
      const watchlistKey = "pc-supporter-catalog-watchlist";
      const originalWatchlist = localStorage.getItem(watchlistKey);
      const button = document.querySelector('.part-watch-button[data-item-id]');
      const itemId = button?.getAttribute('data-item-id') ?? "";
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const entry = { itemId, itemName: "focused result part watch probe", category: "cpu", kind: "part", addedAt: "2026-09-10T00:00:00.000Z" };
      const dispatch = (value) => window.dispatchEvent(new StorageEvent("storage", { key: watchlistKey, newValue: value, storageArea: localStorage }));
      try {
        if (!(button instanceof HTMLButtonElement) || !itemId) return { stage: "missing-controls", itemId };
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const initiallyUnwatched = !button.classList.contains("watched");
        const serialized = JSON.stringify([entry]);
        localStorage.setItem(watchlistKey, serialized);
        dispatch(serialized);
        for (let index = 0; index < 80 && !button.classList.contains("watched"); index += 1) await wait(25);
        const added = button.classList.contains("watched");
        localStorage.setItem(watchlistKey, "[]");
        dispatch("[]");
        for (let index = 0; index < 80 && button.classList.contains("watched"); index += 1) await wait(25);
        const removed = !button.classList.contains("watched");
        return { stage: "checked", itemId, initiallyUnwatched, added, removed, path: location.pathname };
      } finally {
        if (originalWatchlist === null) localStorage.removeItem(watchlistKey); else localStorage.setItem(watchlistKey, originalWatchlist);
        dispatch(originalWatchlist);
        await wait(100);
      }
    })()`);
    assert(probe?.stage === "checked" && probe.initiallyUnwatched === true && probe.added === true && probe.removed === true && probe.path === "/result", "focused result PartWatch storage probe failed: " + JSON.stringify(probe));
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    client?.close();
    signalProcessGroup(chrome, "SIGTERM");
    await sleep(500);
    signalProcessGroup(chrome, "SIGKILL");
    await rm(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
