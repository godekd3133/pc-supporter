import { describe, expect, it } from "vitest";
import { budgetLadderShareHealthFromHttp, budgetLadderShareHealthLabel, budgetLadderShareHealthTone } from "./budget-ladder-share-health";

describe("budget ladder share server health", () => {
  it("distinguishes active, expired, revoked, and transient failure responses", () => {
    expect(budgetLadderShareHealthFromHttp(200)).toBe("active");
    expect(budgetLadderShareHealthFromHttp(404, "예산 구간 비교 링크가 만료되었습니다.")).toBe("expired");
    expect(budgetLadderShareHealthFromHttp(404, "저장된 예산 구간 비교를 찾을 수 없습니다.")).toBe("revoked");
    expect(budgetLadderShareHealthFromHttp(503, "잠시 후 다시 시도해 주세요.")).toBe("error");
  });

  it("keeps the unverified local-expiry state explicit", () => {
    expect(budgetLadderShareHealthLabel("unknown")).toBe("서버 확인 전");
    expect(budgetLadderShareHealthLabel("unknown", true)).toBe("로컬 만료 · 서버 미확인");
    expect(budgetLadderShareHealthTone("active")).toBe("active");
    expect(budgetLadderShareHealthTone("revoked")).toBe("expired");
  });
});
