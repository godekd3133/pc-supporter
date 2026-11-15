import type { PartCategory } from "./types";
import { engineTargetFilterRuleForCategory } from "./engine-target-filters";
import type { EngineCategoryTargetFilter, EngineTargetFilterFacet } from "./engine-target-filters";

// 공개 부품 찾기/부품 선택기의 세부 조건(상세 검색) 패널 — 다나와 카테고리 목록
// (prod.danawa.com/list/?cate=…)의 필터 패널과 같은 그룹/순서/이름을 쓴다. 우리
// 카탈로그 스펙에 값이 없는 다나와 그룹(코드네임, L2/L3 캐시, 팬 커넥터, 색상 등)은
// 뺀다. 관리자 생성기 필터(ENGINE_TARGET_FILTER_FACETS)와 저장된 설정은 그대로다.
const BRANDS: EngineTargetFilterFacet = { id: "brands", kind: "brands", label: "제조사별" };
const PRICE: EngineTargetFilterFacet = { id: "price", kind: "price", label: "가격대" };

export const PUBLIC_CATALOG_FILTER_FACETS: Record<PartCategory, EngineTargetFilterFacet[]> = {
  // 다나와 CPU(112747): 제조사별 / 코드 네임 / CPU 시리즈 / CPU 종류 / 소켓 구분 / 코어 수 / 스레드 수 / L2·L3 캐시 / 내장그래픽 / 가격대
  cpu: [
    BRANDS,
    { id: "cpuSeries", kind: "values", label: "CPU 시리즈" },
    { id: "socket", kind: "values", label: "소켓 구분" },
    { id: "cores", kind: "range", label: "코어 수", unit: "코어", checkboxOnly: true, buckets: [{ label: "24코어 이상", min: 24 }, { label: "16~23코어", min: 16, max: 23 }, { label: "10~14코어", min: 10, max: 14 }, { label: "8코어", min: 8, max: 8 }, { label: "6코어", min: 6, max: 6 }, { label: "4코어 이하", max: 4 }] },
    { id: "threads", kind: "range", label: "스레드 수", unit: "스레드", checkboxOnly: true, buckets: [{ label: "32스레드 이상", min: 32 }, { label: "20~28스레드", min: 20, max: 28 }, { label: "16스레드", min: 16, max: 16 }, { label: "12스레드", min: 12, max: 12 }, { label: "8스레드 이하", max: 8 }] },
    { id: "integratedGraphics", kind: "flag", label: "내장그래픽", optionLabel: "탑재" },
    PRICE
  ],
  // 다나와 쿨러(11236855): 제조사별 / 제품 종류 / 냉각 방식 / 공랭 형태 / 높이 / 라디에이터 / 팬 크기 / 팬 커넥터 / 부가기능 / 가격대
  cooler: [
    BRANDS,
    { id: "coolerType", kind: "values", label: "냉각 방식" },
    { id: "maxCoolerHeightMm", kind: "range", label: "높이", unit: "mm", checkboxOnly: true, buckets: [{ label: "200~", min: 200 }, { label: "170~199", min: 170, max: 199 }, { label: "160~169", min: 160, max: 169 }, { label: "150~159", min: 150, max: 159 }, { label: "125~149", min: 125, max: 149 }, { label: "~124", max: 124 }] },
    { id: "radiatorSizeMm", kind: "values", label: "라디에이터" },
    PRICE
  ],
  // 다나와 메인보드(112751): (제조사별) / CPU 소켓 / 세부 칩셋 / 폼팩터 / 메모리 종류 / 메모리 슬롯 / VGA 연결 / M.2 / 무선랜 종류 / 특징 / 가격대
  // 메인보드는 제조사 검색을 두지 않는다 — 소켓/칩셋/폼팩터가 먼저다.
  motherboard: [
    { id: "socket", kind: "values", label: "CPU 소켓" },
    { id: "chipset", kind: "values", label: "세부 칩셋" },
    { id: "formFactor", kind: "values", label: "폼팩터" },
    { id: "memoryType", kind: "values", label: "메모리 종류" },
    { id: "memorySlots", kind: "range", label: "메모리 슬롯", unit: "개", checkboxOnly: true, buckets: [{ label: "5개 이상", min: 5 }, { label: "4개", min: 4, max: 4 }, { label: "2개", min: 2, max: 2 }, { label: "1개", min: 1, max: 1 }] },
    { id: "m2Slots", kind: "range", label: "M.2", unit: "개", checkboxOnly: true, buckets: [{ label: "6개 이상", min: 6 }, { label: "5개", min: 5, max: 5 }, { label: "4개", min: 4, max: 4 }, { label: "3개", min: 3, max: 3 }, { label: "2개", min: 2, max: 2 }, { label: "1개", min: 1, max: 1 }] },
    { id: "wifi", kind: "flag", label: "무선랜 종류", optionLabel: "무선랜(Wi-Fi)" },
    PRICE
  ],
  // 다나와 RAM(112752): 제조사별 / 사용 장치 / 제품 분류 / 메모리 용량 / 램개수 / 동작클럭(대역폭) / 램타이밍 / 히트싱크 / 방열판 색상 / 부가기능 / 가격대
  memory: [
    BRANDS,
    { id: "formFactor", kind: "values", label: "사용 장치" },
    { id: "memoryType", kind: "values", label: "제품 분류" },
    { id: "capacityGb", kind: "range", label: "메모리 용량", unit: "GB", checkboxOnly: true, buckets: [{ label: "64GB", min: 64, max: 64 }, { label: "48GB", min: 48, max: 48 }, { label: "32GB", min: 32, max: 32 }, { label: "16GB", min: 16, max: 16 }, { label: "8GB", min: 8, max: 8 }] },
    { id: "memoryModuleCountPerKit", kind: "values", label: "램개수" },
    { id: "speedMhz", kind: "range", label: "동작클럭(대역폭)", unit: "MHz", checkboxOnly: true, buckets: [{ label: "7200MHz~", min: 7200 }, { label: "6400MHz", min: 6400, max: 7199 }, { label: "6000MHz", min: 6000, max: 6399 }, { label: "5600MHz", min: 5600, max: 5999 }, { label: "4800~5200MHz", min: 4800, max: 5599 }, { label: "3600MHz", min: 3600, max: 4799 }, { label: "3200MHz", min: 3200, max: 3599 }, { label: "~3199MHz", max: 3199 }] },
    { id: "memoryCasLatency", kind: "range", label: "램타이밍", unit: "CL", checkboxOnly: true, buckets: [{ label: "CL30", min: 30, max: 30 }, { label: "CL32", min: 32, max: 32 }, { label: "CL34", min: 34, max: 34 }, { label: "CL36", min: 36, max: 36 }, { label: "CL40", min: 40, max: 40 }, { label: "CL46", min: 46, max: 46 }, { label: "CL22", min: 22, max: 22 }, { label: "CL16", min: 16, max: 16 }] },
    { id: "memoryProfiles", kind: "values", label: "부가기능" },
    PRICE
  ],
  // 다나와 그래픽카드(112753): 제조사별 / NVIDIA·AMD·인텔 칩셋 / 인터페이스 / 메모리 용량 / 권장 파워용량 / 팬 개수 / 가로(길이) / 색상 / 가격대
  // 칩셋 모델 필드가 없어 칩셋 제조사·시리즈로 묶는다. 두께는 케이스 장착 확인용으로 마지막에 둔다.
  gpu: [
    BRANDS,
    { id: "gpuVendor", kind: "values", label: "칩셋 제조사" },
    { id: "gpuArchitectureFamily", kind: "values", label: "칩셋 시리즈" },
    { id: "vramGb", kind: "range", label: "메모리 용량", unit: "GB", checkboxOnly: true, buckets: [{ label: "32GB", min: 32, max: 32 }, { label: "24GB", min: 24, max: 24 }, { label: "16GB", min: 16, max: 16 }, { label: "12GB", min: 12, max: 12 }, { label: "8GB", min: 8, max: 8 }, { label: "6GB 이하", max: 6 }] },
    { id: "recommendedPsuW", kind: "range", label: "권장 파워용량", unit: "W", checkboxOnly: true, buckets: [{ label: "450W 이상", min: 450, max: 549 }, { label: "550W 이상", min: 550, max: 649 }, { label: "650W 이상", min: 650, max: 749 }, { label: "750W 이상", min: 750, max: 849 }, { label: "850W 이상", min: 850, max: 999 }, { label: "1000W 이상", min: 1000 }] },
    { id: "lengthMm", kind: "range", label: "가로(길이)", unit: "mm", checkboxOnly: true, buckets: [{ label: "360~", min: 360 }, { label: "350~359", min: 350, max: 359 }, { label: "340~349", min: 340, max: 349 }, { label: "330~339", min: 330, max: 339 }, { label: "320~329", min: 320, max: 329 }, { label: "300~319", min: 300, max: 319 }, { label: "~299", max: 299 }] },
    { id: "thicknessMm", kind: "range", label: "그래픽카드 두께", unit: "mm", checkboxOnly: true, buckets: [{ label: "~41mm", max: 41 }, { label: "~51mm", max: 51 }, { label: "~61mm", max: 61 }] },
    PRICE
  ],
  // 다나와 SSD(112760): 제조사별 / 폼팩터 / 인터페이스 / 용량 / 메모리 타입 / RAM 탑재 / 순차읽기 / 순차쓰기 / 가격대
  ssd: [
    BRANDS,
    { id: "formFactor", kind: "values", label: "폼팩터" },
    { id: "interface", kind: "values", label: "인터페이스" },
    { id: "capacityGb", kind: "range", label: "용량", unit: "GB", checkboxOnly: true, buckets: [{ label: "4TB~3TB", min: 3000 }, { label: "2TB~1.1TB", min: 1100, max: 2999 }, { label: "1TB~600GB", min: 600, max: 1099 }, { label: "525GB~270GB", min: 270, max: 599 }, { label: "256GB~130GB", min: 130, max: 269 }, { label: "~129GB", max: 129 }] },
    { id: "ssdNandType", kind: "values", label: "메모리 타입" },
    { id: "sequentialReadMbps", kind: "range", label: "순차읽기", unit: "MB/s", checkboxOnly: true, buckets: [{ label: "12,000~", min: 12000 }, { label: "8,000~11,999", min: 8000, max: 11999 }, { label: "6,000~7,999", min: 6000, max: 7999 }, { label: "4,000~5,999", min: 4000, max: 5999 }, { label: "2,500~3,999", min: 2500, max: 3999 }, { label: "~2,499", max: 2499 }] },
    { id: "sequentialWriteMbps", kind: "range", label: "순차쓰기", unit: "MB/s", checkboxOnly: true, buckets: [{ label: "9,000~", min: 9000 }, { label: "7,000~8,999", min: 7000, max: 8999 }, { label: "6,000~6,999", min: 6000, max: 6999 }, { label: "5,000~5,999", min: 5000, max: 5999 }, { label: "4,000~4,999", min: 4000, max: 4999 }, { label: "~3,999", max: 3999 }] },
    PRICE
  ],
  // 다나와 HDD(112763): 제조사별 / 시리즈 구분 / 디스크 용량 / 회전수 / 버퍼 용량 / 기록방식 / A/S 정보 / 패키지 구성 / 가격대
  hdd: [
    BRANDS,
    { id: "capacityGb", kind: "range", label: "디스크 용량", unit: "GB", checkboxOnly: true, buckets: [{ label: "20TB 이상", min: 20000 }, { label: "12~18TB", min: 12000, max: 19999 }, { label: "8~10TB", min: 8000, max: 11999 }, { label: "4~6TB", min: 4000, max: 7999 }, { label: "2~3TB", min: 2000, max: 3999 }, { label: "1TB 이하", max: 1999 }] },
    PRICE
  ],
  // 다나와 케이스(112775): 제조사별 / 제품 분류 / 케이스 크기 / 지원보드규격 / 측면 개폐 방식 / 파워 장착 길이 / VGA 길이 / CPU쿨러 높이 / 케이스 색상 계열 / 가격대
  case: [
    BRANDS,
    { id: "motherboardFormFactors", kind: "values", label: "지원보드규격" },
    { id: "maxPsuLengthMm", kind: "range", label: "파워 장착 길이", unit: "mm", checkboxOnly: true, buckets: [{ label: "150 미만", max: 149 }, { label: "150~169", min: 150, max: 169 }, { label: "170~179", min: 170, max: 179 }, { label: "180~199", min: 180, max: 199 }, { label: "200 이상", min: 200 }] },
    { id: "maxGpuLengthMm", kind: "range", label: "VGA 길이", unit: "mm", checkboxOnly: true, buckets: [{ label: "400~", min: 400 }, { label: "370~399", min: 370, max: 399 }, { label: "350~369", min: 350, max: 369 }, { label: "330~349", min: 330, max: 349 }, { label: "310~329", min: 310, max: 329 }, { label: "~309", max: 309 }] },
    { id: "maxCoolerHeightMm", kind: "range", label: "CPU쿨러 높이", unit: "mm", checkboxOnly: true, buckets: [{ label: "200mm 이상", min: 200 }, { label: "190~199mm", min: 190, max: 199 }, { label: "180~189mm", min: 180, max: 189 }, { label: "170~179mm", min: 170, max: 179 }, { label: "160~169mm", min: 160, max: 169 }, { label: "~159mm", max: 159 }] },
    PRICE
  ],
  // 다나와 파워(112777): 제조사별 / 제품 분류 / 정격출력 / 80PLUS인증 / ETA인증 / 케이블연결 / PCIe 16핀(12+4) / ATX12V 규격 / 가격대
  psu: [
    BRANDS,
    { id: "psuFormFactor", kind: "values", label: "제품 분류" },
    { id: "wattageW", kind: "range", label: "정격출력", unit: "W", checkboxOnly: true, buckets: [{ label: "1300W~", min: 1300 }, { label: "1000W~1299W", min: 1000, max: 1299 }, { label: "900W~999W", min: 900, max: 999 }, { label: "800W~899W", min: 800, max: 899 }, { label: "700W~799W", min: 700, max: 799 }, { label: "600W~699W", min: 600, max: 699 }, { label: "500W~599W", min: 500, max: 599 }, { label: "~499W", max: 499 }] },
    { id: "efficiency", kind: "values", label: "80PLUS인증" },
    { id: "psuCableType", kind: "values", label: "케이블연결" },
    PRICE
  ]
};

export function publicCatalogDetailFilterForCategory(rule: EngineCategoryTargetFilter | undefined, category: PartCategory) {
  return engineTargetFilterRuleForCategory(rule, category, PUBLIC_CATALOG_FILTER_FACETS[category]);
}
