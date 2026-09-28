const TITLE_COPY: Record<string, string> = {
  "구매 전 수정 필요": "구매 전 확인 필요",
  "차단 위험 악화": "호환 문제 증가",
  "검토 항목 증가": "확인할 항목 증가"
};

export function savedBuildMonitorTitleForDisplay(title: string) {
  return TITLE_COPY[title] ?? title;
}

export function savedBuildMonitorSummaryForDisplay(summary: string) {
  return summary
    .replace(/차단\s*\+\s*(\d+)/g, "호환 불가 +$1")
    .replace(/차단\s*-\s*(\d+)/g, "호환 불가 -$1")
    .replace(/(\d+)개 차단/g, "호환 불가 $1개")
    .replace(/(\d+) 차단/g, "호환 불가 $1개")
    .replace("전력·냉각 예산 기준 미달", "전력·냉각 여유 부족")
    .replace("전력·냉각 수치 확인 필요", "전력·냉각 정보를 더 확인해야 해요.")
    .replace("전력·냉각 여유 좁음", "전력·냉각 여유가 좁아요.");
}
