import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const maxEntryBytes = 600_000;
const maxEntryCssBytes = 1_100_000;
const maxLazyCssBytes = 80_000;
// First-route budgets include the HTML entry plus the lazy Home route's static JS/CSS graph.
const firstRouteBudget = {
  javascript: { bytes: 850_000, gzipBytes: 220_000 },
  css: { bytes: 1_050_000, gzipBytes: 150_000 },
  total: { bytes: 1_800_000, gzipBytes: 380_000 }
};
// Lazy route/feature chunks should stay individually small enough for mobile cold loads;
// a single chunk ballooning past this budget means a new heavyweight view needs splitting.
const maxLazyChunkBytes = 160_000;
const requiredDomainChunks = ["catalog-change-domain-", "saved-build-domain-", "purchase-domain-"];
const requiredLazyRoutes = [
  { source: "src/AdminView.tsx", label: "AdminView" },
  { source: "src/HistoryView.tsx", label: "HistoryView" },
  { source: "src/PriceWatchlistView.tsx", label: "PriceWatchlistView" },
  { source: "src/SharedWatchlistView.tsx", label: "SharedWatchlistView" }
];
const appShellSource = "src/App.tsx";
const firstRouteSource = "src/HomeView.tsx";
const optionalLazyRoutes = [
  { source: "src/QuoteOnboardingView.tsx", label: "QuoteOnboardingView" }
];

function normalizeAssetPath(value) {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    throw new Error(`manifest or HTML contains an invalid asset path: ${value}`);
  }
  const normalized = decoded.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^\.\//, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error(`manifest or HTML contains an unsafe asset path: ${value}`);
  }
  return normalized;
}

function readAttributes(tag) {
  const attributes = new Map();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes.set(match[1].toLowerCase(), match[3]
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"));
  }
  return attributes;
}

function getHtmlLocalAssets(indexHtml, tagName, attributeName, predicate = () => true) {
  const assets = [];
  for (const match of indexHtml.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))) {
    const attributes = readAttributes(match[0]);
    const value = attributes.get(attributeName);
    if (value && predicate(attributes, value) && !/^[a-z][a-z\d+.-]*:/i.test(value)) {
      assets.push(normalizeAssetPath(value));
    }
  }
  return assets;
}

export function assertContentSecurityPolicy(indexHtml) {
  const cspTags = [...indexHtml.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => ({ index: match.index ?? -1, attributes: readAttributes(match[0]) }))
    .filter(({ attributes }) => attributes.get("http-equiv")?.toLowerCase() === "content-security-policy");
  if (cspTags.length !== 1) throw new Error(`index.html must contain exactly one Content-Security-Policy meta tag: found ${cspTags.length}`);
  const { index: cspIndex, attributes: cspAttributes } = cspTags[0];
  const policy = cspAttributes.get("content") ?? "";
  const firstResourceTag = [...indexHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)].find((match) => (match.index ?? -1) >= 0);
  if (firstResourceTag && cspIndex > (firstResourceTag.index ?? -1)) {
    throw new Error("Content Security Policy meta must appear before script and link resources.");
  }
  const inlineScript = indexHtml.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  if (inlineScript === undefined) throw new Error("index.html must contain the script whose SHA-256 hash is allowed by its CSP.");
  const inlineScriptHash = `sha256-${createHash("sha256").update(inlineScript).digest("base64")}`;
  const directives = new Map(policy.split(";").map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }));
  const requireDirective = (name, source) => {
    if (!directives.get(name)?.includes(source)) throw new Error(`Content Security Policy is missing ${name} ${source}.`);
  };

  requireDirective("default-src", "'none'");
  requireDirective("script-src", "'self'");
  requireDirective("script-src", `'${inlineScriptHash}'`);
  requireDirective("script-src-attr", "'none'");
  requireDirective("style-src-attr", "'unsafe-inline'");
  requireDirective("connect-src", "'self'");
  requireDirective("object-src", "'none'");
  if (directives.get("script-src")?.includes("'unsafe-inline'")) {
    throw new Error("Content Security Policy cannot enable inline scripts.");
  }
  if (directives.has("frame-ancestors")) {
    throw new Error("frame-ancestors must be delivered as an HTTP response header, not in a CSP meta tag.");
  }
  requireDirective("style-src-elem", "https://fonts.googleapis.com");
  requireDirective("font-src", "https://fonts.gstatic.com");
  requireDirective("img-src", "https://img.danawa.com");
  requireDirective("img-src", "https://img.danuri.io");
  return policy;
}

export function resolveStaticImportClosure(manifest, indexHtml) {
  const moduleScripts = getHtmlLocalAssets(indexHtml, "script", "src", (attributes) => attributes.get("type")?.toLowerCase() === "module");
  if (moduleScripts.length !== 1) {
    throw new Error(`index.html must reference exactly one local module entry: ${moduleScripts.join(", ") || "none"}`);
  }

  const entryMatches = Object.entries(manifest)
    .filter(([, record]) => typeof record?.file === "string" && normalizeAssetPath(record.file) === moduleScripts[0]);
  if (entryMatches.length !== 1) {
    throw new Error(`HTML module entry must resolve to exactly one Vite manifest record: ${moduleScripts[0]}`);
  }
  const [entryKey, entryRecord] = entryMatches[0];
  if (!entryRecord.isEntry) throw new Error(`HTML module entry is not marked isEntry in the manifest: ${entryKey}`);

  const visitedKeys = new Set();
  const visitingKeys = [];
  const javascriptFiles = new Set();
  const cssFiles = new Set(getHtmlLocalAssets(indexHtml, "link", "href", (attributes) => attributes.get("rel")?.toLowerCase().split(/\s+/).includes("stylesheet")));

  function visit(key) {
    if (visitingKeys.includes(key)) {
      throw new Error(`cyclic Vite manifest imports: ${[...visitingKeys, key].join(" -> ")}`);
    }
    if (visitedKeys.has(key)) return;
    const record = manifest[key];
    if (!record || typeof record.file !== "string") {
      throw new Error(`Vite manifest import references a missing entry: ${key}`);
    }
    visitingKeys.push(key);
    visitedKeys.add(key);
    const file = normalizeAssetPath(record.file);
    if (extname(file) === ".js" || extname(file) === ".mjs") javascriptFiles.add(file);
    for (const cssFile of record.css ?? []) cssFiles.add(normalizeAssetPath(cssFile));
    for (const importedKey of record.imports ?? []) visit(importedKey);
    visitingKeys.pop();
  }

  visit(entryKey);

  const entryStaticKeys = new Set(visitedKeys);
  const entryDynamicRouteKeys = new Set();
  for (const key of entryStaticKeys) {
    const record = manifest[key];
    for (const dynamicKey of record.dynamicImports ?? []) {
      if (!manifest[dynamicKey]) throw new Error(`Vite manifest dynamic import references a missing entry: ${dynamicKey}`);
      entryDynamicRouteKeys.add(dynamicKey);
    }
  }
  const appShellCandidates = [...entryDynamicRouteKeys].filter((key) => {
    const record = manifest[key];
    return record?.src === appShellSource || (record?.isDynamicEntry === true && /^App-[^/]+\.js$/.test(basename(record.file ?? "")));
  });
  if (appShellCandidates.length !== 1) {
    throw new Error(`the App shell must be reachable from the HTML entry's dynamic imports: ${appShellSource}`);
  }
  const [appShellKey] = appShellCandidates;
  if (manifest[appShellKey]?.isDynamicEntry !== true) {
    throw new Error(`the App shell must remain a Vite dynamic entry: ${appShellSource}`);
  }
  visit(appShellKey);
  const appShellStaticKeys = new Set(visitedKeys);
  const firstRouteDynamicKeys = new Set();
  for (const key of appShellStaticKeys) {
    const record = manifest[key];
    for (const dynamicKey of record.dynamicImports ?? []) {
      if (!manifest[dynamicKey]) throw new Error(`App shell dynamic import references a missing entry: ${dynamicKey}`);
      firstRouteDynamicKeys.add(dynamicKey);
    }
  }
  const firstRouteKey = Object.keys(manifest).find((key) => manifest[key]?.src === firstRouteSource);
  if (!firstRouteKey || !firstRouteDynamicKeys.has(firstRouteKey)) {
    throw new Error(`the first rendered route must be reachable from the App shell's dynamic imports: ${firstRouteSource}`);
  }
  if (manifest[firstRouteKey]?.isDynamicEntry !== true) {
    throw new Error(`the first rendered route must remain a Vite dynamic entry: ${firstRouteSource}`);
  }
  visit(firstRouteKey);

  const dynamicRouteKeys = new Set([...entryDynamicRouteKeys, ...firstRouteDynamicKeys]);
  for (const key of visitedKeys) {
    const record = manifest[key];
    for (const dynamicKey of record.dynamicImports ?? []) {
      if (!manifest[dynamicKey]) throw new Error(`Vite manifest dynamic import references a missing entry: ${dynamicKey}`);
      dynamicRouteKeys.add(dynamicKey);
    }
  }
  const routes = [];
  for (const route of requiredLazyRoutes) {
    const routeKey = Object.keys(manifest).find((key) => manifest[key]?.src === route.source);
    if (!routeKey) throw new Error(`required lazy route is missing from the Vite manifest: ${route.label}`);
    if (!dynamicRouteKeys.has(routeKey)) throw new Error(`required route is no longer dynamically imported from the first route: ${route.label}`);
    const routeFile = normalizeAssetPath(manifest[routeKey].file);
    const routeCssFiles = (manifest[routeKey].css ?? []).map(normalizeAssetPath);
    if (javascriptFiles.has(routeFile)) throw new Error(`lazy route entered the first-route static JS closure: ${route.label} (${routeFile})`);
    if (routeCssFiles.some((file) => cssFiles.has(file))) throw new Error(`lazy route stylesheet entered the first-route CSS closure: ${route.label}`);
    routes.push({ ...route, key: routeKey, file: routeFile, cssFiles: routeCssFiles });
  }
  for (const route of optionalLazyRoutes) {
    const routeKey = Object.keys(manifest).find((key) => manifest[key]?.src === route.source);
    if (!routeKey || !dynamicRouteKeys.has(routeKey)) continue;
    const routeFile = normalizeAssetPath(manifest[routeKey].file);
    const routeCssFiles = (manifest[routeKey].css ?? []).map(normalizeAssetPath);
    if (javascriptFiles.has(routeFile)) throw new Error(`lazy route entered the first-route static JS closure: ${route.label} (${routeFile})`);
    if (routeCssFiles.some((file) => cssFiles.has(file))) throw new Error(`lazy route stylesheet entered the first-route CSS closure: ${route.label}`);
    routes.push({ ...route, key: routeKey, file: routeFile, cssFiles: routeCssFiles });
  }

  return {
    entryKey,
    firstRouteKey,
    visitedKeys,
    javascriptFiles,
    cssFiles,
    excludedLazyRoutes: routes
  };
}

function resolveAssetOnDisk(assetDirectory, assetName) {
  const normalizedName = normalizeAssetPath(assetName);
  const assetPath = resolve(assetDirectory, normalizedName);
  const pathFromRoot = relative(resolve(assetDirectory), assetPath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`manifest asset resolves outside the build assets directory: ${assetName}`);
  }
  return assetPath;
}

async function measureAssets(assetDirectory, files) {
  const assets = [];
  for (const name of [...files].sort()) {
    const contents = await readFile(resolveAssetOnDisk(assetDirectory, name));
    assets.push({ name, bytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength });
  }
  return {
    assets,
    bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    gzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, 0)
  };
}

export async function measureStaticImportClosure({ manifest, indexHtml, assetDirectory }) {
  const closure = resolveStaticImportClosure(manifest, indexHtml);
  const [javascript, css] = await Promise.all([
    measureAssets(assetDirectory, closure.javascriptFiles),
    measureAssets(assetDirectory, closure.cssFiles)
  ]);
  return {
    entryKey: closure.entryKey,
    firstRouteKey: closure.firstRouteKey,
    staticManifestKeys: [...closure.visitedKeys].sort(),
    excludedLazyRoutes: closure.excludedLazyRoutes,
    javascript,
    css,
    total: {
      bytes: javascript.bytes + css.bytes,
      gzipBytes: javascript.gzipBytes + css.gzipBytes
    }
  };
}

export function assertNoFirstRouteOnboardingSelectors(cssAssets) {
  const offendingSelectors = new Set();
  for (const { name, contents } of cssAssets) {
    for (const match of contents.matchAll(/\.(onboarding(?:-[\w-]+)?|route-stage-start)\b/g)) {
      offendingSelectors.add(`${name}: .${match[1]}`);
    }
  }
  if (offendingSelectors.size > 0) {
    throw new Error(`first-route CSS must not contain /start-only selectors: ${[...offendingSelectors].join(", ")}`);
  }
}

function assertBudget(label, actual, limit) {
  if (actual > limit) throw new Error(`${label} exceeds ${limit} bytes: ${actual} bytes`);
}

export function assertClientShellBudget(shellBytes, budget = maxEntryBytes) {
  assertBudget("client shell", shellBytes, budget);
}

export function assertFirstRouteBudget(closure, budget = firstRouteBudget) {
  assertBudget("first-route static JS bytes", closure.javascript.bytes, budget.javascript.bytes);
  assertBudget("first-route static JS gzip bytes", closure.javascript.gzipBytes, budget.javascript.gzipBytes);
  assertBudget("first-route CSS bytes", closure.css.bytes, budget.css.bytes);
  assertBudget("first-route CSS gzip bytes", closure.css.gzipBytes, budget.css.gzipBytes);
  assertBudget("first-route total bytes", closure.total.bytes, budget.total.bytes);
  assertBudget("first-route total gzip bytes", closure.total.gzipBytes, budget.total.gzipBytes);
}

async function runBuildVerifier() {
  const buildOutputDirectory = process.env.PC_SUPPORTER_BUILD_OUT_DIR?.trim() || "dist";
  const buildRootDirectory = resolve(process.cwd(), buildOutputDirectory);
  const distDirectory = join(buildRootDirectory, "assets");
  const indexHtml = await readFile(join(buildRootDirectory, "index.html"), "utf8");
  const manifest = JSON.parse(await readFile(join(buildRootDirectory, ".vite/manifest.json"), "utf8"));
  assertContentSecurityPolicy(indexHtml);

  const fontPreconnect = indexHtml.indexOf('<link rel="preconnect" href="https://fonts.googleapis.com">');
  const fontStylesheet = indexHtml.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?');
  const fontAssetPreconnect = indexHtml.indexOf('<link rel="preconnect" href="https://fonts.gstatic.com"');
  if (fontPreconnect < 0 || fontAssetPreconnect < 0 || fontStylesheet < 0 || fontPreconnect > fontStylesheet || fontAssetPreconnect > fontStylesheet) {
    throw new Error("remote build must preconnect to Google Fonts before requesting the stylesheet from the document head.");
  }

  const assetNames = await readdir(distDirectory);

  const htmlModuleAssets = getHtmlLocalAssets(indexHtml, "script", "src", (attributes) => attributes.get("type")?.toLowerCase() === "module");
  if (htmlModuleAssets.length !== 1) {
    throw new Error(`클라이언트 HTML module entry를 정확히 1개 찾을 수 없습니다: ${htmlModuleAssets.join(", ") || "없음"}`);
  }
  const entryName = basename(htmlModuleAssets[0]);
  if (!assetNames.includes(entryName)) throw new Error(`클라이언트 HTML module entry asset을 찾을 수 없습니다: ${entryName}`);
  const entryBytes = (await stat(join(distDirectory, entryName))).size;
  const appNames = assetNames.filter((name) => /^App-[^/]+\.js$/.test(name));
  if (appNames.length > 1) {
    throw new Error(`App shell chunk를 1개 이하로 찾을 수 없습니다: ${appNames.join(", ")}`);
  }
  const shellChunks = [entryName, ...appNames];
  const shellBytes = entryBytes + (appNames[0] ? (await stat(join(distDirectory, appNames[0]))).size : 0);
  assertClientShellBudget(shellBytes);

  const cssAssetNames = assetNames.filter((name) => name.endsWith(".css"));
  const htmlStylesheets = getHtmlLocalAssets(indexHtml, "link", "href", (attributes) => attributes.get("rel")?.toLowerCase().split(/\s+/).includes("stylesheet"));
  if (htmlStylesheets.length !== 1) throw new Error(`초기 화면 CSS asset을 정확히 1개 찾을 수 없습니다: ${htmlStylesheets.join(", ") || "없음"}`);
  const entryCssName = basename(htmlStylesheets[0]);
  if (!cssAssetNames.includes(entryCssName)) throw new Error(`초기 화면 CSS asset을 찾을 수 없습니다: ${entryCssName}`);
  const entryCssBytes = (await stat(join(distDirectory, entryCssName))).size;
  if (entryCssBytes > maxEntryCssBytes) {
    throw new Error(`초기 화면 CSS가 ${maxEntryCssBytes}바이트 예산을 초과했습니다: ${entryCssName} = ${entryCssBytes}바이트`);
  }
  const lazyCssAssets = await Promise.all(cssAssetNames
    .filter((name) => name !== entryCssName)
    .map(async (name) => ({ name, bytes: (await stat(join(distDirectory, name))).size })));
  const oversizedLazyCss = lazyCssAssets.filter(({ bytes }) => bytes > maxLazyCssBytes);
  if (oversizedLazyCss.length > 0) {
    throw new Error(`지연 CSS chunk가 ${maxLazyCssBytes}바이트 예산을 초과했습니다: ${oversizedLazyCss.map(({ name, bytes }) => `${name}=${bytes}`).join(", ")}`);
  }

  const missingDomainChunks = requiredDomainChunks.filter((prefix) => !assetNames.some((name) => name.startsWith(prefix) && name.endsWith(".js")));
  if (missingDomainChunks.length > 0) {
    throw new Error(`필수 도메인 chunk가 생성되지 않았습니다: ${missingDomainChunks.join(", ")}`);
  }

  const oversizedChunks = [];
  const browserJavaScript = [];
  for (const name of assetNames) {
    if (!name.endsWith(".js")) continue;
    browserJavaScript.push(await readFile(join(distDirectory, name), "utf8"));
    if (shellChunks.includes(name) || name.startsWith("react-vendor-")) continue;
    const bytes = (await stat(join(distDirectory, name))).size;
    if (bytes > maxLazyChunkBytes) oversizedChunks.push(`${name} = ${bytes}바이트`);
  }
  if (oversizedChunks.length > 0) {
    throw new Error(`lazy chunk가 ${maxLazyChunkBytes}바이트 예산을 초과했습니다: ${oversizedChunks.join(", ")}`);
  }
  const snapshotInfo = await stat(join(buildRootDirectory, "offline-catalog.json")).catch(() => undefined);
  if (snapshotInfo) throw new Error("remote build must not contain the offline-catalog.json asset.");
  const remoteBuildMarkers = ["OFFLINE_FEATURE_UNAVAILABLE", "OFFLINE_SNAPSHOT_UNAVAILABLE", "OFFLINE_FILTER_UNAVAILABLE", "pc-supporter-offline-catalog"];
  const leakedMarkers = remoteBuildMarkers.filter((marker) => browserJavaScript.some((asset) => asset.includes(marker)));
  if (leakedMarkers.length > 0) {
    throw new Error(`remote 빌드에 로컬 전용 코드가 포함되었습니다: ${leakedMarkers.join(", ")}`);
  }

  const staticClosure = await measureStaticImportClosure({
    manifest,
    indexHtml,
    assetDirectory: buildRootDirectory
  });
  const firstRouteCssAssets = await Promise.all(staticClosure.css.assets.map(async ({ name }) => ({
    name,
    contents: await readFile(resolveAssetOnDisk(buildRootDirectory, name), "utf8")
  })));
  assertNoFirstRouteOnboardingSelectors(firstRouteCssAssets);
  assertFirstRouteBudget(staticClosure);

  console.log(JSON.stringify({
    ok: true,
    entry: entryName,
    entryBytes,
    shellChunks,
    shellBytes,
    maxShellBytes: maxEntryBytes,
    maxEntryBytes,
    entryCss: entryCssName,
    entryCssBytes,
    maxEntryCssBytes,
    lazyCssAssets,
    maxLazyCssBytes,
    requiredDomainChunks,
    maxLazyChunkBytes,
    firstRouteStaticClosure: {
      manifest: ".vite/manifest.json",
      entryKey: staticClosure.entryKey,
      firstRoute: { source: firstRouteSource, key: staticClosure.firstRouteKey },
      javascript: { ...staticClosure.javascript, budget: firstRouteBudget.javascript },
      css: { ...staticClosure.css, budget: firstRouteBudget.css },
      total: { ...staticClosure.total, budget: firstRouteBudget.total },
      excludedLazyRoutes: staticClosure.excludedLazyRoutes
    }
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runBuildVerifier();
}
