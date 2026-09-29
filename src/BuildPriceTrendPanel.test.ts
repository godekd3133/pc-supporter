import { describe, expect, it } from "vitest";
import { buildPriceHistoryFailureNoticeFor } from "./offline/price-history-notice";

describe("build price trend failure copy", () => {
  it("shows a calm, non-blocking explanation when offline snapshots have no price history", () => {
    expect(buildPriceHistoryFailureNoticeFor("OFFLINE_FEATURE_UNAVAILABLE")).toEqual({
      kind: "offline-unavailable",
      message: "오프라인 설치 데이터에는 과거 가격 기록이 포함되지 않아요. 현재 합계를 표시합니다."
    });
  });

  it("keeps the current online failure message unchanged", () => {
    expect(buildPriceHistoryFailureNoticeFor("UPSTREAM_TIMEOUT")).toEqual({
      kind: "error",
      message: "가격 이력을 불러오지 못했습니다. 현재 합계만 표시합니다."
    });
  });
});
