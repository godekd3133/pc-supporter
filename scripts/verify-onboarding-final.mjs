import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CdpClient, firstAvailable, freePort, sleep, waitForJson } from "./browser-smoke.mjs";

const baseUrl = process.env.BROWSER_SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const timeoutMs = 60_000;

const chromePath = await firstAvailable([
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean));
if (!chromePath) throw new Error("Chrome 실행 파일을 찾지 못했습니다.");

const port = await freePort();
const profileDir = await mkdtemp(join(tmpdir(), "pc-supporter-verify-final-"));
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox",
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--remote-allow-origins=*", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`, "--window-size=390,844",
  `${baseUrl}/start`
], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

let client;
try {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`, (items) => Array.isArray(items) && items.some((i) => i.type === "page" && i.webSocketDebuggerUrl), "Chrome 페이지");
  const target = pages.find((i) => i.type === "page" && i.webSocketDebuggerUrl);
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Network.enable");
  await client.send("Page.navigate", { url: `${baseUrl}/start` });
  {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await client.evaluate("location.pathname === '/start' && document.querySelector('.onboarding-page') !== null")) break;
      } catch { /* nav race */ }
      await sleep(60);
    }
  }

  const ev = async (expr) => client.evaluate(`(async () => { return (${expr}); })()`);
  const evs = async (body) => client.evaluate(`(async () => { ${body} })()`);
  const waitFor = async (expr, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { if (await ev(expr)) return; } catch { /* nav race */ }
      await sleep(40);
    }
    const dump = await ev("location.pathname + ' || ' + (document.body?.innerText ?? '').slice(-500)").catch(() => "?");
    throw new Error(`대기 시간 초과: ${label} — ${dump}`);
  };
  const nav = async (path) => {
    await evs(`history.pushState({}, "", ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent("popstate")); return true;`);
  };
  const clickBtn = async (needle, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await ev(`(() => { const b = [...document.querySelectorAll("button")].find(x => !x.disabled && (x.textContent ?? "").replace(/\\s+/g, " ").includes(${JSON.stringify(needle)})); if (!b) return false; b.click(); return true; })()`).catch(() => false);
      if (ok) { await sleep(90); return; }
      await sleep(80);
    }
    const dump = await ev("(document.body?.innerText ?? '').slice(-400)").catch(() => "?");
    throw new Error(`버튼 없음: ${needle} — ${dump}`);
  };
  const bodyHas = async (s) => ev(`(document.body?.innerText ?? "").includes(${JSON.stringify(s)})`);
  const title = async () => ev(`(document.querySelector(".onboarding-title")?.textContent ?? "").trim()`);
  const eyebrow = async () => ev(`(document.querySelector(".onboarding-eyebrow")?.textContent ?? "").replace(/\\s+/g, " ").trim()`);
  const reset = async () => {
    await evs("sessionStorage.clear(); return true;");
    await nav("/");
    await waitFor("document.querySelector('.home-page') !== null", "홈");
    await nav("/start");
    await waitFor("document.querySelector('.onboarding-page') !== null", "온보딩");
  };
  // POST sniffer
  await evs(`window.__posts = []; const of = window.fetch.bind(window); window.fetch = (i, init) => { const u = typeof i === "string" ? i : i.url; if (init?.method === "POST" && u.includes("/api/builds/recommend")) window.__posts.push(u); return of(i, init); }; return true;`);

  // ── 1. 예산 모드: budget → summary(4/4) → recommend ──────────────
  await reset();
  await clickBtn("새로운 견적을 맞추고 싶어요");
  await clickBtn("새 견적 시작하기");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('방식')", "mode");
  await clickBtn("예산으로 맞출래요");
  await clickBtn("다음");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('예산은')", "budget screen");
  await clickBtn("다음 · 조건 확인");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('조건') || (document.body?.innerText ?? '').includes('맞춰볼까요')", "budget summary");
  check("예산모드 요약 스텝 도달", true, await eyebrow());
  check("예산모드 인디케이터 4/4", (await eyebrow()).includes("4 / 4"), await eyebrow());
  check("예산모드 요약에 예산 행", await bodyHas("예산"));
  await clickBtn("이 조건으로 견적 생성하기");
  await waitFor("location.pathname === '/recommend'", "recommend 이동");
  await sleep(1500);
  const posts1 = await ev("window.__posts.length");
  check("예산모드 POST 발생", posts1 >= 1, `${posts1}건`);
  const draftOk = await waitFor("(document.body?.innerText ?? '').match(/CPU|그래픽|GPU/) !== null", "드래프트").then(() => true).catch(() => false);
  check("예산모드 드래프트 렌더링", draftOk);
  check("예산모드 쿼리 profile=general", (await ev("location.search")).includes("profile=general"), await ev("location.search"));

  // ── 2. 재개: summary 상태 저장 → /start → 이어서 → summary ─────
  await nav("/start");
  await waitFor("document.querySelector('.onboarding-page') !== null", "재개 화면");
  check("재개 카드 표시", await bodyHas("이어서"), (await title()) || "");
  await clickBtn("이어서");
  await waitFor("(document.querySelector('.onboarding-eyebrow')?.textContent ?? '').includes('READY')", "요약 복귀");
  check("재개→요약 복귀", true, await eyebrow());
  await clickBtn("이 조건으로 견적 생성하기");
  await waitFor("location.pathname === '/recommend'", "재생성 이동");
  await sleep(1200);
  check("재개 후 재생성 POST", (await ev("window.__posts.length")) > posts1);

  // ── 3. 작업 분기 요약 (7/7) ─────────────────────────────────────
  await reset();
  await clickBtn("새로운 견적을 맞추고 싶어요");
  await clickBtn("새 견적 시작하기");
  await clickBtn("특정 작업이나 게임을 할 거예요");
  await clickBtn("다음");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('주로')", "usecase");
  await clickBtn("작업");
  await clickBtn("다음");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('작업을')", "work");
  await clickBtn("개발·빌드");
  await clickBtn("다음");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('강도') || (document.body?.innerText ?? '').includes('가볍게')", "intensity");
  await clickBtn("균형");
  await clickBtn("다음 · 예산 정하기");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('예산')", "work budget");
  await clickBtn("다음 · 조건 확인");
  await waitFor("(document.querySelector('.onboarding-eyebrow')?.textContent ?? '').includes('READY')", "work summary");
  const wInd = await eyebrow();
  check("작업모드 요약 7/7", wInd.includes("7 / 7"), wInd);
  check("작업모드 요약에 작업 행", await bodyHas("개발") || await bodyHas("작업"));
  check("작업모드 요약에 강도 행", await bodyHas("균형"));
  // 뒤로가기 → budget 복귀
  await ev("document.querySelector('.onboarding-back')?.click() ?? true").catch(() => {});
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('예산')", "작업 뒤로가기");
  check("작업 요약→예산 뒤로가기", true);
  await clickBtn("다음 · 조건 확인");
  await waitFor("(document.querySelector('.onboarding-eyebrow')?.textContent ?? '').includes('READY')", "요약 재진입");
  await clickBtn("이 조건으로 견적 생성하기");
  await waitFor("location.pathname === '/recommend'", "작업 recommend");
  check("작업 쿼리 work=dev", (await ev("location.search")).includes("work=dev"), await ev("location.search"));

  // ── 4. 성능 분기 요약 (5/5) ─────────────────────────────────────
  await reset();
  await clickBtn("새로운 견적을 맞추고 싶어요");
  await clickBtn("새 견적 시작하기");
  await clickBtn("생각해둔 성능이 있어요");
  await clickBtn("다음");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('성능')", "spec");
  await clickBtn("다음");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('예산')", "spec budget");
  await clickBtn("다음 · 조건 확인");
  await waitFor("(document.querySelector('.onboarding-eyebrow')?.textContent ?? '').includes('READY')", "spec summary");
  const sInd = await eyebrow();
  check("성능모드 요약 5/5", sInd.includes("5 / 5"), sInd);
  check("성능모드 요약에 등급 행", await bodyHas("등급") || await bodyHas("성능"));
  await clickBtn("이 조건으로 견적 생성하기");
  await waitFor("location.pathname === '/recommend'", "spec recommend");
  check("성능 쿼리 tier 포함", (await ev("location.search")).includes("tier="), await ev("location.search"));

  // ── 5. 게임 근거 verified 카드 ──────────────────────────────────
  await reset();
  await clickBtn("새로운 견적을 맞추고 싶어요");
  await clickBtn("새 견적 시작하기");
  await clickBtn("특정 작업이나 게임을 할 거예요");
  await clickBtn("다음");
  await clickBtn("게임");
  await clickBtn("다음");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('게임')", "games");
  // 검색으로 사이버펑크 선택
  await ev(`(() => { const i = document.querySelector('input[type="search"], input[placeholder*="검색"], .onboarding-search input, input'); if (!i) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(i, "사이버펑크"); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sleep(150);
  await clickBtn("사이버펑크");
  await clickBtn("다음");
  await waitFor("(document.body?.innerText ?? '').includes('해상도')", "performance");
  await clickBtn("4K");
  await clickBtn("60");
  await sleep(120);
  const perfPill = await ev("document.querySelector('.onboarding-pill')?.textContent ?? ''");
  check("목표 4K·60 반영", perfPill.includes("4K") && perfPill.includes("60"), perfPill);
  await clickBtn("다음");
  await waitFor("(document.body?.innerText ?? '').includes('그래픽') || (document.body?.innerText ?? '').includes('레이트레이싱')", "graphics");
  // RT 기본값 off 유지 + 업스케일링 없음(native) 선택 — 근거 레코드 조건과 일치
  await clickBtn("업스케일링 없음");
  await sleep(80);
  await clickBtn("다음 · 예산 정하기");
  await waitFor("(document.querySelector('.onboarding-title')?.textContent ?? '').includes('예산')", "gaming budget");
  // 예산 600만원 (aria-label 아이콘 버튼)
  for (let i = 0; i < 40; i++) {
    const ok = await ev(`(() => { const b = document.querySelector('button[aria-label*="늘리기"]'); if (!b) return false; b.click(); return true; })()`);
    if (!ok) break;
    await sleep(40);
    const v = await ev("document.querySelector('.onboarding-budget-value')?.textContent ?? ''");
    if (v.includes("600")) break;
  }
  await clickBtn("다음 · 조건 확인");
  await waitFor("(document.querySelector('.onboarding-eyebrow')?.textContent ?? '').includes('READY')", "gaming summary");
  check("게임 요약 8/8", (await eyebrow()).includes("8 / 8"), await eyebrow());
  await clickBtn("이 조건으로 견적 생성하기");
  await waitFor("location.pathname === '/recommend'", "gaming recommend");
  await sleep(3000);
  const gUrl = await ev("location.search");
  check("게임 쿼리 games=cyberpunk", gUrl.includes("cyberpunk"), gUrl);
  const evidTxt = await ev("document.body?.innerText ?? ''");
  check("근거 카드 존재", evidTxt.includes("PERFORMANCE") || evidTxt.includes("근거") || evidTxt.includes("FPS"), "");
  const verified = evidTxt.includes("80") || evidTxt.toLowerCase().includes("verified") || evidTxt.includes("측정");
  check("근거 verified 상태 (80FPS/측정 표시)", verified, evidTxt.match(/FPS.{0,80}/)?.[0] ?? "no FPS text");

  console.log("---");
  const fails = results.filter(r => !r.ok);
  console.log(`TOTAL ${results.length} / FAIL ${fails.length}`);
} finally {
  try { chrome.kill("SIGKILL"); } catch { /* noop */ }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(results.some(r => !r.ok) ? 1 : 0);
