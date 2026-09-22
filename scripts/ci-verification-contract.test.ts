import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());

describe("CI verification contracts", () => {
  it("keeps browser smoke observation defaults aligned with the CI job", async () => {
    const [workflow, browserSmoke, persistenceSmoke] = await Promise.all([
      readFile(resolve(projectRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(resolve(projectRoot, "scripts/browser-smoke.mjs"), "utf8"),
      readFile(resolve(projectRoot, "scripts/browser-persistence-smoke.mjs"), "utf8")
    ]);

    expect(browserSmoke).toContain("process.env.BROWSER_SMOKE_TIMEOUT_MS ?? 120_000");
    expect(browserSmoke).toContain("process.env.BROWSER_SMOKE_EVALUATE_TIMEOUT_MS ?? 30_000");
    expect(persistenceSmoke).toContain("process.env.BROWSER_PERSISTENCE_SMOKE_TIMEOUT_MS ?? 120_000");
    expect(persistenceSmoke).toContain('process.env.BROWSER_SMOKE_EVALUATE_TIMEOUT_MS = "30000"');
    expect(workflow).toContain('BROWSER_SMOKE_TIMEOUT_MS: "120000"');
    expect(workflow).toContain('BROWSER_SMOKE_EVALUATE_TIMEOUT_MS: "30000"');
  });

  it("keeps browser smoke cleanup armed for both the process group and direct child", async () => {
    const browserSmoke = await readFile(resolve(projectRoot, "scripts/browser-smoke.mjs"), "utf8");
    expect(browserSmoke).toContain("process.kill(-child.pid, signal);");
    expect(browserSmoke).toContain("child.kill(signal);");
    expect(browserSmoke).not.toContain("process.kill(-child.pid, signal);\n      return;");
  });

  it("keeps accessory readiness observation on bounded DOM selectors", async () => {
    const browserSmoke = await readFile(resolve(projectRoot, "scripts/browser-smoke.mjs"), "utf8");
    expect(browserSmoke).toContain("document.querySelector('.accessory-page') !== null && document.querySelector('.accessory-watch-button') !== null");
    expect(browserSmoke).not.toContain("(document.body?.innerText ?? '').includes('주변 부품 카탈로그') && document.querySelector('.accessory-watch-button') !== null");
  });

  it("keeps the price-watchlist saved-link context probe wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/price-watchlist-link-context-smoke.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:price-watchlist-link-context": "node scripts/price-watchlist-link-context-smoke.mjs"');
    expect(browserProbe).toContain("oldTokenPreserved");
    expect(browserProbe).toContain("newTokenPreserved");
  });

  it("keeps the dark-mode readability smoke wired", async () => {
    const [packageJson, readabilitySmoke] = await Promise.all([
      readFile(resolve(projectRoot, "package.json"), "utf8"),
      readFile(resolve(projectRoot, "scripts/readability-smoke.mjs"), "utf8")
    ]);

    expect(packageJson).toContain('"test:browser:readability": "node scripts/readability-smoke.mjs"');
    expect(readabilitySmoke).toContain("Emulation.setDeviceMetricsOverride");
    expect(readabilitySmoke).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(readabilitySmoke).toContain("contrastRatio");
    expect(readabilitySmoke).toContain("lightSurfaceLeaks");
    expect(readabilitySmoke).toContain("picker-modal");
  });

  it("keeps the guided quote onboarding smoke wired in development and preview lanes", async () => {
    const [packageJson, workflow, onboardingSmoke] = await Promise.all([
      readFile(resolve(projectRoot, "package.json"), "utf8"),
      readFile(resolve(projectRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(resolve(projectRoot, "scripts/quote-onboarding-smoke.mjs"), "utf8")
    ]);
    expect(packageJson).toContain('"test:browser:quote-onboarding": "node scripts/quote-onboarding-smoke.mjs"');
    expect(workflow).toContain("Guided quote onboarding smoke flow");
    expect(workflow).toContain("Production preview guided quote onboarding smoke flow");
    expect(onboardingSmoke).toContain("사이버펑크 2077");
    expect(onboardingSmoke).toContain("4K · 144 FPS");
    expect(onboardingSmoke).toContain("generator-line");
    expect(onboardingSmoke).toContain("generator-selection-reasons");
    expect(onboardingSmoke).toContain('entry") === "upgrade"');
  });

  it("keeps shared version recheck route cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-version-recheck-route-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-version-recheck-route": "node scripts/shared-version-recheck-route-probe.mjs"');
    expect(browserProbe).toContain("abortedCalls");
    expect(browserProbe).toContain("compatibilityCalls");
  });

  it("keeps shared watchlist route cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-watchlist-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-watchlist-route-abort": "node scripts/shared-watchlist-route-abort-probe.mjs"');
    expect(browserProbe).toContain("abortedCalls");
    expect(browserProbe).toContain("requestStarted");
  });

  it("keeps shared comparison route cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-comparison-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-comparison-route-abort": "node scripts/shared-comparison-route-abort-probe.mjs"');
    expect(browserProbe).toContain("abortedCalls");
    expect(browserProbe).toContain("metaAbortedCalls");
    expect(browserProbe).toContain("requestStarted");
  });

  it("keeps shared comparison live-check cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-comparison-live-check-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-comparison-live-check-abort": "node scripts/shared-comparison-live-check-abort-probe.mjs"');
    expect(browserProbe).toContain("abortedCalls");
    expect(browserProbe).toContain("batchCalls");
  });

  it("keeps shared budget ladder route cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-budget-ladder-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-budget-ladder-route-abort": "node scripts/shared-budget-ladder-route-abort-probe.mjs"');
    expect(browserProbe).toContain("abortedCalls");
    expect(browserProbe).toContain("requestStarted");
  });

  it("keeps shared watchlist live-price cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-watchlist-live-price-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-watchlist-live-price-abort": "node scripts/shared-watchlist-live-price-abort-probe.mjs"');
    expect(browserProbe).toContain("abortedCalls");
    expect(browserProbe).toContain("priceCalls");
  });

  it("keeps shared budget ladder version comparison cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-budget-ladder-version-comparison-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-budget-ladder-version-comparison-abort": "node scripts/shared-budget-ladder-version-comparison-abort-probe.mjs"');
    expect(browserProbe).toContain("versionCalls");
    expect(browserProbe).toContain("abortedCalls");
  });

  it("keeps shared budget ladder refresh cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-budget-ladder-refresh-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-budget-ladder-refresh-route-abort": "node scripts/shared-budget-ladder-refresh-route-abort-probe.mjs"');
    expect(browserProbe).toContain("recommendAbortedCalls");
    expect(browserProbe).toContain("metaAbortedCalls");
  });

  it("keeps shared budget ladder version apply cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-budget-ladder-version-apply-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-budget-ladder-version-apply-route-abort": "node scripts/shared-budget-ladder-version-apply-route-abort-probe.mjs"');
    expect(browserProbe).toContain("recommendAbortedCalls");
    expect(browserProbe).toContain("recommendSignalCalls");
    expect(browserProbe).toContain("requestStarted");
  });

  it("keeps shared budget ladder snapshot save cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-budget-ladder-save-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-budget-ladder-save-route-abort": "node scripts/shared-budget-ladder-save-route-abort-probe.mjs"');
    expect(browserProbe).toContain("saveAbortedCalls");
    expect(browserProbe).toContain("saveSignalCalls");
  });

  it("keeps shared budget ladder snapshot revoke cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-budget-ladder-revoke-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-budget-ladder-revoke-route-abort": "node scripts/shared-budget-ladder-revoke-route-abort-probe.mjs"');
    expect(browserProbe).toContain("deleteAbortedCalls");
    expect(browserProbe).toContain("deleteSignalCalls");
  });

  it("keeps shared budget ladder partial preview cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/shared-budget-ladder-partial-preview-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:shared-budget-ladder-partial-preview-route-abort": "node scripts/shared-budget-ladder-partial-preview-route-abort-probe.mjs"');
    expect(browserProbe).toContain("checkAbortedCalls");
    expect(browserProbe).toContain("checkSignalCalls");
  });

  it("keeps build selection hydration cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/build-selection-hydration-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:build-selection-hydration-route-abort": "node scripts/build-selection-hydration-route-abort-probe.mjs"');
    expect(browserProbe).toContain("partsAbortedCalls");
    expect(browserProbe).toContain("accessoryAbortedCalls");
  });

  it("keeps generator apply hydration cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/generator-apply-route-race-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:generator-apply-route": "node scripts/generator-apply-route-race-probe.mjs"');
    expect(browserProbe).toContain("batchSignalCalls");
    expect(browserProbe).toContain("batchAbortedCalls");
  });

  it("keeps check hydration cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/check-hydration-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:check-hydration-route-abort": "node scripts/check-hydration-route-abort-probe.mjs"');
    expect(browserProbe).toContain("partsAbortedCalls");
    expect(browserProbe).toContain("accessoryAbortedCalls");
  });

  it("keeps saved-build open hydration cancellation wired", async () => {
    const packageJson = await readFile(resolve(projectRoot, "package.json"), "utf8");
    const browserProbe = await readFile(resolve(projectRoot, "scripts/saved-build-open-hydration-route-abort-probe.mjs"), "utf8");
    expect(packageJson).toContain('"test:browser:saved-build-open-hydration-route-abort": "node scripts/saved-build-open-hydration-route-abort-probe.mjs"');
    expect(browserProbe).toContain("partsAbortedCalls");
    expect(browserProbe).toContain("accessoryAbortedCalls");
    expect(browserProbe).toContain("compatibilityAbortedCalls");
  });

  it("keeps the development evidence matrix free of stale fixed test counts", async () => {
    const processDoc = await readFile(resolve(projectRoot, "docs/development-process.md"), "utf8");
    expect(processDoc).not.toMatch(/\b\d+\s+files\s*\/\s*[\d,]+\s+tests\b/);
    expect(processDoc).toContain("현재 worktree에서 명령 실행 결과를 authoritative evidence로 사용");
  });

  it("keeps the CI evidence lanes explicit", async () => {
    const workflow = await readFile(resolve(projectRoot, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("Seed-only API compatibility smoke");
    expect(workflow).toContain("Browser DOM smoke flow");
    expect(workflow).toContain("Production preview browser DOM smoke flow");
    expect(workflow).toContain("Browser persistence smoke flow");
    expect(workflow).toContain("container-smoke:");
    expect(workflow).toContain("docker compose up --build --detach");
    expect(workflow).toContain("npm run test:postgres:comparison");
    expect(workflow).toContain("npm run test:postgres:saved-build");
  });

  it("keeps the production container storage and health contracts aligned", async () => {
    const [workflow, compose, dockerfile] = await Promise.all([
      readFile(resolve(projectRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(resolve(projectRoot, "docker-compose.yml"), "utf8"),
      readFile(resolve(projectRoot, "Dockerfile"), "utf8")
    ]);

    expect(dockerfile).toContain("FROM node:22-alpine");
    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).toContain('CMD ["npm", "run", "start"]');
    expect(dockerfile).toContain("/api/health");
    expect(compose).toContain("image: postgres:16-alpine");
    expect(compose).toContain("condition: service_healthy");
    expect(compose).toContain("DATABASE_URL: postgresql://pcsupporter:pcsupporter@postgres:5432/pcsupporter");
    expect(compose).toContain("APP_HOST_PORT:-4174");
    expect(compose).toContain("pg_isready -U pcsupporter -d pcsupporter");
    expect(workflow).toContain("docker compose up --build --detach");
    expect(workflow).toContain("docker compose down");
  });
});
