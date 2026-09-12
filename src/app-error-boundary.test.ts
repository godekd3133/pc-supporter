import { describe, expect, it } from "vitest";
import { appErrorMessageFor } from "./AppErrorBoundary";

describe("app error boundary", () => {
  it("keeps a bounded diagnostic message for a real Error", () => {
    const message = appErrorMessageFor(new Error("lazy chunk failed"));
    expect(message).toBe("lazy chunk failed");
    expect(message.length).toBeLessThanOrEqual(240);
  });

  it("falls back to a user-safe message for unknown thrown values", () => {
    expect(appErrorMessageFor({ reason: "private detail" })).toBe("화면을 준비하는 중 알 수 없는 오류가 발생했습니다.");
    expect(appErrorMessageFor("failed" as unknown)).toBe("화면을 준비하는 중 알 수 없는 오류가 발생했습니다.");
  });
});
