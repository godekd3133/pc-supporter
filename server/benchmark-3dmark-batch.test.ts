import { describe, expect, it } from "vitest";
import type { Benchmark3DMarkImportPreview, Part } from "../shared/types";
import { benchmark3DMarkBatchPreviewFor } from "./benchmark-3dmark-batch";

const catalog = [
  {
    id: "gpu-4060",
    category: "gpu",
    name: "ASUS GeForce RTX 4060 OC",
    model: "RTX 4060",
    source: "seed",
    specs: {},
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-05T00:00:00.000Z"
  },
  {
    id: "gpu-7900",
    category: "gpu",
    name: "SAPPHIRE Radeon RX 7900 XTX",
    model: "RX 7900 XTX",
    source: "seed",
    specs: {},
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-05T00:00:00.000Z"
  },
  {
    id: "cpu-9800x3d",
    category: "cpu",
    name: "AMD Ryzen 7 9800X3D",
    model: "Ryzen 7 9800X3D",
    source: "seed",
    specs: {},
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-05T00:00:00.000Z"
  }
] as Part[];

function preview(sourceUrl: string, identityStatus: Benchmark3DMarkImportPreview["identityStatus"], score = 20_000): Benchmark3DMarkImportPreview {
  const portRoyal = sourceUrl.includes("/prt/");
  return {
    sourceUrl,
    resultId: sourceUrl.split("/").pop() ?? "1",
    benchmark: portRoyal ? "port_royal" : "time_spy",
    benchmarkLabel: portRoyal ? "3DMark Port Royal" : "3DMark Time Spy",
    scoreKey: portRoyal ? "gpu3dmarkPortRoyalScore" : "gpu3dmarkTimeSpyScore",
    score,
    gpuName: portRoyal ? "AMD Radeon RX 7900 XTX" : "NVIDIA GeForce RTX 4060",
    identityStatus,
    identityDetail: identityStatus === "matched" ? "일치" : "수동 검수",
    fetchedAt: "2026-09-06T00:00:00.000Z"
  };
}

describe("3DMark batch preview", () => {
  it("keeps input order, bounds concurrent imports, and separates review states", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await benchmark3DMarkBatchPreviewFor([
      { partId: "gpu-4060", sourceUrl: "https://www.3dmark.com/spy/100" },
      { partId: "gpu-7900", sourceUrl: "https://www.3dmark.com/prt/200" },
      { partId: "gpu-4060", sourceUrl: "https://www.3dmark.com/spy/101" }
    ], catalog, {
      concurrency: 2,
      now: () => "2026-09-06T00:00:00.000Z",
      importResult: async (sourceUrl) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return preview(sourceUrl, sourceUrl.includes("/prt/") ? "manual_required" : "matched");
      }
    });

    expect(maxActive).toBe(2);
    expect(result).toMatchObject({ schemaVersion: 1, kind: "3dmark-batch-preview", readOnly: true, generatedAt: "2026-09-06T00:00:00.000Z", requestedCount: 3, processedCount: 3, matchedCount: 1, reviewCount: 1, failedCount: 1 });
    expect(result.items.map((item) => item.status)).toEqual(["matched", "manual_required", "failed"]);
    expect(result.items[2]).toMatchObject({ row: 3, partId: "gpu-4060", error: "같은 GPU partId가 일괄 입력에서 중복되었습니다." });
  });

  it("reports unknown IDs, non-GPU rows, malformed rows, and import failures without aborting the batch", async () => {
    const result = await benchmark3DMarkBatchPreviewFor([
      { partId: "missing-gpu", sourceUrl: "https://www.3dmark.com/spy/1" },
      { partId: "cpu-9800x3d", sourceUrl: "https://www.3dmark.com/spy/2" },
      { partId: "gpu-4060", sourceUrl: "https://www.3dmark.com/spy/3" },
      { partId: "gpu-7900", sourceUrl: "https://www.3dmark.com/spy/4" },
      { partId: "", sourceUrl: "" }
    ], catalog, {
      importResult: async (sourceUrl) => {
        if (sourceUrl.endsWith("/4")) throw new Error("remote parser detail must not leak");
        return preview(sourceUrl, "not_found");
      }
    });

    expect(result).toMatchObject({ requestedCount: 5, processedCount: 5, matchedCount: 0, reviewCount: 1, failedCount: 4 });
    expect(result.items.map((item) => item.status)).toEqual(["failed", "failed", "not_found", "failed", "failed"]);
    expect(result.items[0].error).toBe("카탈로그에서 부품을 찾을 수 없습니다.");
    expect(result.items[1]).toMatchObject({ partName: "AMD Ryzen 7 9800X3D", error: "3DMark 일괄 미리보기는 GPU만 대상으로 합니다." });
    expect(result.items[3].error).toBe("3DMark 결과를 미리 읽지 못했습니다.");
    expect(result.items[4].error).toBe("partId와 sourceUrl은 모두 필요합니다.");
  });
});
