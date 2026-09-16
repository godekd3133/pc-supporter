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
      label: "추천 부품",
      summary: "현재 문제 해결 · 새 차단 없음 · 장착 정보 확인됨 · 최근 확인 · 높음"
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
    expect(summary.reasons).toContain("장착 정보가 확인 필요 상태라 실제 장착 전에 제조사 페이지를 확인해야 합니다.");
  });

  it("never presents an unsafe candidate as an applicable recommendation", () => {
    const summary = candidateDecisionSummaryFor({
      risk: "unsafe",
      reasons: ["부품 자체에 차단 오류 1개가 있습니다."],
      recommendationTrustLevel: "high",
      freshness: "fresh"
    });

    expect(summary).toMatchObject({ status: "avoid", label: "적용하지 않음" });
    expect(summary.summary).toContain("부품 자체에 차단 위험");
    expect(summary.reasons).toEqual(["부품 자체에 차단 오류 1개가 있습니다."]);
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
    expect(uncertain.reasons).toContain("현재 문제를 직접 해결하는 부품인지 추가 확인해야 합니다.");
  });

  it("requires a manufacturer source check before applying a manual spec candidate", () => {
    const summary = candidateDecisionSummaryFor({
      risk: "safe",
      resolvesTarget: true,
      recommendationTrustLevel: "medium",
      catalogSpecSourceCheckNeedsReview: true,
      freshness: "fresh"
    });

    expect(summary).toMatchObject({ status: "review", label: "확인 후 적용" });
    expect(summary.summary).toContain("제조사 페이지 확인 필요");
    expect(summary.reasons).toContain("직접 입력된 스펙의 제조사 페이지 접근과 모델 식별을 확인해야 이 부품을 적용할 수 있어요.");
  });
});
