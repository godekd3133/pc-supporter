import { describe, expect, it } from "vitest";
import { GAMING_GAME_CATEGORY_LABELS, GAMING_GAMES, gamingAdvisoryTuningFor, gamingGameDemandFor } from "./gaming-catalog";

describe("gaming catalog advisory", () => {
  it("keeps the client catalog broad and category-complete", () => {
    expect(GAMING_GAMES.length).toBeGreaterThanOrEqual(65);
    expect(new Set(GAMING_GAMES.map((game) => game.category))).toEqual(new Set(Object.keys(GAMING_GAME_CATEGORY_LABELS)));
    expect(GAMING_GAMES.find((game) => game.id === "cyberpunk")).toMatchObject({ label: "사이버펑크 2077", demand: 1.3, category: "aaa" });
    expect(GAMING_GAMES.map((game) => game.label)).toEqual(expect.arrayContaining(["Dota 2", "원신", "앨런 웨이크 2", "Sons of the Forest", "쓰론 앤 리버티"]));
  });

  it("uses the highest selected game demand instead of averaging it away", () => {
    expect(gamingGameDemandFor(["valorant", "cyberpunk", "pubg"])).toBe(1.3);
    expect(gamingGameDemandFor(["unknown-game-id"])).toBe(1);
  });

  it("turns game and graphics conditions into GPU-selection tuning without FPS claims", () => {
    const standard = gamingAdvisoryTuningFor("4k", { gameIds: ["pubg"], graphicsPreset: "balanced", upscaling: "quality" });
    const demanding = gamingAdvisoryTuningFor("4k", { gameIds: ["cyberpunk"], graphicsPreset: "high", rayTracing: true, upscaling: "quality" });
    expect(demanding.demandMultiplier).toBeGreaterThan(standard.demandMultiplier);
    expect(demanding.targetVramGb).toBe(22);
    expect(demanding.gpuTargetWeight).toBeGreaterThan(standard.gpuTargetWeight);
  });
});
