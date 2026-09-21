import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspaceDir = process.cwd();
const timeoutMs = Number(process.env.BROWSER_PERSISTENCE_SMOKE_TIMEOUT_MS ?? 120_000);

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The process group may already have exited; fall back to the direct child.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Cleanup must remain best effort after an assertion failure.
  }
}

// Keep the helper's waitForValue/waitForJson timeout aligned with this runner.
// The assignment must happen before the dynamic import because browser-smoke
// reads its timeout at module evaluation time.
if (!process.env.BROWSER_SMOKE_TIMEOUT_MS && process.env.BROWSER_PERSISTENCE_SMOKE_TIMEOUT_MS) process.env.BROWSER_SMOKE_TIMEOUT_MS = process.env.BROWSER_PERSISTENCE_SMOKE_TIMEOUT_MS;
// Persistence smoke keeps two long result pages alive; a simple DOM probe can
// legitimately wait longer than browser-smoke's short single-page default.
if (!process.env.BROWSER_SMOKE_EVALUATE_TIMEOUT_MS) process.env.BROWSER_SMOKE_EVALUATE_TIMEOUT_MS = "30000";
const {
  CdpClient,
  assert,
  bodyText,
  clickSelector,
  clickText,
  firstAvailable,
  freePort,
  openHistoryDetails,
  openResultDetails,
  sleep,
  setTextValue,
  waitForHomeDemoButtons,
  waitForValue
} = await import("./browser-smoke.mjs");

function managedProcess(command, args, env) {
  const child = spawn(command, args, { cwd: workspaceDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const capture = (chunk) => { output = `${output}${String(chunk)}`.slice(-12_000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  let exited = false;
  const exitPromise = new Promise((resolve) => child.once("exit", () => { exited = true; resolve(); }));
  return {
    child,
    output: () => output,
    async stop() {
      if (exited) return;
      child.kill("SIGTERM");
      await Promise.race([exitPromise, sleep(2_000)]);
      if (!exited) {
        child.kill("SIGKILL");
        await Promise.race([exitPromise, sleep(1_000)]);
      }
    }
  };
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      await response.arrayBuffer();
    } catch {
      // The isolated server may still be starting.
    }
    await sleep(100);
  }
  throw new Error(`${label}을(를) ${timeoutMs}ms 안에 확인하지 못했습니다.`);
}

async function waitForChromePage(port, predicate, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && predicate(item));
        if (page) return page;
      } else await response.arrayBuffer();
    } catch {
      // Chrome may still be creating the second tab.
    }
    await sleep(100);
  }
  throw new Error(`${label}을(를) ${timeoutMs}ms 안에 확인하지 못했습니다.`);
}

async function setInputValue(client, selector, value) {
  return client.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return input.value === ${JSON.stringify(value)}; })()`);
}

async function launchChrome(baseUrl, profileDir) {
  const chromePath = await firstAvailable([
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean));
  if (!chromePath) throw new Error("Chrome 또는 Chromium 실행 파일을 찾지 못했습니다. CHROME_BIN으로 경로를 지정해 주세요.");
  const port = await freePort();
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
    baseUrl
  ], { cwd: workspaceDir, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  let exited = false;
  const exitPromise = new Promise((resolve) => chrome.once("exit", () => { exited = true; resolve(); }));
  const pages = await waitForHttp(`http://127.0.0.1:${port}/json/list`, "Chrome 페이지");
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!page) throw new Error("Chrome 대상 페이지를 찾지 못했습니다.");
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  return {
    client,
    port,
    async stop() {
      client.close();
      if (exited) return;
      signalProcessGroup(chrome, "SIGTERM");
      await Promise.race([exitPromise, sleep(2_000)]);
      if (!exited) {
        signalProcessGroup(chrome, "SIGKILL");
        await Promise.race([exitPromise, sleep(1_000)]);
      }
    }
  };
}

async function openAdditionalPage(client, port, url) {
  assert(await client.evaluate(`Boolean(window.open(${JSON.stringify(url)}, "_blank"))`), "두 번째 브라우저 탭을 열지 못했습니다.");
  const page = await waitForChromePage(port, (item) => item.url.startsWith(url), "두 번째 브라우저 탭");
  const secondClient = new CdpClient(page.webSocketDebuggerUrl);
  await secondClient.connect();
  await secondClient.send("Runtime.enable");
  await secondClient.send("Page.enable");
  return secondClient;
}

async function navigate(client, url, label) {
  await client.send("Page.navigate", { url });
  await waitForValue(client, `location.href.startsWith(${JSON.stringify(url)})`, label);
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "pc-supporter-persistence-data-"));
  const freshProvenanceAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const provenancePart = {
    id: "persistence-provenance-gpu",
    category: "gpu",
    name: "persistence provenance GPU",
    source: "manual",
    specs: { vramGb: 16 },
    dataQuality: "incomplete",
    missingFields: ["powerW"],
    updatedAt: freshProvenanceAt
  };
  await writeFile(join(dataDir, "catalog.json"), JSON.stringify([provenancePart]));
  await writeFile(join(dataDir, "catalog-spec-overrides.json"), JSON.stringify({
    [provenancePart.id]: {
      partId: provenancePart.id,
      category: "gpu",
      fields: { powerW: 320 },
      manufacturerModel: "PERSISTENCE-GPU-16",
      sourceNote: "제조사 공식 사양서 4쪽",
      sourceUrl: "https://vendor.example/persistence-gpu",
      sourceCheck: {
        requestedUrl: "https://vendor.example/persistence-gpu",
        checkedAt: freshProvenanceAt,
        status: "reachable",
        identityStatus: "matched",
        redirectCount: 0,
        finalUrl: "https://vendor.example/persistence-gpu",
        httpStatus: 200,
        contentType: "text/html",
        detail: "등록한 제조사 모델/SKU를 확인했습니다."
      },
      updatedAt: freshProvenanceAt
    }
  }));
  await writeFile(join(dataDir, "catalog-change-log.json"), JSON.stringify([
    { id: "smoke-price-history-1", kind: "part", itemId: "cpu-7800x3d", itemName: "AMD 라이젠7-5세대 7800X3D", category: "cpu", changedAt: "2026-08-20T00:00:00.000Z", changedFields: ["가격"], previousDataQuality: "seed", nextDataQuality: "seed", previousMissingFields: [], nextMissingFields: [], previousPriceWon: 480000, nextPriceWon: 460000, priceDeltaWon: -20000, valueDiffs: [] },
    { id: "smoke-price-history-2", kind: "part", itemId: "cpu-7800x3d", itemName: "AMD 라이젠7-5세대 7800X3D", category: "cpu", changedAt: "2026-08-25T00:00:00.000Z", changedFields: ["가격"], previousDataQuality: "seed", nextDataQuality: "seed", previousMissingFields: [], nextMissingFields: [], previousPriceWon: 460000, nextPriceWon: 420000, priceDeltaWon: -40000, valueDiffs: [] }
  ]));
  const apiPort = await freePort();
  const webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const env = {
    ...process.env,
    PC_SUPPORTER_DATA_DIR: dataDir,
    PORT: String(apiPort),
    DANAWA_CRAWL_ON_START: "false",
    BUILD_MONITOR_SCHEDULER_ENABLED: "false",
    VITE_API_PROXY_TARGET: apiUrl
  };
  const apiServer = managedProcess(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], env);
  const webServer = managedProcess(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(webPort)], env);
  let browser;
  let secondClient;
  try {
    const apiHealth = await waitForHttp(`${apiUrl}/api/health`, "격리 API");
    await waitForHttp(`${webUrl}/api/health`, "격리 Vite proxy");
    const catalogRateLimitProbe = await fetch(`${apiUrl}/api/parts?category=cpu&limit=1`);
    await catalogRateLimitProbe.arrayBuffer();
    assert(catalogRateLimitProbe.ok && catalogRateLimitProbe.headers.get("x-ratelimit-limit") === "180" && catalogRateLimitProbe.headers.has("x-ratelimit-remaining"), "카탈로그 조회 rate limit 헤더가 없습니다.");
    const compatibilityRateLimitProbe = await fetch(`${apiUrl}/api/compatibility/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cpu: "invalid-selection" }) });
    await compatibilityRateLimitProbe.arrayBuffer();
    assert(compatibilityRateLimitProbe.status === 400 && compatibilityRateLimitProbe.headers.get("x-ratelimit-limit") === "60" && compatibilityRateLimitProbe.headers.has("x-ratelimit-reset"), "호환성 검사 rate limit 헤더가 없습니다.");
    browser = await launchChrome(`${webUrl}/`, dataDir + "-chrome");
    const { client } = browser;

    await waitForHomeDemoButtons(client, "격리 홈 화면");
    await navigate(client, `${webUrl}/catalog?category=gpu&partId=${encodeURIComponent(provenancePart.id)}`, "수동 provenance 카탈로그 상세");
    await waitForValue(client, "document.querySelector('[data-testid=\"catalog-part-detail\"]') !== null && document.querySelector('[data-testid=\"catalog-spec-provenance\"]') !== null && document.querySelector('[data-testid=\"catalog-spec-provenance-source-check\"]') !== null && (document.body?.innerText ?? '').includes('PERSISTENCE-GPU-16') && (document.body?.innerText ?? '').includes('페이지·모델 확인됨')", "수동 provenance 표시");
    assert((await bodyText(client)).includes("제조사 공식 사양서 4쪽"), "수동 provenance 근거 메모가 표시되지 않았습니다.");
    await navigate(client, `${webUrl}/admin`, "수동 override 관리자 화면");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('부품 데이터 센터')", "수동 override 관리자 화면 확인");
    await waitForValue(client, "document.getElementById('admin-catalog-spec-override') !== null", "제조사 정보 수동 스펙 보강 anchor");
    await client.evaluate("(() => { const node = document.getElementById('admin-catalog-spec-override'); node?.scrollIntoView({ block: 'center', behavior: 'auto' }); node?.focus({ preventScroll: true }); return Boolean(node); })()");
    await waitForValue(client, "document.querySelector('[data-testid=\"admin-catalog-spec-override\"]')?.textContent?.includes('제조사 정보 수동 스펙 보강') === true && document.querySelector('[data-testid=\"admin-catalog-spec-override\"]')?.textContent?.includes('정보 점검 · URL 접근 가능 · 모델 확인') === true", "수동 override 정보 점검 상태");
    assert(await client.evaluate("[...document.querySelectorAll('[data-testid=\"admin-catalog-spec-override-list\"] button')].some((button) => (button.textContent ?? '').includes('최대 50개 정보 점검'))"), "수동 override 일괄 정보 점검 버튼이 표시되지 않았습니다.");
    await navigate(client, `${webUrl}/`, "격리 홈 화면 복귀");
    await waitForHomeDemoButtons(client, "격리 홈 화면 복귀 확인");
    assert(await clickText(client, "문제 있는 예시 견적"), "문제 있는 예시 견적 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('나의 PC 견적 구성') || (document.body?.innerText ?? '').includes('견적 구성')", "격리 견적 편집기");
    await waitForValue(client, "[...document.querySelectorAll('button')].some((button) => !button.disabled && (button.textContent ?? '').includes('호환성 검사하기'))", "격리 검사 준비");
    assert(await clickText(client, "호환성 검사하기"), "격리 호환성 검사 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('검사 결과 상세')", "격리 검사 결과");
    assert((await clickSelector(client, '.result-metrics button.metric-card.danger', 1)) === 1, "격리 차단 오류 요약 카드를 클릭하지 못했습니다.");
    await waitForValue(client, "location.search === '?finding=blocker' && location.hash === '#findings' && document.querySelector('.finding-filter-button.selected')?.textContent?.includes('차단 오류') === true", "격리 결과 필터 URL");

    assert(await clickText(client, "견적 저장·공유"), "견적 저장·공유 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('#save-build-dialog-title') !== null", "견적 저장 창");
    assert(await setInputValue(client, "#save-build-name", "브라우저 지속성 검증 견적"), "견적 이름을 입력하지 못했습니다.");
    assert(await setTextValue(client, "#save-build-decision-note", "QHD 게이밍과 업그레이드 여유를 우선"), "견적 선택 이유를 입력하지 못했습니다.");
    assert(await clickText(client, "저장하고 링크 복사"), "견적 저장 버튼을 찾지 못했습니다.");
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-hero') !== null && (() => { try { return JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]').length >= 1; } catch { return false; } })()", "견적 저장 완료 상태");

    const savedIds = await client.evaluate("JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]')");
    assert(Array.isArray(savedIds) && savedIds.length === 1 && typeof savedIds[0] === "string", "저장 견적 ID가 브라우저에 기록되지 않았습니다.");
    const originalSavedId = savedIds[0];
    const ownerTokens = await client.evaluate("JSON.parse(localStorage.getItem('pc-supporter-saved-build-owner-tokens') ?? '{}')");
    assert(typeof ownerTokens?.[originalSavedId] === "string" && ownerTokens[originalSavedId].length >= 40, "저장 견적 owner token이 브라우저에 기록되지 않았습니다.");

    const persistedBuild = await fetch(`${apiUrl}/api/builds/${encodeURIComponent(originalSavedId)}`).then((response) => response.json());
    const refreshTargetId = persistedBuild?.selection?.cpu?.partId ?? persistedBuild?.selection?.gpu?.partId ?? persistedBuild?.selection?.motherboard?.partId ?? persistedBuild?.selection?.case?.partId ?? persistedBuild?.selection?.psu?.partId ?? persistedBuild?.selection?.memory?.[0]?.partId ?? persistedBuild?.selection?.ssd?.[0]?.partId ?? persistedBuild?.selection?.hdd?.[0]?.partId;
    const refreshInputFingerprint = await client.evaluate("sessionStorage.getItem('pc-supporter-last-compatibility-input') ?? ''");
    assert(typeof refreshTargetId === "string" && refreshTargetId.length > 0 && typeof refreshInputFingerprint === "string" && refreshInputFingerprint.length > 0, "원문 재확인 연결 검증에 필요한 저장 견적 target/fingerprint를 찾지 못했습니다.");
    const refreshReport = {
      inputFingerprint: refreshInputFingerprint,
      status: "success",
      requestedCount: 1,
      successCount: 1,
      failureCount: 0,
      items: [{ target: { kind: "part", id: refreshTargetId }, name: "브라우저 원문 재확인 근거", changedFields: ["가격", "정규화 스펙"], refreshedAt: "2026-09-04T00:00:00.000Z", previousDataQuality: "seed", nextDataQuality: "live", previousMissingCount: 1, nextMissingCount: 0, previousPriceWon: 100000, nextPriceWon: 110000, valueDiffs: [{ field: "가격", previous: "100,000원", next: "110,000원" }, { field: "정규화 스펙", previous: "{\"socket\":\"AM4\"}", next: "{\"socket\":\"AM5\"}" }] }],
      failures: [],
      completedAt: "2026-09-04T00:00:00.000Z"
    };
    const refreshCheckResponse = await fetch(`${apiUrl}/api/builds/${encodeURIComponent(originalSavedId)}/check`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": ownerTokens[originalSavedId] }, body: JSON.stringify({ catalogRefreshReport: refreshReport }) });
    const refreshCheckPayload = await refreshCheckResponse.json();
    assert(refreshCheckResponse.ok && refreshCheckPayload?.checkHistory?.at(-1)?.catalogRefreshReport?.items?.[0]?.valueDiffs?.length === 2, "원문 재확인 값 근거가 저장 견적 검사 이력에 보존되지 않았습니다. payload=" + JSON.stringify(refreshCheckPayload));
    await navigate(client, `${webUrl}/share/${encodeURIComponent(originalSavedId)}`, "원문 재확인 finding 연결 route");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-recheck-refresh-impact\"]') !== null", "원문 재확인 finding 연결 패널");
    const refreshImpactText = await bodyText(client);
    assert(refreshImpactText.includes("브라우저 원문 재확인 근거") && refreshImpactText.includes("확인된 실제 값") && refreshImpactText.includes("100,000원") && refreshImpactText.includes("110,000원"), "원문 재확인 실제 값 변화가 결과 화면에 표시되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid="saved-build-recheck-refresh-action-purchase-list-panel"]', 1)) === 1, "원문 재확인 가격 바로가기를 클릭하지 못했습니다.");
    await waitForValue(client, "location.hash === '#purchase-list' && document.activeElement?.getAttribute('data-testid') === 'purchase-list-panel'", "원문 재확인 가격 바로가기 focus");

    await waitForValue(client, "document.querySelector('[data-testid=\"assembly-verification-panel\"]') !== null && document.querySelector('[aria-label=\"POST·첫 부팅 상태\"]') !== null", "저장 견적 조립 검증 패널");
    const assemblyCheckChanged = await client.evaluate("(() => { const select = document.querySelector('[aria-label=\"POST·첫 부팅 상태\"]'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, 'pass'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === 'pass'; })()");
    assert(assemblyCheckChanged, "조립 검증 POST 상태를 변경하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"assembly-verification-panel\"] .assembly-verification-progress')?.textContent?.includes('1 / 6개') === true", "조립 검증 POST 상태 반영");
    assert(await clickText(client, "저장 견적에 기록"), "조립 검증 서버 기록 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('저장 견적의 읽기 전용 검사 이력에 기록했습니다') || document.querySelector('.assembly-verification-message.error') !== null", "조립 검증 서버 기록 응답");
    const assemblyServerRecordMessage = await client.evaluate("document.querySelector('.assembly-verification-message')?.textContent ?? ''");
    assert(assemblyServerRecordMessage.includes('저장 견적의 읽기 전용 검사 이력에 기록했습니다'), "조립 검증 서버 기록에 실패했습니다. message=" + assemblyServerRecordMessage);
    const savedAssemblySnapshot = await fetch(`${apiUrl}/api/builds/${encodeURIComponent(originalSavedId)}`).then((response) => response.json());
    assert(savedAssemblySnapshot?.checkSnapshot?.assemblyVerification?.checked === 1 && savedAssemblySnapshot?.checkSnapshot?.assemblyVerification?.checks?.post === 'pass', "조립 검증 compact snapshot이 서버에 기록되지 않았습니다.");
    await navigate(client, `${webUrl}/`, "조립 검증 로컬 기록 초기화 전 홈 이동");
    await waitForValue(client, "document.querySelector('[data-testid=\"assembly-verification-panel\"]') === null", "조립 검증 패널 언마운트");
    await client.evaluate("(() => { Object.keys(localStorage).filter((key) => key.startsWith('pc-supporter-assembly-verification:')).forEach((key) => localStorage.removeItem(key)); return true; })()");
    await navigate(client, `${webUrl}/share/${encodeURIComponent(originalSavedId)}`, "조립 검증 서버 compact 복원 route");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"assembly-verification-panel\"]') !== null", "조립 검증 서버 compact 복원 패널");
    const assemblyRestoreProbe = await client.evaluate(`(async () => { const saved = await fetch('/api/builds/${encodeURIComponent(originalSavedId)}').then((response) => response.json()); const local = Object.entries(localStorage).filter(([key]) => key.startsWith('pc-supporter-assembly-verification:')).map(([key, value]) => ({ key, value })); return { banner: Boolean(document.querySelector('[data-testid="assembly-verification-server-restored"]')), progress: document.querySelector('[data-testid="assembly-verification-panel"] .assembly-verification-progress')?.textContent ?? '', panel: document.querySelector('[data-testid="assembly-verification-panel"]')?.textContent?.slice(0, 1800) ?? '', local, checkHistory: saved?.checkHistory?.map((snapshot) => ({ checked: snapshot?.assemblyVerification?.checked, historyLength: snapshot?.assemblyVerificationHistory?.length ?? 0 })) ?? [] }; })()`);
    assert(assemblyRestoreProbe.banner && assemblyRestoreProbe.progress.includes('1 / 6개') && assemblyRestoreProbe.panel.includes('실측 회차1 / 12회차'), "조립 검증 서버 compact 복원에 실패했습니다. probe=" + JSON.stringify(assemblyRestoreProbe));

    const monitorHeaders = { "Content-Type": "application/json", "X-Share-Owner-Token": ownerTokens[originalSavedId] };
    const monitorConfigured = await fetch(`${apiUrl}/api/builds/${encodeURIComponent(originalSavedId)}/monitor`, { method: "PUT", headers: monitorHeaders, body: JSON.stringify({ enabled: false, intervalMinutes: 60, alertPolicy: "all" }) });
    await monitorConfigured.arrayBuffer();
    assert(monitorConfigured.ok, "저장 견적 서버 모니터링을 설정하지 못했습니다.");
    const monitorRun = await fetch(`${apiUrl}/api/builds/${encodeURIComponent(originalSavedId)}/monitor/run`, { method: "POST", headers: monitorHeaders });
    const monitorRunPayload = await monitorRun.json();
    const monitorAlertWithFinding = monitorRunPayload?.subscription?.alerts?.find((alert) => Array.isArray(alert.findingRuleIds) && alert.findingRuleIds.length > 0);
    const monitorFindingRuleId = monitorAlertWithFinding?.findingRuleIds?.[0];
    assert(monitorRun.ok && typeof monitorFindingRuleId === "string", "서버 모니터 alert에 영향 finding context가 기록되지 않았습니다.");

    secondClient = await openAdditionalPage(client, browser.port, `${webUrl}/history`);
    await waitForValue(secondClient, "(document.body?.innerText ?? '').includes('저장된 견적') && (document.body?.innerText ?? '').includes('브라우저 지속성 검증 견적')", "두 번째 탭 원본 견적 이력");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-monitor-alerts\"]') !== null", "두 번째 탭 알림함 lazy load");
    await waitForValue(secondClient, "document.querySelector('.history-monitor-alert-finding-link') !== null", "알림 영향 finding 표시");
    assert(await clickSelector(secondClient, ".history-monitor-alert-finding-link", 1) === 1, "알림 영향 finding 상세 이동 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "location.pathname === '/result' && document.activeElement?.id?.startsWith('finding-') === true", "알림에서 finding 상세 이동");
    await navigate(secondClient, `${webUrl}/share/${encodeURIComponent(originalSavedId)}?findingRule=${encodeURIComponent(monitorFindingRuleId)}#findings`, "finding deep link 공유 route");
    await waitForValue(secondClient, "location.search.startsWith('?findingRule=') && location.hash === '#findings' && document.activeElement?.id?.startsWith('finding-') === true", "finding deep link 공유 route 포커스");

    const sharedWatchlistCreated = await fetch(`${apiUrl}/api/watchlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "브라우저 공유 가격 추적 검증 목록",
        entries: [{ itemId: "cpu-7800x3d", itemName: "AMD 라이젠7-5세대 7800X3D", category: "cpu", kind: "part", addedAt: new Date().toISOString(), targetPriceWon: 999999999 }],
        nearLowThresholdPercent: 10,
        expiresInDays: 30
      })
    });
    const sharedWatchlistPayload = await sharedWatchlistCreated.json();
    assert(sharedWatchlistCreated.status === 201 && typeof sharedWatchlistPayload?.id === "string", "공유 가격 추적 검증 목록을 만들지 못했습니다.");
    const sharedWatchlistId = sharedWatchlistPayload.id;
    const sharedWatchlistUrl = `${webUrl}/watchlist/${encodeURIComponent(sharedWatchlistId)}`;
    await navigate(secondClient, sharedWatchlistUrl, "두 번째 탭 공유 가격 추적 route");
    await waitForValue(secondClient, "document.querySelector('.shared-watchlist-card') !== null && document.querySelector('[data-testid=\"shared-watchlist-decision\"]') !== null", "공유 가격 추적 snapshot");
    assert(!(await bodyText(secondClient)).includes(sharedWatchlistPayload.ownerToken), "공유 가격 추적 화면에 owner token이 노출되었습니다.");
    await secondClient.send("Network.enable");
    await secondClient.send("Network.setBlockedURLs", { urls: ["*://*/api/watchlists/*"] });
    await navigate(secondClient, sharedWatchlistUrl, "공유 가격 추적 오류 복구 route");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-watchlist-retry\"]') !== null", "공유 가격 추적 재시도 안내");
    assert((await bodyText(secondClient)).includes("API 서버에 연결할 수 없습니다."), "공유 가격 추적 재시도 안내가 API 연결 오류를 표시하지 않았습니다.");
    await secondClient.send("Network.setBlockedURLs", { urls: [] });
    assert(await clickText(secondClient, "다시 시도"), "공유 가격 추적 다시 시도 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('.shared-watchlist-card') !== null", "공유 가격 추적 재시도 복구");
    assert(await clickText(secondClient, "현재 가격 다시 확인"), "공유 가격 추적 현재 가격 확인 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "[...document.querySelectorAll('[data-testid=\"shared-watchlist-decision\"]')].some((node) => (node.textContent ?? '').includes('목표가 도달'))", "공유 가격 추적 결정 상태");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-watchlist-decision-overview\"]') !== null && (document.body?.innerText ?? '').includes('목표가 도달 1')", "공유 가격 추적 판단 분포");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-watchlist-price-history\"]') !== null && document.querySelectorAll('[data-testid=\"shared-watchlist-price-history\"] .price-watchlist-sparkline span').length === 2", "공유 가격 추적 추세 막대");
    assert(await secondClient.evaluate("(() => { const select = document.querySelector('[aria-label=\"공유 가격 이력 기간\"]'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, '90'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === '90'; })()"), "공유 가격 추적 이력 기간을 변경하지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[aria-label=\"공유 가격 이력 기간\"]')?.value === '90'", "공유 가격 추적 이력 기간");
    await navigate(secondClient, `${webUrl}/history`, "두 번째 탭 후보 견적 동기화 route");

    await waitForValue(client, "[...document.querySelectorAll('.finding-card')].some((candidate) => (candidate.textContent ?? '').includes('파워서플라이 용량이 부족합니다.') && [...candidate.querySelectorAll('.finding-actions button')].some((button) => !button.disabled && (button.textContent ?? '').includes('파워서플라이 바꾸기')))", "후보 전체 비교용 finding 액션");
    const candidateReplacementClicked = await client.evaluate("(() => { const card = [...document.querySelectorAll('.finding-card')].find((candidate) => (candidate.textContent ?? '').includes('파워서플라이 용량이 부족합니다.')); const node = [...(card?.querySelectorAll('.finding-actions button') ?? [])].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('파워서플라이 바꾸기')); if (!node) return false; node.click(); return true; })()");
    assert(candidateReplacementClicked, "후보 전체 비교 테스트용 finding 교체 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] #picker-title')?.textContent?.includes('선택') === true", "후보 전체 비교용 선택기");
    await waitForValue(client, "document.querySelectorAll('[role=dialog] .picker-item').length > 0", "후보 전체 비교 목록");
    assert(await client.evaluate("(() => { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; for (const label of [...document.querySelectorAll('[role=dialog] label')]) { if (!(label.textContent ?? '').includes('부품')) continue; const select = label.querySelector('select'); if (!select || ![...select.options].some((option) => option.value === 'no_blocker')) continue; setter?.call(select, 'no_blocker'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === 'no_blocker'; } return false; })()"), "후보 전체 비교 모드로 전환하지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('차단 오류 없는 부품') && document.querySelectorAll('[role=dialog] .picker-item').length > 1", "차단 없음 후보 전체 비교 목록");
    await waitForValue(client, "document.querySelectorAll('[role=dialog] .picker-compare-toggle:not([disabled])').length > 1", "차단 없음 후보 비교 버튼");
    assert((await clickSelector(client, '[role=dialog] .picker-compare-toggle', 2)) === 2, "후보 전체 비교용 후보 2개를 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[role=dialog] [aria-label=\"부품 비교\"]') !== null", "후보 전체 비교 선택 상태");
    assert(await clickText(client, "전체 미리 비교"), "전체 미리 비교 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('#candidate-scenario-title') !== null", "부품 전체 미리 비교 창");
    await waitForValue(client, "document.querySelectorAll('.candidate-scenario-card.ready').length === 2 && (document.body?.innerText ?? '').includes('2 / 2개 계산')", "부품 전체 미리 비교 완료");
    await waitForValue(client, "document.querySelectorAll('[data-testid=\"candidate-scenario-analysis\"]').length === 2 && (document.body?.innerText ?? '').includes('부품 적용 후 성능 분석')", "후보별 성능 분석 비교");
    await waitForValue(client, "document.querySelector('[data-testid=\"candidate-tradeoff-frontier\"]') !== null && (document.body?.innerText ?? '').includes('호환·가격·분석·정보의 비교 우위')", "후보 비교 우위");
    assert((await bodyText(client)).includes('비교 우위') && (await bodyText(client)).includes('가격 변화'), "부품 비교 우위의 핵심 근거가 표시되지 않았습니다.");
    assert(await clickText(client, "비교 결과 공유"), "부품 전체 미리 비교 공유 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"미리 비교 공유 링크\"]')?.value?.startsWith(location.origin + '/compare/') === true", "부품 전체 미리 비교 공유 링크");
    const comparisonShareUrl = await client.evaluate("document.querySelector('[aria-label=\"미리 비교 공유 링크\"]')?.value ?? ''");
    const comparisonShareId = new URL(comparisonShareUrl).pathname.split("/").filter(Boolean).at(-1);
    assert(typeof comparisonShareId === "string" && comparisonShareId.length > 0, "부품 전체 미리 비교 공유 ID를 추출하지 못했습니다.");
    const comparisonShares = await client.evaluate("JSON.parse(localStorage.getItem('pc-supporter-alternative-comparison-shares') ?? '[]')");
    const comparisonShareEntry = comparisonShares.find((entry) => entry?.id === comparisonShareId);
    assert(comparisonShareEntry?.name?.includes("부품 전체 미리 비교") === true, "부품 전체 미리 비교의 설명적인 공유 이름이 저장되지 않았습니다.");
    assert(typeof comparisonShareEntry?.ownerToken === "string" && comparisonShareEntry.ownerToken.length >= 40, "후보 비교 공유 owner token이 브라우저 이력에 기록되지 않았습니다.");
    assert(!comparisonShareUrl.includes(comparisonShareEntry.ownerToken), "후보 비교 공유 URL에 owner token이 노출되었습니다.");
    const publicComparison = await client.evaluate(`fetch(${JSON.stringify(`${webUrl}/api/comparisons/${comparisonShareId}`)}).then((response) => response.ok ? response.json() : null)`);
    assert(publicComparison?.name?.includes("부품 전체 미리 비교") === true && publicComparison?.engineVersion === apiHealth?.engineVersion && publicComparison?.currentPartName && publicComparison?.currentPartSummary && publicComparison?.currentPartPrice, `후보 비교 공유 API가 이름·엔진·현재 기준선 메타데이터를 보존하지 않았습니다. expectedEngine=${apiHealth?.engineVersion ?? "unknown"} actualEngine=${publicComparison?.engineVersion ?? "missing"}`);
    assert(!Object.prototype.hasOwnProperty.call(publicComparison, "ownerToken") && !Object.prototype.hasOwnProperty.call(publicComparison, "ownerTokenHash"), "후보 비교 공개 응답에 owner credential이 포함되었습니다.");
    await navigate(secondClient, comparisonShareUrl, "두 번째 탭 후보 비교 공유 route");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-comparison-live-check\"]') !== null && document.querySelector('[data-testid=\"shared-comparison-baseline\"]') !== null && document.querySelector('.shared-comparison-card') !== null", "두 번째 탭 후보 비교 snapshot");
    const sharedComparisonText = await bodyText(secondClient);
    assert(sharedComparisonText.includes("부품 전체 미리 비교") && sharedComparisonText.includes("공유된 미리 적용·구매 판단") && sharedComparisonText.includes("현재 카탈로그 재확인") && sharedComparisonText.includes("부품 적용 후 성능 분석"), "두 번째 탭에서 후보 가상 비교·성능 분석·현재 카탈로그 재확인이 표시되지 않았습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-comparison-tradeoff\"]') !== null && (document.body?.innerText ?? '').includes('공유된 부품 비교 우위')", "공유된 부품 비교 우위");
    assert((await bodyText(secondClient)).includes('공유된 부품 비교 우위') && (await bodyText(secondClient)).includes('비교 우위'), "공유된 부품 비교 우위가 복원되지 않았습니다.");
    assert(!sharedComparisonText.includes(comparisonShareEntry.ownerToken), "읽기 전용 후보 비교 화면에 owner token이 노출되었습니다.");
    await secondClient.send("Network.enable");
    await secondClient.send("Network.setBlockedURLs", { urls: ["*://*/api/comparisons/*"] });
    await navigate(secondClient, comparisonShareUrl, "오류 복구용 후보 비교 공유 route");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-comparison-retry\"]') !== null", "공유 후보 비교 재시도 안내");
    assert((await bodyText(secondClient)).includes("API 서버에 연결할 수 없습니다."), "공유 후보 비교 재시도 안내가 API 연결 오류를 표시하지 않았습니다.");
    await secondClient.send("Network.setBlockedURLs", { urls: [] });
    assert(await clickText(secondClient, "다시 시도"), "공유 후보 비교 다시 시도 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('.shared-comparison-card') !== null", "공유 후보 비교 재시도 복구");
    await navigate(secondClient, `${webUrl}/`, "두 번째 탭 후보 비교 이력 route");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"home-alternative-comparison-shares\"]')?.textContent?.includes('부품 전체 미리 비교') === true && document.querySelector('[data-testid^=\"home-alternative-comparison-baseline-\"]') !== null", "두 번째 탭 후보 비교 공유 이력");
    const alternativeShareHistoryText = await secondClient.evaluate("document.querySelector('[data-testid=\"home-alternative-comparison-shares\"]')?.textContent ?? ''");
    assert(alternativeShareHistoryText.includes(publicComparison.currentPartSummary) && alternativeShareHistoryText.includes(publicComparison.currentPartPrice), "최근 후보 비교 공유 이력에 현재 기준선 사양·가격이 표시되지 않았습니다.");
    await client.evaluate("window.confirm = () => true");
    assert(await clickText(client, "공유 취소"), "부품 전체 미리 비교 공유 취소 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[aria-label=\"미리 비교 공유 링크\"]') === null", "부품 전체 미리 비교 공유 취소 완료");
    const revokedComparisonStatus = await client.evaluate(`fetch(${JSON.stringify(`${webUrl}/api/comparisons/${comparisonShareId}`)}).then((response) => response.status)`);
    assert(revokedComparisonStatus === 404, "후보 비교 공유 취소 후 서버 링크가 계속 열립니다.");
    await navigate(secondClient, comparisonShareUrl, "취소된 후보 비교 공유 route");
    await waitForValue(secondClient, "document.querySelector('[role=\"alert\"]') !== null && (document.body?.innerText ?? '').includes('저장된 부품 비교를 찾을 수 없습니다.')", "취소된 후보 비교 차단 안내");
    await navigate(secondClient, `${webUrl}/history`, "두 번째 탭 후보 견적 동기화 route");
    await openHistoryDetails(secondClient);
    assert(await clickText(client, "새 견적으로 저장"), "후보 구성 새 견적 저장 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('#save-build-dialog-title') !== null", "후보 구성 저장 창");
    assert(await setInputValue(client, "#save-build-name", "브라우저 후보 저장 검증 견적"), "후보 구성 견적 이름을 입력하지 못했습니다.");
    assert(await clickText(client, "저장하고 링크 복사"), "후보 구성 저장 버튼을 찾지 못했습니다.");
    await waitForValue(client, "location.pathname === '/result' && document.querySelector('.result-hero') !== null && (() => { try { return JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]').length >= 2; } catch { return false; } })()", "후보 구성 새 견적 저장 완료");
    const savedIdsAfterCandidate = await client.evaluate("JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]')");
    assert(Array.isArray(savedIdsAfterCandidate) && savedIdsAfterCandidate.length === 2 && savedIdsAfterCandidate[0] !== originalSavedId, "후보 구성이 원본과 분리된 새 저장 견적으로 기록되지 않았습니다.");
    const candidateSavedId = savedIdsAfterCandidate[0];
    const candidateOwnerTokens = await client.evaluate("JSON.parse(localStorage.getItem('pc-supporter-saved-build-owner-tokens') ?? '{}')");
    assert(typeof candidateOwnerTokens?.[candidateSavedId] === "string" && candidateOwnerTokens[candidateSavedId].length >= 40, "후보 구성 새 견적 owner token이 기록되지 않았습니다.");
    await waitForValue(secondClient, "(document.body?.innerText ?? '').includes('브라우저 후보 저장 검증 견적') && (document.body?.innerText ?? '').includes('견적 버전 비교')", "두 번째 탭 후보 견적 동기화");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-comparison-tradeoff\"]') !== null && (document.body?.innerText ?? '').includes('호환·비용·분석·확장성의 비교 우위')", "저장 견적 버전 비교 우위");
    assert((await bodyText(secondClient)).includes('비교 우위') && (await bodyText(secondClient)).includes('확장성'), "저장 견적 버전 비교 우위의 근거가 표시되지 않았습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-comparison-consensus\"]') !== null && ((document.body?.innerText ?? '').includes('기준별 부품') || (document.body?.innerText ?? '').includes('공통 부품'))", "저장 견적 비교 결정 수렴 맥락");
    assert((await bodyText(secondClient)).includes('선택 이유') && (await bodyText(secondClient)).includes('구매 진행'), "저장 견적 비교 결정 요약에 선택 이유·구매 진행 맥락이 표시되지 않았습니다.");
    assert(await clickSelector(secondClient, '[data-testid="saved-build-comparison-result-open-compatibility"]', 1) === 1, "비교 결정 카드의 결과 열기 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "location.pathname === '/result' && (document.body?.innerText ?? '').includes('검사 결과 상세')", "비교 결정 카드 결과 열기");
    await navigate(secondClient, `${webUrl}/history`, "비교 결정 카드 결과 열기 후 이력 복귀");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-comparison-consensus\"]') !== null", "비교 결정 카드 이력 복귀");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-comparison-purchase-open-compatibility\"]') !== null", "비교 결정 카드 구매 목록 버튼 준비");
    assert(await clickSelector(secondClient, '[data-testid="saved-build-comparison-purchase-open-compatibility"]', 1) === 1, "비교 결정 카드의 구매 목록 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "location.pathname === '/result' && location.hash === '#purchase-list' && document.querySelector('[data-testid=\"purchase-list-panel\"]') !== null", "비교 결정 카드 구매 목록 열기");
    await navigate(secondClient, `${webUrl}/history`, "비교 결정 카드 구매 목록 열기 후 이력 복귀");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-comparison-consensus\"]') !== null", "비교 결정 카드 구매 목록 후 이력 복귀");

    await navigate(client, `${webUrl}/share/${encodeURIComponent(originalSavedId)}?finding=blocker#findings`, "원본 공유 견적 필터 route");
    await openResultDetails(client);
    await waitForValue(client, "(document.body?.innerText ?? '').includes('구매 목록') && !(document.body?.innerText ?? '').includes('공유 견적을 열 수 없습니다')", "공유 견적 결과");
    await waitForValue(client, "document.querySelector('[data-testid=\"result-decision-note\"]')?.textContent?.includes('QHD 게이밍과 업그레이드 여유를 우선') === true", "공유 견적 선택 메모");
    await waitForValue(client, "location.search === '?finding=blocker' && location.hash === '#findings' && document.querySelector('.finding-filter-button.selected')?.textContent?.includes('차단 오류') === true", "공유 견적 필터 복원");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-recheck-diff\"]') !== null && (document.body?.innerText ?? '').includes('저장 당시와 현재 재검사 비교')", "공유 견적 재검사 비교 패널");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-recheck-diff\"]')?.textContent?.includes('성능 분석') === true", "공유 견적 성능 분석 diff");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-recheck-diff\"]')?.textContent?.includes('전력·냉각 예산') === true", "공유 견적 전력·냉각 예산 diff");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-recheck-strategies\"]') !== null && (document.body?.innerText ?? '').includes('현재 결과 해결 전략 비교')", "공유 견적 해결 전략 비교");
    assert(await clickText(client, "검사 타임라인 보기"), "공유 견적 재검사 비교의 타임라인 이동 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.activeElement?.getAttribute('data-testid') === 'saved-build-check-timeline'", "공유 견적 타임라인 이동");
    assert(await clickText(client, "플랜 상세 보기"), "공유 견적 해결 전략의 플랜 상세 이동 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.activeElement?.getAttribute('data-testid') === 'repair-plan-panel'", "공유 견적 플랜 상세 이동");
    const sharedText = await bodyText(client);
    assert(sharedText.includes("검사 결과 상세") && sharedText.includes("구매 목록"), "공유 견적에서 검사 결과와 구매 목록을 복원하지 못했습니다.");

    await navigate(client, `${webUrl}/history`, "저장 견적 이력 route");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('저장된 견적') && (document.body?.innerText ?? '').includes('브라우저 지속성 검증 견적') && (document.body?.innerText ?? '').includes('브라우저 후보 저장 검증 견적')", "저장 견적 이력");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-decision-note\"]')?.textContent?.includes('QHD 게이밍과 업그레이드 여유를 우선') === true", "저장 견적 선택 메모 이력");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-monitor-alerts\"]') !== null", "저장 견적 알림함 lazy load");
    assert((await clickSelector(client, `[data-testid="saved-build-edit-metadata-${originalSavedId}"]`, 1)) === 1, "저장 견적 설명 수정 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"edit-saved-build-dialog\"]') !== null", "저장 견적 설명 수정 창");
    assert(await setTextValue(client, "#edit-saved-build-decision-note", "소음과 유지보수 여유를 다시 우선"), "저장 견적 선택 이유 수정 입력을 하지 못했습니다.");
    assert(await clickText(client, "변경사항 저장"), "저장 견적 설명 저장 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"edit-saved-build-dialog\"]') === null && (document.body?.innerText ?? '').includes('소음과 유지보수 여유를 다시 우선')", "저장 견적 설명 수정 완료");
    await navigate(client, `${webUrl}/share/${encodeURIComponent(originalSavedId)}`, "수정된 선택 이유 공유 route");
    await waitForValue(client, "document.querySelector('[data-testid=\"result-decision-note\"]')?.textContent?.includes('소음과 유지보수 여유를 다시 우선') === true", "수정된 선택 이유 공유 결과");
    await navigate(client, `${webUrl}/history`, "수정된 선택 이유 이력 route");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-decision-note\"]')?.textContent?.includes('소음과 유지보수 여유를 다시 우선') === true", "수정된 선택 이유 이력");
    assert((await clickSelector(client, `[data-testid="saved-build-metadata-history-${originalSavedId}"]`, 1)) === 1, "저장 견적 설명 변경 이력 버튼을 찾지 못했습니다.");
    await waitForValue(client, `document.querySelector('[data-testid="saved-build-metadata-history-panel-${originalSavedId}"]')?.textContent?.includes('QHD 게이밍과 업그레이드 여유를 우선') === true && document.querySelector('[data-testid="saved-build-metadata-history-panel-${originalSavedId}"]')?.textContent?.includes('소음과 유지보수 여유를 다시 우선') === true`, "저장 견적 설명 변경 이력");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-version-panel\"]') !== null", "원본·후보 견적 버전 비교");
    const versionDecisionNoteProbe = await client.evaluate("(() => { const panel = document.querySelector('[data-testid=\"saved-build-version-panel\"]'); return { context: Boolean(document.querySelector('[data-testid=\"saved-build-version-decision-note\"]')), summary: Boolean(document.querySelector('[data-testid=\"saved-build-version-summary\"]')), lineage: panel?.querySelectorAll('.saved-build-version-lineage').length ?? 0, delta: panel?.querySelectorAll('.saved-build-version-delta').length ?? 0, rows: panel?.querySelectorAll('.saved-build-version-row').length ?? 0, panelText: panel?.textContent?.slice(0, 2500) ?? '' }; })()");
    const versionChangeRows = await client.evaluate("document.querySelectorAll('[data-testid^=\"saved-build-version-changes-\"]').length");
    assert(versionDecisionNoteProbe.context && versionDecisionNoteProbe.summary && versionDecisionNoteProbe.lineage >= 2 && versionDecisionNoteProbe.delta >= 1 && versionChangeRows >= 1 && versionDecisionNoteProbe.panelText.includes('소음과 유지보수 여유를 다시 우선') && versionDecisionNoteProbe.panelText.includes('선택한 두 버전 적용 요약') && versionDecisionNoteProbe.panelText.includes('라인리지 원본') && versionDecisionNoteProbe.panelText.includes('파생') && versionDecisionNoteProbe.panelText.includes('위험') && versionDecisionNoteProbe.panelText.includes('항목 변화'), "버전별 선택 이유·부모 lineage·선택한 두 버전 적용 요약·실제 변경 부품·항목 변화가 표시되지 않았습니다. probe=" + JSON.stringify({ ...versionDecisionNoteProbe, versionChangeRows }));
    assert(await client.evaluate("document.querySelectorAll('[data-testid^=\"saved-build-version-compare-toggle-\"]').length >= 2"), "버전 비교 선택지가 표시되지 않았습니다.");
    assert((await clickSelector(client, '[data-testid^="saved-build-version-compare-toggle-"]', 1)) === 1, "버전 비교 기준 해제 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-version-summary\"]') === null", "버전 비교 기준 해제");
    assert((await clickSelector(client, '[data-testid^="saved-build-version-compare-toggle-"]', 1)) === 1, "버전 비교 기준 복원 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-version-summary\"]') !== null", "버전 비교 기준 복원");
    await waitForValue(client, "document.querySelector('[data-testid=\"saved-build-current-comparison\"]') !== null", "버전 현재 catalog 비교표");
    await waitForValue(client, "document.querySelectorAll('[data-testid^=\"saved-build-version-current-check-\"]').length >= 2 && [...document.querySelectorAll('[data-testid^=\"saved-build-version-current-check-\"]')].every((node) => (node.textContent ?? '').includes('현재'))", "버전 행 현재 catalog 상태");
    assert(await client.evaluate("[...document.querySelectorAll('[data-testid^=\"saved-build-version-current-check-\"]')].every((node) => /현재 (catalog|기준)/.test(node.textContent ?? ''))"), "버전 행에 현재 catalog 상태가 표시되지 않았습니다.");
    assert((await clickSelector(client, `[data-testid^="saved-build-purchase-list-"]`, 1)) === 1, "저장 견적 이력의 구매 목록 열기 버튼을 찾지 못했습니다.");
    await waitForValue(client, "location.pathname === '/result' && location.hash === '#purchase-list'", "저장 견적 구매 목록 route");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-panel\"]') !== null", "저장 견적 구매 목록");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-action-center\"]') !== null", "저장 견적 구매 다음 행동 센터");
    const firstPurchaseAction = await client.evaluate("(() => { const node = document.querySelector('.purchase-list-action-center-item'); return node?.getAttribute('data-testid')?.replace('purchase-list-action-', '') ?? null; })()");
    assert(typeof firstPurchaseAction === "string" && firstPurchaseAction.length > 0, "구매 다음 행동 센터의 액션 버튼을 찾지 못했습니다.");
    assert((await clickSelector(client, `[data-testid="purchase-list-action-${firstPurchaseAction}"]`, 1)) === 1, "구매 다음 행동 센터 액션을 클릭하지 못했습니다.");
    const expectedPurchaseActionFilter = firstPurchaseAction === "data-review" ? "purchase-list-filter-data_review" : firstPurchaseAction === "price-review" ? "purchase-list-filter-needs_review" : `purchase-list-status-filter-${firstPurchaseAction === "order" ? "planned" : firstPurchaseAction === "receive" ? "ordered" : "received"}`;
    await waitForValue(client, `document.querySelector('[data-testid="${expectedPurchaseActionFilter}"]')?.classList.contains('selected') === true`, "구매 다음 행동 필터 이동");
    if (firstPurchaseAction === "data-review" || firstPurchaseAction === "price-review") assert((await clickSelector(client, '[data-testid="purchase-list-filter-all"]', 1)) === 1, "구매 다음 행동 가격 필터 초기화를 클릭하지 못했습니다.");
    else assert((await clickSelector(client, '[data-testid="purchase-list-status-filter-all"]', 1)) === 1, "구매 다음 행동 단계 필터 초기화를 클릭하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-server-sync\"]') !== null && [...document.querySelectorAll('[data-testid=\"purchase-list-server-sync\"] button')].some((button) => !button.disabled && (button.textContent ?? '').includes('현재 상태 서버 저장'))", "이력에서 연 저장 견적의 구매 진행률 서버 저장 버튼");
    await navigate(secondClient, `${webUrl}/share/${encodeURIComponent(candidateSavedId)}`, "두 번째 탭 구매 목록 route");
    await openResultDetails(secondClient);
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"purchase-list-panel\"]') !== null && (document.body?.innerText ?? '').includes('아직 서버에 저장하지 않음')", "두 번째 탭의 오래된 구매 진행률");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-status-board\"]') !== null && document.querySelectorAll('.purchase-list-status-select').length > 0", "구매 단계 보드");
    const stagedStatusChanged = await client.evaluate("(() => { const select = document.querySelector('.purchase-list-status-select'); if (!(select instanceof HTMLSelectElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, 'ordered'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === 'ordered'; })()");
    assert(stagedStatusChanged, "첫 구매 항목의 주문 완료 단계를 선택하지 못했습니다.");
    await waitForValue(client, "document.querySelector('.purchase-list-status-select')?.value === 'ordered' && (document.body?.innerText ?? '').includes('주문 완료')", "주문 완료 단계 반영");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-decision-gate\"]')?.textContent?.includes('주문 1') === true", "최종 구매 판단 주문 단계 동기화");
    await waitForValue(client, "Object.keys(localStorage).filter((key) => key.includes(':item-statuses')).some((key) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null')?.items?.some((item) => item.status === 'ordered') === true; } catch { return false; } })", "주문 완료 단계 로컬 저장");
    assert((await clickSelector(client, '[data-testid="purchase-list-panel"] .purchase-list-row-check input', 1)) === 1, "구매 목록 첫 항목 체크박스를 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('1 /') && (document.body?.innerText ?? '').includes('구매 완료')", "구매 진행률 1개");
    await waitForValue(client, "Object.keys(localStorage).filter((key) => key.includes(':item-statuses')).some((key) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null')?.items?.some((item) => item.status === 'received') === true; } catch { return false; } })", "수령 완료 단계 로컬 저장");
    await waitForValue(client, "document.querySelector('.purchase-list-status-select')?.value === 'received'", "수령 완료 단계 화면 반영");
    const purchaseProgressRequestProbe = await client.evaluate("(async () => { const originalFetch = window.fetch; let captured; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; if (url.includes('/purchase-progress') && init?.method === 'PUT') captured = typeof init.body === 'string' ? JSON.parse(init.body) : undefined; return originalFetch(input, init); }; try { const button = [...document.querySelectorAll('button')].find((candidate) => !candidate.disabled && (candidate.textContent ?? '').includes('현재 상태 서버 저장')); if (!(button instanceof HTMLButtonElement)) return { stage: 'no-button' }; button.click(); for (let index = 0; index < 100 && !captured; index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); const localStatuses = Object.entries(localStorage).filter(([key]) => key.includes(':item-statuses')).map(([key, value]) => ({ key, value })); return { stage: captured ? 'captured' : 'timeout', progress: captured?.progress, localStatuses, selectors: [...document.querySelectorAll('.purchase-list-status-select')].slice(0, 3).map((select) => select.value), gate: document.querySelector('[data-testid=\"purchase-decision-gate\"]')?.textContent ?? '' }; } finally { window.fetch = originalFetch; } })()");
    assert(purchaseProgressRequestProbe.stage === 'captured' && Array.isArray(purchaseProgressRequestProbe.progress?.itemStates) && purchaseProgressRequestProbe.progress.itemStates.some((item) => item.status === 'received'), "브라우저 구매 진행률 request body에 단계별 itemStates가 없습니다. probe=" + JSON.stringify(purchaseProgressRequestProbe));
    await waitForValue(client, "(document.body?.innerText ?? '').includes('현재 구매 완료 상태 1개를 저장 견적 서버에 저장했습니다')", "구매 진행률 서버 저장 완료");
    const savedProgressPayload = await fetch(`${apiUrl}/api/builds/${encodeURIComponent(candidateSavedId)}`).then((response) => response.json());
    assert(Array.isArray(savedProgressPayload?.purchaseProgress?.itemStates) && savedProgressPayload.purchaseProgress.itemStates.some((item) => item.status === 'received'), "서버 구매 진행률에 단계별 itemStates가 저장되지 않았습니다. payload=" + JSON.stringify({ savedId: candidateSavedId, purchaseProgress: savedProgressPayload?.purchaseProgress }));
    await waitForValue(secondClient, "[...document.querySelectorAll('button')].some((button) => !button.disabled && (button.textContent ?? '').includes('현재 상태 서버 저장'))", "두 번째 탭의 오래된 구매 진행률 저장 버튼");
    assert(await clickText(secondClient, "현재 상태 서버 저장"), "두 번째 탭 구매 진행률 서버 저장 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "(document.body?.innerText ?? '').includes('서버 구매 진행률이 먼저 변경되어 저장을 막았습니다')", "구매 진행률 revision 충돌 안내");

    await client.evaluate("Object.keys(localStorage).filter((key) => key.startsWith('pc-supporter-purchase-list:')).forEach((key) => localStorage.removeItem(key))");
    await navigate(client, `${webUrl}/share/${encodeURIComponent(candidateSavedId)}`, "서버 진행률 재조회 route");
    await openResultDetails(client);
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-panel\"]') !== null", "서버 진행률 구매 목록");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('서버 저장 1 /')", "서버 저장 진행률 표시");
    assert(await clickText(client, "서버 상태 불러오기"), "서버 상태 불러오기 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('저장 견적 서버에서 1개 구매 완료 상태를 불러왔습니다')", "서버 진행률 로컬 복원");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('1 /') && (document.body?.innerText ?? '').includes('구매 완료')", "서버 진행률 복원 완료");

    assert((await clickSelector(client, '[data-testid="purchase-list-live-price-refresh"]', 1)) === 1, "현재 가격 확인 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-live-price-status\"]') !== null", "현재 가격 확인 결과");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-live-price-decision\"]') !== null && (document.body?.innerText ?? '').includes('개 가격 확인')", "현재 가격 판단 요약");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-data-freshness\"]') !== null && document.querySelector('[data-testid=\"purchase-list-data-review-action\"]') !== null", "구매 목록 데이터 신선도 요약");
    const dataReviewFilterEnabled = await client.evaluate("(() => { const button = document.querySelector('[data-testid=\"purchase-list-data-review-action\"]'); return button instanceof HTMLButtonElement && !button.disabled; })()");
    if (dataReviewFilterEnabled) {
      assert((await clickSelector(client, '[data-testid="purchase-list-data-review-action"]', 1)) === 1, "구매 목록 데이터 확인 필요 필터를 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-data-review-action\"]')?.getAttribute('aria-pressed') === 'true'", "구매 목록 데이터 확인 필요 필터 선택");
      assert((await clickSelector(client, '[data-testid="purchase-list-filter-all"]', 1)) === 1, "구매 목록 데이터 필터 전체 복원 버튼을 찾지 못했습니다.");
      await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-filter-all\"]')?.getAttribute('aria-pressed') === 'true'", "구매 목록 데이터 필터 전체 복원");
    }
    const allPurchaseRowCount = await client.evaluate("document.querySelectorAll('[data-testid=\"purchase-list-row\"]').length");
    assert(allPurchaseRowCount >= 2, "구매 목록 표시 필터 검증에 필요한 행을 찾지 못했습니다.");
    assert((await clickSelector(client, '[data-testid="purchase-list-filter-remaining"]', 1)) === 1, "구매 예정 필터를 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-filter-remaining\"]')?.getAttribute('aria-pressed') === 'true'", "구매 예정 필터 선택");
    const remainingPurchaseRowCount = await client.evaluate("document.querySelectorAll('[data-testid=\"purchase-list-row\"]').length");
    assert(remainingPurchaseRowCount < allPurchaseRowCount, "구매 예정 필터가 완료 항목을 제외하지 못했습니다.");
    assert((await clickSelector(client, '[data-testid="purchase-list-visible-copy"]', 1)) === 1, "표시 목록 복사 버튼을 찾지 못했습니다.");
    assert((await clickSelector(client, '[data-testid="purchase-list-visible-csv"]', 1)) === 1, "표시 목록 CSV 버튼을 찾지 못했습니다.");
    assert((await clickSelector(client, '[data-testid="purchase-list-filter-all"]', 1)) === 1, "구매 목록 전체 필터를 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-filter-all\"]')?.getAttribute('aria-pressed') === 'true' && document.querySelectorAll('[data-testid=\"purchase-list-row\"]').length === " + allPurchaseRowCount, "구매 목록 전체 필터 복원");
    const searchablePurchaseRowName = await client.evaluate("document.querySelector('[data-testid=\"purchase-list-row\"] strong')?.textContent?.trim() ?? ''");
    assert(typeof searchablePurchaseRowName === "string" && searchablePurchaseRowName.length > 0, "구매 목록 검색 검증에 필요한 부품명을 찾지 못했습니다.");
    assert(await setInputValue(client, '[data-testid="purchase-list-search"] input', searchablePurchaseRowName), "구매 목록 검색어를 입력하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-search\"] input')?.value === " + JSON.stringify(searchablePurchaseRowName) + " && document.querySelectorAll('[data-testid=\"purchase-list-row\"]').length >= 1 && document.querySelectorAll('[data-testid=\"purchase-list-row\"]').length < " + allPurchaseRowCount, "구매 목록 이름 검색");
    assert(await setInputValue(client, '[data-testid="purchase-list-search"] input', ""), "구매 목록 검색어를 초기화하지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-search\"] input')?.value === '' && document.querySelectorAll('[data-testid=\"purchase-list-row\"]').length === " + allPurchaseRowCount, "구매 목록 검색 초기화");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-price-history-server-save\"]')?.disabled === false", "가격 이력 서버 저장 버튼");
    assert((await clickSelector(client, '[data-testid="purchase-list-price-history-server-save"]', 1)) === 1, "가격 이력 서버 저장 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('가격 확인 이력을 저장 견적 서버에 저장했습니다. revision 1')", "가격 이력 서버 저장 완료");
    assert((await clickSelector(secondClient, '[data-testid="purchase-list-live-price-refresh"]', 1)) === 1, "두 번째 탭 현재 가격 확인 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"purchase-list-live-price-status\"]') !== null", "두 번째 탭 현재 가격 확인 결과");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"purchase-list-price-history-server-save\"]')?.disabled === false", "두 번째 탭 가격 이력 저장 버튼");
    assert((await clickSelector(secondClient, '[data-testid="purchase-list-price-history-server-save"]', 1)) === 1, "두 번째 탭 가격 이력 서버 저장 버튼을 찾지 못했습니다.");
    await waitForValue(secondClient, "(document.body?.innerText ?? '').includes('서버 가격 확인 이력이 먼저 변경되어 저장을 막았습니다')", "가격 이력 revision 충돌 안내");
    assert(await clickText(client, "확인 기록 초기화"), "브라우저 가격 확인 기록 초기화 버튼을 찾지 못했습니다.");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-price-history-server-load\"]')?.disabled === false", "가격 이력 서버 불러오기 버튼");
    assert((await clickSelector(client, '[data-testid="purchase-list-price-history-server-load"]', 1)) === 1, "가격 이력 서버 불러오기 버튼을 찾지 못했습니다.");
    await waitForValue(client, "(document.body?.innerText ?? '').includes('저장 견적 서버에서 가격 확인 이력 revision 1 상태를 불러왔습니다')", "가격 이력 서버 복원");
    await waitForValue(client, "document.querySelector('[data-testid=\"purchase-list-price-history-overview\"]') !== null", "가격 이력 복원 요약");

    await client.evaluate(`(() => { const key = 'pc-supporter-saved-build-owner-tokens'; const tokens = JSON.parse(localStorage.getItem(key) ?? '{}'); delete tokens[${JSON.stringify(originalSavedId)}]; localStorage.setItem(key, JSON.stringify(tokens)); return true; })()`);
    await navigate(client, `${webUrl}/share/${encodeURIComponent(originalSavedId)}`, "공유 견적 외부 사용자 복제 route");
    await waitForValue(client, "document.querySelector('[data-testid=\"shared-build-clone\"]') !== null", "공유 견적 내 견적으로 복제 액션");
    assert(await clickSelector(client, '[data-testid="shared-build-clone"]', 1) === 1, "공유 견적 내 견적으로 복제 버튼을 클릭하지 못했습니다.");
    await waitForValue(client, "location.pathname === '/build' && document.querySelector('.workspace-page') !== null && document.querySelector('.result-hero') === null", "공유 견적 새 초안 복제");
    const cloneProbe = await client.evaluate("({ draft: Boolean(localStorage.getItem('pc-supporter-draft')), savedIds: JSON.parse(localStorage.getItem('pc-supporter-saved-build-ids') ?? '[]'), cloneButton: Boolean(document.querySelector('[data-testid=\"shared-build-clone\"]')), result: Boolean(document.querySelector('.result-hero')) })");
    assert(cloneProbe.draft && cloneProbe.savedIds.includes(originalSavedId) && !cloneProbe.cloneButton && !cloneProbe.result, "공유 견적 복제가 원본 기록과 결과 상태를 분리하지 못했습니다. probe=" + JSON.stringify(cloneProbe));
    await client.evaluate(`(() => { const key = 'pc-supporter-saved-build-owner-tokens'; const tokens = JSON.parse(localStorage.getItem(key) ?? '{}'); tokens[${JSON.stringify(originalSavedId)}] = ${JSON.stringify(ownerTokens[originalSavedId])}; localStorage.setItem(key, JSON.stringify(tokens)); return true; })()`);

    const candidateSavedResponse = await fetch(`${apiUrl}/api/builds/${encodeURIComponent(candidateSavedId)}`);
    const candidateSavedPayload = await candidateSavedResponse.json();
    assert(candidateSavedResponse.ok && candidateSavedPayload?.selection && typeof candidateSavedPayload.selection === "object", "세 번째 version 생성용 후보 견적을 다시 읽지 못했습니다. payload=" + JSON.stringify({ status: candidateSavedResponse.status, body: candidateSavedPayload }));
    const thirdSelection = structuredClone(candidateSavedPayload.selection);
    if (Array.isArray(thirdSelection.memory) && thirdSelection.memory.length > 0) thirdSelection.memory[0].quantity = Number(thirdSelection.memory[0].quantity ?? 1) + 1;
    else thirdSelection.useIntegratedGraphics = !Boolean(thirdSelection.useIntegratedGraphics);
    const thirdBuildResponse = await fetch(`${apiUrl}/api/builds`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": candidateOwnerTokens[candidateSavedId] }, body: JSON.stringify({ name: "브라우저 후보 세 번째 버전", selection: thirdSelection, recommendationPreferences: candidateSavedPayload.recommendationPreferences, decisionNote: "세 번째 version pair 선택 검증", parentBuildId: candidateSavedId }) });
    const thirdBuild = await thirdBuildResponse.json();
    assert(thirdBuildResponse.ok && thirdBuild?.derivedFromBuildId === candidateSavedId && thirdBuild?.versionNumber === 3, "세 번째 파생 version을 만들지 못했습니다. payload=" + JSON.stringify(thirdBuild));
    // Seed the tab that will reload as well; this setup must not depend on storage-event delivery timing.
    const versionPairStorageScript = `(() => { const ids = [${JSON.stringify(thirdBuild.id)}, ${JSON.stringify(candidateSavedId)}, ${JSON.stringify(originalSavedId)}]; localStorage.setItem('pc-supporter-saved-build-ids', JSON.stringify(ids)); const tokens = JSON.parse(localStorage.getItem('pc-supporter-saved-build-owner-tokens') ?? '{}'); tokens[${JSON.stringify(thirdBuild.id)}] = ${JSON.stringify(thirdBuild.ownerToken)}; localStorage.setItem('pc-supporter-saved-build-owner-tokens', JSON.stringify(tokens)); return true; })()`;
    await client.evaluate(versionPairStorageScript);
    await secondClient.evaluate(versionPairStorageScript);
    await navigate(secondClient, `${webUrl}/history?version-pair-smoke=1`, "세 번째 파생 version 이력 route");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-version-panel\"]') !== null && document.querySelectorAll('[data-testid^=\"saved-build-version-compare-toggle-\"]').length >= 3", "세 버전 비교 선택지");
    await secondClient.evaluate(`(() => {
      const originalFetch = window.fetch;
      const changed = { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 0, findings: [], metrics: {}, analysis: { profile: "gaming", scoreLabel: "균형형", scoreBasis: "current-version-save-probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 9999999, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: "2026-09-17T00:00:00.000Z", checkedAt: "2026-09-17T00:00:00.000Z" };
      window.__pcSupporterVersionProbeOriginalFetch = originalFetch;
      window.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (requestUrl.pathname === "/api/compatibility/check" && method === "POST") return new Response(JSON.stringify(changed), { status: 200, headers: { "Content-Type": "application/json" } });
        return originalFetch(input, init);
      };
      return true;
    })()`);
    assert((await clickSelector(secondClient, `[data-testid="saved-build-version-compare-toggle-${candidateSavedId}"]`, 1)) === 1, "v2 비교 기준을 해제하지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-version-summary\"]') === null", "세 버전 비교 기준 해제");
    assert((await clickSelector(secondClient, `[data-testid="saved-build-version-compare-toggle-${originalSavedId}"]`, 1)) === 1, "v1 비교 기준을 선택하지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-version-summary\"]')?.textContent?.includes('v1 → v3') === true", "v1·v3 임의 version pair 비교");
    const currentVersionSaveProbe = await secondClient.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalClipboard = navigator.clipboard;
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
      const changed = {
        status: "needs_review",
        blockerCount: 0,
        warningCount: 1,
        unknownCount: 0,
        findings: [],
        metrics: {},
        analysis: { profile: "gaming", scoreLabel: "균형형", scoreBasis: "current-version-save-probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] },
        links: [],
        totalPriceWon: 9999999,
        priceComplete: true,
        engineVersion: "2.58.0",
        catalogSnapshotAt: "2026-09-17T00:00:00.000Z",
        checkedAt: "2026-09-17T00:00:00.000Z"
      };
      let captured;
      const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      try {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } });
        window.fetch = async (input, init) => {
          const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
          const method = String(init?.method ?? "GET").toUpperCase();
          if (requestUrl.pathname === "/api/compatibility/check" && method === "POST") return response(changed);
          if (requestUrl.pathname === "/api/builds" && method === "POST") {
            const result = await originalFetch(input, init);
            let payload;
            try { payload = await result.clone().json(); } catch {}
            captured = { status: result.status, payload };
            return result;
          }
          return originalFetch(input, init);
        };
        let recheck;
        for (let index = 0; index < 160; index += 1) {
          const candidate = [...document.querySelectorAll("button")].find((button) => !button.disabled && (button.textContent ?? "").includes("현재 기준 다시 검사"));
          if (candidate instanceof HTMLButtonElement) {
            recheck = candidate;
            break;
          }
          await pause(50);
        }
        if (!(recheck instanceof HTMLButtonElement)) return { stage: "missing-recheck", comparison: document.querySelector('[data-testid="saved-build-current-comparison"]')?.textContent?.slice(0, 800) ?? "" };
        recheck.click();
        for (let index = 0; index < 160 && !document.querySelector('[data-testid="saved-build-version-current-change-save"]'); index += 1) await pause(50);
        const saveVersion = document.querySelector('[data-testid="saved-build-version-current-change-save"]');
        if (!(saveVersion instanceof HTMLButtonElement)) return { stage: "missing-current-version-save", body: (document.body?.innerText ?? "").slice(-1400) };
        saveVersion.click();
        for (let index = 0; index < 100 && !document.querySelector("#save-build-name"); index += 1) await pause(50);
        const nameInput = document.querySelector("#save-build-name");
        if (!(nameInput instanceof HTMLInputElement)) return { stage: "missing-save-dialog" };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(nameInput, "브라우저 현재 기준 새 버전");
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
        const submit = document.querySelector('.save-build-actions button[type="submit"]');
        if (!(submit instanceof HTMLButtonElement)) return { stage: "missing-save-submit" };
        submit.click();
        for (let index = 0; index < 240 && (!captured || location.pathname !== "/result"); index += 1) await pause(50);
        let savedIds = [];
        try { savedIds = JSON.parse(localStorage.getItem("pc-supporter-saved-build-ids") ?? "[]"); } catch {}
        return {
          stage: captured && location.pathname === "/result" ? "saved" : "save-incomplete",
          status: captured?.status,
          path: location.pathname,
          savedIds,
          newId: captured?.payload?.id,
          parentId: captured?.payload?.derivedFromBuildId,
          versionNumber: captured?.payload?.versionNumber,
          name: captured?.payload?.name
        };
      } finally {
        window.fetch = originalFetch;
        try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard }); } catch {}
      }
    })()`);
    assert(currentVersionSaveProbe.stage === "saved" && currentVersionSaveProbe.status === 201 && currentVersionSaveProbe.versionNumber === 4 && currentVersionSaveProbe.savedIds.length >= 4 && currentVersionSaveProbe.name === "브라우저 현재 기준 새 버전", "현재 기준 새 버전 저장이 새 lineage로 끝나지 않았습니다. probe=" + JSON.stringify(currentVersionSaveProbe));
    const currentVersionSavedId = currentVersionSaveProbe.newId;
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"result-version-context\"]')?.textContent?.includes('v4') === true", "저장 직후 결과 버전 context");
    const resultVersionContextProbe = await secondClient.evaluate("document.querySelector('[data-testid=\"result-version-context\"]')?.textContent ?? ''");
    assert(resultVersionContextProbe.includes("에서 파생") && resultVersionContextProbe.includes("버전 비교 열기"), "저장 직후 결과 화면에 새 version lineage context가 표시되지 않았습니다. probe=" + JSON.stringify(resultVersionContextProbe));
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"result-version-delta\"]')?.textContent?.includes('구성') === true", "저장 직후 결과 부모 버전 대비 요약");
    const resultVersionDeltaProbe = await secondClient.evaluate("document.querySelector('[data-testid=\"result-version-delta\"]')?.textContent ?? ''");
    assert(resultVersionDeltaProbe.includes("위험") && (resultVersionDeltaProbe.includes("금액") || resultVersionDeltaProbe.includes("금액 확인 필요")) && resultVersionDeltaProbe.includes("분석"), "저장 직후 결과 화면에 부모 버전 대비 요약이 표시되지 않았습니다. probe=" + JSON.stringify(resultVersionDeltaProbe));
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"result-version-change-details\"]')?.textContent?.includes('변경된 구성') === true", "저장 직후 결과 실제 변경 항목");
    const resultVersionChangeDetailsProbe = await secondClient.evaluate("document.querySelector('[data-testid=\"result-version-change-details\"]')?.textContent ?? ''");
    assert(resultVersionChangeDetailsProbe.includes("변경된 호환성 결과") && (resultVersionChangeDetailsProbe.includes("RAM") || resultVersionChangeDetailsProbe.includes("파워") || resultVersionChangeDetailsProbe.includes("구성 변화 없음")), "저장 직후 결과 화면에 실제 변경 부품·finding 또는 변화 없음 상태가 표시되지 않았습니다. probe=" + JSON.stringify(resultVersionChangeDetailsProbe));
    assert((await clickSelector(secondClient, '[data-testid="result-version-context-open-history"]', 1)) === 1, "저장 직후 결과의 버전 비교 열기 버튼을 클릭하지 못했습니다.");
    await waitForValue(secondClient, "location.pathname === '/history'", "현재 기준 새 버전 저장 후 이력 재진입");
    await waitForValue(secondClient, `document.querySelector('[data-testid="saved-build-version-toggle-${currentVersionSavedId}"]') !== null || document.querySelector('[data-testid="saved-build-version-compare-toggle-${currentVersionSavedId}"]') !== null`, "현재 기준 새 버전 lineage 재표시");
    await waitForValue(secondClient, `document.querySelector('[data-testid="saved-build-priority-row-${currentVersionSavedId}"]') !== null`, "현재 기준 새 버전 우선순위 보드 재표시");
    const currentVersionHistoryProbe = await secondClient.evaluate(`(() => ({ versionToggle: Boolean(document.querySelector('[data-testid="saved-build-version-compare-toggle-${currentVersionSavedId}"]')), priorityRow: Boolean(document.querySelector('[data-testid="saved-build-priority-row-${currentVersionSavedId}"]')), lineage: document.querySelector('[data-testid="saved-build-version-lineage-${currentVersionSavedId}"]')?.textContent ?? "", versionPanelText: document.querySelector('[data-testid="saved-build-version-panel"]')?.textContent?.slice(-1200) ?? "" }))()`);
    assert(currentVersionHistoryProbe.versionToggle && currentVersionHistoryProbe.priorityRow && currentVersionHistoryProbe.lineage.includes("파생"), "현재 기준 새 버전 저장 후 히스토리 lineage·우선순위 보드가 갱신되지 않았습니다. probe=" + JSON.stringify(currentVersionHistoryProbe));
    assert((await clickSelector(secondClient, `[data-testid="saved-build-version-compare-toggle-${currentVersionSavedId}"]`, 1)) === 1, "현재 기준 새 버전 비교 기준을 해제하지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-version-summary\"]') === null", "현재 기준 새 버전 비교 기준 해제");
    assert((await clickSelector(secondClient, `[data-testid="saved-build-version-compare-toggle-${originalSavedId}"]`, 1)) === 1, "v1 비교 기준을 저장 후 다시 선택하지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"saved-build-version-summary\"]')?.textContent?.includes('v1 → v3') === true", "저장 후 v1·v3 비교 기준 복원");
    const versionExportProbe = await secondClient.evaluate("(async () => { let copied = ''; let downloaded = ''; const originalClipboard = navigator.clipboard; const originalCreateObjectURL = window.URL.createObjectURL; const originalRevokeObjectURL = window.URL.revokeObjectURL; const originalAnchorClick = HTMLAnchorElement.prototype.click; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { copied = value; } } }); window.URL.createObjectURL = (blob) => { void blob.text().then((value) => { downloaded = value; }); return 'blob:version-export-smoke'; }; window.URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = function () {}; document.querySelector('[data-testid=\"saved-build-version-copy\"]')?.click(); for (let index = 0; index < 20 && !copied; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); document.querySelector('[data-testid=\"saved-build-version-download-json\"]')?.click(); for (let index = 0; index < 20 && !downloaded; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); return { copied, downloaded, status: document.querySelector('[data-testid=\"saved-build-version-export-status\"]')?.textContent ?? '' }; } finally { try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard }); } catch {} window.URL.createObjectURL = originalCreateObjectURL; window.URL.revokeObjectURL = originalRevokeObjectURL; HTMLAnchorElement.prototype.click = originalAnchorClick; } })()");
    assert(versionExportProbe.copied.includes("PC Supporter 저장 견적 버전 비교") && versionExportProbe.copied.includes("v1") && versionExportProbe.copied.includes("확인 범위"), "저장 견적 버전 비교 복사 payload가 완성되지 않았습니다. probe=" + JSON.stringify({ ...versionExportProbe, copied: versionExportProbe.copied.slice(0, 500) }));
    assert(versionExportProbe.downloaded.includes('"kind": "pc-supporter.saved-build-version-comparison"') && versionExportProbe.downloaded.includes('"schemaVersion": 1'), "저장 견적 버전 비교 JSON payload가 생성되지 않았습니다. probe=" + JSON.stringify({ ...versionExportProbe, downloaded: versionExportProbe.downloaded.slice(0, 500) }));
    const versionShareProbe = await secondClient.evaluate("(async () => { let captured; const originalFetch = window.fetch; const originalClipboard = navigator.clipboard; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; if (url === '/api/version-comparisons' && init?.method === 'POST') { const request = typeof init.body === 'string' ? JSON.parse(init.body) : undefined; const response = await originalFetch(input, init); let payload; try { payload = await response.clone().json(); } catch {} captured = { request, response: payload, status: response.status }; return response; } return originalFetch(input, init); }; document.querySelector('[data-testid=\"saved-build-version-share\"]')?.click(); for (let index = 0; index < 80 && (!captured || !(() => { try { return JSON.parse(localStorage.getItem('pc-supporter-saved-build-version-shares') ?? '[]').some((entry) => entry?.id === captured.response?.id); } catch { return false; } })()); index += 1) await new Promise((resolve) => setTimeout(resolve, 50)); return captured; } finally { window.fetch = originalFetch; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard }); } catch {} } })()");
    assert(versionShareProbe?.status === 201 && versionShareProbe.request?.beforeBuildId && versionShareProbe.request?.afterBuildId && versionShareProbe.response?.payload?.kind === 'pc-supporter.saved-build-version-comparison-share', "저장 견적 버전 비교 공유 요청이 서버 snapshot을 만들지 못했습니다. probe=" + JSON.stringify(versionShareProbe));
    await waitForValue(secondClient, `(() => { try { return JSON.parse(localStorage.getItem('pc-supporter-saved-build-version-shares') ?? '[]').some((entry) => entry?.id === ${JSON.stringify(versionShareProbe.response.id)}); } catch { return false; } })()`, "저장 견적 버전 비교 공유 이력 저장");
    const versionShareUrl = `${webUrl}/version-comparison/${encodeURIComponent(versionShareProbe.response.id)}`;
    await navigate(secondClient, `${webUrl}/`, "견적 버전 비교 공유 이력 홈 route");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"home-saved-build-version-shares\"]')?.textContent?.includes('최근 견적 버전 비교 공유') === true && document.querySelector('[data-testid^=\"home-saved-build-version-catalog-\"]') !== null", "최근 견적 버전 비교 공유 이력");
    const versionShareHistoryText = await secondClient.evaluate("document.querySelector('[data-testid=\"home-saved-build-version-shares\"]')?.textContent ?? ''");
    assert(versionShareHistoryText.includes(versionShareProbe.response.name) && versionShareHistoryText.includes('사용 가능') && (versionShareHistoryText.includes('저장한 검사 기준') || versionShareHistoryText.includes('저장 검사 기준')) && (versionShareHistoryText.includes('검사 버전') || versionShareHistoryText.includes('engine')), "홈의 최근 견적 버전 비교 공유 이력이 생성된 링크 상태·catalog 기준을 표시하지 않았습니다.");
    assert(await secondClient.evaluate("document.querySelectorAll('[data-testid^=\"home-saved-build-version-filter-\"]').length === 4"), "홈의 견적 버전 비교 공유 상태 필터 4종이 모두 표시되지 않았습니다.");
    assert((await clickSelector(secondClient, '[data-testid="home-saved-build-version-filter-active"]', 1)) === 1, "견적 버전 비교 공유 사용 가능 필터를 선택하지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"home-saved-build-version-filter-active\"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-testid=\"home-saved-build-version-shares\"]')?.textContent?.includes('사용 가능') === true", "견적 버전 비교 공유 사용 가능 필터");
    assert((await clickSelector(secondClient, '[data-testid="home-saved-build-version-filter-all"]', 1)) === 1, "견적 버전 비교 공유 전체 필터를 복원하지 못했습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"home-saved-build-version-filter-all\"]')?.getAttribute('aria-pressed') === 'true'", "견적 버전 비교 공유 전체 필터 복원");
    await navigate(secondClient, versionShareUrl, "저장 견적 버전 비교 공유 route");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-version-comparison-card\"]') !== null && (document.body?.innerText ?? '').includes('공유된 견적 버전 비교')", "공유된 견적 버전 비교 화면");
    const publicVersionShareText = await bodyText(secondClient);
    assert(publicVersionShareText.includes('원본·수정 버전') || publicVersionShareText.includes('브라우저 후보 세 번째 버전'), "공유 버전 비교 화면에 버전 이름이 표시되지 않았습니다.");
    assert(await secondClient.evaluate("document.querySelectorAll('a[data-testid^=\"shared-version-comparison-current-\"]').length === 2 && (document.body?.innerText ?? '').includes('현재 기준 결과 열기')"), "공유 버전 비교 화면에 두 버전의 현재 기준 재검사 deep-link가 없습니다.");
    await waitForValue(secondClient, "document.querySelector('[data-testid=\"shared-version-current-check-grid\"]') !== null && document.querySelector('[data-testid=\"shared-version-comparison-current-download\"]') !== null && document.querySelector('[data-testid=\"shared-version-comparison-current-copy\"]') !== null", "공유 버전 현재 기준 재검사 결과");
    const currentRecheckExportProbe = await secondClient.evaluate("(async () => { let copied = ''; let downloaded = ''; const originalClipboard = navigator.clipboard; const originalCreateObjectURL = window.URL.createObjectURL; const originalRevokeObjectURL = window.URL.revokeObjectURL; const originalAnchorClick = HTMLAnchorElement.prototype.click; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { copied = value; } } }); window.URL.createObjectURL = (blob) => { void blob.text().then((value) => { downloaded = value; }); return 'blob:current-recheck-smoke'; }; window.URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = function () {}; document.querySelector('[data-testid=\"shared-version-comparison-current-copy\"]')?.click(); for (let index = 0; index < 20 && !copied; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); document.querySelector('[data-testid=\"shared-version-comparison-current-download\"]')?.click(); for (let index = 0; index < 20 && !downloaded; index += 1) await new Promise((resolve) => setTimeout(resolve, 25)); return { copied, downloaded }; } finally { try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard }); } catch {} window.URL.createObjectURL = originalCreateObjectURL; window.URL.revokeObjectURL = originalRevokeObjectURL; HTMLAnchorElement.prototype.click = originalAnchorClick; } })()");
    assert(currentRecheckExportProbe.copied.includes("PC Supporter 현재 기준 버전 재검사") && currentRecheckExportProbe.copied.includes("finding:"), "현재 재검사 텍스트 복사 payload가 완성되지 않았습니다. probe=" + JSON.stringify({ copied: currentRecheckExportProbe.copied.slice(0, 700) }));
    assert(currentRecheckExportProbe.downloaded.includes('"kind": "pc-supporter.saved-build-version-current-recheck"') && currentRecheckExportProbe.downloaded.includes('"schemaVersion": 1'), "현재 재검사 JSON payload가 생성되지 않았습니다. probe=" + JSON.stringify({ downloaded: currentRecheckExportProbe.downloaded.slice(0, 700) }));
    const accessoryActionProbe = await secondClient.evaluate(`(async () => {
      const originalFetch = window.fetch;
      const beforeId = ${JSON.stringify(currentVersionSaveProbe.parentId)};
      const afterId = ${JSON.stringify(currentVersionSavedId)};
      const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
      const accessoryId = "accessory-seed-fan-120-pwm";
      const beforeFinding = { id: "smoke-fan-power-before", ruleId: "fan-power", severity: "warning", accessoryId, accessoryName: "120mm PWM 시스템 팬", relatedPartIds: ["case-compact-matx"], title: "팬 허브 연결을 확인해 주세요.", message: "주변 부품 연결을 확인합니다.", facts: [] };
      const afterFinding = { id: "smoke-fan-power-after", ruleId: "fan-power", severity: "blocker", accessoryId, accessoryName: "120mm PWM 시스템 팬", relatedPartIds: ["case-compact-matx", "mb-a620-small"], title: "팬 허브 전원 연결이 부족합니다.", message: "팬 허브 전원 연결을 확인해야 합니다.", facts: [] };
      const savedWithAccessoryFinding = (saved, after) => ({ ...saved, selection: { ...saved.selection, accessories: [...(saved.selection.accessories ?? []).filter((selection) => selection.accessoryId !== accessoryId), { accessoryId, quantity: 1, targetPartId: "case-compact-matx" }] }, checkSnapshot: { ...(saved.checkSnapshot ?? {}), accessoryCompatibility: after ? { status: "incompatible", blockerCount: 1, warningCount: 0, unknownCount: 0, findings: [afterFinding] } : { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 0, findings: [beforeFinding] } } });
      const changedResult = { status: "needs_review", blockerCount: 0, warningCount: 0, unknownCount: 0, findings: [], accessoryCompatibility: { status: "incompatible", blockerCount: 1, warningCount: 0, unknownCount: 0, findings: [afterFinding] }, metrics: {}, analysis: { profile: "gaming", scoreLabel: "균형형", scoreBasis: "accessory-action-probe", confidence: "high", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] }, links: [], totalPriceWon: 9999999, priceComplete: true, engineVersion: "2.58.0", catalogSnapshotAt: "2026-09-17T00:00:00.000Z", checkedAt: "2026-09-17T00:00:00.000Z" };
      const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (predicate, limit = 120) => { for (let index = 0; index < limit; index += 1) { if (predicate()) return true; await pause(50); } return false; };
      const navigate = async (path) => { history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); await pause(150); };
      try {
        window.fetch = async (input, init) => {
          const requestUrl = new URL(typeof input === "string" ? input : input.url, location.href);
          const method = String(init?.method ?? "GET").toUpperCase();
          if (requestUrl.pathname === "/api/compatibility/check" && method === "POST") return response(changedResult);
          if (requestUrl.pathname === "/api/builds" && requestUrl.searchParams.has("ids")) {
            const result = await originalFetch(input, init);
            const payload = await result.clone().json();
            return response({ ...payload, items: payload.items.map((saved) => saved.id === beforeId ? savedWithAccessoryFinding(saved, false) : saved.id === afterId ? savedWithAccessoryFinding(saved, true) : saved) }, result.status);
          }
          if (requestUrl.pathname === "/api/builds/" + afterId) {
            const result = await originalFetch(input, init);
            const payload = await result.clone().json();
            return response(savedWithAccessoryFinding(payload, true), result.status);
          }
          return originalFetch(input, init);
        };
        const savedIds = localStorage.getItem("pc-supporter-saved-build-ids");
        window.dispatchEvent(new StorageEvent("storage", { key: "pc-supporter-saved-build-ids", newValue: savedIds, storageArea: localStorage }));
        await pause(250);
        await navigate("/");
        await navigate("/history?accessory-finding-smoke=1");
        await waitFor(() => Boolean(document.querySelector('[data-testid="saved-build-version-panel"]')));
        const versionRow = document.querySelector('[data-testid="saved-build-version-lineage-' + afterId + '"]')?.closest("article");
        const openVersion = versionRow?.querySelector("button");
        if (!(openVersion instanceof HTMLButtonElement)) return { stage: "missing-version-open", path: location.pathname };
        openVersion.click();
        const detailsReady = await waitFor(() => Boolean(document.querySelector('[data-testid="result-version-change-details"]')));
        if (!detailsReady) return { stage: "missing-accessory-details", path: location.pathname, context: document.querySelector('[data-testid="result-version-context"]')?.textContent ?? "", body: (document.body?.innerText ?? "").slice(-1800) };
        const detailsText = document.querySelector('[data-testid="result-version-change-details"]')?.textContent ?? "";
        const purchaseButton = document.querySelector('[data-testid^="result-version-accessory-purchase-"]');
        const connectionButton = document.querySelector('[data-testid^="result-version-accessory-connection-"]');
        if (!(purchaseButton instanceof HTMLButtonElement) || !(connectionButton instanceof HTMLButtonElement)) return { stage: "missing-accessory-actions", detailsText };
        purchaseButton.click();
        const purchaseFocused = await waitFor(() => document.activeElement?.getAttribute("data-testid") === "purchase-list-panel");
        connectionButton.click();
        const connectionFocused = await waitFor(() => document.activeElement?.getAttribute("data-testid") === "build-connectivity-panel");
        const purchaseSectionFocused = location.hash === "#purchase-list" || purchaseFocused;
        return { stage: purchaseSectionFocused && connectionFocused ? "checked" : "focus-incomplete", detailsText, path: location.pathname, hash: location.hash, purchaseFocused, purchaseSectionFocused, connectionFocused, activeElement: document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "", purchaseRows: [...document.querySelectorAll('[data-testid="purchase-list-row"]')].map((row) => ({ id: row.id, sourceKey: row.getAttribute("data-purchase-row-key"), name: row.querySelector("strong")?.textContent ?? "" })).slice(0, 12) };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assert(accessoryActionProbe.stage === "checked" && accessoryActionProbe.detailsText.includes("120mm PWM 시스템 팬") && accessoryActionProbe.detailsText.includes("연결 부품") && accessoryActionProbe.purchaseSectionFocused && accessoryActionProbe.purchaseFocused && accessoryActionProbe.connectionFocused, "주변 부품 finding의 구매·연결 액션 흐름이 완성되지 않았습니다. probe=" + JSON.stringify(accessoryActionProbe));
    assert(!publicVersionShareText.includes(versionShareProbe.response.ownerToken), "공유 버전 비교 화면에 owner token이 노출되었습니다.");
    await secondClient.evaluate(`(() => { const originalFetch = window.__pcSupporterVersionProbeOriginalFetch; if (typeof originalFetch === "function") window.fetch = originalFetch; delete window.__pcSupporterVersionProbeOriginalFetch; return typeof originalFetch === "function"; })()`);

    console.log(JSON.stringify({ ok: true, savedBuildId: candidateSavedId, originalSavedBuildId: originalSavedId, comparisonShareId, sharedWatchlistId, flow: ["isolated-servers", "api-rate-limit-headers", "save-build", "saved-build-decision-note", "saved-build-metadata-edit", "saved-build-recheck-refresh-value-diff", "assembly-verification-server-compact-restore", "saved-build-metadata-history", "saved-share-view-state", "cross-tab-history-sync", "shared-watchlist-snapshot", "shared-watchlist-retry", "shared-watchlist-decision", "shared-watchlist-decision-summary", "shared-watchlist-price-history-chart", "shared-watchlist-history-window", "candidate-scenario-compare", "candidate-scenario-share", "candidate-scenario-shared-route", "candidate-scenario-share-history", "shared-comparison-retry", "candidate-scenario-share-revoke", "candidate-scenario-revoked-route", "candidate-scenario-save", "share-route", "history-route", "saved-build-alerts-lazy-load", "saved-build-alert-finding-focus", "saved-build-finding-deep-link", "saved-build-recheck-analysis-diff", "saved-build-comparison-navigation", "version-pair-selection", "version-comparison-export", "version-comparison-share", "version-comparison-share-history", "cross-tab-purchase-progress-conflict", "purchase-item-status", "purchase-decision-gate-progress", "assembly-plan-execution-progress", "assembly-plan-resume-action", "purchase-list-action-center", "purchase-progress-save", "purchase-progress-server-restore", "cross-tab-price-history-conflict", "price-history-server-save", "price-history-server-restore", "purchase-price-decision-summary", "purchase-list-data-freshness", "purchase-list-price-filters", "purchase-list-search", "shared-build-clone-to-draft"] }, null, 2));
  } finally {
    if (secondClient) {
      await Promise.race([
        secondClient.send("Page.close").catch(() => undefined),
        sleep(1_000)
      ]);
      secondClient.close();
    }
    await browser?.stop();
    await webServer.stop();
    await apiServer.stop();
    await rm(dataDir, { recursive: true, force: true });
    await rm(dataDir + "-chrome", { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
