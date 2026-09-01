import { describe, expect, it } from "vitest";
import { VALUE_SCORE_MAX, valueScoreText } from "./value-score";

describe("value score display", () => {
  it("makes the two-hundred-point scale explicit", () => {
    expect(valueScoreText(181)).toBe("181/200점");
    expect(VALUE_SCORE_MAX).toBe(200);
  });

  it("does not change the underlying numeric score", () => {
    expect(valueScoreText(0)).toBe("0/200점");
    expect(valueScoreText(200)).toBe("200/200점");
  });
});
