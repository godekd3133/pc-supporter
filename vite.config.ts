import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": "http://127.0.0.1:4174"
    }
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // The shared decision, budget-ladder route metadata, and local share index add a small, intentional app-shell cost; keep a narrow 523kB budget.
    chunkSizeWarningLimit: 523,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "icons-vendor": ["react-icons"],
          "saved-build-check": ["./shared/saved-build-check.ts"],
          "compatibility-report": ["./shared/compatibility-report.ts"],
          "purchase-readiness": ["./shared/purchase-readiness.ts", "./shared/gpu-fit.ts"],
          "candidate-decision": ["./shared/candidate-decision.ts"],
          "budget-ladder-local-history": ["./shared/budget-ladder-local-history.ts"],
          "build-input": ["./shared/build-fingerprint.ts", "./shared/build-preflight.ts", "./shared/build-transfer.ts", "./shared/build-transfer-diff.ts", "./shared/budget-ladder.ts"]
        }
      }
    }
  }
});
