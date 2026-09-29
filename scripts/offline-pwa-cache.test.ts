import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { offlinePrecacheUrlsFromViteManifest, offlineServiceWorkerForBuild } from "./offline-pwa-cache";

const workerTemplate = readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8");
const buildRevision = "123e4567-e89b-42d3-a456-426614174000";
const catalogRevision = "catalog-0-4ecaecc34937e837";

describe("local-offline PWA cache contract", () => {
  it("precaches every output file, including lazy chunks, with the installed catalog", () => {
    const urls = offlinePrecacheUrlsFromViteManifest({
      "index.html": {
        file: "index.html",
        isEntry: true,
        imports: ["_react-vendor.js"],
        css: ["assets/index-a1.css"],
        assets: ["assets/logo.svg"]
      },
      "_react-vendor.js": { file: "assets/react-b2.js" },
      "src/HomeView.tsx": { file: "assets/HomeView-c3.js", isDynamicEntry: true },
      "src/AdminView.tsx": { file: "assets/AdminView-d4.js", isDynamicEntry: true }
    });

    expect(urls).toEqual(expect.arrayContaining([
      "/",
      "/index.html",
      "/offline-catalog.json",
      "/assets/index-a1.css",
      "/assets/logo.svg",
      "/assets/react-b2.js",
      "/assets/HomeView-c3.js",
      "/assets/AdminView-d4.js"
    ]));
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some((url) => url.startsWith("https:"))).toBe(false);
  });

  it("rejects unsafe Vite manifest asset paths", () => {
    expect(() => offlinePrecacheUrlsFromViteManifest({
      "index.html": { file: "index.html" },
      bad: { file: "../outside.js" }
    })).toThrow("safe output-relative asset path");
  });

  it("renders build and catalog revisions into an isolated service-worker cache", () => {
    const precacheUrls = offlinePrecacheUrlsFromViteManifest({
      "index.html": { file: "index.html" },
      "src/main.tsx": { file: "assets/main.js" }
    });
    const rendered = offlineServiceWorkerForBuild(workerTemplate, { buildRevision, catalogRevision, precacheUrls });

    expect(rendered).toContain(`const LOCAL_OFFLINE_BUILD_REVISION = "${buildRevision}";`);
    expect(rendered).toContain(`const LOCAL_OFFLINE_CATALOG_REVISION = "${catalogRevision}";`);
    expect(rendered).toContain('const CACHE_NAME = LOCAL_OFFLINE_MODE');
    expect(rendered).toContain('pc-supporter-offline-${LOCAL_OFFLINE_BUILD_REVISION}-${LOCAL_OFFLINE_CATALOG_REVISION}');
    expect(rendered).toContain('await cache.addAll(LOCAL_OFFLINE_SHELL_URLS)');
    expect(rendered).toContain('catalog?.manifest?.revision !== LOCAL_OFFLINE_CATALOG_REVISION');
    expect(rendered).toContain('const CACHE_NAME = LOCAL_OFFLINE_MODE');
    expect(rendered).toContain('cache.match(request, { ignoreVary: true })');
    expect(rendered).toContain("/assets/main.js");
    const localInstall = rendered.slice(
      rendered.indexOf("async function installLocalOfflineCache"),
      rendered.indexOf('self.addEventListener("install"')
    );
    expect(localInstall).not.toContain("skipWaiting");
    expect(rendered).toContain(".then(() => self.skipWaiting())");
  });

  it("rejects a template that cannot be revisioned safely", () => {
    expect(() => offlineServiceWorkerForBuild(workerTemplate, {
      buildRevision: "bad",
      catalogRevision,
      precacheUrls: ["/index.html", "/offline-catalog.json"]
    })).toThrow("must be a UUID");
  });
});

type WorkerHarnessOptions = {
  catalogResponseRevision?: string;
  failAssetPath?: string;
  initialCacheNames?: string[];
};

function createWorkerHarness(workerSource: string, options: WorkerHarnessOptions = {}) {
  const origin = "https://offline.test";
  const cachesByName = new Map<string, Map<string, { requestHeaders: Headers; response: Response }>>();
  for (const name of options.initialCacheNames ?? []) cachesByName.set(name, new Map());
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const networkRequests: string[] = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;

  const absoluteRequestUrl = (request: string | URL | { url: string }) => {
    const value = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    return new URL(value, origin).href;
  };
  const requestHeaders = (request: string | URL | { url: string; headers?: HeadersInit }) => {
    if (!request || typeof request !== "object" || request instanceof URL || !("headers" in request)) return new Headers();
    return new Headers(request.headers as HeadersInit | undefined);
  };
  const fetchAsset = async (request: string | URL | { url: string }) => {
    const url = absoluteRequestUrl(request);
    const pathname = new URL(url).pathname;
    networkRequests.push(pathname);
    if (pathname === options.failAssetPath) return new Response("missing", { status: 404 });
    if (pathname === "/offline-catalog.json") {
      return new Response(JSON.stringify({ manifest: { revision: options.catalogResponseRevision ?? catalogRevision } }), {
        status: 200,
        headers: { "Content-Type": "application/json", Vary: "Origin" }
      });
    }
    if (pathname.endsWith(".js")) {
      return new Response(`const build = "${buildRevision}"; const catalog = "${catalogRevision}";`, { status: 200, headers: { Vary: "Origin" } });
    }
    return new Response(`asset:${pathname}`, { status: 200, headers: { Vary: "Origin" } });
  };

  const caches = {
    async open(name: string) {
      let entries = cachesByName.get(name);
      if (!entries) {
        entries = new Map();
        cachesByName.set(name, entries);
      }
      return {
        async addAll(requests: Array<string | URL | { url: string }>) {
          for (const request of requests) {
            const response = await fetchAsset(request);
            if (!response.ok) throw new Error("precache response failed");
            entries!.set(absoluteRequestUrl(request), { requestHeaders: requestHeaders(request), response: response.clone() });
          }
        },
        async match(request: string | URL | { url: string; headers?: HeadersInit }, matchOptions: { ignoreVary?: boolean } = {}) {
          const entry = entries!.get(absoluteRequestUrl(request));
          if (!entry) return undefined;
          if (!matchOptions.ignoreVary) {
            const varyHeaders = entry.response.headers.get("vary")?.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean) ?? [];
            const incomingHeaders = requestHeaders(request);
            if (varyHeaders.includes("*") || varyHeaders.some((name) => entry.requestHeaders.get(name) !== incomingHeaders.get(name))) return undefined;
          }
          return entry.response.clone();
        }
      };
    },
    async keys() {
      return [...cachesByName.keys()];
    },
    async delete(name: string) {
      return cachesByName.delete(name);
    },
    async match(request: string | URL | { url: string }) {
      const key = absoluteRequestUrl(request);
      for (const entries of cachesByName.values()) {
        const entry = entries.get(key);
        if (entry) return entry.response.clone();
      }
      return undefined;
    }
  };

  const workerSelf = {
    location: { origin, href: `${origin}/service-worker.js` },
    clients: { async claim() { claimCalls += 1; } },
    skipWaiting: async () => { skipWaitingCalls += 1; },
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      listeners.set(type, listener);
    }
  };

  runInNewContext(workerSource, { self: workerSelf, caches, fetch: fetchAsset, URL, Response });
  return {
    origin,
    cachesByName,
    networkRequests,
    get skipWaitingCalls() { return skipWaitingCalls; },
    get claimCalls() { return claimCalls; },
    async dispatch(type: string, event: Record<string, unknown> = {}) {
      const listener = listeners.get(type);
      if (!listener) throw new Error(`worker has no ${type} handler`);
      let pending: Promise<unknown> | undefined;
      let response: Promise<Response> | undefined;
      listener({
        ...event,
        waitUntil(value: Promise<unknown>) { pending = Promise.resolve(value); },
        respondWith(value: Promise<Response>) { response = Promise.resolve(value); }
      });
      if (pending) await pending;
      return response ? response : undefined;
    }
  };
}

function renderTestWorker(revision = catalogRevision) {
  const precacheUrls = offlinePrecacheUrlsFromViteManifest({
    "index.html": { file: "index.html" },
    "src/offline/bundled-catalog.ts": { file: "assets/offline-catalog.js" },
    "src/main.tsx": { file: "assets/main.js" }
  });
  return offlineServiceWorkerForBuild(workerTemplate, { buildRevision, catalogRevision: revision, precacheUrls });
}

describe("local-offline service worker lifecycle", () => {
  it("keeps the active revision when the candidate catalog does not match", async () => {
    const oldCache = "pc-supporter-offline-old-build-catalog-0-old";
    const harness = createWorkerHarness(renderTestWorker(), {
      catalogResponseRevision: "catalog-0-aaaaaaaaaaaaaaaa",
      initialCacheNames: [oldCache]
    });

    await expect(harness.dispatch("install")).rejects.toThrow("offline catalog revision does not match");
    expect(harness.cachesByName.has(oldCache)).toBe(true);
    expect(harness.cachesByName.has(`pc-supporter-offline-${buildRevision}-${catalogRevision}`)).toBe(false);
    expect(harness.skipWaitingCalls).toBe(0);
  });

  it("deletes a partially downloaded candidate cache when any shell asset fails", async () => {
    const oldCache = "pc-supporter-offline-old-build-catalog-0-old";
    const harness = createWorkerHarness(renderTestWorker(), {
      failAssetPath: "/assets/main.js",
      initialCacheNames: [oldCache]
    });
    const candidateCache = `pc-supporter-offline-${buildRevision}-${catalogRevision}`;

    await expect(harness.dispatch("install")).rejects.toThrow("precache response failed");
    expect(harness.cachesByName.has(oldCache)).toBe(true);
    expect(harness.cachesByName.has(candidateCache)).toBe(false);
    expect(harness.skipWaitingCalls).toBe(0);
  });

  it("precaches one matching release, waits for old clients, then removes older release caches", async () => {
    const oldOfflineCache = "pc-supporter-offline-old-build-catalog-0-old";
    const oldRemoteCache = "pc-supporter-shell-v1";
    const harness = createWorkerHarness(renderTestWorker(), {
      initialCacheNames: [oldOfflineCache, oldRemoteCache]
    });
    const currentCache = `pc-supporter-offline-${buildRevision}-${catalogRevision}`;

    await harness.dispatch("install");
    expect(harness.skipWaitingCalls).toBe(0);
    expect(harness.cachesByName.has(currentCache)).toBe(true);
    const cache = await (await cachesForHarness(harness, currentCache));
    expect(cache).toEqual(expect.arrayContaining([
      "https://offline.test/index.html",
      "https://offline.test/assets/offline-catalog.js",
      "https://offline.test/assets/main.js",
      "https://offline.test/offline-catalog.json"
    ]));

    await harness.dispatch("activate");
    expect(harness.cachesByName.has(oldOfflineCache)).toBe(false);
    expect(harness.cachesByName.has(oldRemoteCache)).toBe(false);
    expect(harness.cachesByName.has(currentCache)).toBe(true);
    expect(harness.claimCalls).toBe(1);

    const requestsBeforeCacheRead = harness.networkRequests.length;
    const cachedScript = await harness.dispatch("fetch", {
      request: { url: "https://offline.test/assets/main.js", method: "GET", mode: "script", headers: new Headers({ Origin: harness.origin }) }
    });
    expect(await cachedScript!.text()).toContain(buildRevision);
    expect(harness.networkRequests.length).toBe(requestsBeforeCacheRead);

    const cacheMiss = await harness.dispatch("fetch", {
      request: { url: "https://offline.test/not-pre-cached.js", method: "GET", mode: "script" }
    });
    expect(cacheMiss!.type).toBe("error");
    expect(harness.networkRequests.length).toBe(requestsBeforeCacheRead);
  });
});

async function cachesForHarness(harness: ReturnType<typeof createWorkerHarness>, cacheName: string) {
  const entries = harness.cachesByName.get(cacheName);
  return [...(entries?.keys() ?? [])];
}
