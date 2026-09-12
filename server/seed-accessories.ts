import type { AccessoryItem } from "../shared/types";

// 외부 수집 결과가 없는 새 checkout에서도 주변 부품 탐색·호환 판정을
// 재현할 수 있도록 제공하는 개발용 starter catalog입니다. 실판매가나
// 최신 재고를 의미하지 않으며, live 수집 결과가 들어오면 merge됩니다.
const updatedAt = "2026-08-26T00:00:00.000Z";

const seed = (item: Omit<AccessoryItem, "source" | "listingType" | "dataQuality" | "missingFields" | "updatedAt">): AccessoryItem => ({
  ...item,
  source: "manual",
  listingType: "accessory",
  dataQuality: "seed",
  missingFields: [],
  updatedAt
});

export const seedAccessories: AccessoryItem[] = [
  seed({
    id: "accessory-seed-m2-pcie-2280",
    category: "storage_accessory",
    name: "M.2 NVMe to PCIe x4 어댑터 2280",
    brand: "PC Supporter",
    model: "M2-PCIE-2280",
    priceWon: 12900,
    rawSpecText: "M.2 2280 · M-Key · NVMe → PCIe x4 · 보관(장착) 개수: 최대 1개",
    specs: { formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], interface: "NVMe", adapterStorageDeviceCount: 1, adapterPcieSlotWidth: 4 }
  }),
  seed({
    id: "accessory-seed-m2-sata-2280",
    category: "storage_accessory",
    name: "M.2 SATA to 2.5인치 변환 어댑터",
    brand: "PC Supporter",
    model: "M2-SATA-25",
    priceWon: 9900,
    rawSpecText: "M.2 2280 · B-Key · SATA/NGFF → SATA 2.5인치 · 보관(장착) 개수: 최대 1개",
    specs: { formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], interface: "SATA", adapterStorageDeviceCount: 1 }
  }),
  seed({
    id: "accessory-seed-25-drive-bracket",
    category: "storage_accessory",
    name: "2.5인치 SSD 장착 브라켓",
    brand: "PC Supporter",
    model: "SSD-BRACKET-25",
    priceWon: 6900,
    rawSpecText: "2.5인치 SATA SSD용 · 3.5인치 베이 장착 브라켓",
    specs: { formFactor: "2.5인치", supportedFormFactors: ["2.5인치"] }
  }),
  seed({
    id: "accessory-seed-fan-120-pwm",
    category: "cooling_fan",
    name: "120mm PWM 시스템 팬",
    brand: "PC Supporter",
    model: "FAN-120-PWM",
    priceWon: 7900,
    rawSpecText: "120mm · 4핀 PWM · 팬 전류 0.20A · 비RGB",
    specs: { lengthMm: 120, widthMm: 120, fanCount: 1, fanCurrentA: 0.2 }
  }),
  seed({
    id: "accessory-seed-fan-120-argb",
    category: "cooling_fan",
    name: "120mm PWM ARGB 시스템 팬",
    brand: "PC Supporter",
    model: "FAN-120-ARGB",
    priceWon: 11900,
    rawSpecText: "120mm · 4핀 PWM · 팬 전류 0.22A · ARGB 3핀 5V",
    specs: { lengthMm: 120, widthMm: 120, fanCount: 1, fanCurrentA: 0.22, rgbDeviceVoltage: "5V" }
  }),
  seed({
    id: "accessory-seed-fan-140-argb",
    category: "cooling_fan",
    name: "140mm PWM ARGB 시스템 팬",
    brand: "PC Supporter",
    model: "FAN-140-ARGB",
    priceWon: 14900,
    rawSpecText: "140mm · 4핀 PWM · 팬 전류 0.28A · ARGB 3핀 5V",
    specs: { lengthMm: 140, widthMm: 140, fanCount: 1, fanCurrentA: 0.28, rgbDeviceVoltage: "5V" }
  }),
  seed({
    id: "accessory-seed-fan-120-dc",
    category: "cooling_fan",
    name: "120mm 3핀 DC 시스템 팬",
    brand: "PC Supporter",
    model: "FAN-120-DC",
    priceWon: 5900,
    rawSpecText: "120mm · 3핀 DC · 팬 전류 0.18A · 비RGB",
    specs: { lengthMm: 120, widthMm: 120, fanCount: 1, fanCurrentA: 0.18 }
  }),
  seed({
    id: "accessory-seed-thermal-grease-basic",
    category: "thermal_grease",
    name: "고성능 써멀그리스 2g",
    brand: "PC Supporter",
    model: "TG-2G",
    priceWon: 6900,
    rawSpecText: "용량 2g · 열전도율 8.5W/(m·K)",
    specs: { capacityG: 2, thermalConductivityWmK: 8.5 }
  }),
  seed({
    id: "accessory-seed-thermal-grease-pro",
    category: "thermal_grease",
    name: "고열전도 써멀그리스 4g",
    brand: "PC Supporter",
    model: "TG-4G-PRO",
    priceWon: 12900,
    rawSpecText: "용량 4g · 열전도율 12.0W/(m·K)",
    specs: { capacityG: 4, thermalConductivityWmK: 12 }
  }),
  seed({
    id: "accessory-seed-m2-heatsink-2280",
    category: "m2_heatsink",
    name: "M.2 2280 알루미늄 방열판",
    brand: "PC Supporter",
    model: "M2-HS-2280",
    priceWon: 8900,
    rawSpecText: "M.2 2280 · 단면/양면 SSD 호환 · 열패드 포함",
    specs: { formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"] }
  }),
  seed({
    id: "accessory-seed-m2-heatsink-multi",
    category: "m2_heatsink",
    name: "M.2 2230/2242/2260/2280 방열판",
    brand: "PC Supporter",
    model: "M2-HS-MULTI",
    priceWon: 13900,
    rawSpecText: "M.2 2230/2242/2260/2280 · 양면 SSD 호환",
    specs: { formFactor: "M.2 2280", supportedFormFactors: ["M.2 2230", "M.2 2242", "M.2 2260", "M.2 2280"] }
  }),
  seed({
    id: "accessory-seed-gpu-support-adjustable",
    category: "gpu_support",
    name: "그래픽카드 길이 조절 지지대",
    brand: "PC Supporter",
    model: "GPU-BRACE-ADJ",
    priceWon: 15900,
    rawSpecText: "자석 베이스 · 높이 조절 · 대형 그래픽카드 지지용",
    specs: {}
  }),
  seed({
    id: "accessory-seed-gpu-support-vertical",
    category: "gpu_support",
    name: "GPU 수직 지지 스탠드",
    brand: "PC Supporter",
    model: "GPU-BRACE-V",
    priceWon: 21900,
    rawSpecText: "높이 조절 70~120mm · 케이스 바닥 설치형",
    specs: {}
  }),
  seed({
    id: "accessory-seed-gpu-cooler-bracket",
    category: "gpu_cooler",
    name: "그래픽카드 보조 쿨링 브라켓",
    brand: "PC Supporter",
    model: "GPU-COOLER-BRACKET",
    priceWon: 18900,
    rawSpecText: "PCI 슬롯 장착형 · 80/92mm 팬 장착 지원",
    specs: {}
  }),
  seed({
    id: "accessory-seed-memory-cooler",
    category: "memory_cooler",
    name: "DDR5 메모리 모듈 쿨링팬",
    brand: "PC Supporter",
    model: "RAM-COOLER-DDR5",
    priceWon: 17900,
    rawSpecText: "DDR5 DIMM용 · 5V ARGB · 3핀 전원",
    specs: { rgbDeviceVoltage: "5V", fanCount: 2, fanCurrentA: 0.12 }
  }),
  seed({
    id: "accessory-seed-thermal-pad-1mm",
    category: "thermal_pad",
    name: "M.2 메모리용 써멀패드 1mm",
    brand: "PC Supporter",
    model: "TP-1MM",
    priceWon: 4900,
    rawSpecText: "두께 1.0mm · M.2 방열판용 · 100 × 20mm",
    specs: {}
  }),
  seed({
    id: "accessory-seed-thermal-pad-kit",
    category: "thermal_pad",
    name: "그래픽카드·VRM 써멀패드 키트",
    brand: "PC Supporter",
    model: "TP-KIT",
    priceWon: 15900,
    rawSpecText: "두께 0.5/1.0/1.5mm 혼합 · 절단형 키트",
    specs: {}
  }),
  seed({
    id: "accessory-seed-fan-hub-6-pwm",
    category: "fan_hub",
    name: "6포트 PWM 팬 허브",
    brand: "PC Supporter",
    model: "HUB-6-PWM",
    priceWon: 12900,
    rawSpecText: "팬 분배: 6개 · 분배단자: 4핀 PWM · SATA 전원 · 최대 허용전력: 12V 2A",
    specs: { fanPortCount: 6 }
  }),
  seed({
    id: "accessory-seed-fan-hub-10-pwm",
    category: "fan_hub",
    name: "10포트 PWM·ARGB 팬 허브",
    brand: "PC Supporter",
    model: "HUB-10-PWM-ARGB",
    priceWon: 24900,
    rawSpecText: "팬 분배: 10개 · 분배단자: 4핀 PWM · RGB 분배: 10개 · 입력단자: SATA 전원 · 작동전압: LED 5V · 최대 허용전력: 5V 3A / 12V 3A",
    specs: { fanPortCount: 10, rgbPortCount: 10, rgbDeviceVoltage: "5V" }
  }),
  seed({
    id: "accessory-seed-rgb-controller-mixed",
    category: "fan_hub",
    name: "5V ARGB·12V RGB 겸용 컨트롤러",
    brand: "PC Supporter",
    model: "RGB-CONTROLLER-MIXED",
    priceWon: 29900,
    rawSpecText: "RGB 분배: 8개 · 입력단자: SATA 전원 · 작동전압: LED 5V / RGB 12V · 최대 허용전력: 5V 3A / 12V 3A",
    specs: { rgbPortCount: 8, rgbDeviceVoltage: "mixed" }
  }),
  seed({
    id: "accessory-seed-ups-300w",
    category: "ups",
    name: "정현파 UPS 300W",
    brand: "PC Supporter",
    model: "UPS-600VA",
    priceWon: 89000,
    rawSpecText: "용량 600VA · 출력 용량 (W): 300W · 콘센트 4개",
    specs: { capacityVa: 600, outputW: 300, outletCount: 4 }
  }),
  seed({
    id: "accessory-seed-ups-600w",
    category: "ups",
    name: "정현파 UPS 600W",
    brand: "PC Supporter",
    model: "UPS-1200VA",
    priceWon: 169000,
    rawSpecText: "용량 1200VA · 출력 용량 (W): 600W · 콘센트 6개",
    specs: { capacityVa: 1200, outputW: 600, outletCount: 6 }
  }),
  seed({
    id: "accessory-seed-m2-pcie-dual-2280",
    category: "storage_accessory",
    name: "M.2 NVMe 2개용 PCIe x4 어댑터",
    brand: "PC Supporter",
    model: "M2-PCIE-DUAL-2280",
    priceWon: 24900,
    rawSpecText: "M.2 2280 · M-Key · NVMe 2개 → PCIe x4 · 보관(장착) 개수: 최대 2개",
    specs: { formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], interface: "NVMe", adapterStorageDeviceCount: 2, adapterPcieSlotWidth: 4 }
  }),
  seed({
    id: "accessory-seed-35-drive-bracket",
    category: "storage_accessory",
    name: "3.5인치 HDD 진동 방지 장착 브라켓",
    brand: "PC Supporter",
    model: "HDD-BRACKET-35",
    priceWon: 9900,
    rawSpecText: "3.5인치 SATA HDD용 · 케이스 3.5인치 베이 장착 브라켓 · 진동 방지 패드 포함",
    specs: { formFactor: "3.5인치", supportedFormFactors: ["3.5인치"] }
  }),
  seed({
    id: "accessory-seed-fan-120-reverse-argb",
    category: "cooling_fan",
    name: "120mm 리버스 에어플로우 PWM ARGB 팬",
    brand: "PC Supporter",
    model: "FAN-120-REVERSE-ARGB",
    priceWon: 13900,
    rawSpecText: "120mm · 4핀 PWM · 팬 전류 0.24A · ARGB 3핀 5V · 리버스 에어플로우",
    specs: { lengthMm: 120, widthMm: 120, fanCount: 1, fanCurrentA: 0.24, rgbDeviceVoltage: "5V" }
  }),
  seed({
    id: "accessory-seed-fan-140-pwm",
    category: "cooling_fan",
    name: "140mm 저소음 PWM 시스템 팬",
    brand: "PC Supporter",
    model: "FAN-140-PWM",
    priceWon: 9900,
    rawSpecText: "140mm · 4핀 PWM · 팬 전류 0.30A · 비RGB",
    specs: { lengthMm: 140, widthMm: 140, fanCount: 1, fanCurrentA: 0.3 }
  }),
  seed({
    id: "accessory-seed-thermal-grease-1g",
    category: "thermal_grease",
    name: "CPU 교체용 써멀그리스 1g",
    brand: "PC Supporter",
    model: "TG-1G",
    priceWon: 3900,
    rawSpecText: "용량 1g · 열전도율 6.5W/(m·K)",
    specs: { capacityG: 1, thermalConductivityWmK: 6.5 }
  }),
  seed({
    id: "accessory-seed-thermal-grease-8g",
    category: "thermal_grease",
    name: "대용량 고열전도 써멀그리스 8g",
    brand: "PC Supporter",
    model: "TG-8G-PRO",
    priceWon: 19900,
    rawSpecText: "용량 8g · 열전도율 11.0W/(m·K)",
    specs: { capacityG: 8, thermalConductivityWmK: 11 }
  }),
  seed({
    id: "accessory-seed-m2-active-heatsink",
    category: "m2_heatsink",
    name: "M.2 2280 액티브 쿨링 방열판",
    brand: "PC Supporter",
    model: "M2-HS-ACTIVE-2280",
    priceWon: 24900,
    rawSpecText: "M.2 2280 · 단면/양면 SSD 호환 · 30mm 냉각팬 · 열패드 포함",
    specs: { formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], fanCount: 1, fanCurrentA: 0.15 }
  }),
  seed({
    id: "accessory-seed-m2-heatsink-22110",
    category: "m2_heatsink",
    name: "M.2 22110 서버형 SSD 방열판",
    brand: "PC Supporter",
    model: "M2-HS-22110",
    priceWon: 15900,
    rawSpecText: "M.2 22110 · 양면 SSD 호환 · 알루미늄 방열판 · 열패드 포함",
    specs: { formFactor: "M.2 22110", supportedFormFactors: ["M.2 22110"] }
  }),
  seed({
    id: "accessory-seed-gpu-support-antisag",
    category: "gpu_support",
    name: "그래픽카드 안티사그 지지 브라켓",
    brand: "PC Supporter",
    model: "GPU-BRACE-ANTISAG",
    priceWon: 12900,
    rawSpecText: "PCI 슬롯 고정형 · 그래픽카드 처짐 방지 · 높이 조절",
    specs: {}
  }),
  seed({
    id: "accessory-seed-gpu-support-universal",
    category: "gpu_support",
    name: "범용 GPU 지지 기둥 세트",
    brand: "PC Supporter",
    model: "GPU-BRACE-UNIVERSAL",
    priceWon: 18900,
    rawSpecText: "케이스 바닥 설치형 · 50~150mm 높이 조절 · 미끄럼 방지 베이스",
    specs: {}
  }),
  seed({
    id: "accessory-seed-gpu-cooler-dual-fan",
    category: "gpu_cooler",
    name: "그래픽카드 하단 듀얼팬 브라켓",
    brand: "PC Supporter",
    model: "GPU-COOLER-DUAL-120",
    priceWon: 23900,
    rawSpecText: "PCI 슬롯 장착형 · 120mm 팬 2개 장착 지원 · 팬 전류 0.24A",
    specs: { lengthMm: 120, widthMm: 120, fanCount: 2, fanCurrentA: 0.24 }
  }),
  seed({
    id: "accessory-seed-gpu-cooler-92",
    category: "gpu_cooler",
    name: "그래픽카드 보조 92mm 팬 브라켓",
    brand: "PC Supporter",
    model: "GPU-COOLER-92",
    priceWon: 14900,
    rawSpecText: "PCI 슬롯 장착형 · 92mm 팬 1개 장착 지원 · 팬 전류 0.18A",
    specs: { lengthMm: 92, widthMm: 92, fanCount: 1, fanCurrentA: 0.18 }
  }),
  seed({
    id: "accessory-seed-memory-cooler-ddr4",
    category: "memory_cooler",
    name: "DDR4 메모리 모듈 쿨링팬",
    brand: "PC Supporter",
    model: "RAM-COOLER-DDR4",
    priceWon: 14900,
    rawSpecText: "DDR4 DIMM용 · 40mm 팬 2개 · 팬 전류 0.10A",
    specs: { fanCount: 2, fanCurrentA: 0.1 }
  }),
  seed({
    id: "accessory-seed-memory-heatsink-kit",
    category: "memory_cooler",
    name: "범용 DIMM 메모리 방열판 키트",
    brand: "PC Supporter",
    model: "RAM-HEATSINK-UNIVERSAL",
    priceWon: 9900,
    rawSpecText: "DIMM 메모리용 · 양면 알루미늄 방열판 · 모듈 2개 세트",
    specs: {}
  }),
  seed({
    id: "accessory-seed-thermal-pad-2mm",
    category: "thermal_pad",
    name: "두꺼운 부품용 써멀패드 2mm",
    brand: "PC Supporter",
    model: "TP-2MM",
    priceWon: 6900,
    rawSpecText: "두께 2.0mm · 그래픽카드·전원부 보조용 · 100 × 20mm",
    specs: {}
  }),
  seed({
    id: "accessory-seed-thermal-pad-05mm",
    category: "thermal_pad",
    name: "정밀 간격용 써멀패드 0.5mm",
    brand: "PC Supporter",
    model: "TP-05MM",
    priceWon: 3900,
    rawSpecText: "두께 0.5mm · M.2·메모리 방열판용 · 100 × 20mm",
    specs: {}
  }),
  seed({
    id: "accessory-seed-fan-hub-4-pwm",
    category: "fan_hub",
    name: "4포트 SATA 전원 PWM 팬 허브",
    brand: "PC Supporter",
    model: "HUB-4-PWM",
    priceWon: 9900,
    rawSpecText: "팬 분배: 4개 · 분배단자: 4핀 PWM · SATA 전원 · 최대 허용전력: 12V 2A",
    specs: { fanPortCount: 4 }
  }),
  seed({
    id: "accessory-seed-fan-hub-8-argb",
    category: "fan_hub",
    name: "8포트 PWM·5V ARGB 허브",
    brand: "PC Supporter",
    model: "HUB-8-PWM-ARGB",
    priceWon: 19900,
    rawSpecText: "팬 분배: 8개 · 분배단자: 4핀 PWM · RGB 분배: 8개 · SATA 전원 · 작동전압: LED 5V · 최대 허용전력: 5V 3A / 12V 3A",
    specs: { fanPortCount: 8, rgbPortCount: 8, rgbDeviceVoltage: "5V" }
  }),
  seed({
    id: "accessory-seed-ups-450w",
    category: "ups",
    name: "정현파 UPS 450W",
    brand: "PC Supporter",
    model: "UPS-900VA",
    priceWon: 119000,
    rawSpecText: "용량 900VA · 출력 용량 (W): 450W · 콘센트 6개",
    specs: { capacityVa: 900, outputW: 450, outletCount: 6 }
  }),
  seed({
    id: "accessory-seed-ups-900w",
    category: "ups",
    name: "정현파 UPS 900W",
    brand: "PC Supporter",
    model: "UPS-1800VA",
    priceWon: 249000,
    rawSpecText: "용량 1800VA · 출력 용량 (W): 900W · 콘센트 8개",
    specs: { capacityVa: 1800, outputW: 900, outletCount: 8 }
  })
];
