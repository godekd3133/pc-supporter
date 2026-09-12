import { BENCHMARK_3DMARK_BATCH_MAX_ITEMS } from "../shared/types";
import type { Benchmark3DMarkBatchItem, Benchmark3DMarkBatchResponse, Benchmark3DMarkImportPreview, Part } from "../shared/types";
import { Benchmark3DMarkImportError, import3DMarkResult } from "./benchmark-3dmark";

export { BENCHMARK_3DMARK_BATCH_MAX_ITEMS };

const DEFAULT_CONCURRENCY = 2;

export type Benchmark3DMarkBatchImportDependencies = {
  concurrency?: number;
  now?: () => string;
  importResult?: (sourceUrl: string, partName: string, partModel: string | undefined) => Promise<Benchmark3DMarkImportPreview>;
};

type ValidBatchTarget = {
  row: number;
  partId: string;
  sourceUrl: string;
  part: Part;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function failedItem(row: number, partId: string, sourceUrl: string, error: string, partName?: string): Benchmark3DMarkBatchItem {
  return { row, partId, sourceUrl, ...(partName ? { partName } : {}), status: "failed", error };
}

function importErrorMessage(error: unknown) {
  if (error instanceof Benchmark3DMarkImportError) return error.message;
  return "3DMark 결과를 미리 읽지 못했습니다.";
}

/**
 * Preview-only batch import. It deliberately returns per-row failures and never
 * calls the benchmark override persistence layer. The caller must still pass
 * matched previews through the existing JSON validation/save gate.
 */
export async function benchmark3DMarkBatchPreviewFor(rawItems: unknown[], catalog: Part[], options: Benchmark3DMarkBatchImportDependencies = {}): Promise<Benchmark3DMarkBatchResponse> {
  const generatedAt = options.now?.() ?? new Date().toISOString();
  const concurrency = Number.isFinite(options.concurrency)
    ? Math.min(4, Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY)))
    : DEFAULT_CONCURRENCY;
  const itemsByRow = new Map<number, Benchmark3DMarkBatchItem>();
  const targets: ValidBatchTarget[] = [];
  const seenPartIds = new Set<string>();

  for (const [index, rawItem] of rawItems.entries()) {
    const row = index + 1;
    const candidate = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem) ? rawItem as Record<string, unknown> : {};
    const partId = stringValue(candidate.partId);
    const sourceUrl = stringValue(candidate.sourceUrl);
    if (!partId || !sourceUrl) {
      itemsByRow.set(row, failedItem(row, partId, sourceUrl, "partId와 sourceUrl은 모두 필요합니다."));
      continue;
    }
    if (partId.length > 200) {
      itemsByRow.set(row, failedItem(row, partId, sourceUrl, "partId는 200자 이하로 입력해야 합니다."));
      continue;
    }
    if (sourceUrl.length > 1_000) {
      itemsByRow.set(row, failedItem(row, partId, sourceUrl, "sourceUrl은 1,000자 이하로 입력해야 합니다."));
      continue;
    }
    if (seenPartIds.has(partId)) {
      itemsByRow.set(row, failedItem(row, partId, sourceUrl, "같은 GPU partId가 일괄 입력에서 중복되었습니다."));
      continue;
    }
    seenPartIds.add(partId);
    const part = catalog.find((candidatePart) => candidatePart.id === partId);
    if (!part) {
      itemsByRow.set(row, failedItem(row, partId, sourceUrl, "카탈로그에서 부품을 찾을 수 없습니다."));
      continue;
    }
    if (part.category !== "gpu") {
      itemsByRow.set(row, failedItem(row, partId, sourceUrl, "3DMark 일괄 미리보기는 GPU만 대상으로 합니다.", part.name));
      continue;
    }
    targets.push({ row, partId, sourceUrl, part });
  }

  const importResult = options.importResult ?? ((sourceUrl: string, partName: string, partModel: string | undefined) => import3DMarkResult(sourceUrl, partName, partModel, {}));
  for (let index = 0; index < targets.length; index += concurrency) {
    const chunk = targets.slice(index, index + concurrency);
    const importedChunk = await Promise.all(chunk.map(async (target) => {
      try {
        const preview = await importResult(target.sourceUrl, target.part.name, target.part.model);
        return {
          row: target.row,
          partId: target.partId,
          sourceUrl: target.sourceUrl,
          partName: target.part.name,
          status: preview.identityStatus,
          preview
        } satisfies Benchmark3DMarkBatchItem;
      } catch (error: unknown) {
        return failedItem(target.row, target.partId, target.sourceUrl, importErrorMessage(error), target.part.name);
      }
    }));
    importedChunk.forEach((item) => itemsByRow.set(item.row, item));
  }

  const items = rawItems.map((_rawItem, index) => itemsByRow.get(index + 1) ?? failedItem(index + 1, "", "", "일괄 미리보기 결과를 만들지 못했습니다."));
  const matchedCount = items.filter((item) => item.status === "matched").length;
  const reviewCount = items.filter((item) => item.status === "manual_required" || item.status === "not_found").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  return {
    schemaVersion: 1,
    kind: "3dmark-batch-preview",
    readOnly: true,
    generatedAt,
    maxItems: BENCHMARK_3DMARK_BATCH_MAX_ITEMS,
    requestedCount: rawItems.length,
    processedCount: items.length,
    matchedCount,
    reviewCount,
    failedCount,
    items
  };
}
