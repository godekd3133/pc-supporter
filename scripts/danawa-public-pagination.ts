/**
 * Resumable, low-rate pagination inventory for Danawa PC-part list pages.
 * The default command is intentionally a bounded prototype. --all enables the
 * nine-category walk only after a human has reviewed and approved that prototype.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Category = { category: string; categoryId: string; label: string; root?: boolean };
type Product = { productCode: string; name: string; url: string; priceWon?: number; spec?: string };
type Page = { page: number; pageSize: number; totalPages?: number; totalCount?: number; parserVersion?: number; codes: string[]; products: Product[]; fetchedAt: string };
type Snapshot = { schemaVersion: 1; source: string; updatedAt: string; categories: Record<string, { category: string; categoryId: string; label: string; pages: Record<string, Page>; status: string; error?: string; duplicateProductCodes?: string[]; listedProductCount?: number; uniqueProductCount?: number }> };

const ROOT = process.cwd();
const OUTPUT = resolve(ROOT, "data/danawa-pc9-all-pages.json");
const TARGETS = resolve(ROOT, "scripts/fixtures/danawa-pc9-targets.json");
const ROOT_IDS = new Set(["112747", "11336857", "11336856", "112751", "112752", "112753", "112760", "112763", "112775", "112777"]);
const CHROME = "/Users/kimminkyu/Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium";
const MIN_DELAY_MS = 900;
const MAX_RETRIES = 2;
const TIMEOUT_MS = 8_000;
let lastSourceRequest = 0;
let schemaShapeLogged = false;

const wait = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));
function assertSameCategory(url: string, id: string) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://prod.danawa.com" || parsed.pathname !== "/list/" || parsed.searchParams.get("cate") !== id) {
    throw new Error("Refusing a request outside the selected public category list.");
  }
}
async function pacedFetch(url: string, init: RequestInit) {
  assertSameCategory(url, new URL(url).searchParams.get("cate")!);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await wait(Math.max(0, MIN_DELAY_MS - (Date.now() - lastSourceRequest)));
    lastSourceRequest = Date.now();
    try {
      const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if ([403, 429].includes(response.status)) throw new Error(`STOP: source returned HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (/접근이 제한|비정상적인 접근|자동입력 방지|보안문자|로봇이 아닙니다|captcha/i.test(text)) throw new Error("STOP: challenge/access-denied response");
      return { response, text };
    } catch (error) {
      if (String(error).startsWith("Error: STOP:") || attempt === MAX_RETRIES) throw error;
      await wait(MIN_DELAY_MS);
    }
  }
  throw new Error("Retries exhausted");
}
function parseAction(text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("1:")) continue;
    try { const value = JSON.parse(line.slice(2)); if (value && typeof value === "object") return value as Record<string, any>; } catch { /* inspect other 1: lines */ }
  }
  throw new Error("No parseable 1: RSC success/data action in response.");
}
function sourceText(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(item => sourceText(item, depth + 1)).filter(Boolean).join(" ").trim();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["ko-KR", "ko", "displayName", "productName", "name", "label", "text", "title", "value", "description"]) {
      const text = sourceText(record[key], depth + 1);
      if (text) return text;
    }
    return Object.values(record).map(item => sourceText(item, depth + 1)).filter(Boolean).join(" ").trim();
  }
  return "";
}
function toProducts(values: unknown[]): Product[] {
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const p = value as Record<string, any>;
    const code = String(p.productCode ?? p.pcode ?? p.code ?? "").trim();
    if (!/^\d{5,}$/.test(code)) return [];
    const rawPrice = p.price?.min ?? p.price?.lowest ?? p.displayPrice ?? p.priceWon;
    const price = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice ?? "").replace(/[^\d]/g, ""));
    const structuredName = p.name && typeof p.name === "object" ? p.name.full ?? p.name.product ?? p.name.model : p.name;
    const name = sourceText(p.productName ?? structuredName ?? p.title);
    if (!name || name === "[object Object]") throw new Error(`Could not normalize product name for code ${code}.`);
    const structuredSpec = p.description && typeof p.description === "object" ? p.description.pc ?? p.description.mobile : p.description;
    return [{ productCode: code, name, url: `https://prod.danawa.com/info/?pcode=${code}`,
      ...(Number.isFinite(price) && price > 0 ? { priceWon: price } : {}), ...(structuredSpec || p.rawSpecText || p.spec ? { spec: sourceText(structuredSpec ?? p.rawSpecText ?? p.spec) } : {}) }];
  });
}
function pageFromAction(action: Record<string, any>, requested: number): Page {
  const data = action.data && typeof action.data === "object" ? action.data : action;
  if (action.success === false || !Array.isArray(data.products)) throw new Error(`RSC action did not succeed for page ${requested}.`);
  const products = toProducts(data.products);
  const findNumber = (keys: string[]) => {
    const visit = (value: unknown, depth: number): number | undefined => {
      if (depth > 6 || !value || typeof value !== "object") return undefined;
      if (Array.isArray(value)) { for (const child of value) { const result = visit(child, depth + 1); if (result !== undefined) return result; } return undefined; }
      const object = value as Record<string, unknown>;
      for (const key of keys) if (typeof object[key] === "number") return object[key] as number;
      for (const child of Object.values(object)) { const result = visit(child, depth + 1); if (result !== undefined) return result; }
      return undefined;
    };
    return visit(action, 0);
  };
  const pageSize = Number(data.pageSize ?? findNumber(["pageSize"]) ?? products.length);
  const currentPage = Number(data.currentPage ?? data.page ?? findNumber(["currentPage"]) ?? requested);
  const totalCount = Number(data.totalCount ?? findNumber(["totalCount"]));
  const reportedTotalPages = Number(data.totalPages ?? findNumber(["totalPages"]));
  const totalPages = Number.isInteger(reportedTotalPages) && reportedTotalPages > 0
    ? reportedTotalPages
    : Number.isInteger(totalCount) && totalCount >= 0 && Number.isInteger(pageSize) && pageSize > 0 ? Math.ceil(totalCount / pageSize) : Number.NaN;
  if (currentPage !== requested) throw new Error(`Response page mismatch: requested ${requested}, received ${currentPage}.`);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 30 || products.length > pageSize) throw new Error(`Unsafe page size ${pageSize} / ${products.length}.`);
  if (new Set(products.map(p => p.productCode)).size !== products.length) throw new Error(`Duplicate product code inside page ${requested}.`);
  if (Number.isInteger(totalPages) && totalPages > 0 && requested > totalPages) throw new Error(`Response page ${requested} exceeds totalPages ${totalPages}.`);
  if (Number.isInteger(totalCount) && totalCount >= 0 && requested <= totalPages && products.length !== Math.min(pageSize, Math.max(0, totalCount - ((requested - 1) * pageSize)))) throw new Error(`Page ${requested} has an unexpected product count.`);
  return { page: requested, pageSize, parserVersion: 4, ...(Number.isInteger(totalPages) && totalPages > 0 ? { totalPages } : {}), ...(Number.isInteger(totalCount) && totalCount >= 0 ? { totalCount } : {}),
    products, codes: products.map(p => p.productCode), fetchedAt: new Date().toISOString() };
}
async function atomicSave(snapshot: Snapshot) {
  await mkdir(join(ROOT, "data"), { recursive: true });
  const temp = `${OUTPUT}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, OUTPUT);
}

type Capture = { url: string; body: string; headers: Record<string, string> };
async function bootstrap(categoryId: string): Promise<{ capture: Capture; html: string }> {
  const profile = await import("node:fs/promises").then(m => m.mkdtemp(join(tmpdir(), "danawa-pc9-page-")));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--disable-background-networking", "--remote-allow-origins=*", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let ws: WebSocket | undefined;
  try {
    let port: number | undefined;
    for (let i = 0; i < 200 && !port; i++) { try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { await wait(100); } }
    if (!port) throw new Error("Chromium DevTools bootstrap timed out.");
    let tab: any;
    for (let i = 0; i < 100 && !tab; i++) { try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x: any) => x.type === "page"); } catch {} if (!tab) await wait(100); }
    if (!tab?.webSocketDebuggerUrl) throw new Error("Chromium page target unavailable.");
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise<void>((resolveOpen, reject) => { ws!.onopen = () => resolveOpen(); ws!.onerror = () => reject(new Error("CDP WebSocket failed.")); });
    let id = 0; const pending = new Map<number, (value: any) => void>(); let capture: Capture | undefined; let html = "";
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id) { pending.get(message.id)?.(message.result); pending.delete(message.id); return; }
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request, resourceType } = message.params;
      const u = new URL(request.url);
      const isStatic = ["Script", "Stylesheet", "Image", "Font", "Media"].includes(resourceType);
      const sameList = u.origin === "https://prod.danawa.com" && u.pathname === "/list/" && u.searchParams.get("cate") === categoryId;
      const rootDoc = sameList && resourceType === "Document" && request.method === "GET";
      const forbidden = /^\/(api|list\/ajax|info\/ajax|bridge|community)(\/|$)/.test(u.pathname);
      let parsed: any; try { parsed = JSON.parse(request.postData ?? ""); } catch {}
      const pageTwo = Array.isArray(parsed) ? parsed.find((entry: any) => entry && String(entry.categoryCode) === categoryId.slice(3) && entry.page === 2) : undefined;
      const hasNextAction = Object.keys(request.headers).some(key => key.toLowerCase() === "next-action");
      if (!capture && sameList && request.method === "POST" && pageTwo && hasNextAction) capture = { url: request.url, body: request.postData ?? "", headers: { ...request.headers } };
      const allow = !forbidden && (isStatic || rootDoc || (sameList && request.method === "GET"));
      if (allow && u.hostname === "prod.danawa.com" && u.pathname === "/list/") { const gap = Math.max(0, MIN_DELAY_MS - (Date.now() - lastSourceRequest)); if (gap) { setTimeout(() => ws?.send(JSON.stringify({ id: ++id, method: "Fetch.continueRequest", params: { requestId } })), gap); lastSourceRequest = Date.now() + gap; return; } lastSourceRequest = Date.now(); }
      ws!.send(JSON.stringify({ id: ++id, method: allow ? "Fetch.continueRequest" : "Fetch.failRequest", params: allow ? { requestId } : { requestId, errorReason: "BlockedByClient" } }));
    };
    const cdp = (method: string, params: object = {}) => new Promise<any>(resolveCdp => { const callId = ++id; pending.set(callId, resolveCdp); ws!.send(JSON.stringify({ id: callId, method, params })); });
    const evaluate = async (expression: string) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
    await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await cdp("Page.navigate", { url: `https://prod.danawa.com/list/?cate=${categoryId}` });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) { const ready = await evaluate(`!!document.querySelector('button[aria-label="페이지 2"]')`); if (ready) break; await wait(100); }
    html = String(await evaluate("document.documentElement.outerHTML") ?? "");
    const ready = await evaluate(`!!document.querySelector('button[aria-label="페이지 2"]')`);
    if (!ready) {
      const bodyText = String(await evaluate("document.body?.innerText ?? ''") ?? "");
      if (/접근이 제한|비정상적인 접근|자동입력 방지|보안문자|로봇이 아닙니다|captcha|잠시 후 다시/i.test(bodyText)) throw new Error("STOP: browser bootstrap returned a challenge/access-denied page.");
      throw new Error("Initial category page did not expose the page 2 control within 20 seconds.");
    }
    await evaluate(`document.querySelector('button[aria-label="페이지 2"]').click()`);
    const captureDeadline = Date.now() + 10_000;
    while (!capture && Date.now() < captureDeadline) await wait(100);
    if (!capture) throw new Error("Could not capture the same-category page 2 UI request.");
    return { capture, html };
  } finally { try { ws?.close(); } catch {} try { chrome.kill("SIGTERM"); } catch {} await wait(250); const { rm } = await import("node:fs/promises"); await rm(profile, { recursive: true, force: true }); }
}
async function bootstrapWithTransientRetries(categoryId: string) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await bootstrap(categoryId); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = message.includes("did not expose the page 2 control") || message.includes("Could not capture the same-category page 2 UI request");
      if (!retryable || attempt >= 2) throw error;
      await wait(MIN_DELAY_MS);
    }
  }
}
function requestTemplate(capture: Capture, page: number, category: Category) {
  assertSameCategory(capture.url, category.categoryId);
  const body = JSON.parse(capture.body);
  const action = Array.isArray(body) ? body.find((x: any) => x && String(x.categoryCode) === category.categoryId.slice(3) && x.page === 2) : undefined;
  if (!action) throw new Error("Captured request payload has no matching category/page action.");
  action.page = page;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(capture.headers)) {
    const lower = key.toLowerCase();
    if (["host", "content-length", "connection", "accept-encoding", "transfer-encoding", "cookie2"].includes(lower) || lower.startsWith(":")) continue;
    headers[key] = value;
  }
  // Cookie and Next-Action are kept only in the live capture object and never written/logged.
  return { url: capture.url, body: JSON.stringify(body), headers, cookiePresent: Boolean(headers.cookie ?? headers.Cookie), nextActionPresent: Boolean(headers["Next-Action"] ?? headers["next-action"]) };
}
async function fetchPage(capture: Capture, category: Category, page: number) {
  const request = requestTemplate(capture, page, category);
  const { response, text } = await pacedFetch(request.url, { method: "POST", headers: request.headers, body: request.body });
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/x-component")) throw new Error(`Unexpected response content type: ${type}`);
  const action = parseAction(text);
  const data = action.data && typeof action.data === "object" ? action.data : action;
  if (!schemaShapeLogged && Array.isArray(data.products) && data.products[0] && typeof data.products[0] === "object") {
    schemaShapeLogged = true;
    const product = data.products[0] as Record<string, unknown>;
    const shape = (value: unknown): unknown => value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, child && typeof child === "object" ? Object.keys(child as object) : typeof child])) : typeof value;
    console.log(JSON.stringify({ rscFieldShape: { productKeys: Object.keys(product), productNameShape: shape(product.productName), nameShape: shape(product.name), nameFieldValues: product.name, descriptionShape: shape(product.description), specShape: shape(product.spec), priceShape: shape(product.price) } }));
  }
  const result = pageFromAction(action, page);
  return { ...result, _requestEvidence: { httpStatus: response.status, contentType: type, cookiePresent: request.cookiePresent, nextActionPresent: request.nextActionPresent } };
}
function duplicateCodes(pages: Record<string, Page>) {
  const counts = new Map<string, number>();
  for (const page of Object.values(pages)) for (const code of page.codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([code]) => code).sort();
}
function updateCategoryMetrics(state: Snapshot["categories"][string]) {
  const allCodes = Object.values(state.pages).flatMap(page => page.codes);
  state.duplicateProductCodes = duplicateCodes(state.pages);
  state.listedProductCount = allCodes.length;
  state.uniqueProductCount = new Set(allCodes).size;
}
function needsRefresh(page: Page | undefined) {
  return Boolean(page && (page.parserVersion !== 4 || page.products.some(product => !product.name || product.name === "[object Object]" || product.spec === "[object Object]")));
}

const args = new Set(process.argv.slice(2));
if ([...args].some(x => x !== "--prototype" && x !== "--all")) throw new Error("Allowed options: --prototype (default), --all (after prototype approval).");
if (args.has("--prototype") && args.has("--all")) throw new Error("Choose one run mode.");
const mode = args.has("--all") ? "all" : "prototype";
const targets = JSON.parse(await readFile(TARGETS, "utf8")) as Category[];
const roots = targets.filter(t => ROOT_IDS.has(t.categoryId));
if (roots.length !== 10 || new Set(roots.map(t => t.category)).size !== 9) throw new Error("PC9 root category manifest did not match the expected nine logical categories across ten listing roots.");
let snapshot: Snapshot;
try { snapshot = JSON.parse(await readFile(OUTPUT, "utf8")) as Snapshot; } catch { snapshot = { schemaVersion: 1, source: "danawa public product listing pages", updatedAt: new Date().toISOString(), categories: {} }; }
if (snapshot.categories["11236855"] && snapshot.categories["11236855"].status !== "complete") {
  snapshot.categories["11236855"].status = "partial-capped-repeat";
  snapshot.categories["11236855"].error = "Broad cooler root repeats the same 30 product codes from page 67 onward; excluded from logical cooler completeness. Use roots 11336857 and 11336856.";
  updateCategoryMetrics(snapshot.categories["11236855"]);
}
const run = mode === "prototype" ? [{ category: "cpu", categoryId: "112747", label: "CPU root", pages: [1, 2, 3] }, { category: "gpu", categoryId: "112753", label: "GPU root", pages: [1, 2] }, { category: "cooler", categoryId: "11336857", label: "CPU cooler air", pages: [1] }, { category: "cooler", categoryId: "11336856", label: "CPU cooler liquid", pages: [1] }] : roots.map(t => ({ ...t, pages: [] as number[] }));
try {
  for (const target of run) {
    const category: Category = { category: target.category, categoryId: target.categoryId, label: target.label, root: true };
    const state = snapshot.categories[category.categoryId] ?? (snapshot.categories[category.categoryId] = { category: category.category, categoryId: category.categoryId, label: category.label, pages: {}, status: "in-progress" });
    if (!target.pages.length && state.status === "complete" && !Object.values(state.pages).some(needsRefresh)) continue;
    state.status = "in-progress";
    delete state.error;
    if (state.pages["1"] && state.pages["1"].codes.length !== state.pages["1"].pageSize) delete state.pages["1"];
    await atomicSave(snapshot);
    const { capture, html } = await bootstrapWithTransientRetries(category.categoryId);
    const htmlStats = html.match(/\"totalCount\"\s*:\s*(\d+)\s*,\s*\"currentPage\"\s*:\s*(\d+)\s*,\s*\"pageSize\"\s*:\s*(\d+)\s*,\s*\"totalPages\"\s*:\s*(\d+)/);
    const firstRequestPage = mode === "all" ? 1 : (target.pages.includes(1) && (!state.pages["1"] || needsRefresh(state.pages["1"])) ? 1 : 0);
    if (firstRequestPage && (!state.pages["1"] || needsRefresh(state.pages["1"]))) {
      const page = await fetchPage(capture, category, 1);
      const { _requestEvidence, ...savedPage } = page;
      state.pages["1"] = { ...savedPage,
        ...(savedPage.totalPages === undefined && htmlStats ? { totalPages: Number(htmlStats[4]) } : {}),
        ...(savedPage.totalCount === undefined && htmlStats ? { totalCount: Number(htmlStats[1]) } : {}) };
      if (state.pages["1"].totalPages === undefined && state.pages["1"].totalCount !== undefined) state.pages["1"].totalPages = Math.ceil(state.pages["1"].totalCount! / state.pages["1"].pageSize);
      if (state.pages["1"].codes.length !== state.pages["1"].pageSize) throw new Error(`Page 1 returned ${state.pages["1"].codes.length} products; expected ${state.pages["1"].pageSize}.`);
      updateCategoryMetrics(state);
      await atomicSave(snapshot);
      console.log(JSON.stringify({ category: category.category, categoryId: category.categoryId, page: 1, codeCount: savedPage.codes.length, firstCodes: savedPage.codes.slice(0, 5), pageSize: savedPage.pageSize, totalPages: savedPage.totalPages, sourceStatus: _requestEvidence.httpStatus, contentType: _requestEvidence.contentType, cookieAndNextActionPresent: _requestEvidence.cookiePresent && _requestEvidence.nextActionPresent }));
    }
    let maxPage: number | undefined = Object.values(state.pages).map(p => p.totalPages).find((x): x is number => typeof x === "number");
    const knownTotal = Object.values(state.pages).map(p => p.totalCount).find((x): x is number => typeof x === "number");
    if (maxPage && knownTotal !== undefined) {
      for (const [pageKey, page] of Object.entries(state.pages)) {
        const pageNo = Number(pageKey);
        const expected = Math.min(page.pageSize, Math.max(0, knownTotal - (pageNo - 1) * page.pageSize));
        if (pageNo <= maxPage && page.codes.length !== expected) throw new Error(`Saved page ${pageNo} has ${page.codes.length} products; expected ${expected}.`);
        page.totalPages ??= maxPage;
        page.totalCount ??= knownTotal;
      }
      await atomicSave(snapshot);
    }
    updateCategoryMetrics(state);
    const pageNumbers = mode === "all" ? (maxPage ? Array.from({ length: maxPage }, (_, i) => i + 1) : (() => { throw new Error("Could not determine the category's exact last page; refusing unbounded enumeration."); })()) : target.pages;
    for (const pageNo of pageNumbers.filter(n => n > 1)) {
      if (state.pages[String(pageNo)] && !needsRefresh(state.pages[String(pageNo)])) continue;
      const result = await fetchPage(capture, category, pageNo);
      const { _requestEvidence, ...page } = result;
      maxPage = page.totalPages ?? maxPage;
      const totalCount = page.totalCount ?? state.pages["1"]?.totalCount;
      const expectedRows = totalCount !== undefined ? Math.min(page.pageSize, Math.max(0, totalCount - ((pageNo - 1) * page.pageSize))) : (maxPage && pageNo < maxPage ? page.pageSize : undefined);
      if (expectedRows === undefined) throw new Error(`Cannot verify exact row count for page ${pageNo}; refusing to checkpoint it.`);
      if (page.codes.length !== expectedRows) throw new Error(`Page ${pageNo} returned ${page.codes.length} products; expected ${expectedRows}.`);
      state.pages[String(pageNo)] = { ...page, ...(page.totalPages === undefined && maxPage ? { totalPages: maxPage } : {}), ...(page.totalCount === undefined && totalCount !== undefined ? { totalCount } : {}) };
      updateCategoryMetrics(state);
      await atomicSave(snapshot);
      console.log(JSON.stringify({ category: category.category, categoryId: category.categoryId, page: pageNo, codeCount: page.codes.length, firstCodes: page.codes.slice(0, 5), pageSize: page.pageSize, totalPages: page.totalPages, sourceStatus: _requestEvidence.httpStatus, contentType: _requestEvidence.contentType, cookieAndNextActionPresent: _requestEvidence.cookiePresent && _requestEvidence.nextActionPresent }));
    }
    if (mode === "all") {
      const expectedPages = maxPage ? Array.from({ length: maxPage }, (_, index) => String(index + 1)) : [];
      if (!expectedPages.length || expectedPages.some(page => !state.pages[page])) throw new Error("Cannot mark category complete: one or more expected pages are missing.");
      for (const pageKey of expectedPages) {
        const page = state.pages[pageKey];
        const expectedRows = page.totalCount !== undefined ? Math.min(page.pageSize, Math.max(0, page.totalCount - (page.page - 1) * page.pageSize)) : undefined;
        if (expectedRows === undefined || page.codes.length !== expectedRows) throw new Error(`Cannot mark category complete: page ${pageKey} does not have its exact expected row count.`);
      }
      state.status = "complete";
    }
    else state.status = "prototype-complete";
    await atomicSave(snapshot);
      console.log(JSON.stringify({ category: category.category, categoryId: category.categoryId, status: state.status, savedPages: Object.keys(state.pages).map(Number).sort((a,b) => a-b), listedProducts: state.listedProductCount, uniqueCodes: state.uniqueProductCount, duplicateCodeCount: state.duplicateProductCodes?.length ?? 0, duplicateCodeSamples: state.duplicateProductCodes?.slice(0, 10) ?? [] }));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const active = run.find(target => snapshot.categories[target.categoryId]?.status === "in-progress" || snapshot.categories[target.categoryId]?.status === "prototype-approved-all-mode-running");
  if (active) { snapshot.categories[active.categoryId].status = "stopped"; snapshot.categories[active.categoryId].error = message; await atomicSave(snapshot); }
  console.error(JSON.stringify({ status: message.startsWith("Error: STOP:") || message.startsWith("STOP:") ? "source-blocked-stop" : "failed-stop", error: message }));
  process.exitCode = 1;
}
