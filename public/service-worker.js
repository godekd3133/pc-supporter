const LOCAL_OFFLINE_BUILD_REVISION = "";
const LOCAL_OFFLINE_CATALOG_REVISION = "";
const LOCAL_OFFLINE_SHELL_URLS = [];
const LOCAL_OFFLINE_MODE = Boolean(LOCAL_OFFLINE_BUILD_REVISION || LOCAL_OFFLINE_CATALOG_REVISION || LOCAL_OFFLINE_SHELL_URLS.length);
const CACHE_NAME = LOCAL_OFFLINE_MODE
  ? `pc-supporter-offline-${LOCAL_OFFLINE_BUILD_REVISION}-${LOCAL_OFFLINE_CATALOG_REVISION}`
  : "pc-supporter-shell-v1";
const REMOTE_SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/favicon-32.png", "/apple-touch-icon.png", "/icons/icon-192.png", "/icons/icon-512.png"];
const OFFLINE_BUILD_REVISION_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const OFFLINE_CATALOG_REVISION_PATTERN = /^catalog-\d+-[a-f0-9]{16}$/;

async function installLocalOfflineCache() {
  if (!OFFLINE_BUILD_REVISION_PATTERN.test(LOCAL_OFFLINE_BUILD_REVISION)
    || !OFFLINE_CATALOG_REVISION_PATTERN.test(LOCAL_OFFLINE_CATALOG_REVISION)
    || !Array.isArray(LOCAL_OFFLINE_SHELL_URLS)
    || LOCAL_OFFLINE_SHELL_URLS.length === 0
    || !LOCAL_OFFLINE_SHELL_URLS.includes("/index.html")
    || !LOCAL_OFFLINE_SHELL_URLS.includes("/offline-catalog.json")
    || new Set(LOCAL_OFFLINE_SHELL_URLS).size !== LOCAL_OFFLINE_SHELL_URLS.length) {
    throw new Error("local-offline service worker contract is incomplete.");
  }

  const cache = await caches.open(CACHE_NAME);
  try {
    await cache.addAll(LOCAL_OFFLINE_SHELL_URLS);
    const catalogResponse = await cache.match("/offline-catalog.json");
    if (!catalogResponse) throw new Error("offline catalog was not precached.");
    const catalog = await catalogResponse.json();
    if (catalog?.manifest?.revision !== LOCAL_OFFLINE_CATALOG_REVISION) {
      throw new Error("offline catalog revision does not match the app shell.");
    }

    const scriptUrls = LOCAL_OFFLINE_SHELL_URLS.filter((url) => /\.m?js$/.test(url));
    if (scriptUrls.length === 0) throw new Error("app JavaScript was not included in the offline shell.");
    let codeHasBuildRevision = false;
    let codeHasCatalogRevision = false;
    for (const url of scriptUrls) {
      const response = await cache.match(url);
      if (!response) throw new Error(`offline app script was not precached: ${url}`);
      const source = await response.text();
      codeHasBuildRevision ||= source.includes(LOCAL_OFFLINE_BUILD_REVISION);
      codeHasCatalogRevision ||= source.includes(LOCAL_OFFLINE_CATALOG_REVISION);
    }
    if (!codeHasBuildRevision || !codeHasCatalogRevision) {
      throw new Error("offline app code revisions do not match the service worker.");
    }
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    LOCAL_OFFLINE_MODE
      ? installLocalOfflineCache()
      : caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(REMOTE_SHELL_URLS))
        .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const cachePrefixes = LOCAL_OFFLINE_MODE
    ? ["pc-supporter-offline-", "pc-supporter-shell-"]
    : ["pc-supporter-shell-"];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => cachePrefixes.some((prefix) => key.startsWith(prefix)) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (LOCAL_OFFLINE_MODE) {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => cache.match(request, { ignoreVary: true }))
        .then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") {
            return caches.open(CACHE_NAME).then((cache) => cache.match("/index.html", { ignoreVary: true })).then((index) => index || Response.error());
          }
          return Response.error();
        })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("/index.html");
        return Response.error();
      }))
  );
});
