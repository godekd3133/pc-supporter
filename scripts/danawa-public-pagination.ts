/**
 * Resumable, low-rate pagination inventory for robots-allowed Danawa public list pages.
 * The default command is a bounded PC-part prototype. `--accessory` targets the
 * separate public accessory categories; `--all` enumerates selected roots and marks
 * them complete only after exact per-page counts and unique product codes validate.
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ACCESSORY_CATEGORY_LABELS, type AccessoryCategory } from "../shared/types";
import { DANAWA_ACCESSORY_CATEGORIES } from "../server/accessory-crawler";
import { parseDanawaPublicListPage } from "../server/danawa-public-list";
import {
  BUNDLE_MEMBERS_SOURCE,
  createBundlePageObservation,
  emptyBundleMembersArtifact,
  mergeBundlePageObservation,
  type BundleMembersArtifact,
  type BundlePageObservation
} from "./danawa-accessory-bundle-members";

type Category = { category: string; categoryId: string; label: string; root?: boolean };
type Product = { productCode: string; name: string; url: string; priceWon?: number; spec?: string };
type Page = { page: number; pageSize: number; totalPages?: number; totalCount?: number; parserVersion?: number; rowCountMismatch?: { expected: number; received: number }; codes: string[]; products: Product[]; fetchedAt: string };
type Snapshot = { schemaVersion: 1; source: string; updatedAt: string; categories: Record<string, { category: string; categoryId: string; label: string; pages: Record<string, Page>; status: string; error?: string; duplicateProductCodes?: string[]; listedProductCount?: number; uniqueProductCount?: number }> };

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const accessoryMode = args.has("--accessory");
const selectedAccessoryCategory = [...args].find((argument) => argument.startsWith("--category="))?.slice("--category=".length) as AccessoryCategory | undefined;
const capturePageArgument = [...args].find((argument) => argument.startsWith("--capture-page="))?.slice("--capture-page=".length);
const capturePage = capturePageArgument === undefined ? undefined : Number(capturePageArgument);
const captureRangeArgument = [...args].find((argument) => argument.startsWith("--capture-range="))?.slice("--capture-range=".length);
const captureRangeMatch = captureRangeArgument?.match(/^(\d+):(\d+)$/);
const captureRange = captureRangeMatch ? { start: Number(captureRangeMatch[1]), end: Number(captureRangeMatch[2]) } : undefined;
const selectedSort = [...args].find((argument) => argument.startsWith("--sort="))?.slice("--sort=".length);
const pageSizeArgument = [...args].find((argument) => argument.startsWith("--page-size="))?.slice("--page-size=".length);
const selectedPageSize = pageSizeArgument === undefined ? 30 : Number(pageSizeArgument);
const persistCapture = args.has("--persist-capture");
const persistBundles = args.has("--persist-bundles");
const OUTPUT = resolve(ROOT, accessoryMode ? "data/danawa-accessory-all-pages.json" : "data/danawa-pc9-all-pages.json");
const SORT_SUPPLEMENT_OUTPUT = resolve(ROOT, "data/danawa-accessory-sort-pages.json");
const BUNDLE_MEMBERS_OUTPUT = resolve(ROOT, "data/danawa-accessory-bundle-members.json");
const TARGETS = resolve(ROOT, "scripts/fixtures/danawa-pc9-targets.json");
const ROOT_IDS = new Set(["112747", "11336857", "11336856", "112751", "112752", "112753", "112760", "112763", "112775", "112777"]);
const CHROME = process.env.PC_SUPPORTER_CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MIN_DELAY_MS = 900;
const MAX_RETRIES = 2;
const TIMEOUT_MS = 8_000;
let lastSourceRequest = 0;
let schemaShapeLogged = false;

const wait = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));
const pageButtonSelector = (page: number) => {
  const pageNumber = JSON.stringify(String(page));
  return "(() => { var controls = document.querySelectorAll('button, a, [role=\"button\"]');"
    + "for (var i = 0; i < controls.length; i += 1) { var element = controls[i];"
    + "var text = (element.textContent || '').trim(); var aria = element.getAttribute('aria-label') || '';"
    + "var title = element.getAttribute('title') || ''; var dataPage = element.getAttribute('data-page') || element.getAttribute('data-page-number') || '';"
    + "var scope = element.closest && element.closest('nav, [class*=\"page\"], [class*=\"paging\"], [class*=\"paginate\"], [class*=\"pagination\"], [class*=\"pager\"], [class*=\"edge_nav\"]');"
    + "if (aria === '페이지 ' + " + pageNumber + " || title === '페이지 ' + " + pageNumber
    + " || dataPage === " + pageNumber + " || (Boolean(scope) && text === " + pageNumber + ")) return element; }"
    + "return null; })()";
};
const hasPageExpression = (page: number) => "(" + pageButtonSelector(page) + ") !== null";
const clickPageExpression = (page: number) => "(() => { const target = " + pageButtonSelector(page)
  + "; if (!(target instanceof HTMLElement)) return false; target.click(); return true; })()";
const sortButtonSelector = (sort: string) => "document.querySelector(" + JSON.stringify('[id$=\"-trigger-' + sort + '\"]') + ")";
const sortButtonPointExpression = (sort: string) => "(() => { var target = " + sortButtonSelector(sort)
  + "; if (!(target instanceof HTMLElement)) return null; target.scrollIntoView({ block: 'center' });"
  + "var rect = target.getBoundingClientRect(); var style = getComputedStyle(target);"
  + "if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || rect.bottom <= 0 || rect.top >= window.innerHeight) return null;"
  + "var point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; var hit = document.elementFromPoint(point.x, point.y);"
  + "return hit && (hit === target || target.contains(hit)) ? point : null; })()";
const sortSelectedExpression = (sort: string) => "(() => { var target = " + sortButtonSelector(sort)
  + "; return Boolean(target && (target.getAttribute('aria-selected') === 'true' || target.getAttribute('data-state') === 'active')); })()";
const hasLoadedCategoryProductsExpression = "(() => { const area = document.querySelector('#productListArea');"
  + "const productLinks = area?.querySelectorAll('a[href*=\"/info/\"][href*=\"pcode=\"]')?.length ?? 0;"
  + "return productLinks >= 10 && !/상품 목록 로딩 중/.test(area?.innerText ?? ''); })()";
const sortStateExpression = (sort: string) => "(() => { var target = " + sortButtonSelector(sort)
  + "; return target ? JSON.stringify({ id: target.id, ariaSelected: target.getAttribute('aria-selected'), dataState: target.getAttribute('data-state'),"
  + "role: target.getAttribute('role'), text: target.innerText || target.textContent || '', className: String(target.className || '') }) : 'missing'; })()";
const pageSizeSelectExpression = "Array.from(document.querySelectorAll('select')).find((select) => ['30', '60', '90'].every((value) => Array.from(select.options).some((option) => option.value === value)))";
const pageSizeStateExpression = "(() => { const select = " + pageSizeSelectExpression + ";"
  + "return JSON.stringify(select instanceof HTMLSelectElement ? { value: select.value, options: Array.from(select.options).map((option) => option.value) } : null); })()";
const pageSizeControlDiagnosticExpression = "JSON.stringify({ viewport: { width: innerWidth, height: innerHeight },"
  + "selects: Array.from(document.querySelectorAll('select')).map((select) => ({ ariaLabel: select.getAttribute('aria-label'), value: select.value,"
  + "rect: (() => { const rect = select.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),"
  + "style: { display: getComputedStyle(select).display, visibility: getComputedStyle(select).visibility, pointerEvents: getComputedStyle(select).pointerEvents } })),"
  + "pageSizeCandidates: Array.from(document.querySelectorAll('button,[role=\"combobox\"],[role=\"button\"]')).map((element) => ({ role: element.getAttribute('role'), ariaLabel: element.getAttribute('aria-label'), text: (element.innerText || element.textContent || '').trim().slice(0, 60), id: element.id })).filter((item) => /페이지당|30개|60개|90개/.test((item.ariaLabel || '') + ' ' + item.text)),"
  + "sortTabs: Array.from(document.querySelectorAll('[role=\"tab\"]')).map((element) => ({ id: element.id, text: (element.textContent || '').trim().slice(0, 30) })) })";
const setPageSizeExpression = (pageSize: number) => "(() => { const select = " + pageSizeSelectExpression + ";"
  + "if (!(select instanceof HTMLSelectElement)) return JSON.stringify({ found: false });"
  + "const value = " + JSON.stringify(String(pageSize)) + ";"
  + "if (!Array.from(select.options).some((option) => option.value === value)) return JSON.stringify({ found: true, value: select.value, available: Array.from(select.options).map((option) => option.value) });"
  + "const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;"
  + "if (setter) setter.call(select, value); else select.value = value;"
  + "select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true }));"
  + "return JSON.stringify({ found: true, value: select.value, available: Array.from(select.options).map((option) => option.value) }); })()";
const pageSizeSelectPointExpression = "(() => { const select = " + pageSizeSelectExpression + ";"
  + "if (!(select instanceof HTMLSelectElement)) return null; select.scrollIntoView({ block: 'center', behavior: 'instant' });"
  + "let rect = select.getBoundingClientRect(); if (rect.top < 0 || rect.bottom > innerHeight) { window.scrollBy({ top: rect.top + rect.height / 2 - innerHeight / 2, behavior: 'instant' }); rect = select.getBoundingClientRect(); }"
  + "const style = getComputedStyle(select);"
  + "if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return null;"
  + "const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };"
  + "return document.elementFromPoint(point.x, point.y) === select ? { ...point, currentValue: select.value, options: Array.from(select.options).map((option) => option.value) } : null; })()";
const hasVisiblePageSizeRowsExpression = (pageSize: number) => "(() => { const select = " + pageSizeSelectExpression + ";"
  + "const rows = Array.from(document.querySelectorAll('#productListArea a.font-bold[href*=\"pcode=\"]'));"
  + "const codes = new Set(rows.map((link) => { try { return new URL(link.href).searchParams.get('pcode'); } catch { return null; } }).filter(Boolean));"
  + "const area = document.querySelector('#productListArea'); return Boolean(select && select.value === " + JSON.stringify(String(pageSize))
  + " && codes.size >= " + String(pageSize) + " && !/상품 목록 로딩 중/.test(area?.innerText ?? '')); })()";
const sortButtonDiagnosticExpression = (sort: string) => `(() => {
  const target = ${sortButtonSelector(sort)};
  const summarize = (element) => {
    const href = element.getAttribute('href'); let hrefPath;
    try { hrefPath = href ? new URL(href, location.href).pathname : undefined; } catch {}
    return { tag: element.tagName, id: element.id || undefined, role: element.getAttribute('role') || undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined, title: element.getAttribute('title') || undefined,
      className: String(element.className || '').slice(0, 120), text: (element.innerText || element.textContent || '').trim().slice(0, 80), hrefPath };
  };
  const selectors = [
    ['modernSortButtons', 'button[id*="-trigger-"], [role="tab"][id*="-trigger-"]'],
    ['legacySortList', '.sort_list, [class*="sort_list"]'],
    ['legacySortType', '.sort_type, [class*="sort_type"]'],
    ['legacySortAnchors', 'a[href*="sort"], a[id*="sort"]'],
    ['legacyPriceControls', '#gnb_apps_link, #getPriceParameter, #priceRangeSearchButtonSimple'],
    ['nativePageSizeSelects', 'select']
  ];
  const diagnostic = { found: Boolean(target), href: location.href.split('?')[0], title: document.title, readyState: document.readyState,
    documentClass: String(document.documentElement.className || '').slice(0, 160), bodyClass: String(document.body?.className || '').slice(0, 160),
    expectedSortId: target?.id, selectorSummary: selectors.map(([name, selector]) => {
      const elements = Array.from(document.querySelectorAll(selector));
      return { name, count: elements.length, elements: elements.slice(0, 12).map(summarize) };
    }), namedLegacyControls: ['gnb_apps_link', 'getPriceParameter', 'priceRangeSearchButtonSimple'].map((id) => {
      const element = document.getElementById(id); return { id, found: Boolean(element), ...(element ? summarize(element) : {}) };
    }) };
  if (!(target instanceof HTMLElement)) return JSON.stringify(diagnostic);
  target.scrollIntoView({ block: 'center' }); const rect = target.getBoundingClientRect(); const style = getComputedStyle(target);
  const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; const hit = document.elementFromPoint(point.x, point.y);
  return JSON.stringify({ ...diagnostic, selected: target.getAttribute('aria-selected'), state: target.getAttribute('data-state'),
    text: (target.innerText || target.textContent || '').trim(), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom },
    viewport: { width: innerWidth, height: innerHeight, scrollY }, style: { display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents },
    hit: hit ? { tag: hit.tagName, id: hit.id, className: String(hit.className || ''), text: (hit.innerText || hit.textContent || '').trim().slice(0, 60) } : null });
})()`;
const sortHitTestExpression = (sort: string, point: { x: number; y: number }) => "(() => { const target = " + sortButtonSelector(sort)
  + "; const point = " + JSON.stringify(point) + "; const rect = target?.getBoundingClientRect(); const hit = document.elementFromPoint(point.x, point.y);"
  + "return JSON.stringify({ point, target: target ? { id: target.id, ariaSelected: target.getAttribute('aria-selected'), dataState: target.getAttribute('data-state'),"
  + "disabled: target.getAttribute('disabled'), rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined } : null,"
  + "hit: hit ? { tag: hit.tagName, id: hit.id, role: hit.getAttribute('role'), text: (hit.innerText || hit.textContent || '').trim().slice(0, 80),"
  + "className: String(hit.className || ''), pointerEvents: getComputedStyle(hit).pointerEvents } : null }); })()";
const clickNextPageGroupExpression = "(() => { const controls = Array.from(document.querySelectorAll('button, a, [role=\"button\"]'));"
  + "const target = controls.find((element) => { const label = (element.getAttribute('aria-label') ?? '') + ' '"
  + "+ (element.getAttribute('title') ?? '') + ' ' + (element.textContent ?? '').trim() + ' ' + (element.innerText ?? '').trim();"
  + "const pageScope = element.closest('nav, [class*=\"page\"], [class*=\"paging\"], [class*=\"paginate\"], [class*=\"pagination\"], [class*=\"pager\"], [class*=\"edge_nav\"]');"
  + "return !(element.disabled || element.hasAttribute('disabled')) && (/(?:다음\\s*페이지\\s*그룹|next\\s*page\\s*group)/i.test(label) || (pageScope && /(?:다음|next)/i.test(label))); });"
  + "if (!(target instanceof HTMLElement)) return false; target.click(); return true; })()";
const hasNextPageGroupExpression = clickNextPageGroupExpression.replace("target.click(); return true;", "return true;");
const paginationControlsDiagnosticExpression = "JSON.stringify(Array.from(document.querySelectorAll('button, a, [role=\"button\"], [aria-label], [aria-labelledby]'))"
  + ".map(function(element) { return [element.tagName, element.getAttribute('aria-label') || '', element.getAttribute('aria-labelledby') || '', element.getAttribute('title') || '',"
  + "(element.innerText || element.textContent || '').trim(), element.getAttribute('href') || '', String(element.className || '')].join('|'); })"
  + ".filter(function(value) { return /페이지|page|next|이전|다음|group|그룹|^\\d{1,3}$/.test(value); }).slice(-80))";
const scrollToNextPageChunkExpression = "(() => { const nextY = Math.min(window.scrollY + Math.max(window.innerHeight * 3, 1200), document.documentElement.scrollHeight);"
  + "window.scrollTo(0, nextY); return { scrollHeight: document.documentElement.scrollHeight, clientHeight: window.innerHeight, scrollY: window.scrollY }; })()";
const pageTwoSelector = `(() => {
  const controls = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const pageScope = (element) => element.closest('nav, [class*="page"], [class*="paging"], [class*="paginate"], [class*="pagination"], [class*="pager"], [class*="edge_nav"]');
  const categoryId = new URL(location.href).searchParams.get('cate');
  const hrefPageTwo = controls.find((element) => {
    const href = element.getAttribute('href');
    if (!href || !pageScope(element)) return false;
    try { const url = new URL(href, location.href); return url.pathname === '/list/' && url.searchParams.get('cate') === categoryId && url.searchParams.get('page') === '2'; } catch { return false; }
  });
  if (hrefPageTwo) return hrefPageTwo;
  const byLabel = controls.find((element) => Boolean(pageScope(element)) && /(?:페이지\s*2|2\s*페이지)/i.test((element.getAttribute('aria-label') ?? '') + ' ' + (element.getAttribute('title') ?? '') + ' ' + (element.textContent ?? '').trim())
    || element.getAttribute('data-page') === '2'
    || element.getAttribute('data-page-number') === '2');
  if (byLabel) return byLabel;
  const numberedPage = controls.find((element) => {
    const text = (element.textContent ?? '').trim();
    return text === '2' && Boolean(pageScope(element));
  }) ?? null;
  if (numberedPage) return numberedPage;
  return controls.find((element) => {
    const label = (element.getAttribute('aria-label') ?? '') + ' ' + (element.getAttribute('title') ?? '') + ' ' + (element.textContent ?? '').trim();
    return Boolean(pageScope(element)) && !element.hasAttribute('disabled') && /(?:다음\s*페이지|next\s*page)/i.test(label);
  }) ?? null;
})()`;
const hasPageTwoExpression = `Boolean(${pageTwoSelector})`;
const clickPageTwoExpression = `(() => { const target = ${pageTwoSelector}; if (!(target instanceof HTMLElement)) return false; target.click(); return true; })()`;
const scrollToPageControlsExpression = `(() => { window.scrollTo(0, document.documentElement.scrollHeight); return { scrollHeight: document.documentElement.scrollHeight, clientHeight: window.innerHeight, scrollY: window.scrollY }; })()`;
const pageControlsDiagnosticExpression = `JSON.stringify((() => {
  const controls = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  return {
    title: document.title,
    bodyTail: (document.body?.innerText ?? '').slice(-500),
    bodyMentionsMore: /더보기|다음|페이지/i.test(document.body?.innerText ?? ''),
    interactiveControls: controls.filter((element) => {
      const label = element.getAttribute('aria-label') ?? '';
      const text = (element.textContent ?? '').trim();
      const className = String(element.className ?? '');
      return /페이지|page|더보기|다음|이전|load more|paginat|pager/i.test(label + ' ' + text + ' ' + className) || /^\d{1,2}$/.test(text);
    }).slice(0, 100).map((element) => {
      const href = element.getAttribute('href');
      let listTarget;
      try {
        const url = href ? new URL(href, location.href) : undefined;
        if (url?.origin === location.origin && url.pathname === '/list/') listTarget = { category: url.searchParams.get('cate'), page: url.searchParams.get('page') };
      } catch { /* omit non-URL hrefs */ }
      return { tag: element.tagName, label: element.getAttribute('aria-label'), text: (element.textContent ?? '').trim().slice(0, 40), className: String(element.className ?? '').slice(0, 100), testId: element.getAttribute('data-testid'), dataPage: element.getAttribute('data-page'), listTarget };
    })
  };
})())`;
function robotsDisallows(robots: string, path: string) {
  let wildcardGroup = false;
  let groupHasRules = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (groupHasRules) { wildcardGroup = false; groupHasRules = false; }
      if (!groupHasRules) wildcardGroup = value === "*";
      continue;
    }
    if (key === "allow" || key === "disallow") {
      groupHasRules = true;
      if (wildcardGroup && key === "disallow" && value && path.startsWith(value)) return true;
    }
  }
  return false;
}
async function preflightPublicListPolicy() {
  const response = await fetch("https://prod.danawa.com/robots.txt", {
    headers: { "user-agent": "PCSupporterCatalogResearch/1.0 (public list inventory; project: PC Supporter)" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (response.status === 403 || response.status === 429) throw new Error(`STOP: robots.txt returned HTTP ${response.status}`);
  if (!response.ok) throw new Error(`Could not verify Danawa robots.txt: HTTP ${response.status}`);
  const robots = await response.text();
  if (robotsDisallows(robots, "/list/")) throw new Error("STOP: robots.txt disallows the public list page.");
  lastSourceRequest = Date.now();
}
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
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 90 || products.length > pageSize) throw new Error(`Unsafe page size ${pageSize} / ${products.length}.`);
  if (new Set(products.map(p => p.productCode)).size !== products.length) throw new Error(`Duplicate product code inside page ${requested}.`);
  if (Number.isInteger(totalPages) && totalPages > 0 && requested > totalPages) throw new Error(`Response page ${requested} exceeds totalPages ${totalPages}.`);
  const expectedRows = Number.isInteger(totalCount) && totalCount >= 0 && Number.isInteger(pageSize) && pageSize > 0 && Number.isInteger(totalPages) && requested <= totalPages
    ? Math.min(pageSize, Math.max(0, totalCount - ((requested - 1) * pageSize)))
    : undefined;
  return { page: requested, pageSize, parserVersion: 4, ...(expectedRows !== undefined && products.length !== expectedRows ? { rowCountMismatch: { expected: expectedRows, received: products.length } } : {}), ...(Number.isInteger(totalPages) && totalPages > 0 ? { totalPages } : {}), ...(Number.isInteger(totalCount) && totalCount >= 0 ? { totalCount } : {}),
    products, codes: products.map(p => p.productCode), fetchedAt: new Date().toISOString() };
}
async function atomicSave(snapshot: Snapshot, path = OUTPUT) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

async function atomicSaveSortSupplement(category: AccessoryCategory, categoryId: string, sortMethod: string, page: Page, requestShape: unknown, requestEvidence: { httpStatus?: number; contentType?: string }) {
  type SupplementalPage = Page & {
    sortMethod: string;
    sourcePath: "/list/";
    requestMethod: "POST";
    responseStatus?: number;
    responseContentType?: string;
    uiRequestShape?: unknown;
  };
  type SupplementalSnapshot = {
    schemaVersion: 1;
    source: "robots-allowed Danawa accessory list UI sort pages";
    updatedAt: string;
    categories: Record<string, {
      category: AccessoryCategory;
      categoryId: string;
      pagesBySort: Record<string, Record<string, SupplementalPage>>;
    }>;
  };
  let snapshot: SupplementalSnapshot;
  try { snapshot = JSON.parse(await readFile(SORT_SUPPLEMENT_OUTPUT, "utf8")) as SupplementalSnapshot; }
  catch {
    snapshot = { schemaVersion: 1, source: "robots-allowed Danawa accessory list UI sort pages", updatedAt: new Date().toISOString(), categories: {} };
  }
  if (snapshot.schemaVersion !== 1 || snapshot.source !== "robots-allowed Danawa accessory list UI sort pages") {
    throw new Error("Unsupported Danawa accessory sort supplement schema or source.");
  }
  const categorySnapshot = snapshot.categories[categoryId] ?? (snapshot.categories[categoryId] = { category, categoryId, pagesBySort: {} });
  const sortPages = categorySnapshot.pagesBySort[sortMethod] ?? (categorySnapshot.pagesBySort[sortMethod] = {});
  sortPages[String(page.page)] = {
    ...page,
    sortMethod,
    sourcePath: "/list/",
    requestMethod: "POST",
    ...(requestEvidence.httpStatus !== undefined ? { responseStatus: requestEvidence.httpStatus } : {}),
    ...(requestEvidence.contentType ? { responseContentType: requestEvidence.contentType } : {}),
    ...(requestShape ? { uiRequestShape: requestShape } : {})
  };
  snapshot.updatedAt = new Date().toISOString();
  await mkdir(join(ROOT, "data"), { recursive: true });
  const temp = SORT_SUPPLEMENT_OUTPUT + "." + process.pid + ".tmp";
  await writeFile(temp, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, SORT_SUPPLEMENT_OUTPUT);
}
async function atomicSaveSortSupplementRange(category: AccessoryCategory, categoryId: string, sortMethod: string, pages: Array<{ page: Page; requestEvidence: { httpStatus?: number; contentType?: string } }>, requestShape: unknown) {
  type SupplementalPage = Page & {
    sortMethod: string;
    sourcePath: "/list/";
    requestMethod: "POST";
    responseStatus?: number;
    responseContentType?: string;
    uiRequestShape?: unknown;
  };
  type SupplementalSnapshot = {
    schemaVersion: 1;
    source: "robots-allowed Danawa accessory list UI sort pages";
    updatedAt: string;
    categories: Record<string, {
      category: AccessoryCategory;
      categoryId: string;
      pagesBySort: Record<string, Record<string, SupplementalPage>>;
    }>;
  };
  let snapshot: SupplementalSnapshot;
  try { snapshot = JSON.parse(await readFile(SORT_SUPPLEMENT_OUTPUT, "utf8")) as SupplementalSnapshot; }
  catch {
    snapshot = { schemaVersion: 1, source: "robots-allowed Danawa accessory list UI sort pages", updatedAt: new Date().toISOString(), categories: {} };
  }
  if (snapshot.schemaVersion !== 1 || snapshot.source !== "robots-allowed Danawa accessory list UI sort pages") {
    throw new Error("Unsupported Danawa accessory sort supplement schema or source.");
  }
  const categorySnapshot = snapshot.categories[categoryId] ?? (snapshot.categories[categoryId] = { category, categoryId, pagesBySort: {} });
  if (categorySnapshot.category !== category || categorySnapshot.categoryId !== categoryId) throw new Error("Sort supplement category identity changed before range persistence.");
  const sortPages = categorySnapshot.pagesBySort[sortMethod] ?? (categorySnapshot.pagesBySort[sortMethod] = {});
  for (const { page, requestEvidence } of pages) {
    sortPages[String(page.page)] = {
      ...page,
      sortMethod,
      sourcePath: "/list/",
      requestMethod: "POST",
      ...(requestEvidence.httpStatus !== undefined ? { responseStatus: requestEvidence.httpStatus } : {}),
      ...(requestEvidence.contentType ? { responseContentType: requestEvidence.contentType } : {}),
      ...(requestShape ? { uiRequestShape: requestShape } : {})
    };
  }
  snapshot.updatedAt = new Date().toISOString();
  await mkdir(join(ROOT, "data"), { recursive: true });
  const temp = SORT_SUPPLEMENT_OUTPUT + "." + process.pid + ".tmp";
  await writeFile(temp, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, SORT_SUPPLEMENT_OUTPUT);
}
async function atomicSaveBundleMembersRange(category: AccessoryCategory, categoryId: string, pages: BundlePageObservation[]) {
  let artifact: BundleMembersArtifact;
  try {
    artifact = JSON.parse(await readFile(BUNDLE_MEMBERS_OUTPUT, "utf8")) as BundleMembersArtifact;
  } catch {
    artifact = emptyBundleMembersArtifact();
  }
  if (artifact.schemaVersion !== 1 || artifact.source !== BUNDLE_MEMBERS_SOURCE || !artifact.categories || typeof artifact.categories !== "object") {
    throw new Error("Unsupported Danawa accessory bundle member artifact schema or source.");
  }
  const priorCategory = artifact.categories[categoryId];
  if (priorCategory && (priorCategory.category !== category || priorCategory.categoryId !== categoryId)) {
    throw new Error("Bundle member artifact category identity mismatch.");
  }
  let next = artifact;
  for (const page of pages) next = mergeBundlePageObservation(next, category, categoryId, page);
  next.updatedAt = new Date().toISOString();
  await mkdir(join(ROOT, "data"), { recursive: true });
  const temp = BUNDLE_MEMBERS_OUTPUT + "." + process.pid + ".tmp";
  await writeFile(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, BUNDLE_MEMBERS_OUTPUT);
}
type Capture = { url: string; body: string; headers: Record<string, string>; page: number; requestShape?: ReturnType<typeof safeRequestShape> };
function safeRequestShape(request: any) {
  const raw = typeof request.postData === "string" ? request.postData : "";
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  const actionFields: Array<{ key: string; value: string | number }> = [];
  const walk = (value: unknown, prefix = "", depth = 0) => {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) { value.slice(0, 10).forEach((child, index) => walk(child, `${prefix}[${index}]`, depth + 1)); return; }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (/(?:page|cate|category|offset|limit|cursor|sort|order|start|end|position|after|before)/i.test(key) && (typeof child === "number" || typeof child === "string")) {
        const stringValue = String(child);
        const showValue = typeof child === "number"
          || (/^(?:page|cate|category|offset|limit|pageSize)$/i.test(key) && /^\d{1,16}$/.test(stringValue))
          || (/^(?:sort|sortType|sortMethod|order|orderBy)$/i.test(key) && stringValue.length <= 40);
        actionFields.push({ key: path, value: showValue ? typeof child === "number" ? child : stringValue : `string-length:${stringValue.length}` });
      }
      walk(child, path, depth + 1);
    }
  };
  walk(parsed);
  const headers = request.headers as Record<string, unknown>;
  const contentTypeKey = Object.keys(headers).find((key) => key.toLowerCase() === "content-type");
  return {
    contentType: contentTypeKey ? String(headers[contentTypeKey]).slice(0, 80) : undefined,
    bodyLength: raw.length,
    bodyType: Array.isArray(parsed) ? "array" : parsed && typeof parsed === "object" ? "object" : raw ? "non-json" : "empty",
    bodyKeys: parsed && !Array.isArray(parsed) && typeof parsed === "object" ? Object.keys(parsed as Record<string, unknown>).slice(0, 20) : undefined,
    arrayItemKeys: Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" ? Object.keys(parsed[0] as Record<string, unknown>).slice(0, 20) : undefined,
    actionFields: actionFields.slice(0, 20)
  };
}
async function bootstrap(categoryId: string, targetPage = 2, sortMethod?: string, pageSize = 30): Promise<{ capture: Capture; html: string }> {
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
    let targetPageClickIssued = false;
    let pageGroupPostAllowedUntil = 0;
    let sortChangePostAllowedUntil = 0;
    let pageSizeChangePostAllowedUntil = 0;
    let initialUiListRequestAllowed = false;
    let sortPostAllowedForSelection = false;
    let pageSizePostAllowedForSelection = false;
    let pageSizePagePostAllowed = false;
    let pageSizeDisplayPostAllowed = false;
    const sortRequestObserved: Array<Record<string, unknown>> = [];
    const initialUiListRequestObserved: Array<Record<string, unknown>> = [];
    const pageSizeRequestObserved: Array<Record<string, unknown>> = [];
    const targetPageObserved: Array<Record<string, unknown>> = [];
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
      const pageAction = Array.isArray(parsed) ? parsed.find((entry: any) => entry && Number(entry.page) === targetPage && String(entry.categoryCode) === categoryId.slice(3)) : undefined;
      if (targetPageClickIssued && u.hostname === "prod.danawa.com" && targetPageObserved.length < 10) {
        const action = Array.isArray(parsed) ? parsed.find((entry: any) => entry && String(entry.categoryCode) === categoryId.slice(3)) : undefined;
        targetPageObserved.push({
          path: u.pathname,
          method: request.method,
          resourceType,
          categoryQuery: u.searchParams.get("cate"),
          pageQuery: u.searchParams.get("page"),
          matchingActionPage: action?.page,
          nextActionPresent: Object.keys(request.headers).some(key => key.toLowerCase() === "next-action"),
          requestShape: safeRequestShape(request),
          blockedByPublicPathPolicy: forbidden
        });
      }
      const hasNextAction = Object.keys(request.headers).some(key => key.toLowerCase() === "next-action");
      if (!capture && sameList && request.method === "POST" && pageAction && hasNextAction) capture = { url: request.url, body: request.postData ?? "", headers: { ...request.headers }, page: targetPage, requestShape: safeRequestShape(request) };
      const hasSelectedCategoryAction = Array.isArray(parsed) && parsed.some((entry: any) => entry && String(entry.categoryCode) === categoryId.slice(3) && Number.isSafeInteger(Number(entry.page)));
      const uiListAction = Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === "object" ? parsed[0] : undefined;
      const productCodeList = uiListAction?.productCodeList;
      const productCodeListValid = Array.isArray(productCodeList)
        ? productCodeList.length > 0 && productCodeList.length <= 100 && productCodeList.every((code: unknown) => /^\d{1,16}$/.test(String(code)))
        : typeof productCodeList === "string" && productCodeList.length <= 1_700 && /^\d{1,16}(?:,\d{1,16}){0,99}$/.test(productCodeList);
      const uiListActionShape = uiListAction && productCodeListValid
        && typeof uiListAction.viewMethod === "string" && uiListAction.viewMethod.length <= 32
        && (typeof uiListAction.physicsCate1 === "string" || Number.isSafeInteger(uiListAction.physicsCate1))
        && (typeof uiListAction.physicsCate2 === "string" || Number.isSafeInteger(uiListAction.physicsCate2))
        && Object.prototype.hasOwnProperty.call(uiListAction, "group");
      const productCodeListCount = Array.isArray(productCodeList)
        ? productCodeList.length
        : typeof productCodeList === "string" && productCodeList.length > 0 ? productCodeList.split(",").length : 0;
      const isUiInitialListPost = sameList && request.method === "POST" && hasNextAction && !initialUiListRequestAllowed
        && !targetPageClickIssued && uiListActionShape && uiListAction.sortMethod === "BEST";
      if (Date.now() <= pageSizeChangePostAllowedUntil && sameList && request.method === "POST" && pageSizeRequestObserved.length < 12) {
        pageSizeRequestObserved.push({
          hasNextAction,
          uiListActionShape: Boolean(uiListActionShape),
          sortMethod: uiListAction?.sortMethod,
          listCount: uiListAction?.listCount,
          productCodeListType: Array.isArray(productCodeList) ? "array" : typeof productCodeList,
          productCodeListLength: Array.isArray(productCodeList) ? productCodeList.length : typeof productCodeList === "string" ? productCodeList.length : undefined,
          requestShape: safeRequestShape(request)
        });
      }
      if (sameList && request.method === "POST" && hasNextAction && uiListAction && initialUiListRequestObserved.length < 12) {
        initialUiListRequestObserved.push({
          sortMethod: uiListAction.sortMethod,
          uiListActionShape: Boolean(uiListActionShape),
          initialUiListRequestAllowed,
          isUiInitialListPost,
          productCodeListType: Array.isArray(productCodeList) ? "array" : typeof productCodeList,
          productCodeListLength: Array.isArray(productCodeList) ? productCodeList.length : typeof productCodeList === "string" ? productCodeList.length : undefined,
          productCodeListSample: typeof productCodeList === "string" ? productCodeList.slice(0, 120).replace(/[^\d,]/g, "?") : undefined,
          productCodeListCommaCount: typeof productCodeList === "string" ? (productCodeList.match(/,/g) ?? []).length : undefined
        });
      }
      const requestedSortAction = uiListActionShape && sortMethod && uiListAction?.sortMethod === sortMethod ? uiListAction : undefined;
      const isUiSortPost = sameList && request.method === "POST" && hasNextAction && requestedSortAction !== undefined
        && Date.now() <= sortChangePostAllowedUntil && !sortPostAllowedForSelection;
      const requestedPageSizeAction = uiListActionShape && Number(uiListAction?.listCount) === pageSize ? uiListAction : undefined;
      const isUiPageSizePost = sameList && request.method === "POST" && hasNextAction && requestedPageSizeAction !== undefined
        && Date.now() <= pageSizeChangePostAllowedUntil && !pageSizePostAllowedForSelection;
      const categoryPageAction = Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === "object" ? parsed[0] : undefined;
      const isUiPageSizePagePost = pageSize > 30 && sameList && request.method === "POST" && hasNextAction && !pageSizePagePostAllowed
        && Date.now() <= pageSizeChangePostAllowedUntil && String(categoryPageAction?.categoryCode) === categoryId.slice(3)
        && Number(categoryPageAction?.page) === 1 && Number(categoryPageAction?.listCount) === pageSize
        && String(categoryPageAction?.sortMethod) === "BEST";
      const isUiPageSizeDisplayPost = pageSize > 30 && sameList && request.method === "POST" && hasNextAction && !pageSizeDisplayPostAllowed
        && Date.now() <= pageSizeChangePostAllowedUntil && pageSizePagePostAllowed && uiListActionShape
        && String(uiListAction?.sortMethod) === "BEST" && productCodeListCount === pageSize;
      const isUiPaginationPost = sameList && request.method === "POST" && hasNextAction && hasSelectedCategoryAction
        && ((targetPageClickIssued && pageAction) || Date.now() <= pageGroupPostAllowedUntil);
      const allow = !forbidden && (isStatic || rootDoc || (sameList && request.method === "GET") || isUiInitialListPost || isUiSortPost || isUiPageSizePost || isUiPageSizePagePost || isUiPageSizeDisplayPost || isUiPaginationPost);
      if (allow && isUiInitialListPost) initialUiListRequestAllowed = true;
      if (allow && isUiSortPost) sortPostAllowedForSelection = true;
      if (allow && isUiPageSizePost) pageSizePostAllowedForSelection = true;
      if (allow && isUiPageSizePagePost) {
        pageSizePagePostAllowed = true;
        pageSizePostAllowedForSelection = true;
        initialUiListRequestAllowed = true;
      }
      if (allow && isUiPageSizeDisplayPost) {
        pageSizeDisplayPostAllowed = true;
        pageSizePostAllowedForSelection = true;
      }
      if (Date.now() <= sortChangePostAllowedUntil && sameList && sortRequestObserved.length < 10) {
        const sortAction = Array.isArray(parsed) ? parsed.find((entry: any) => entry && String(entry.categoryCode) === categoryId.slice(3)) : undefined;
        sortRequestObserved.push({ path: u.pathname, method: request.method, resourceType, categoryQuery: u.searchParams.get("cate"),
          pageQuery: u.searchParams.get("page"), matchingActionPage: sortAction?.page, hasNextAction, sameList, forbidden, allowed: allow,
          requestedSort: sortMethod, isUiInitialListPost, isUiSortPost, uiListAction: uiListAction ? {
            keys: Object.keys(uiListAction), sortMethod: uiListAction.sortMethod,
            productCodeListType: Array.isArray(uiListAction.productCodeList) ? "array" : typeof uiListAction.productCodeList,
            productCodeListLength: Array.isArray(uiListAction.productCodeList) ? uiListAction.productCodeList.length : undefined,
            viewMethodType: typeof uiListAction.viewMethod, physicsCate1Type: typeof uiListAction.physicsCate1,
            physicsCate2Type: typeof uiListAction.physicsCate2, hasGroup: Object.prototype.hasOwnProperty.call(uiListAction, "group")
          } : undefined, requestShape: safeRequestShape(request) });
      }
      if (allow && u.hostname === "prod.danawa.com" && u.pathname === "/list/") { const gap = Math.max(0, MIN_DELAY_MS - (Date.now() - lastSourceRequest)); if (gap) { setTimeout(() => ws?.send(JSON.stringify({ id: ++id, method: "Fetch.continueRequest", params: { requestId } })), gap); lastSourceRequest = Date.now() + gap; return; } lastSourceRequest = Date.now(); }
      ws!.send(JSON.stringify({ id: ++id, method: allow ? "Fetch.continueRequest" : "Fetch.failRequest", params: allow ? { requestId } : { requestId, errorReason: "BlockedByClient" } }));
    };
    const cdp = (method: string, params: object = {}) => new Promise<any>(resolveCdp => { const callId = ++id; pending.set(callId, resolveCdp); ws!.send(JSON.stringify({ id: callId, method, params })); });
    const evaluate = async (expression: string) => {
      const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Chrome public-list UI evaluation failed: " + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "unknown evaluation error") + " expression=" + expression);
      return result.result?.value;
    };
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await cdp("Page.navigate", { url: `https://prod.danawa.com/list/?cate=${categoryId}` });
    const listDeadline = Date.now() + 15_000;
    while (!(await evaluate(hasLoadedCategoryProductsExpression)) && Date.now() < listDeadline) await wait(100);
    if (!(await evaluate(hasLoadedCategoryProductsExpression))) {
      throw new Error("The public category list did not finish loading its products before pagination. " + String(await evaluate(paginationControlsDiagnosticExpression)).slice(0, 9000));
    }
    if (pageSize !== 30) {
      const currentPageSize = JSON.parse(String(await evaluate(pageSizeStateExpression) ?? "null")) as { value?: string } | null;
      if (currentPageSize?.value !== String(pageSize)) {
        pageSizeChangePostAllowedUntil = Date.now() + 10_000;
        pageSizePostAllowedForSelection = false;
        let point = await evaluate(pageSizeSelectPointExpression) as { x: number; y: number; currentValue: string; options: string[] } | null;
        const pageSizeControlDeadline = Date.now() + 10_000;
        while (!point && Date.now() < pageSizeControlDeadline) {
          await wait(100);
          point = await evaluate(pageSizeSelectPointExpression) as { x: number; y: number; currentValue: string; options: string[] } | null;
        }
        if (!point) throw new Error(`Could not locate the visible page-size control for ${pageSize} items. ` + String(await evaluate(pageSizeControlDiagnosticExpression)).slice(0, 4000));
        const currentOptionIndex = point.options.indexOf(point.currentValue);
        const requestedOptionIndex = point.options.indexOf(String(pageSize));
        if (currentOptionIndex < 0 || requestedOptionIndex < 0) throw new Error(`The page-size control does not offer ${pageSize} items. ` + JSON.stringify({ current: point.currentValue, options: point.options }));
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
        await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
        await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
        const direction = requestedOptionIndex > currentOptionIndex ? "ArrowDown" : "ArrowUp";
        const virtualKeyCode = direction === "ArrowDown" ? 40 : 38;
        for (let step = 0; step < Math.abs(requestedOptionIndex - currentOptionIndex); step += 1) {
          await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: direction, code: direction, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
          await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: direction, code: direction, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
        }
        await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        const initialUiRequestDeadline = Date.now() + 5_000;
        while (!pageSizePostAllowedForSelection && !initialUiListRequestAllowed && Date.now() < initialUiRequestDeadline) await wait(100);
        if (!pageSizePostAllowedForSelection && initialUiListRequestAllowed) {
          // A cold page can use the first select interaction to hydrate its
          // default 30-item list. Let that response settle, then use the same
          // visible select's change event to choose the requested larger page.
          await wait(750);
          const settledPageSize = JSON.parse(String(await evaluate(pageSizeStateExpression) ?? "null")) as { value?: string } | null;
          if (settledPageSize?.value !== String(pageSize)) {
            pageSizeChangePostAllowedUntil = Date.now() + 10_000;
            pageSizePostAllowedForSelection = false;
            pageSizePagePostAllowed = false;
            pageSizeDisplayPostAllowed = false;
            const retriedSelection = JSON.parse(String(await evaluate(setPageSizeExpression(pageSize)))) as { found?: boolean; value?: string; available?: string[] };
            if (!retriedSelection.found || retriedSelection.value !== String(pageSize)) {
              throw new Error(`The public list UI did not keep ${pageSize} items selected after initial hydration. ` + JSON.stringify({ retriedSelection, pageSizeState: await evaluate(pageSizeStateExpression) }));
            }
          }
        }
        const pageSizeRequestDeadline = Date.now() + 10_000;
        while (!pageSizePostAllowedForSelection && Date.now() < pageSizeRequestDeadline) await wait(100);
        if (!pageSizePostAllowedForSelection) {
          throw new Error(`The public list UI did not issue its bounded ${pageSize}-item request. ` + JSON.stringify({ pageSizeState: await evaluate(pageSizeStateExpression), initialUiListRequests: initialUiListRequestObserved, pageSizeRequests: pageSizeRequestObserved }));
        }
        const pageSizeRenderDeadline = Date.now() + 15_000;
        let pageSizeRowsReady = await evaluate(hasVisiblePageSizeRowsExpression(pageSize));
        while (!pageSizeRowsReady && Date.now() < pageSizeRenderDeadline) {
          await wait(100);
          pageSizeRowsReady = await evaluate(hasVisiblePageSizeRowsExpression(pageSize));
        }
        pageSizeChangePostAllowedUntil = 0;
        if (!pageSizeRowsReady) {
          throw new Error(`The public list UI selected ${pageSize} items per page but did not render that page size. ` + JSON.stringify({ pageSizeState: await evaluate(pageSizeStateExpression), diagnostic: await evaluate(paginationControlsDiagnosticExpression) }));
        }
      }
    }
    if (sortMethod) {
      let sortPoint = await evaluate(sortButtonPointExpression(sortMethod));
      const sortButtonDeadline = Date.now() + 10_000;
      while (!sortPoint && Date.now() < sortButtonDeadline) {
        await wait(100);
        sortPoint = await evaluate(sortButtonPointExpression(sortMethod));
      }
      if (!sortPoint) throw new Error("Could not locate the requested public list sort option. " + JSON.stringify({ diagnostic: await evaluate(sortButtonDiagnosticExpression(sortMethod)), initialUiListRequests: initialUiListRequestObserved }));
      // The list hydrates incrementally and can move controls after the first
      // geometry read. Recalculate the actionable point immediately before the
      // trusted mouse input so a zero-sized placeholder is never clicked.
      sortPoint = await evaluate(sortButtonPointExpression(sortMethod));
      if (!sortPoint) throw new Error("The requested public list sort option is not visibly clickable yet. " + String(await evaluate(sortButtonDiagnosticExpression(sortMethod))));
      sortPostAllowedForSelection = false;
      const dispatchSortClick = async (point: { x: number; y: number }) => {
        sortPoint = point;
        sortChangePostAllowedUntil = Date.now() + 10_000;
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
        await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
        await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
        const sortDeadline = Date.now() + 5_000;
        let selected = await evaluate(sortSelectedExpression(sortMethod));
        while (!selected && Date.now() < sortDeadline) {
          await wait(100);
          selected = await evaluate(sortSelectedExpression(sortMethod));
        }
        return selected;
      };
      let sortSelected = await dispatchSortClick(sortPoint);
      // On a cold client the first click can release its pending BEST list
      // hydration request. Once that first same-category request completes,
      // click the requested sort again so its own UI request is captured.
      if (!sortSelected && initialUiListRequestAllowed && !sortPostAllowedForSelection) {
        await wait(750);
        const retryPoint = await evaluate(sortButtonPointExpression(sortMethod));
        if (retryPoint) sortSelected = await dispatchSortClick(retryPoint);
      }
      sortChangePostAllowedUntil = 0;
      if (!sortSelected) {
        const state = String(await evaluate(sortStateExpression(sortMethod)));
        const hitTest = String(await evaluate(sortHitTestExpression(sortMethod, sortPoint)));
        throw new Error("The public list UI did not confirm the requested sort option. " + JSON.stringify({ state, hitTest, initialUiListRequests: initialUiListRequestObserved, observedRequests: sortRequestObserved }));
      }
    }
    const deadline = Date.now() + 20_000;
    let nextScrollAt = 0;
    while (Date.now() < deadline) {
      const ready = await evaluate(hasPageTwoExpression) && await evaluate(hasNextPageGroupExpression);
      if (ready) break;
      if (Date.now() >= nextScrollAt) {
        await evaluate(scrollToNextPageChunkExpression);
        nextScrollAt = Date.now() + 750;
      }
      await wait(100);
    }
    html = String(await evaluate("document.documentElement.outerHTML") ?? "");
    const ready = await evaluate(hasPageTwoExpression) && await evaluate(hasNextPageGroupExpression);
    if (!ready) {
      const bodyText = String(await evaluate("document.body?.innerText ?? ''") ?? "");
      if (/접근이 제한|비정상적인 접근|자동입력 방지|보안문자|로봇이 아닙니다|captcha|잠시 후 다시/i.test(bodyText)) throw new Error("STOP: browser bootstrap returned a challenge/access-denied page.");
      const diagnostic = await evaluate(pageControlsDiagnosticExpression);
      throw new Error("Initial category page did not expose pagination controls within 20 seconds. Safe UI diagnostic: " + String(diagnostic).slice(0, 3000) + " Pagination controls: " + String(await evaluate(paginationControlsDiagnosticExpression)).slice(0, 9000));
    }
    let targetPageReady = await evaluate(hasPageExpression(targetPage));
    const maxPageGroupSteps = Math.floor((targetPage - 1) / 10);
    for (let step = 0; step < maxPageGroupSteps && !targetPageReady; step += 1) {
      pageGroupPostAllowedUntil = Date.now() + 5_000;
      const moved = await evaluate(clickNextPageGroupExpression);
      if (!moved) {
        pageGroupPostAllowedUntil = 0;
        throw new Error("Could not advance the page-number group in the public list UI. " + String(await evaluate(paginationControlsDiagnosticExpression)).slice(0, 9000));
      }
      const groupDeadline = Date.now() + 4_000;
      while (!targetPageReady && Date.now() < groupDeadline) {
        await wait(100);
        targetPageReady = await evaluate(hasPageExpression(targetPage));
      }
      pageGroupPostAllowedUntil = 0;
    }
    if (!targetPageReady) throw new Error("The public list UI did not expose the requested page number.");
    targetPageClickIssued = true;
    const clicked = await evaluate(clickPageExpression(targetPage));
    if (!clicked) throw new Error("Requested page control disappeared before it could be activated.");
    const captureDeadline = Date.now() + 10_000;
    while (!capture && Date.now() < captureDeadline) await wait(100);
    if (!capture) throw new Error("Could not capture the requested same-category page UI request. Observed safe request metadata: " + JSON.stringify(targetPageObserved));
    return { capture, html };
  } finally { try { ws?.close(); } catch {} try { chrome.kill("SIGTERM"); } catch {} await wait(250); const { rm } = await import("node:fs/promises"); await rm(profile, { recursive: true, force: true }); }
}
async function bootstrapWithTransientRetries(categoryId: string, targetPage = 2, sortMethod?: string, pageSize = 30) {
  const retryLimit = accessoryMode ? 0 : 2;
  for (let attempt = 0; ; attempt += 1) {
    try { return await bootstrap(categoryId, targetPage, sortMethod, pageSize); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = message.includes("did not expose the page 2 control") || message.includes("Could not capture the same-category page 2 UI request");
      if (!retryable || attempt >= retryLimit) throw error;
      await wait(MIN_DELAY_MS);
    }
  }
}
function requestTemplate(capture: Capture, page: number, category: Category) {
  assertSameCategory(capture.url, category.categoryId);
  const body = JSON.parse(capture.body);
  const action = Array.isArray(body) ? body.find((x: any) => x && Number(x.page) === capture.page) : undefined;
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
async function fetchPage(capture: Capture, category: Category, page: number, includeBundleProducts = false) {
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
    const metadataCandidates: Record<"totalCount" | "totalPages", Array<{ path: string; value: number }>> = { totalCount: [], totalPages: [] };
    const collectMetadata = (value: unknown, path: string, depth: number) => {
      if (depth > 6 || value === null || typeof value !== "object") return;
      if (Array.isArray(value)) { value.slice(0, 100).forEach((child, index) => collectMetadata(child, `${path}[${index}]`, depth + 1)); return; }
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if ((key === "totalCount" || key === "totalPages") && typeof child === "number" && Number.isFinite(child)) {
          const candidates = metadataCandidates[key];
          if (candidates.length < 12) candidates.push({ path: `${path}.${key}`, value: child });
        }
        collectMetadata(child, `${path}.${key}`, depth + 1);
      }
    };
    collectMetadata(action, "action", 0);
    const dataPath = action.data && typeof action.data === "object" ? "action.data" : "action";
    const selectedCountSource = data.totalCount !== undefined && data.totalCount !== null
      ? { path: `${dataPath}.totalCount`, value: Number(data.totalCount) }
      : metadataCandidates.totalCount[0];
    const selectedPagesSource = data.totalPages !== undefined && data.totalPages !== null
      ? { path: `${dataPath}.totalPages`, value: Number(data.totalPages) }
      : metadataCandidates.totalPages[0];
    const safeCategory = (value: unknown): unknown => {
      if (typeof value === "string" || typeof value === "number") return String(value).slice(0, 100);
      if (!value || typeof value !== "object" || Array.isArray(value)) return value === undefined ? "missing" : typeof value;
      const record = value as Record<string, unknown>;
      const allowedKeys = ["code", "categoryCode", "id", "name", "label", "value", "displayName", "path", "parentCode", "parentName"];
      const fields: Record<string, unknown> = Object.fromEntries(allowedKeys.flatMap((key) => {
        const field = record[key];
        return typeof field === "string" || typeof field === "number" ? [[key, String(field).slice(0, 100)]] : [];
      }));
      for (const key of ["codes", "names"]) {
        const values = record[key];
        if (Array.isArray(values)) {
          fields[key] = values.slice(0, 12).flatMap((item) =>
            typeof item === "string" ? [item.slice(0, 200)] : typeof item === "number" ? [item] : []
          );
        }
      }
      return Object.keys(fields).length ? fields : { objectKeys: Object.keys(record).slice(0, 20) };
    };
    const categoryCounts = new Map<string, { category: unknown; count: number }>();
    for (const rawProduct of data.products as unknown[]) {
      if (!rawProduct || typeof rawProduct !== "object") continue;
      const rawCategory = (rawProduct as Record<string, unknown>).category;
      const categoryValue = safeCategory(rawCategory);
      const key = JSON.stringify(categoryValue);
      const row = categoryCounts.get(key) ?? { category: categoryValue, count: 0 };
      row.count += 1;
      categoryCounts.set(key, row);
    }
    const firstProductCategories = (data.products as unknown[]).slice(0, 3).flatMap((rawProduct) => {
      if (!rawProduct || typeof rawProduct !== "object") return [];
      const sourceProduct = rawProduct as Record<string, unknown>;
      const productCode = String(sourceProduct.productCode ?? sourceProduct.pcode ?? sourceProduct.code ?? "");
      return /^\d{5,16}$/.test(productCode) ? [{ productCode, category: safeCategory(sourceProduct.category) }] : [];
    });
    const safePublicCode = (value: unknown): string | number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.length <= 100 && /^[\w.-]+$/.test(value)) return value;
      return null;
    };
    const bundleDictionaryCodeTypeCounts = new Map<string, number>();
    const bundleDictionaryCodeValueCounts = new Map<string, number>();
    const bundleProductListTypeCounts = new Map<string, number>();
    const bundleProductListLengthCounts = new Map<string, number>();
    const countNestedBundleCodes = (value: unknown, depth = 0): number => {
      if (depth > 5 || value === null || typeof value !== "object") return 0;
      if (Array.isArray(value)) return value.slice(0, 100).reduce((total, item) => total + countNestedBundleCodes(item, depth + 1), 0);
      let count = 0;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (/bundle.*code/i.test(key) && safePublicCode(child) !== null) count += 1;
        else count += countNestedBundleCodes(child, depth + 1);
      }
      return count;
    };
    for (const rawProduct of data.products as unknown[]) {
      if (!rawProduct || typeof rawProduct !== "object") continue;
      const sourceProduct = rawProduct as Record<string, unknown>;
      const dictionaryCode = sourceProduct.bundleDictionaryCode;
      const dictionaryType = dictionaryCode === null ? "null" : typeof dictionaryCode;
      bundleDictionaryCodeTypeCounts.set(dictionaryType, (bundleDictionaryCodeTypeCounts.get(dictionaryType) ?? 0) + 1);
      const publicDictionaryCode = safePublicCode(dictionaryCode);
      if (publicDictionaryCode !== null) {
        const code = String(publicDictionaryCode);
        bundleDictionaryCodeValueCounts.set(code, (bundleDictionaryCodeValueCounts.get(code) ?? 0) + 1);
      }
      const bundleProductList = sourceProduct.bundleProductList;
      const listType = bundleProductList === null ? "null" : Array.isArray(bundleProductList) ? "array" : typeof bundleProductList;
      bundleProductListTypeCounts.set(listType, (bundleProductListTypeCounts.get(listType) ?? 0) + 1);
      if (Array.isArray(bundleProductList)) {
        const length = String(bundleProductList.length);
        bundleProductListLengthCounts.set(length, (bundleProductListLengthCounts.get(length) ?? 0) + 1);
      }
    }
    const firstProductBundleGroups = (data.products as unknown[]).slice(0, 3).flatMap((rawProduct) => {
      if (!rawProduct || typeof rawProduct !== "object") return [];
      const sourceProduct = rawProduct as Record<string, unknown>;
      const productCode = String(sourceProduct.productCode ?? sourceProduct.pcode ?? sourceProduct.code ?? "");
      if (!/^\d{5,16}$/.test(productCode)) return [];
      const groupIdFields = ["groupID", "groupId", "productGroupID", "productGroupId"];
      const groupIdField = groupIdFields.find((key) => safePublicCode(sourceProduct[key]) !== null);
      return [{
        productCode,
        groupId: groupIdField ? safePublicCode(sourceProduct[groupIdField]) : null,
        groupIdField: groupIdField ?? null,
        nestedBundleCodeCount: countNestedBundleCodes(sourceProduct.bundleProductList)
      }];
    });
    const collectBundleProductCodes = (value: unknown, depth = 0): string[] => {
      if (depth > 5 || value === null || typeof value !== "object") return [];
      if (Array.isArray(value)) return value.slice(0, 100).flatMap((item) => collectBundleProductCodes(item, depth + 1));
      const codes: string[] = [];
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (["productCode", "pcode", "pCode", "product_code"].includes(key)) {
          const code = String(child ?? "");
          if (/^\d{5,16}$/.test(code)) codes.push(code);
        } else {
          codes.push(...collectBundleProductCodes(child, depth + 1));
        }
      }
      return codes;
    };
    const firstBundleMemberships = (data.products as unknown[]).flatMap((rawProduct) => {
      if (!rawProduct || typeof rawProduct !== "object") return [];
      const sourceProduct = rawProduct as Record<string, unknown>;
      const productCode = String(sourceProduct.productCode ?? sourceProduct.pcode ?? sourceProduct.code ?? "");
      const bundleProductList = sourceProduct.bundleProductList;
      if (!/^\d{5,16}$/.test(productCode) || !Array.isArray(bundleProductList) || bundleProductList.length === 0) return [];
      const membershipProductCodes = [...new Set(collectBundleProductCodes(bundleProductList))].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
      const firstEntry = bundleProductList[0];
      const firstEntryRecord = firstEntry && typeof firstEntry === "object" && !Array.isArray(firstEntry) ? firstEntry as Record<string, unknown> : undefined;
      const firstEntryKeys = firstEntryRecord ? Object.keys(firstEntryRecord).slice(0, 40) : [];
      const firstEntryScalarFieldTypes = firstEntryRecord
        ? Object.fromEntries(Object.entries(firstEntryRecord).flatMap(([key, value]) =>
          value === null || ["string", "number", "boolean"].includes(typeof value) ? [[key, value === null ? "null" : typeof value]] : []
        ).slice(0, 40))
        : {};
      const parentCodeField = firstEntryRecord
        ? ["parentCode", "parentProductCode", "baseProductCode", "representativeParentCode"].find((key) => /^\d{5,16}$/.test(String(firstEntryRecord[key] ?? "")))
        : undefined;
      return [{
        parentProductCode: productCode,
        bundleProductListLength: bundleProductList.length,
        firstEntryKeys,
        firstEntryScalarFieldTypes,
        membershipProductCodes: membershipProductCodes.slice(0, 20),
        membershipProductCodeCount: membershipProductCodes.length,
        membershipProductCodesTruncated: membershipProductCodes.length > 20,
        parentCodeIncluded: membershipProductCodes.includes(productCode),
        representativeParentCode: parentCodeField ? String(firstEntryRecord![parentCodeField]) : null,
        representativeParentCodeField: parentCodeField ?? null
      }];
    }).slice(0, 3);
    console.log(JSON.stringify({ rscFieldShape: {
      productKeys: Object.keys(product),
      productNameShape: shape(product.productName),
      nameShape: shape(product.name),
      categoryShape: shape(product.category),
      descriptionShape: shape(product.description),
      specShape: shape(product.spec),
      priceShape: shape(product.price),
      totalCountSelectedSource: selectedCountSource,
      totalCountCandidates: metadataCandidates.totalCount,
      totalPagesSelectedSource: selectedPagesSource,
      totalPagesCandidates: metadataCandidates.totalPages,
      productCategoryValueCounts: [...categoryCounts.values()],
      firstProductCategories,
      bundleDictionaryCodeTypeCounts: Object.fromEntries(bundleDictionaryCodeTypeCounts),
      bundleDictionaryCodeExamples: [...bundleDictionaryCodeValueCounts].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([code, count]) => ({ code, count })),
      bundleProductListTypeCounts: Object.fromEntries(bundleProductListTypeCounts),
      bundleProductListLengthCounts: Object.fromEntries(bundleProductListLengthCounts),
      firstProductBundleGroups,
      firstBundleMemberships
    } }));
  }
  const result = pageFromAction(action, page);
  return {
    ...result,
    _requestEvidence: { httpStatus: response.status, contentType: type, cookiePresent: request.cookiePresent, nextActionPresent: request.nextActionPresent },
    ...(includeBundleProducts ? { _rawBundleProducts: data.products as unknown[] } : {})
  };
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
function pagesWithRepeatedProductCodes(pages: Record<string, Page>) {
  const seen = new Set<string>();
  const repeatedPages = new Set<string>();
  for (const [pageKey, page] of Object.entries(pages).sort(([left], [right]) => Number(left) - Number(right))) {
    for (const code of page.codes) {
      if (seen.has(code)) repeatedPages.add(pageKey);
      else seen.add(code);
    }
  }
  return repeatedPages;
}
function needsRefresh(page: Page | undefined) {
  return Boolean(page && (page.parserVersion !== 4 || page.rowCountMismatch || page.products.some(product => !product.name || product.name === "[object Object]" || product.spec === "[object Object]")));
}

const captureOnly = args.has("--capture-only") || capturePage !== undefined || captureRangeArgument !== undefined;
if ([...args].some((argument) => argument !== "--prototype" && argument !== "--all" && argument !== "--accessory" && argument !== "--capture-only" && argument !== "--persist-capture" && argument !== "--persist-bundles" && !argument.startsWith("--category=") && !argument.startsWith("--capture-page=") && !argument.startsWith("--capture-range=") && !argument.startsWith("--sort=") && !argument.startsWith("--page-size="))) {
  throw new Error("Allowed options: --prototype (default), --all, --accessory, --category=ACCESSORY_CATEGORY, --capture-only, --capture-page=PAGE, --capture-range=START:END, --sort=BEST|LOW_PRICE|HIGH_PRICE|NEW|REVIEW, --page-size=30|60|90, --persist-capture, --persist-bundles.");
}
if (![30, 60, 90].includes(selectedPageSize)) throw new Error("--page-size must be 30, 60, or 90.");
if (args.has("--prototype") && args.has("--all")) throw new Error("Choose one run mode.");
if (selectedAccessoryCategory && !accessoryMode) throw new Error("--category requires --accessory.");
if (capturePage !== undefined && (!Number.isInteger(capturePage) || capturePage < 2 || capturePage > 1000)) throw new Error("--capture-page must be an integer from 2 to 1000.");
if (captureRangeArgument !== undefined && (!captureRange || !Number.isInteger(captureRange.start) || !Number.isInteger(captureRange.end) || captureRange.start < 1 || captureRange.end < captureRange.start || captureRange.end > 1000 || captureRange.end - captureRange.start + 1 > 1000)) throw new Error("--capture-range must be an inclusive START:END range with 1 <= START <= END <= 1000 and no more than 1000 pages.");
if (capturePage !== undefined && !accessoryMode) throw new Error("--capture-page currently requires --accessory.");
if (captureRange !== undefined && !accessoryMode) throw new Error("--capture-range currently requires --accessory.");
if (captureOnly && (!accessoryMode || !selectedAccessoryCategory || args.has("--all"))) throw new Error("Page capture requires --accessory --category=... and cannot be combined with --all.");
if (args.has("--capture-only") && (capturePage !== undefined || captureRange !== undefined)) throw new Error("Choose --capture-only, --capture-page=PAGE, or --capture-range=START:END.");
if (capturePage !== undefined && captureRange !== undefined) throw new Error("Choose --capture-page=PAGE or --capture-range=START:END.");
if (selectedSort && !["BEST", "LOW_PRICE", "HIGH_PRICE", "NEW", "REVIEW"].includes(selectedSort)) throw new Error("--sort must be BEST, LOW_PRICE, HIGH_PRICE, NEW, or REVIEW.");
if (selectedSort && !captureOnly) throw new Error("--sort requires --capture-only or --capture-page=PAGE.");
if (captureRange !== undefined && !selectedSort) throw new Error("--capture-range requires an explicit --sort.");
if (persistCapture && ((capturePage === undefined && captureRange === undefined) || !selectedSort)) throw new Error("--persist-capture requires --capture-page=PAGE or --capture-range=START:END and an explicit --sort.");
if (persistBundles && (captureRange === undefined || !selectedSort)) throw new Error("--persist-bundles requires --capture-range=START:END and an explicit --sort.");
if (accessoryMode && selectedAccessoryCategory && !DANAWA_ACCESSORY_CATEGORIES.some((category) => category.category === selectedAccessoryCategory)) {
  throw new Error(`Unknown Danawa accessory category: ${selectedAccessoryCategory}`);
}
const mode = args.has("--all") ? "all" : "prototype";
await preflightPublicListPolicy();
const targets: Category[] = accessoryMode
  ? DANAWA_ACCESSORY_CATEGORIES
    .filter((category) => !selectedAccessoryCategory || category.category === selectedAccessoryCategory)
    .map((category) => ({ category: category.category, categoryId: category.categoryId, label: ACCESSORY_CATEGORY_LABELS[category.category], root: true }))
  : JSON.parse(await readFile(TARGETS, "utf8")) as Category[];
const roots = accessoryMode ? targets : targets.filter((target) => ROOT_IDS.has(target.categoryId));
if (!accessoryMode && (roots.length !== 10 || new Set(roots.map((target) => target.category)).size !== 9)) {
  throw new Error("PC9 root category manifest did not match the expected nine logical categories across ten listing roots.");
}
if (accessoryMode && roots.length !== (selectedAccessoryCategory ? 1 : DANAWA_ACCESSORY_CATEGORIES.length)) {
  throw new Error("Danawa accessory target manifest did not match the selected accessory categories.");
}
if (captureOnly) {
  const target = roots[0];
  const targetPage = captureRange ? 2 : capturePage ?? 2;
  const { capture, html } = await bootstrapWithTransientRetries(target.categoryId, targetPage, selectedSort, selectedPageSize);
  const pageOne = parseDanawaPublicListPage(html, target.categoryId, 1);
  if (captureRange) {
    if (!Number.isInteger(pageOne.totalPages) || pageOne.totalPages < 1 || captureRange.end > pageOne.totalPages) {
      throw new Error(`Capture range ends at ${captureRange.end}, beyond or without a valid public UI totalPages value (${pageOne.totalPages}).`);
    }
    const existingAccessoryRows = JSON.parse(await readFile(resolve(ROOT, "data/accessories.json"), "utf8")) as Array<{ sourceProductCode?: string }>;
    const existingAccessoryCodes = new Set(existingAccessoryRows.flatMap((item) => item.sourceProductCode ? [item.sourceProductCode] : []));
    const capturedPages: Array<{ page: Page; requestEvidence: { httpStatus?: number; contentType?: string } }> = [];
    const capturedBundlePages: BundlePageObservation[] = [];
    let expectedTotalPages: number | undefined;
    let expectedTotalCount: number | undefined;
    for (let pageNumber = captureRange.start; pageNumber <= captureRange.end; pageNumber += 1) {
      const captured = await fetchPage(capture, target, pageNumber, persistBundles);
      const { _requestEvidence, _rawBundleProducts, ...page } = captured;
      if (_requestEvidence.httpStatus !== 200 || !_requestEvidence.contentType?.includes("text/x-component")) throw new Error(`Page ${pageNumber} lacks successful public UI response evidence.`);
      if (page.pageSize !== selectedPageSize || page.rowCountMismatch || page.products.length !== Math.min(selectedPageSize, Math.max(0, (page.totalCount ?? 0) - ((pageNumber - 1) * selectedPageSize)))) {
        throw new Error(`Page ${pageNumber} does not contain its exact expected ${selectedPageSize}-row result.`);
      }
      if (page.totalCount === undefined || page.totalPages === undefined) throw new Error(`Page ${pageNumber} lacks total count/page metadata.`);
      if (expectedTotalPages === undefined) {
        expectedTotalPages = page.totalPages;
        expectedTotalCount = page.totalCount;
        if (expectedTotalPages !== Math.ceil(expectedTotalCount / selectedPageSize)) throw new Error(`Source totalPages ${expectedTotalPages} does not match totalCount/pageSize ${expectedTotalCount}/${selectedPageSize}.`);
      } else if (page.totalPages !== expectedTotalPages || page.totalCount !== expectedTotalCount) {
        throw new Error(`Source totals changed while capturing page ${pageNumber}.`);
      }
      capturedPages.push({ page, requestEvidence: _requestEvidence });
      const newToLocalCount = page.products.filter((product) => !existingAccessoryCodes.has(product.productCode)).length;
      let bundleProgress: Record<string, number> | undefined;
      if (persistBundles) {
        const bundlePage = createBundlePageObservation({
          category: target.category as AccessoryCategory,
          categoryId: target.categoryId,
          page: page.page,
          pageSize: page.pageSize,
          totalPages: page.totalPages!,
          totalCount: page.totalCount!,
          fetchedAt: page.fetchedAt,
          sortMethod: selectedSort!,
          requestEvidence: {
            sourcePath: "/list/",
            requestMethod: "POST",
            responseStatus: _requestEvidence.httpStatus!,
            responseContentType: _requestEvidence.contentType!
          },
          products: _rawBundleProducts ?? []
        });
        capturedBundlePages.push(bundlePage);
        bundleProgress = {
          parentsWithMembers: bundlePage.parents.filter((parent) => parent.bundleProductListLength > 0).length,
          observedMemberRows: bundlePage.parents.reduce((count, parent) => count + parent.bundleProductListLength, 0),
          validMemberPCodeRows: bundlePage.parents.reduce((count, parent) => count + parent.members.length, 0),
          unresolvedMemberRows: bundlePage.unresolvedMemberCount
        };
      }
      console.log(JSON.stringify({ category: target.category, sortMethod: selectedSort, page: pageNumber, codeCount: page.codes.length, newToLocalCount, ...(bundleProgress ? { bundleProgress } : {}) }));
    }
    if (persistCapture) await atomicSaveSortSupplementRange(target.category as AccessoryCategory, target.categoryId, selectedSort!, capturedPages, capture.requestShape);
    if (persistBundles) await atomicSaveBundleMembersRange(target.category as AccessoryCategory, target.categoryId, capturedBundlePages);
    const memberCodes = new Set(capturedBundlePages.flatMap((page) => page.parents.flatMap((parent) => parent.members.map((member) => member.memberProductCode))));
    const bundleParentCount = capturedBundlePages.reduce((count, page) => count + page.parentProductCount, 0);
    const unresolvedMemberCount = capturedBundlePages.reduce((count, page) => count + page.unresolvedMemberCount, 0);
    console.log(JSON.stringify({
      mode: persistBundles || persistCapture ? "capture-range-persisted" : "capture-range-read-only",
      category: target.category,
      categoryId: target.categoryId,
      sortMethod: selectedSort,
      pageSize: selectedPageSize,
      requestedRange: captureRange,
      totalPages: expectedTotalPages,
      totalCount: expectedTotalCount,
      pagesCaptured: capturedPages.length,
      codeCount: capturedPages.reduce((count, item) => count + item.page.codes.length, 0),
      ...(persistBundles ? {
        bundleParentsObserved: bundleParentCount,
        uniqueBundleMemberPCodeCount: memberCodes.size,
        unresolvedBundleMemberCount: unresolvedMemberCount,
        bundleMembersWritten: true,
        bundleMembersPath: BUNDLE_MEMBERS_OUTPUT
      } : { bundleMembersWritten: false }),
      newToLocalCount: capturedPages.reduce((count, item) => count + item.page.products.filter((product) => !existingAccessoryCodes.has(product.productCode)).length, 0),
      pageOne: { source: pageOne.source, currentPage: pageOne.currentPage, totalPages: pageOne.totalPages, totalProductCount: pageOne.totalProductCount, pageSize: pageOne.pageSize },
      outputWritten: persistCapture,
      ...(persistCapture ? { supplementalSourcePath: SORT_SUPPLEMENT_OUTPUT } : {}),
      ...(persistCapture ? { supplementalPagesWritten: capturedPages.length } : {})
    }, null, 2));
    await new Promise<void>((resolveFlush) => process.stdout.write("", resolveFlush));
    process.exit(0);
  }
  const captured = await fetchPage(capture, target, targetPage);
  const { _requestEvidence, ...page } = captured;
  if (persistCapture && page.rowCountMismatch) throw new Error("Refusing to persist a page whose source row count does not match the declared total.");
  const existingAccessoryRows = JSON.parse(await readFile(resolve(ROOT, "data/accessories.json"), "utf8")) as Array<{ sourceProductCode?: string }>;
  const existingAccessoryCodes = new Set(existingAccessoryRows.flatMap((item) => item.sourceProductCode ? [item.sourceProductCode] : []));
  const newToLocalProducts = page.products.filter((product) => !existingAccessoryCodes.has(product.productCode));
  if (persistCapture) await atomicSaveSortSupplement(target.category, target.categoryId, selectedSort!, page, capture.requestShape, _requestEvidence);
  console.log(JSON.stringify({
    mode: "capture-page-read-only",
    category: target.category,
    categoryId: target.categoryId,
    requestedPage: targetPage,
    sortMethod: selectedSort ?? "BEST",
    pageOne: {
      source: pageOne.source,
      currentPage: pageOne.currentPage,
      totalPages: pageOne.totalPages,
      totalProductCount: pageOne.totalProductCount,
      pageSize: pageOne.pageSize,
      parsedProductCount: pageOne.items.length,
      firstProductCodes: pageOne.items.slice(0, 5).map((item) => item.sourceProductCode)
    },
    uiRequest: capture.requestShape,
    capturedPage: {
      page: page.page,
      pageSize: page.pageSize,
      totalPages: page.totalPages,
      totalCount: page.totalCount,
      rowCountMismatch: page.rowCountMismatch,
      codeCount: page.codes.length,
      codes: page.codes,
      firstProducts: page.products.slice(0, 5).map(({ productCode, name }) => ({ productCode, name })),
      newToLocalProducts,
      fetchedAt: page.fetchedAt
    },
    requestEvidence: _requestEvidence,
    credentialsObservedButNotStored: {
      cookiePresent: Boolean(capture.headers.cookie ?? capture.headers.Cookie),
      nextActionPresent: Boolean(capture.headers["Next-Action"] ?? capture.headers["next-action"])
    },
    outputWritten: persistCapture,
    ...(persistCapture ? { supplementalSourcePath: SORT_SUPPLEMENT_OUTPUT } : {})
  }, null, 2));
  await new Promise<void>((resolveFlush) => process.stdout.write("", resolveFlush));
  process.exit(0);
}
let snapshot: Snapshot;
try { snapshot = JSON.parse(await readFile(OUTPUT, "utf8")) as Snapshot; } catch {
  snapshot = {
    schemaVersion: 1,
    source: accessoryMode ? "robots-allowed Danawa public accessory list pages" : "danawa public product listing pages",
    updatedAt: new Date().toISOString(),
    categories: {}
  };
}
if (!accessoryMode && snapshot.categories["11236855"] && snapshot.categories["11236855"].status !== "complete") {
  snapshot.categories["11236855"].status = "partial-capped-repeat";
  snapshot.categories["11236855"].error = "Broad cooler root repeats the same 30 product codes from page 67 onward; excluded from logical cooler completeness. Use roots 11336857 and 11336856.";
  updateCategoryMetrics(snapshot.categories["11236855"]);
}
const run = mode === "prototype"
  ? accessoryMode
    ? roots.slice(0, 1).map((target) => ({ ...target, pages: [1, 2] }))
    : [{ category: "cpu", categoryId: "112747", label: "CPU root", pages: [1, 2, 3] }, { category: "gpu", categoryId: "112753", label: "GPU root", pages: [1, 2] }, { category: "cooler", categoryId: "11336857", label: "CPU cooler air", pages: [1] }, { category: "cooler", categoryId: "11336856", label: "CPU cooler liquid", pages: [1] }]
  : roots.map((target) => ({ ...target, pages: [] as number[] }));
let activeOutput = OUTPUT;
let stagedRecrawlCategories: string[] = [];
if (mode === "all" && pageSizeArgument !== undefined) {
  const categoriesNeedingRecrawl = run.flatMap((target) => {
    const state = snapshot.categories[target.categoryId];
    const previousPageSizes = new Set(Object.values(state?.pages ?? {}).map((page) => page.pageSize));
    return previousPageSizes.size > 0 && !previousPageSizes.has(selectedPageSize) ? [target.categoryId] : [];
  });
  if (categoriesNeedingRecrawl.length > 0) {
    const backupPath = join(tmpdir(), `danawa-accessory-pages-before-size-${selectedPageSize}-${Date.now()}.json`);
    const stagingPath = join(tmpdir(), `danawa-accessory-pages-size-${selectedPageSize}-stage-${Date.now()}.json`);
    try {
      await copyFile(OUTPUT, backupPath);
      console.log(JSON.stringify({ action: "recrawl-page-size-change", backupPath, stagingPath, categories: categoriesNeedingRecrawl, pageSize: selectedPageSize }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    activeOutput = stagingPath;
    stagedRecrawlCategories = categoriesNeedingRecrawl;
    for (const categoryId of categoriesNeedingRecrawl) {
      const state = snapshot.categories[categoryId];
      state.pages = {};
      state.status = "in-progress";
      delete state.error;
      delete state.duplicateProductCodes;
      delete state.listedProductCount;
      delete state.uniqueProductCount;
    }
  }
}
try {
  for (const target of run) {
    const category: Category = { category: target.category, categoryId: target.categoryId, label: target.label, root: true };
    const state = snapshot.categories[category.categoryId] ?? (snapshot.categories[category.categoryId] = { category: category.category, categoryId: category.categoryId, label: category.label, pages: {}, status: "in-progress" });
    if (!target.pages.length && state.status === "complete" && !Object.values(state.pages).some(needsRefresh)) continue;
    state.status = "in-progress";
    delete state.error;
    if (state.pages["1"] && state.pages["1"].codes.length !== state.pages["1"].pageSize) delete state.pages["1"];
    await atomicSave(snapshot, activeOutput);
    const { capture, html } = await bootstrapWithTransientRetries(category.categoryId, 2, undefined, selectedPageSize);
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
      await atomicSave(snapshot, activeOutput);
      console.log(JSON.stringify({ category: category.category, categoryId: category.categoryId, page: 1, codeCount: savedPage.codes.length, firstCodes: savedPage.codes.slice(0, 5), pageSize: savedPage.pageSize, totalPages: savedPage.totalPages, sourceStatus: _requestEvidence.httpStatus, contentType: _requestEvidence.contentType, cookieAndNextActionPresent: _requestEvidence.cookiePresent && _requestEvidence.nextActionPresent }));
    }
    let maxPage: number | undefined = Object.values(state.pages).map(p => p.totalPages).find((x): x is number => typeof x === "number");
    const knownTotal = Object.values(state.pages).map(p => p.totalCount).find((x): x is number => typeof x === "number");
    if (maxPage && knownTotal !== undefined) {
      for (const [pageKey, page] of Object.entries(state.pages)) {
        const pageNo = Number(pageKey);
        const expected = Math.min(page.pageSize, Math.max(0, knownTotal - (pageNo - 1) * page.pageSize));
        const persistedMismatchMatches = page.rowCountMismatch?.expected === expected && page.rowCountMismatch.received === page.codes.length;
        if (pageNo <= maxPage && page.codes.length !== expected && !persistedMismatchMatches) throw new Error(`Saved page ${pageNo} has ${page.codes.length} products; expected ${expected}.`);
        page.totalPages ??= maxPage;
        page.totalCount ??= knownTotal;
      }
      await atomicSave(snapshot, activeOutput);
    }
    updateCategoryMetrics(state);
    const pageNumbers = mode === "all" ? (maxPage ? Array.from({ length: maxPage }, (_, i) => i + 1) : (() => { throw new Error("Could not determine the category's exact last page; refusing unbounded enumeration."); })()) : target.pages;
    const repeatedPageKeys = pagesWithRepeatedProductCodes(state.pages);
    for (const pageNo of pageNumbers.filter(n => n > 1)) {
      if (state.pages[String(pageNo)] && !needsRefresh(state.pages[String(pageNo)]) && !repeatedPageKeys.has(String(pageNo))) continue;
      const result = await fetchPage(capture, category, pageNo);
      const { _requestEvidence, ...page } = result;
      maxPage = page.totalPages ?? maxPage;
      const totalCount = page.totalCount ?? state.pages["1"]?.totalCount;
      const expectedRows = totalCount !== undefined ? Math.min(page.pageSize, Math.max(0, totalCount - ((pageNo - 1) * page.pageSize))) : (maxPage && pageNo < maxPage ? page.pageSize : undefined);
      if (expectedRows === undefined) throw new Error(`Cannot verify exact row count for page ${pageNo}; refusing to checkpoint it.`);
      if (page.codes.length !== expectedRows) page.rowCountMismatch = { expected: expectedRows, received: page.codes.length };
      state.pages[String(pageNo)] = { ...page, ...(page.totalPages === undefined && maxPage ? { totalPages: maxPage } : {}), ...(page.totalCount === undefined && totalCount !== undefined ? { totalCount } : {}) };
      updateCategoryMetrics(state);
      await atomicSave(snapshot, activeOutput);
      console.log(JSON.stringify({ category: category.category, categoryId: category.categoryId, page: pageNo, codeCount: page.codes.length, firstCodes: page.codes.slice(0, 5), pageSize: page.pageSize, totalPages: page.totalPages, ...(page.rowCountMismatch ? { rowCountMismatch: page.rowCountMismatch } : {}), sourceStatus: _requestEvidence.httpStatus, contentType: _requestEvidence.contentType, cookieAndNextActionPresent: _requestEvidence.cookiePresent && _requestEvidence.nextActionPresent }));
      if (page.rowCountMismatch) break;
    }
    if (mode === "all") {
      const expectedPages = maxPage ? Array.from({ length: maxPage }, (_, index) => String(index + 1)) : [];
      const countMismatchPages = expectedPages.flatMap((pageKey) => {
        const page = state.pages[pageKey];
        return page?.rowCountMismatch ? [{ page: page.page, ...page.rowCountMismatch }] : [];
      });
      if (countMismatchPages.length > 0) {
        state.status = "partial-count-mismatch";
        const pageDetails = countMismatchPages.map(page => `page ${page.page}: received ${page.received}, expected ${page.expected}`).join("; ");
        const repeatedCodes = state.duplicateProductCodes?.length ?? 0;
        state.error = `${pageDetails}; ${repeatedCodes} product codes repeat across pages. Captured rows are retained, but this category remains partial.`;
        await atomicSave(snapshot, activeOutput);
        console.log(JSON.stringify({ category: category.category, categoryId: category.categoryId, status: state.status, savedPages: Object.keys(state.pages).map(Number).sort((a,b) => a-b), listedProducts: state.listedProductCount, uniqueCodes: state.uniqueProductCount, repeatedProductCodeCount: repeatedCodes, countMismatchPages }));
        continue;
      }
      if (!expectedPages.length || expectedPages.some(page => !state.pages[page])) throw new Error("Cannot mark category complete: one or more expected pages are missing.");
      for (const pageKey of expectedPages) {
        const page = state.pages[pageKey];
        const expectedRows = page.totalCount !== undefined ? Math.min(page.pageSize, Math.max(0, page.totalCount - (page.page - 1) * page.pageSize)) : undefined;
        if (expectedRows === undefined || page.codes.length !== expectedRows) throw new Error(`Cannot mark category complete: page ${pageKey} does not have its exact expected row count.`);
      }
      if ((state.duplicateProductCodes?.length ?? 0) > 0) {
        state.status = "partial-capped-repeat";
        state.error = `All ${expectedPages.length} source pages were captured, but ${state.duplicateProductCodes!.length} product codes repeat across pages. Keep this category partial until unique source membership is verified.`;
      } else state.status = "complete";
    }
    else state.status = "prototype-complete";
    await atomicSave(snapshot, activeOutput);
      console.log(JSON.stringify({ category: category.category, categoryId: category.categoryId, status: state.status, savedPages: Object.keys(state.pages).map(Number).sort((a,b) => a-b), listedProducts: state.listedProductCount, uniqueCodes: state.uniqueProductCount, duplicateCodeCount: state.duplicateProductCodes?.length ?? 0, duplicateCodeSamples: state.duplicateProductCodes?.slice(0, 10) ?? [] }));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const active = run.find(target => snapshot.categories[target.categoryId]?.status === "in-progress" || snapshot.categories[target.categoryId]?.status === "prototype-approved-all-mode-running");
  if (active) { snapshot.categories[active.categoryId].status = "stopped"; snapshot.categories[active.categoryId].error = message; await atomicSave(snapshot, activeOutput); }
  console.error(JSON.stringify({ status: message.startsWith("Error: STOP:") || message.startsWith("STOP:") ? "source-blocked-stop" : "failed-stop", error: message }));
  process.exitCode = 1;
}
if (stagedRecrawlCategories.length > 0) {
  const statuses = stagedRecrawlCategories.map((categoryId) => ({ categoryId, status: snapshot.categories[categoryId]?.status, uniqueCodes: snapshot.categories[categoryId]?.uniqueProductCount }));
  if (process.exitCode !== 1 && statuses.every((category) => category.status === "complete")) {
    await atomicSave(snapshot, OUTPUT);
    console.log(JSON.stringify({ action: "recrawl-committed", pageSize: selectedPageSize, categories: statuses, sourcePath: OUTPUT }));
  } else {
    console.log(JSON.stringify({ action: "recrawl-staged-only", pageSize: selectedPageSize, categories: statuses, stagingPath: activeOutput }));
    process.exitCode = 1;
  }
}
