import { describe, expect, it } from "vitest";
import { candidateDecisionSummaryFor } from "./candidate-decision";

describe("candidate decision summary", () => {
  it("marks a clean target-resolving candidate as recommended", () => {
    const summary = candidateDecisionSummaryFor({
      risk: "safe",
      resolvesTarget: true,
      physicalStatus: "verified",
      recommendationTrustLevel: "high",
      freshness: "fresh"
    });

    expect(summary).toMatchObject({
      status: "recommended",
      label: "추천 후보",
      summary: "현재 문제 해결 · 새 차단 없음 · 물리 근거 확인됨 · 최근 확인 · 높은 근거"
    });
  });

  it("downgrades review candidates and keeps the reason visible", () => {
    const summary = candidateDecisionSummaryFor({
      risk: "review",
      resolvesTarget: true,
      reasons: ["PCIe 세대가 확인되지 않습니다."],
      physicalStatus: "review",
      recommendationTrustLevel: "medium",
      freshness: "aging"
    });

    expect(summary.status).toBe("review");
    expect(summary.label).toBe("확인 후 적용");
    expect(summary.summary).toContain("추가 확인 필요");
    expect(summary.reasons).toContain("PCIe 세대가 확인되지 않습니다.");
    expect(summary.reasons).toContain("물리 근거가 확인 필요 상태라 실제 장착 전에 제조사 원문을 확인해야 합니다.");
  });

  it("never presents an unsafe candidate as an applicable recommendation", () => {
    const summary = candidateDecisionSummaryFor({
      risk: "unsafe",
      reasons: ["후보 자체에 차단 오류 1개가 있습니다."],
      recommendationTrustLevel: "high",
      freshness: "fresh"
    });

    expect(summary).toMatchObject({ status: "avoid", label: "적용하지 않음" });
    expect(summary.summary).toContain("후보 자체에 차단 위험");
    expect(summary.reasons).toEqual(["후보 자체에 차단 오류 1개가 있습니다."]);
  });

  it("downgrades stale or target-uncertain candidates even without a rule blocker", () => {
    const stale = candidateDecisionSummaryFor({
      risk: "safe",
      resolvesTarget: true,
      recommendationTrustLevel: "medium",
      freshness: "stale"
    });
    const uncertain = candidateDecisionSummaryFor({ risk: "safe", resolvesTarget: false, freshness: "unknown" });

    expect(stale.status).toBe("review");
    expect(stale.summary).toContain("오래된 정보");
    expect(uncertain.status).toBe("review");
    expect(uncertain.reasons).toContain("현재 문제를 직접 해결하는 후보인지 추가 확인해야 합니다.");
  });
});
