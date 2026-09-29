import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createContentSecurityPolicy } from "../shared/content-security-policy";
import { assertContentSecurityPolicy, assertFirstRouteBudget, assertNoFirstRouteOnboardingSelectors, measureStaticImportClosure, resolveStaticImportClosure } from "./verify-client-bundle.mjs";

const indexHtml = `<!doctype html><html><head>
  <link rel="stylesheet" href="/assets/root.css">
  <script type="module" crossorigin src="/assets/index.js"></script>
</head><body></body></html>`;

const staticContents: Record<string, string> = {
  "assets/index.js": "first route entry javascript",
  "assets/left.js": "left static import javascript",
  "assets/right.js": "right static import javascript",
  "assets/shared.js": "deduplicated shared static javascript",
  "assets/home.js": "first rendered Home route javascript",
  "assets/root.css": "html root stylesheet",
  "assets/feature.css": "shared feature stylesheet",
  "assets/home.css": "Home route stylesheet"
};

function createManifest() {
  return {
    "index.html": {
      file: "assets/index.js",
      src: "index.html",
      isEntry: true,
      imports: ["_left.js", "_right.js"],
      dynamicImports: ["src/HomeView.tsx", "src/AdminView.tsx", "src/HistoryView.tsx", "src/PriceWatchlistView.tsx", "src/SharedWatchlistView.tsx", "src/QuoteOnboardingView.tsx"],
      css: ["assets/root.css"]
    },
    "_left.js": { file: "assets/left.js", imports: ["_shared.js"], css: ["assets/feature.css"] },
    "_right.js": { file: "assets/right.js", imports: ["_shared.js"], css: ["assets/feature.css"] },
    "_shared.js": { file: "assets/shared.js", imports: [] },
    "src/HomeView.tsx": { file: "assets/home.js", src: "src/HomeView.tsx", isDynamicEntry: true, imports: ["_left.js"], dynamicImports: ["src/HomeLazyPanel.tsx"], css: ["assets/home.css"] },
    "src/HomeLazyPanel.tsx": { file: "assets/home-lazy-panel.js", src: "src/HomeLazyPanel.tsx", isDynamicEntry: true, imports: [] },
    "src/AdminView.tsx": { file: "assets/AdminView.js", src: "src/AdminView.tsx", isDynamicEntry: true, imports: ["index.html"], css: ["assets/AdminView.css"] },
    "src/HistoryView.tsx": { file: "assets/HistoryView.js", src: "src/HistoryView.tsx", isDynamicEntry: true, imports: ["index.html"], css: ["assets/HistoryView.css"] },
    "src/PriceWatchlistView.tsx": { file: "assets/PriceWatchlistView.js", src: "src/PriceWatchlistView.tsx", isDynamicEntry: true, imports: ["index.html"], css: ["assets/PriceWatchlistView.css"] },
    "src/SharedWatchlistView.tsx": { file: "assets/SharedWatchlistView.js", src: "src/SharedWatchlistView.tsx", isDynamicEntry: true, imports: ["index.html"], css: ["assets/SharedWatchlistView.css"] },
    "src/QuoteOnboardingView.tsx": { file: "assets/QuoteOnboardingView.js", src: "src/QuoteOnboardingView.tsx", isDynamicEntry: true, imports: ["index.html"], css: ["assets/QuoteOnboardingView.css"] }
  };
}

describe("first-route client asset closure", () => {
  it("requires a script-hash CSP meta policy and keeps offline policies origin-free", () => {
    const remotePolicy = createContentSecurityPolicy({ connectOrigins: ["https://api.example.com"] });
    const sourceHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const themeScript = sourceHtml.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
    expect(themeScript).toBeTruthy();
    const remoteHtml = `<html><head><meta http-equiv="Content-Security-Policy" content="${remotePolicy}"><script>${themeScript!}</script></head></html>`;
    expect(assertContentSecurityPolicy(remoteHtml, false)).toBe(remotePolicy);

    const offlinePolicy = createContentSecurityPolicy({ allowRemoteAssets: false });
    const offlineHtml = `<html><head><meta http-equiv="Content-Security-Policy" content="${offlinePolicy}"><script>${themeScript!}</script></head></html>`;
    expect(assertContentSecurityPolicy(offlineHtml, true)).toBe(offlinePolicy);
    expect(() => assertContentSecurityPolicy("<html><head></head></html>", false)).toThrow("exactly one Content-Security-Policy meta tag");
    expect(() => assertContentSecurityPolicy(`<meta http-equiv="Content-Security-Policy" content="${offlinePolicy}; frame-ancestors 'none'"><script>${themeScript!}</script>`, true))
      .toThrow("frame-ancestors must be delivered as an HTTP response header");
    expect(() => assertContentSecurityPolicy(`<script>${themeScript!}</script><meta http-equiv="Content-Security-Policy" content="${offlinePolicy}">`, true))
      .toThrow("must appear before script and link resources");
  });

  it("keeps /start-only selectors out of global and first-route CSS", () => {
    const globalStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(() => assertNoFirstRouteOnboardingSelectors([{ name: "src/styles.css", contents: globalStyles }])).not.toThrow();
    expect(() => assertNoFirstRouteOnboardingSelectors([{
      name: "assets/index.css",
      contents: ".app-shell { display: flex; } .route-stage { min-width: 0; } .button { cursor: pointer; }"
    }])).not.toThrow();
    expect(() => assertNoFirstRouteOnboardingSelectors([{
      name: "assets/index.css",
      contents: ".onboarding-page { max-width: 520px; }"
    }])).toThrow("first-route CSS must not contain /start-only selectors: assets/index.css: .onboarding-page");
    expect(() => assertNoFirstRouteOnboardingSelectors([{
      name: "assets/index.css",
      contents: ".app-shell:has(.route-stage-start) .page-container { padding-bottom: 0; }"
    }])).toThrow("assets/index.css: .route-stage-start");
  });

  it("deduplicates the entry and first rendered Home route graphs while preserving lazy boundaries", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-client-closure-"));
    try {
      await mkdir(join(outputDirectory, "assets"), { recursive: true });
      for (const [name, contents] of Object.entries(staticContents)) {
        await writeFile(join(outputDirectory, name), contents);
      }

      const closure = await measureStaticImportClosure({
        manifest: createManifest(),
        indexHtml,
        assetDirectory: outputDirectory
      });

      const expectedJsFiles = ["assets/home.js", "assets/index.js", "assets/left.js", "assets/right.js", "assets/shared.js"];
      const expectedCssFiles = ["assets/feature.css", "assets/home.css", "assets/root.css"];
      const expectedBytes = (files: string[]) => files.reduce((sum, file) => sum + Buffer.byteLength(staticContents[file]), 0);
      const expectedGzipBytes = (files: string[]) => files.reduce((sum, file) => sum + gzipSync(staticContents[file]).byteLength, 0);

      expect(closure.javascript.assets.map(({ name }) => name)).toEqual(expectedJsFiles);
      expect(closure.css.assets.map(({ name }) => name)).toEqual(expectedCssFiles);
      expect(closure.javascript.bytes).toBe(expectedBytes(expectedJsFiles));
      expect(closure.javascript.gzipBytes).toBe(expectedGzipBytes(expectedJsFiles));
      expect(closure.css.bytes).toBe(expectedBytes(expectedCssFiles));
      expect(closure.css.gzipBytes).toBe(expectedGzipBytes(expectedCssFiles));
      expect(closure.total).toEqual({
        bytes: expectedBytes([...expectedJsFiles, ...expectedCssFiles]),
        gzipBytes: expectedGzipBytes([...expectedJsFiles, ...expectedCssFiles])
      });
      expect(closure.firstRouteKey).toBe("src/HomeView.tsx");
      expect(closure.excludedLazyRoutes.map(({ label }) => label)).toEqual([
        "AdminView",
        "HistoryView",
        "PriceWatchlistView",
        "SharedWatchlistView",
        "QuoteOnboardingView"
      ]);
      expect(closure.javascript.assets.some(({ name }) => /HomeLazyPanel|AdminView|HistoryView|PriceWatchlistView|SharedWatchlistView|QuoteOnboardingView/.test(name))).toBe(false);
      expect(closure.css.assets.some(({ name }) => /AdminView|HistoryView|PriceWatchlistView|SharedWatchlistView|QuoteOnboardingView/.test(name))).toBe(false);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("fails when a static manifest reference is missing", () => {
    const manifest = createManifest();
    manifest["index.html"].imports.push("_missing.js");
    expect(() => resolveStaticImportClosure(manifest, indexHtml)).toThrow("references a missing entry: _missing.js");
  });

  it("requires the Home route to remain reachable as a dynamic route from the HTML entry", () => {
    const manifest = createManifest();
    manifest["index.html"].dynamicImports = manifest["index.html"].dynamicImports.filter((key) => key !== "src/HomeView.tsx");
    expect(() => resolveStaticImportClosure(manifest, indexHtml)).toThrow("first rendered route must be reachable from the HTML entry's dynamic imports");
  });

  it("fails on cyclic static manifest references", () => {
    const manifest = createManifest();
    manifest["_shared.js"].imports = ["index.html"];
    expect(() => resolveStaticImportClosure(manifest, indexHtml)).toThrow("cyclic Vite manifest imports");
  });

  it("fails if a lazy route stylesheet is added to the first-route CSS closure", () => {
    const manifest = createManifest();
    manifest["index.html"].css.push("assets/AdminView.css");
    expect(() => resolveStaticImportClosure(manifest, indexHtml)).toThrow("lazy route stylesheet entered the first-route CSS closure: AdminView");
  });

  it("enforces independent raw and compressed first-route budgets", () => {
    expect(() => assertFirstRouteBudget({
      javascript: { bytes: 850_001, gzipBytes: 1 },
      css: { bytes: 0, gzipBytes: 0 },
      total: { bytes: 850_001, gzipBytes: 1 }
    })).toThrow("first-route static JS bytes exceeds 850000 bytes");
    expect(() => assertFirstRouteBudget({
      javascript: { bytes: 1, gzipBytes: 220_001 },
      css: { bytes: 0, gzipBytes: 0 },
      total: { bytes: 1, gzipBytes: 220_001 }
    })).toThrow("first-route static JS gzip bytes exceeds 220000 bytes");
    expect(() => assertFirstRouteBudget({
      javascript: { bytes: 779_448, gzipBytes: 206_700 },
      css: { bytes: 925_757, gzipBytes: 127_509 },
      total: { bytes: 1_705_205, gzipBytes: 334_209 }
    })).not.toThrow();
  });
});
