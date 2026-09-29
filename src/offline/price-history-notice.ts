export type PriceHistoryFailureNotice = { kind: "offline-unavailable" | "error"; message: string };

export function buildPriceHistoryFailureNoticeFor(code: unknown): PriceHistoryFailureNotice {
  return code === "OFFLINE_FEATURE_UNAVAILABLE"
    ? { kind: "offline-unavailable", message: "오프라인 설치 데이터에는 과거 가격 기록이 포함되지 않아요. 현재 합계를 표시합니다." }
    : { kind: "error", message: "가격 이력을 불러오지 못했습니다. 현재 합계만 표시합니다." };
}
