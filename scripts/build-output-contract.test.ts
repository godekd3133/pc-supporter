import { afterEach, describe, expect, it, vi } from "vitest";

describe("build output contract", () => {
  const previousBuildOutputDirectory = process.env.PC_SUPPORTER_BUILD_OUT_DIR;
  const previousCapacitorWebDirectory = process.env.CAPACITOR_WEB_DIR;

  afterEach(() => {
    if (previousBuildOutputDirectory === undefined) delete process.env.PC_SUPPORTER_BUILD_OUT_DIR;
    else process.env.PC_SUPPORTER_BUILD_OUT_DIR = previousBuildOutputDirectory;
    if (previousCapacitorWebDirectory === undefined) delete process.env.CAPACITOR_WEB_DIR;
    else process.env.CAPACITOR_WEB_DIR = previousCapacitorWebDirectory;
    vi.resetModules();
  });

  it("keeps native web assets and Capacitor sync on the isolated output directory", async () => {
    process.env.PC_SUPPORTER_BUILD_OUT_DIR = "dist-mobile";
    process.env.CAPACITOR_WEB_DIR = "dist-mobile";
    vi.resetModules();

    const [{ default: viteConfig }, { default: capacitorConfig }] = await Promise.all([
      import("../vite.config"),
      import("../capacitor.config")
    ]);

    expect(viteConfig.build?.outDir).toBe("dist-mobile");
    expect(capacitorConfig.webDir).toBe("dist-mobile");
  });
});
