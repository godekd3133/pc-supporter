import type { PhysicalOverrideCategory, PhysicalSourceCheck, PhysicalSourceCheckBatchItem, PhysicalSourceCheckBatchResponse } from "../shared/types";
import { physicalSourceCheckNeedsReview } from "../shared/physical-source-check";
import { checkPhysicalSourceUrl } from "./physical-source-check";

export type PhysicalSourceCheckBatchTarget = {
  partId: string;
  partName: string;
  category: PhysicalOverrideCategory;
  sourceUrl: string;
  manufacturerModel: string;
};

export type PhysicalSourceCheckBatchOptions = {
  limit?: number;
  concurrency?: number;
  persist?: boolean;
  now?: () => string;
  check?: (sourceUrl: string, manufacturerModel: string) => Promise<PhysicalSourceCheck>;
  persistCheck?: (partId: string, sourceCheck: PhysicalSourceCheck) => Promise<unknown>;
  skipped?: Array<{ partId: string; partName?: string; reason: string }>;
};

function fallbackSourceCheck(sourceUrl: string, checkedAt: string): PhysicalSourceCheck {
  return {
    requestedUrl: sourceUrl,
    checkedAt,
    status: "unreachable",
    identityStatus: "not_checked",
    redirectCount: 0,
    detail: "근거 URL 점검 중 예기치 않은 오류가 발생했습니다."
  };
}

export async function physicalSourceCheckBatchFor(targets: PhysicalSourceCheckBatchTarget[], options: PhysicalSourceCheckBatchOptions = {}): Promise<PhysicalSourceCheckBatchResponse> {
  const limit = Number.isFinite(options.limit) ? Math.min(50, Math.max(1, Math.floor(options.limit ?? 20))) : 20;
  const concurrency = Number.isFinite(options.concurrency) ? Math.min(4, Math.max(1, Math.floor(options.concurrency ?? 2))) : 2;
  const persist = options.persist === true;
  const checkedAt = options.now?.() ?? new Date().toISOString();
  const check = options.check ?? checkPhysicalSourceUrl;
  const selectedTargets = targets.slice(0, limit);
  const items: PhysicalSourceCheckBatchItem[] = [];

  for (let index = 0; index < selectedTargets.length; index += concurrency) {
    const chunk = selectedTargets.slice(index, index + concurrency);
    const checkedChunk = await Promise.all(chunk.map(async (target) => {
      let sourceCheck: PhysicalSourceCheck;
      try {
        sourceCheck = await check(target.sourceUrl, target.manufacturerModel);
      } catch {
        sourceCheck = fallbackSourceCheck(target.sourceUrl, checkedAt);
      }
      let persisted = false;
      if (persist && options.persistCheck) {
        try {
          persisted = Boolean(await options.persistCheck(target.partId, sourceCheck));
        } catch {
          persisted = false;
        }
      }
      return { partId: target.partId, partName: target.partName, category: target.category, sourceUrl: target.sourceUrl, sourceCheck, persisted };
    }));
    items.push(...checkedChunk);
  }

  return {
    checkedAt,
    persisted: persist,
    totalCandidates: targets.length,
    checkedCount: items.length,
    reviewCount: items.filter((item) => physicalSourceCheckNeedsReview(item.sourceCheck, true, checkedAt)).length,
    passedCount: items.filter((item) => !physicalSourceCheckNeedsReview(item.sourceCheck, true, checkedAt)).length,
    persistedCount: items.filter((item) => item.persisted).length,
    persistFailureCount: persist ? items.filter((item) => !item.persisted).length : 0,
    items,
    skipped: options.skipped ?? []
  };
}
