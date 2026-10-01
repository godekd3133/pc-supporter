import type { PartCategory, RecommendationProfile } from "./types";

// 실제 판매 조립PC 견적을 전사한 참조 견적표다. 출처는 두 곳 — 유튜브
// "체험판" 채널 견적 소개 영상(youtu.be/1lkdO8UAka4, 5:28~7:43 구간)과
// 온라인 조립PC 판매처 라인업(AURA PC/오버시스템 상품 목록, 컴퓨존 추천조립PC).
// 자동 구성 엔진이 CPU·GPU 조합을 정할 때 예산대별로 실제 매장이 선택한 부품
// 등급의 쌍을 soft preference로 참고한다 — hard gate가 아니라 점수 보너스로만
// 작용한다. 게이밍 조립PC의 상업적 패턴은 "CPU는 미드~X3D 대역에 플랫하게 묶고
// 예산 증가분은 GPU 등급에 실는다"는 것이라, 같은 예산대에 인텔·AMD 두 갈래의
// 대표 페어링을 둘 수록한다.
export type ReferenceBuild = {
  id: string;
  label: string;
  profile: RecommendationProfile;
  budgetWon: number;
  /** 원문 부품명 — cpu/gpu는 모델 계열 매칭에 쓰이고, 나머지는 구성 맥락 기록용이다. */
  parts: Partial<Record<PartCategory, string>>;
};

const AM4_SHARED = {
  motherboard: "ASUS PRIME A520M-A II",
  ssd: "삼성전자 PM9A1 M.2 NVMe 512GB",
  case: "DAVEN D6 MESH 강화유리",
  psu: "GIGABYTE P650SS 80PLUS실버 FDB ATX3.0"
} satisfies Partial<Record<PartCategory, string>>;

const AM5_SETTLER = {
  motherboard: "GIGABYTE B650M K",
  ssd: "삼성전자 PM9A1 M.2 NVMe 512GB",
  case: "DAVEN D7 MESH 세븐팬",
  psu: "앱코 SETTLER 하이브리드 PCIE5.1 STH-800B ETA BRONZE",
  cooler: "PCCOOLER CPS RT620 PRO 카본스틸"
} satisfies Partial<Record<PartCategory, string>>;

const AM5_CENTURY = {
  ...AM5_SETTLER,
  psu: "MONTECH CENTURY II 850 80PLUS골드 풀모듈러 ATX3.1"
} satisfies Partial<Record<PartCategory, string>>;

const CPU_5600 = "AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)";
const CPU_7500X3D = "AMD 라이젠5-5세대 7500X3D (라파엘)";
const CPU_9800X3D = "AMD 라이젠7-6세대 9800X3D (그래니트 릿지)";
const GPU_RTX_5050 = "COLORFUL 지포스 RTX 5050 GAMING DUO OC D6 8GB";
const GPU_RTX_5060TI = "기가바이트 RTX 5060 Ti WINDFORCE OC D7 8GB";
const RAM_AGI_16X1 = "AGI DDR5-5600 CL46 UD238 (16GB) *1";
const RAM_AGI_16X2 = "AGI DDR5-5600 CL46 UD238 (16GB) *2";

export const REFERENCE_BUILDS: readonly ReferenceBuild[] = [
  {
    id: "reference-office-81",
    label: "사무용 (라이젠) 약 81만원",
    profile: "office",
    budgetWon: 810_000,
    parts: {
      cpu: "AMD 라이젠5-4세대 5500GT (세잔)",
      ...AM4_SHARED,
      memory: "컴이지 킹덤 DDR4-3200 CL22 (8GB) *2",
      cooler: "기본 번들 쿨러"
    }
  },
  {
    id: "reference-gaming-99-am4",
    label: "게임용 (라이젠 AM4 캐주얼) 약 99만원",
    profile: "gaming",
    budgetWon: 990_000,
    parts: {
      cpu: CPU_5600,
      ...AM4_SHARED,
      memory: "컴이지 킹덤 DDR4-3200 CL22 (8GB) *2",
      gpu: "액슬 라데온 RX 580 2048SP D5 8GB R2",
      cooler: "DarkFlash Ellsworth S21"
    }
  },
  {
    id: "reference-gaming-138-am4",
    label: "게임용 (라이젠 AM4) 약 138만원",
    profile: "gaming",
    budgetWon: 1_380_000,
    parts: {
      cpu: CPU_5600,
      ...AM4_SHARED,
      memory: "컴이지 킹덤 DDR4-3200 CL22 (16GB) *2",
      gpu: GPU_RTX_5050,
      cooler: "DarkFlash Ellsworth S21"
    }
  },
  {
    id: "reference-gaming-148-am5",
    label: "게임용 (라이젠 AM5) 약 148만원",
    profile: "gaming",
    budgetWon: 1_480_000,
    parts: {
      cpu: "AMD 라이젠5-5세대 7500F (라파엘)",
      ...AM5_SETTLER,
      memory: RAM_AGI_16X1,
      gpu: GPU_RTX_5050
    }
  },
  {
    id: "reference-gaming-164-am5",
    label: "게임용 (라이젠 AM5) 약 164만원",
    profile: "gaming",
    budgetWon: 1_640_000,
    parts: {
      cpu: CPU_7500X3D,
      ...AM5_SETTLER,
      memory: RAM_AGI_16X1,
      gpu: GPU_RTX_5050
    }
  },
  {
    id: "reference-gaming-179-am5",
    label: "게임용 (라이젠 AM5) 약 179만원",
    profile: "gaming",
    budgetWon: 1_790_000,
    parts: {
      cpu: CPU_7500X3D,
      ...AM5_SETTLER,
      memory: RAM_AGI_16X1,
      gpu: GPU_RTX_5060TI
    }
  },
  {
    id: "reference-gaming-211-am5",
    label: "게임용 (라이젠 AM5) 약 211만원",
    profile: "gaming",
    budgetWon: 2_110_000,
    parts: {
      cpu: CPU_7500X3D,
      ...AM5_SETTLER,
      memory: RAM_AGI_16X2,
      gpu: GPU_RTX_5060TI
    }
  },
  {
    id: "reference-gaming-220-am5",
    label: "게임용 (라이젠 AM5) 약 220만원",
    profile: "gaming",
    budgetWon: 2_200_000,
    parts: {
      cpu: "AMD 라이젠7-5세대 7800X3D (라파엘)",
      ...AM5_SETTLER,
      memory: RAM_AGI_16X2,
      gpu: GPU_RTX_5060TI
    }
  },
  {
    id: "reference-gaming-242-am5",
    label: "게임용 (라이젠 AM5) 약 242만원",
    profile: "gaming",
    budgetWon: 2_420_000,
    parts: {
      cpu: CPU_9800X3D,
      ...AM5_SETTLER,
      memory: RAM_AGI_16X2,
      gpu: GPU_RTX_5060TI
    }
  },
  {
    id: "reference-gaming-288-am5",
    label: "게임용 (라이젠 AM5) 약 288만원",
    profile: "gaming",
    budgetWon: 2_880_000,
    parts: {
      cpu: CPU_9800X3D,
      ...AM5_SETTLER,
      memory: RAM_AGI_16X2,
      gpu: "COLORFUL RTX 5070 GAMING D7 12GB"
    }
  },
  {
    id: "reference-gaming-346-am5",
    label: "게임용 (라이젠 AM5) 약 346만원",
    profile: "gaming",
    budgetWon: 3_460_000,
    parts: {
      cpu: CPU_9800X3D,
      ...AM5_CENTURY,
      memory: RAM_AGI_16X2,
      gpu: "기가바이트 RTX 5070 Ti WINDFORCE OC V2 D7 16GB"
    }
  },
  {
    id: "reference-gaming-403-am5",
    label: "게임용 (라이젠 AM5) 약 403만원",
    profile: "gaming",
    budgetWon: 4_030_000,
    parts: {
      cpu: CPU_9800X3D,
      ...AM5_CENTURY,
      memory: RAM_AGI_16X2,
      gpu: "기가바이트 RTX 5080 WINDFORCE OC SFF D7 16GB"
    }
  },
  {
    id: "reference-gaming-946-am5",
    label: "게임용 (라이젠 AM5) 약 946만원",
    profile: "gaming",
    budgetWon: 9_460_000,
    parts: {
      cpu: CPU_9800X3D,
      ...AM5_SETTLER,
      memory: RAM_AGI_16X2,
      gpu: "RTX 5090 (시장 재고 거의 없음. 재고있는 제품으로)",
      psu: "슈퍼플라워 SF-1000F14GE LEADEX III GOLD UP ATX3.1"
    }
  },
  // ── AURA PC(오버시스템)·컴퓨존 추천조립PC 라인업 — 2025년 하반기 판매 상품의
  // CPU/GPU 페어링. 가격대마다 CPU는 7500F~9800X3D·i5~i7급으로 좁게 묶이고
  // GPU 등급이 올라가는 "플랫 페어링" 패턴이다. parts의 나머지 항목은 매칭에
  // 쓰이지 않으므로 CPU/GPU만 기록한다.
  {
    id: "reference-gaming-aura-110",
    label: "AURA PC 입출문 약 110만원",
    profile: "gaming",
    budgetWon: 1_100_000,
    parts: { cpu: "인텔 코어i5-14세대 14400F (랩터레이크 리프레시)", gpu: "RTX 3050 6GB" }
  },
  {
    id: "reference-gaming-aura-110-am4",
    label: "AURA PC 입출문 (라이젠) 약 110만원",
    profile: "gaming",
    budgetWon: 1_100_000,
    parts: { cpu: "AMD 라이젠5-4세대 5600 (버미어)", gpu: "RTX 3050 6GB" }
  },
  {
    id: "reference-gaming-aura-150",
    label: "AURA PC 보급 약 150만원",
    profile: "gaming",
    budgetWon: 1_500_000,
    parts: { cpu: "인텔 코어i5-14세대 14400F (랩터레이크 리프레시)", gpu: "RTX 5060 8GB" }
  },
  {
    id: "reference-gaming-aura-152-amd",
    label: "AURA PC 보급 (라이젠) 약 152만원",
    profile: "gaming",
    budgetWon: 1_520_000,
    parts: { cpu: "AMD 라이젠5-5세대 7500F (라파엘)", gpu: "RX 9060 XT 8GB" }
  },
  {
    id: "reference-gaming-cz-160",
    label: "컴퓨존 추천조립PC 약 160만원",
    profile: "gaming",
    budgetWon: 1_600_000,
    parts: { cpu: "AMD 라이젠5-5세대 7500F (라파엘)", gpu: "RTX 5060 Ti 8GB" }
  },
  {
    id: "reference-gaming-aura-180",
    label: "AURA PC 주력 약 180만원",
    profile: "gaming",
    budgetWon: 1_800_000,
    parts: { cpu: "AMD 라이젠5-5세대 7500F (라파엘)", gpu: "RTX 5060 Ti 8GB" }
  },
  {
    id: "reference-gaming-aura-182-intel",
    label: "AURA PC 주력 (인텔) 약 182만원",
    profile: "gaming",
    budgetWon: 1_820_000,
    parts: { cpu: "인텔 코어i5-14세대 14600KF (랩터레이크 리프레시)", gpu: "RTX 5060 Ti 8GB" }
  },
  {
    id: "reference-gaming-cz-217",
    label: "컴퓨존 추천조립PC R7885 약 217만원",
    profile: "gaming",
    budgetWon: 2_170_000,
    parts: { cpu: "AMD 라이젠7-5세대 7800X3D (라파엘)", gpu: "RTX 5060 Ti 8GB" }
  },
  {
    id: "reference-gaming-aura-230",
    label: "AURA PC 고급 약 230만원",
    profile: "gaming",
    budgetWon: 2_300_000,
    parts: { cpu: "AMD 라이젠5-6세대 9600X (그래니트 릿지)", gpu: "RX 9070 16GB" }
  },
  {
    id: "reference-gaming-aura-234-x3d",
    label: "AURA PC 고급 (X3D) 약 234만원",
    profile: "gaming",
    budgetWon: 2_340_000,
    parts: { cpu: "AMD 라이젠7-5세대 7800X3D (라파엘)", gpu: "RTX 5060 Ti 16GB" }
  },
  {
    id: "reference-gaming-aura-320",
    label: "AURA PC 고성능 약 320만원",
    profile: "gaming",
    budgetWon: 3_200_000,
    parts: { cpu: "AMD 라이젠7-5세대 7800X3D (라파엘)", gpu: "RTX 5070 12GB" }
  },
  {
    id: "reference-gaming-aura-378",
    label: "AURA PC 고성능 (X3D) 약 378만원",
    profile: "gaming",
    budgetWon: 3_780_000,
    parts: { cpu: CPU_9800X3D, gpu: "RX 9070 XT 16GB" }
  },
  {
    id: "reference-gaming-aura-420",
    label: "AURA PC 최상급 약 420만원",
    profile: "gaming",
    budgetWon: 4_200_000,
    parts: { cpu: CPU_9800X3D, gpu: "RTX 5070 Ti 16GB" }
  },
  {
    id: "reference-gaming-aura-500",
    label: "AURA PC 플래그십 약 500만원",
    profile: "gaming",
    budgetWon: 5_000_000,
    parts: { cpu: CPU_9800X3D, gpu: "RTX 5080 16GB" }
  },
  {
    id: "reference-gaming-aura-500-intel",
    label: "AURA PC 플래그십 (인텔) 약 500만원",
    profile: "gaming",
    budgetWon: 5_000_000,
    parts: { cpu: "인텔 코어 울트라9 시리즈2 285K (애로우레이크)", gpu: "RTX 5080 16GB" }
  }
];

// 요청 예산과 참조 견적 예산의 거리를 0~1 가중치로 바꾼다. 같은 예산이면 1,
// 2배(또는 절반) 차이면 0이 되는 로그 스케일 — 예산이 두 배 벌어지면 부품 등급
// 판단이 이미 달라진다고 보고 무시한다.
export function referenceBuildBudgetWeight(budgetWon: number, referenceBudgetWon: number) {
  if (budgetWon <= 0 || referenceBudgetWon <= 0) return 0;
  return Math.max(0, 1 - Math.abs(Math.log2(budgetWon / referenceBudgetWon)));
}
