// 관리자 사용 통계 패널 스크린샷 — 임시 Chrome + CDP로 로그인 후 캡처한다.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const BASE_URL = process.env.PANEL_BASE_URL ?? "http://127.0.0.1:5174";
const ADMIN_PASSWORD = process.env.PANEL_ADMIN_PASSWORD ?? "analytics-test-1234";
const OUT_PATH = process.env.PANEL_SCREENSHOT ?? "admin-usage-analytics.png";
const CHROME_PATH = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}
async function waitForJson(url, predicate, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const payload = await (await fetch(url)).json();
      if (predicate(payload)) return payload;
    } catch { /* retry */ }
    await sleep(120);
  }
  throw new Error(`${label} 준비가 되지 않았습니다.`);
}

class CdpClient {
  constructor(url) { this.webSocketUrl = url; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("CDP 연결 실패")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}

const port = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-analytics-chrome-"));
const chrome = spawn(CHROME_PATH, [
  "--headless=new", "--no-first-run", "--window-size=1440,1600",
  "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank"
], { stdio: "ignore" });

let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (list) => Array.isArray(list) && list.some((item) => item.type === "page" && item.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");

  await client.send("Page.navigate", { url: `${BASE_URL}/admin` });
  await sleep(2_500);

  // 로그인 폼이 보이면 같은 오리진에서 직접 로그인하고 새로고침한다.
  const needsLogin = await client.evaluate(`Boolean(document.querySelector('#admin-password'))`);
  if (needsLogin) {
    const status = await client.evaluate(`fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ${JSON.stringify(ADMIN_PASSWORD)} }) }).then((r) => r.status)`);
    console.log("login status:", status);
    await client.send("Page.navigate", { url: `${BASE_URL}/admin` });
    await sleep(2_500);
  }

  // 패널이 lazy 마운트될 때까지 기다린 뒤 화면에 스크롤한다.
  const found = await client.evaluate(`(async () => {
    document.getElementById('admin-usage-analytics')?.scrollIntoView({ block: 'start' });
    for (let i = 0; i < 60; i += 1) {
      const panel = document.querySelector('[data-testid="admin-usage-analytics"]');
      if (panel) { panel.scrollIntoView({ block: 'start' }); return true; }
      document.getElementById('admin-usage-analytics')?.scrollIntoView({ block: 'start' });
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  })()`);
  if (!found) {
    const debug = await client.evaluate(`JSON.stringify({
      url: location.href,
      hasAnchor: Boolean(document.getElementById('admin-usage-analytics')),
      hasPassword: Boolean(document.querySelector('#admin-password')),
      testids: [...document.querySelectorAll('[data-testid]')].map((el) => el.dataset.testid),
      bodyHead: document.body.innerText.slice(0, 300)
    })`);
    console.log("debug:", debug);
    throw new Error("admin-usage-analytics 패널이 마운트되지 않았습니다.");
  }
  await sleep(1_200);

  const shot = await client.send("Page.captureScreenshot", { format: "png" });
  await writeFile(OUT_PATH, Buffer.from(shot.data, "base64"));
  console.log(`screenshot: ${OUT_PATH}`);

  const funnelText = await client.evaluate(`document.querySelector('[data-testid="admin-usage-analytics"]')?.innerText?.slice(0, 400)`);
  console.log("panel text head:", funnelText);
} finally {
  client?.close();
  chrome.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), sleep(2_000)]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profileDir, { recursive: true, force: true, maxRetries: 3 });
      break;
    } catch {
      await sleep(400);
    }
  }
}
