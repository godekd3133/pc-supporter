const RESTRICTED_PUBLIC_API_KEYS = new Set([
  "recommendationTrust",
  "recommendationTrustCounts",
  "recommendationTrustScore",
  "recommendationTrustReasons",
  "trustExcludedCount",
  "decision",
  "decisionSummary",
  "benchmarkEvidence",
  "benchmarkSnapshot",
  "benchmarkProvenance",
  "benchmarkCoverage",
  "benchmarkStatus",
  "benchmarkExcludedCount",
  "benchmarkSourceKind",
  "benchmarkSourceCheck",
  "benchmarkSourceCheckNeedsReview",
  "benchmarkFreshness",
  "benchmarkBacked",
  "similarityEvidence",
  "similarity",
  "performance",
  "performanceSummary",
  "gpuTarget",
  "analysis",
  "gamingPerformanceAssessment",
  "gamingPerformanceEvidence",
  "cinebenchR23Single",
  "cinebenchR23Multi",
  "gpu3dmarkTimeSpyScore",
  "gpu3dmarkPortRoyalScore",
  "averageFps",
  "onePercentLowFps",
  "targetFps",
  "targetFPS",
  "fpsTarget",
  "targetFrameRate",
  "matchedRecordIds",
  "staleRecordIds",
  "belowTargetRecordIds",
  "sourceUrls",
  "analysisScore",
  "analysisScoreDelta",
  "analysisScoreLabel",
  "analysisConfidence",
  "overallScore",
  "scoreModelVersion",
  "scoreBasis",
  "scoreLabel",
  "score",
  "similarityScore",
  "valueScore",
  "valueScoreScale",
  "valueLabel",
  "valueEvidence",
  "similarityLabel",
  "upgradeScore",
  "improvementPercent",
  "improvedDimensions",
  "scoreDelta",
  "candidateScore",
  "confidence",
  "catalogSpecSourceCheckNeedsReview",
  "benchmarkChanged",
  "benchmarkNeedsReview",
  "riskScore",
  "evidenceScore",
  "fixedAnchorScore",
  "fixedAnchorAnalysisScore",
  "cpuScore",
  "gpuScore",
  "weight",
  "gap"
]);

const INTERNAL_SIGNAL_TEXT_KEYS = new Set([
  "performanceSummary",
  "specSummary",
  "selectionReason",
  "rationale",
  "warnings",
  "summary",
  "reason",
  "note",
  "detail"
]);
const INTERNAL_SIGNAL_TEXT = /\b(?:cinebench|r23|3dmark|time\s*spy|port\s*royal)\b|\bfps\b|목표\s*프레임|실측\s*프레임|(?:FHD|QHD|4K)\s*[·•]\s*\d{2,3}\s*Hz\s*[·•]\s*권장\s*VRAM/i;

function isRestrictedPublicApiKey(key: string) {
  return RESTRICTED_PUBLIC_API_KEYS.has(key)
    || key.startsWith("recommendationTrust")
    || key === "gamingPerformanceMeasurement"
    || key === "gamingPerformanceMeasurements";
}

/**
 * Remove internal recommendation evidence from customer-facing API payloads.
 * The input is copied so the engine, cache, and admin evidence routes retain
 * the original records and ranking signals.
 */
export function publicApiPayloadProjection(value: unknown, parentKey?: string): unknown {
  if (typeof value === "string") {
    return parentKey && INTERNAL_SIGNAL_TEXT_KEYS.has(parentKey) && INTERNAL_SIGNAL_TEXT.test(value) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const projected = publicApiPayloadProjection(item, parentKey);
      return projected === undefined ? [] : [projected];
    });
  }
  if (!value || typeof value !== "object" || value instanceof Date) return value;

  const projected: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isRestrictedPublicApiKey(key)) continue;
    const next = publicApiPayloadProjection(item, key);
    if (next !== undefined) projected[key] = next;
  }
  return projected;
}
