import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// embedded-postgres registers async-exit-hook handlers that finish the process
// with `process.exit(0)` on 'beforeExit', rewriting a pending
// `process.exitCode = 1` into a successful exit — CI run 36823048596's save
// check timed out yet the smoke step passed. Both entry points that load
// embedded-postgres (the smoke helper and the Vitest global setup) must keep
// the masking handlers removed.
describe("embedded-postgres exit mask", () => {
  it("preserves a non-zero exitCode for ensure-embedded-postgres consumers", () => {
    const moduleUrl = pathToFileURL(resolve("scripts/ensure-embedded-postgres.mjs")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(moduleUrl)}; process.exitCode = 1;`], { encoding: "utf8" });
    expect(result.status).toBe(1);
  });

  it("keeps a clean zero exit for ensure-embedded-postgres consumers", () => {
    const moduleUrl = pathToFileURL(resolve("scripts/ensure-embedded-postgres.mjs")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(moduleUrl)};`], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  it("preserves a non-zero exitCode for the Vitest global setup entry point", () => {
    const probe = join(mkdtempSync(join(tmpdir(), "exit-mask-probe-")), "probe.mts");
    writeFileSync(probe, `import ${JSON.stringify(pathToFileURL(resolve("server/testkit/global-setup.ts")).href)}; process.exitCode = 1;`);
    const result = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), probe], { encoding: "utf8", cwd: process.cwd() });
    expect(result.status).toBe(1);
  });
});
