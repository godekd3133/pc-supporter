import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { offlinePrecacheUrlsFromViteManifest, offlineServiceWorkerForBuild } from "./scripts/offline-pwa-cache";
import { OFFLINE_CATALOG_ASSET_MAX_BYTES, requireOfflineCatalogSnapshot } from "./shared/offline-catalog";
import { apiBaseUrlCspOrigin, createContentSecurityPolicy } from "./shared/content-security-policy";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:4174";
const requestedBuildMode = process.env.PC_SUPPORTER_BUILD_MODE?.trim() || "remote";
if (requestedBuildMode !== "remote" && requestedBuildMode !== "local-offline") {
  throw new Error("PC_SUPPORTER_BUILD_MODE must be either remote or local-offline.");
}
const localOfflineBuild = requestedBuildMode === "local-offline";
const buildOutputDirectory = process.env.PC_SUPPORTER_BUILD_OUT_DIR?.trim() || (localOfflineBuild ? "artifacts/pc-supporter-offline/web" : "dist");
const offlineBundlePath = process.env.PC_SUPPORTER_OFFLINE_BUNDLE_FILE?.trim();
const offlineEnvDirectory = process.env.PC_SUPPORTER_VITE_ENV_DIR?.trim();
if (localOfflineBuild && !offlineBundlePath) {
  throw new Error("local-offline builds must provide a validated PC_SUPPORTER_OFFLINE_BUNDLE_FILE.");
}
if (localOfflineBuild && !offlineEnvDirectory) {
  throw new Error("local-offline builds must use a temporary empty PC_SUPPORTER_VITE_ENV_DIR.");
}
const offlineBuildRevision = process.env.PC_SUPPORTER_OFFLINE_BUILD_REVISION?.trim() ?? "";
if (localOfflineBuild && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(offlineBuildRevision)) {
  throw new Error("local-offline builds must provide a unique PC_SUPPORTER_OFFLINE_BUILD_REVISION.");
}
const apiProxy = {
  "/api": apiProxyTarget
};

function offlineCatalogSnapshotForBuild() {
  if (!localOfflineBuild || !offlineBundlePath) throw new Error("local-offline snapshot bundle is unavailable.");
  const bundlePath = resolve(offlineBundlePath);
  const candidate = JSON.parse(readFileSync(bundlePath, "utf8")) as unknown;
  return requireOfflineCatalogSnapshot(candidate);
}

const localOfflineSnapshot = localOfflineBuild ? offlineCatalogSnapshotForBuild() : undefined;
const offlineCatalogRevision = localOfflineSnapshot?.manifest.revision ?? "";

function offlineCatalogAssetSource() {
  if (!localOfflineBuild || !localOfflineSnapshot) throw new Error("local-offline snapshot bundle is unavailable.");
  const source = `${JSON.stringify(localOfflineSnapshot)}\n`;
  if (Buffer.byteLength(source, "utf8") > OFFLINE_CATALOG_ASSET_MAX_BYTES) {
    throw new Error(`local-offline snapshot exceeds the ${OFFLINE_CATALOG_ASSET_MAX_BYTES}-byte installed catalog asset budget.`);
  }
  return source;
}

let offlineProductionBuild = false;

const offlineCatalogModule: Plugin = {
  name: "pc-supporter-offline-catalog",
  configResolved(config) {
    offlineProductionBuild = config.command === "build";
  },
  transformIndexHtml() {
    if (localOfflineBuild) return [];
    return [
      { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }, injectTo: "head" },
      {
        tag: "link",
        attrs: {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap"
        },
        injectTo: "head"
      }
    ];
  },
  configureServer(server: import("vite").ViteDevServer) {
    if (!localOfflineBuild) return;
    server.middlewares.use("/offline-catalog.json", (_request, response, next) => {
      try {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(offlineCatalogAssetSource());
      } catch (error: unknown) {
        next(error instanceof Error ? error : new Error(String(error)));
      }
    });
  },
  generateBundle() {
    if (localOfflineBuild) this.emitFile({ type: "asset", fileName: "offline-catalog.json", source: offlineCatalogAssetSource() });
  },
  closeBundle() {
    if (!localOfflineBuild || !offlineProductionBuild) return;
    const outputDirectory = resolve(process.cwd(), buildOutputDirectory);
    const manifest = JSON.parse(readFileSync(join(outputDirectory, ".vite/manifest.json"), "utf8")) as unknown;
    const precacheUrls = offlinePrecacheUrlsFromViteManifest(manifest);
    const workerTemplate = readFileSync(resolve(process.cwd(), "public/service-worker.js"), "utf8");
    const workerSource = offlineServiceWorkerForBuild(workerTemplate, {
      buildRevision: offlineBuildRevision,
      catalogRevision: offlineCatalogRevision,
      precacheUrls
    });
    writeFileSync(join(outputDirectory, "service-worker.js"), workerSource, "utf8");
  }
};

export default defineConfig(({ mode }) => {
  const clientEnvDirectory = localOfflineBuild ? offlineEnvDirectory! : process.cwd();
  const clientEnvironment = loadEnv(mode, clientEnvDirectory, "VITE_");
  const apiOrigin = localOfflineBuild
    ? undefined
    : apiBaseUrlCspOrigin(clientEnvironment.VITE_API_BASE_URL ?? process.env.VITE_API_BASE_URL);
  const browserPolicyPlugin: Plugin = {
    name: "pc-supporter-content-security-policy",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [{
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: createContentSecurityPolicy({
              connectOrigins: apiOrigin ? [apiOrigin] : [],
              allowRemoteAssets: !localOfflineBuild
            })
          },
          injectTo: "head-prepend"
        }
        ];
      }
    }
  };

  return {
    plugins: [react(), browserPolicyPlugin, offlineCatalogModule],
    ...(localOfflineBuild ? { envDir: offlineEnvDirectory } : {}),
    define: {
      "import.meta.env.VITE_APP_DATA_MODE": JSON.stringify(localOfflineBuild ? "offline" : "remote"),
      "import.meta.env.VITE_OFFLINE_BUILD_REVISION": JSON.stringify(localOfflineBuild ? offlineBuildRevision : ""),
      "import.meta.env.VITE_OFFLINE_CATALOG_REVISION": JSON.stringify(offlineCatalogRevision)
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: ["terminal.local"],
      proxy: apiProxy
    },
    preview: {
      host: "0.0.0.0",
      proxy: apiProxy
    },
    build: {
      outDir: buildOutputDirectory,
      emptyOutDir: !localOfflineBuild,
      sourcemap: !localOfflineBuild,
      // Keep the Rollup asset graph available to the client-budget verifier without changing chunking or runtime loading.
      manifest: true,
      // The shared decision, budget-ladder route metadata, local share index, catalog share bridge, data-trust summary, filter URL state, search-link actions, history guards, network/API status, exact catalog GET session fallback, conditional ETag reads, draft validation, cross-tab recovery, result URL state, report view metadata, saved-build recheck entry point, resource-budget drift display, and the top-level UI recovery boundary add a small, intentional app-shell cost; keep a narrow 600kB budget.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            "react-vendor": ["react", "react-dom", "react-dom/client", "scheduler"],
            "icons-vendor": ["react-icons", "react-icons/fi"],
            "saved-build-check": ["./shared/saved-build-check.ts"],
            "compatibility-report": ["./shared/compatibility-report.ts"],
            "purchase-readiness": ["./shared/purchase-readiness.ts", "./shared/gpu-fit.ts"],
            "build-resource-summary": ["./shared/build-resource-summary.ts"],
            "build-change-result": ["./shared/build-change-result.ts"],
            "candidate-decision": ["./shared/candidate-decision.ts"],
            "budget-ladder-local-history": ["./shared/budget-ladder-local-history.ts"],
            "catalog-watchlist": ["./shared/catalog-watchlist.ts"],
            "saved-build-purchase-price-history": ["./shared/saved-build-purchase-price-history.ts"],
            "build-input": ["./shared/build-fingerprint.ts", "./shared/build-preflight.ts", "./shared/build-transfer.ts", "./shared/build-transfer-diff.ts", "./shared/budget-ladder.ts", "./shared/build-selection-hydration.ts"],
            // Result/history-only calculations stay cacheable without inflating the app entry whenever the catalog changes.
            "catalog-change-domain": ["./shared/catalog-change-analytics.ts", "./shared/catalog-change-filters.ts", "./shared/catalog-change-export.ts", "./shared/catalog-change-impact.ts", "./shared/saved-build-change-causes.ts"],
            "saved-build-domain": ["./shared/saved-build-monitor.ts", "./shared/saved-build-monitor-alerts.ts", "./shared/saved-build-monitor-subscription.ts", "./shared/saved-build-priority.ts", "./shared/saved-build-priority-action.ts", "./shared/saved-build-version.ts", "./shared/saved-build-comparison-diff.ts"],
            "purchase-domain": ["./shared/purchase-list.ts", "./shared/purchase-list-progress.ts", "./shared/purchase-list-status.ts", "./shared/saved-build-purchase-progress.ts"]
          }
        }
      }
    }
  };
});
