import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:4174";
const buildOutputDirectory = process.env.PC_SUPPORTER_BUILD_OUT_DIR?.trim() || "dist";
const apiProxy = {
  "/api": apiProxyTarget
};

export default defineConfig({
  plugins: [react()],
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
    sourcemap: true,
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
});
