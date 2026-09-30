import type { AccessoryCategory } from "./types";

const MANUAL_FIT_REVIEW_NOTICES: Partial<Record<AccessoryCategory, string>> = {
  gpu_support: "지지대 장착 방식·높이와 케이스 내부 공간이 그래픽카드에 맞는지 상품 페이지에서 확인해 주세요.",
  gpu_cooler: "그래픽카드 모델별 장착 가능 여부는 판정하지 않아요. 그래픽카드 기판·쿨러 규격과 장착 키트를 확인해 주세요.",
  memory_cooler: "메모리 모듈과 CPU 쿨러의 간섭 여부는 판정하지 않아요. DIMM 높이와 주변 공간을 확인해 주세요.",
  thermal_pad: "기기별 접촉 위치와 필요한 두께·면적은 판정하지 않아요. 적용 부위의 규격을 확인해 주세요."
};

export function accessoryFitReviewNoticeFor(category: AccessoryCategory) {
  return MANUAL_FIT_REVIEW_NOTICES[category];
}
