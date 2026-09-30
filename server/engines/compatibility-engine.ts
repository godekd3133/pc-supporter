// 호환성 검사 엔진 모듈 — evaluateBuild 결과를 둘러싼 인메모리 캐시 계층을
// 소유한다. index.ts의 라우트는 이 모듈을 통해 캐시를 조회·무효화하고,
// 운영 상태 API는 여기의 지표를 읽는다.
import { TtlLruInFlightCache, compatibilityResultCache } from "../compatibility-cache";
import { savedBuildCheckPreviewCache } from "../saved-build-check-cache";
import type { assessAlternativePart, candidateSimilarityForBuild } from "../engine";
import type { recommendationTrustFor } from "../recommendation-trust";
import type { candidateDecisionSummaryFor } from "../../shared/candidate-decision";
import type { partSpecFilterDiagnosticsFor } from "../catalog";
import type { Finding, Part } from "../../shared/types";
import { ENGINE_VERSION } from "../engine";

type CompatiblePartAssessmentRow = {
  part: Part;
  assessment: ReturnType<typeof assessAlternativePart>;
  similarity: ReturnType<typeof candidateSimilarityForBuild>;
  recommendationTrust: ReturnType<typeof recommendationTrustFor>;
  decision: ReturnType<typeof candidateDecisionSummaryFor>;
};

export type CompatiblePartAssessmentCacheValue = {
  intentFinding?: Finding;
  assessedParts: CompatiblePartAssessmentRow[];
  policyExcludedParts: Part[];
  priceExcludedCount: number;
  freshnessExcludedCount: number;
  specExcludedCount: number;
  detailExcludedCount: number;
  specFilterDiagnostics: ReturnType<typeof partSpecFilterDiagnosticsFor>;
};

// 대안 부품 평가 캐시 — 호환 평가는 부품 전수 조사라 호출이 겹치는 동안
// 요청을 묶어(coalesce) 한 번만 계산한다.
export const compatiblePartAssessmentCache = new TtlLruInFlightCache<CompatiblePartAssessmentCacheValue>({ ttlMs: 2 * 60 * 1000, maxEntries: 40 });

export function clearCompatibilityEngineCaches() {
  compatibilityResultCache.clear();
  savedBuildCheckPreviewCache.clear();
  compatiblePartAssessmentCache.clear();
}

export function compatibilityEngineStatus() {
  return {
    id: "compatibility" as const,
    label: "호환성 검사 엔진",
    engineVersion: ENGINE_VERSION,
    caches: {
      compatibilityResult: compatibilityResultCache.stats(),
      savedBuildCheckPreview: savedBuildCheckPreviewCache.stats(),
      compatiblePartAssessment: compatiblePartAssessmentCache.stats()
    }
  };
}
