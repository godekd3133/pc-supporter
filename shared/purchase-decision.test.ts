import { describe, expect, it } from "vitest";
import type { PurchaseReadiness } from "./purchase-readiness";
import { purchaseDecisionFor } from "./purchase-decision";

const readiness = (state: PurchaseReadiness["state"]): PurchaseReadiness => ({ state, label: state === "ready" ? "구매 준비 완료" : state === "review" ? "확인 후 구매" : "구매 보류", summary: `readiness-${state}`, items: [] });
const progress = (remaining: number, total = 4) => ({ total, checked: total - remaining, remaining, percent: total === 0 ? 0 : Math.round(((total - remaining) / total) * 100) });
const assembly = (state: "not_started" | "in_progress" | "passed" | "failed", recheckSignalCount = 0) => ({ state, total: 6, checked: state === "not_started" ? 0 : state === "in_progress" ? 3 : 6, passed: state === "passed" ? 6 : 0, failed: state === "failed" ? 1 : 0, remaining: state === "passed" || state === "failed" ? 0 : 3, percent: state === "not_started" ? 0 : state === "in_progress" ? 50 : 100, recheckSignalCount, updatedAt: "2026-09-02T00:00:00.000Z" });

describe("purchase decision gate", () => {
  it("keeps engine blockers and reviews ahead of checklist completion", () => {
    expect(purchaseDecisionFor(readiness("blocked"), progress(0)).state).toBe("blocked");
    expect(purchaseDecisionFor(readiness("review"), progress(0)).state).toBe("review");
  });

  it("does not claim final readiness while the checklist is loading or incomplete", () => {
    expect(purchaseDecisionFor(readiness("ready")).state).toBe("pending");
    expect(purchaseDecisionFor(readiness("ready"), progress(2))).toMatchObject({ state: "review", label: "체크리스트 확인 후 구매" });
  });

  it("becomes ready when there are no checklist items or all items are complete", () => {
    expect(purchaseDecisionFor(readiness("ready"), progress(0)).state).toBe("ready");
    expect(purchaseDecisionFor(readiness("ready"), progress(0, 0)).state).toBe("ready");
  });

  it("uses recorded build evidence as a conservative follow-up signal without treating an unstarted run as a blocker", () => {
    expect(purchaseDecisionFor(readiness("ready"), progress(0), assembly("not_started")).state).toBe("ready");
    expect(purchaseDecisionFor(readiness("ready"), progress(0), assembly("in_progress"))).toMatchObject({ state: "review", label: "실측 기록 진행 중" });
    expect(purchaseDecisionFor(readiness("ready"), progress(0), assembly("failed"))).toMatchObject({ state: "review", label: "실측 확인 후 진행" });
    expect(purchaseDecisionFor(readiness("ready"), progress(0), assembly("passed", 1))).toMatchObject({ state: "review", label: "실측 재확인 필요" });
  });
});
