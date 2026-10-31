import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneratorGamingTargetControls } from "./GeneratorGamingTargetControls";
import { readFileSync } from "node:fs";

describe("budget game context", () => {
  it("shows game and resolution choices without requiring a target FPS", () => {
    const noop = () => undefined;
    const markup = renderToStaticMarkup(createElement(GeneratorGamingTargetControls, { mode: "budget", onMode: noop, vendor: "nvidia", onVendor: noop, gameIds: ["pubg"], onGames: noop, resolution: "4k", onResolution: noop, refreshRate: 144, onRefreshRate: noop, targetFps: "144", onTargetFps: noop, graphicsPreset: "balanced", onGraphicsPreset: noop, rayTracing: false, onRayTracing: noop, upscaling: "quality", onUpscaling: noop, disabled: false }));
    expect(markup).toContain("주로 할 게임");
    expect(markup).toContain("배틀그라운드");
    expect(markup).toContain("해상도");
    expect(markup).toContain('value="4k" selected');
    expect(markup).not.toContain('data-testid="generator-target-fps"');
  });
  it("keeps the GPU length control out of the public picker", () => {
    const source = readFileSync(new URL("./PartPicker.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("GPU 길이 ≤");
    expect(source).not.toContain('payload.maxLengthMm = filter.maxLengthMm');
  });
});
