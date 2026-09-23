import type { Part } from "../shared/types";
import { seedCatalog } from "./seed-catalog";

// `seedCatalog`에는 기존 시연·테스트가 의존하는 대표 ID를 보존하고,
// 새 checkout에서 탐색 폭을 넓히는 추가 starter 후보만 이 파일에 둡니다.
// 모두 프로젝트 기준값이며 live 가격·재고·제조사 최신성을 의미하지 않습니다.
const updatedAt = "2026-08-26T00:00:00.000Z";

const seed = (part: Omit<Part, "source" | "dataQuality" | "missingFields" | "updatedAt">): Part => ({
  ...part,
  source: "seed",
  listingType: "retail",
  dataQuality: "seed",
  missingFields: [],
  updatedAt
});

export const extendedSeedCatalog: Part[] = [
  seed({
    id: "cpu-7600",
    category: "cpu",
    name: "AMD 라이젠5-5세대 7600",
    brand: "AMD",
    model: "7600",
    priceWon: 235000,
    specs: { socket: "AM5", memoryType: "DDR5", cores: 6, threads: 12, boostClockGhz: 5.1, tdpW: 65, pptW: 88, integratedGraphics: true, coolerIncluded: true, maxMemorySpeedMhz: 5200 }
  }),
  seed({
    id: "cpu-7950x",
    category: "cpu",
    name: "AMD 라이젠9-5세대 7950X",
    brand: "AMD",
    model: "7950X",
    priceWon: 649000,
    specs: { socket: "AM5", memoryType: "DDR5", cores: 16, threads: 32, boostClockGhz: 5.7, tdpW: 170, pptW: 230, integratedGraphics: true, coolerIncluded: false, maxMemorySpeedMhz: 5200 }
  }),
  seed({
    id: "cpu-i5-14600k",
    category: "cpu",
    name: "인텔 코어 i5-14세대 14600K",
    brand: "Intel",
    model: "i5-14600K",
    priceWon: 359000,
    specs: { socket: "LGA1700", memoryType: "DDR5", cores: 14, threads: 20, boostClockGhz: 5.3, tdpW: 125, pptW: 181, integratedGraphics: true, coolerIncluded: false, maxMemorySpeedMhz: 5600 }
  }),
  seed({
    id: "cpu-i5-12400f",
    category: "cpu",
    name: "인텔 코어 i5-12세대 12400F",
    brand: "Intel",
    model: "i5-12400F",
    priceWon: 159000,
    specs: { socket: "LGA1700", memoryType: "DDR4", cores: 6, threads: 12, boostClockGhz: 4.4, tdpW: 65, pptW: 117, integratedGraphics: false, coolerIncluded: true, maxMemorySpeedMhz: 3200 }
  }),
  seed({
    id: "cooler-air-am5-1700-mid",
    category: "cooler",
    name: "싱글타워 멀티소켓 CPU 쿨러",
    brand: "PC Supporter",
    model: "AIR-180-MULTI",
    priceWon: 39000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"], maxCoolingW: 180, maxCoolerHeightMm: 154, coolerType: "air" }
  }),
  seed({
    id: "cooler-liquid-360-multi",
    category: "cooler",
    name: "360mm 일체형 수랭 쿨러",
    brand: "PC Supporter",
    model: "AIO-360-MULTI",
    priceWon: 139000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"], maxCoolingW: 300, coolerType: "liquid", radiatorSizeMm: 360, radiatorSizesMm: [360], radiatorPosition: "top" }
  }),
  seed({
    id: "cooler-low-profile-multi",
    category: "cooler",
    name: "저소음 로우프로파일 CPU 쿨러",
    brand: "PC Supporter",
    model: "LP-120-MULTI",
    priceWon: 32000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700"], maxCoolingW: 120, maxCoolerHeightMm: 67, coolerType: "air" }
  }),
  seed({
    id: "mb-x670-atx",
    category: "motherboard",
    name: "ASUS TUF Gaming X670E-PLUS WIFI",
    brand: "ASUS",
    model: "TUF Gaming X670E-PLUS WIFI",
    priceWon: 359000,
    specs: { socket: "AM5", memoryType: "DDR5", maxMemoryGb: 192, memorySlots: 4, maxMemorySpeedMhz: 7600, m2Slots: 4, m2Interfaces: ["NVMe"], m2PcieGenerations: [5, 4], sataPorts: 4, vrmCapacityW: 260, formFactor: "ATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 5, rgb5vPortCount: 3, rgb12vPortCount: 1, rgbPortCount: 4 }
  }),
  seed({
    id: "mb-b650m-wifi",
    category: "motherboard",
    name: "ASUS TUF Gaming B650M-PLUS WIFI",
    brand: "ASUS",
    model: "TUF Gaming B650M-PLUS WIFI",
    priceWon: 219000,
    specs: { socket: "AM5", memoryType: "DDR5", maxMemoryGb: 192, memorySlots: 4, maxMemorySpeedMhz: 7600, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 4, vrmCapacityW: 180, formFactor: "mATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 4, rgb5vPortCount: 2, rgb12vPortCount: 1, rgbPortCount: 3 }
  }),
  seed({
    id: "mb-z790-ddr5",
    category: "motherboard",
    name: "MSI MAG Z790 토마호크 WIFI",
    brand: "MSI",
    model: "MAG Z790 TOMAHAWK WIFI",
    priceWon: 329000,
    specs: { socket: "LGA1700", memoryType: "DDR5", maxMemoryGb: 192, memorySlots: 4, maxMemorySpeedMhz: 7200, m2Slots: 4, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 6, vrmCapacityW: 260, formFactor: "ATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 5, rgb5vPortCount: 2, rgb12vPortCount: 1, rgbPortCount: 3 }
  }),
  seed({
    id: "mb-b760-ddr4",
    category: "motherboard",
    name: "ASRock B760M Pro RS/D4",
    brand: "ASRock",
    model: "B760M Pro RS/D4",
    priceWon: 159000,
    specs: { socket: "LGA1700", memoryType: "DDR4", maxMemoryGb: 128, memorySlots: 4, maxMemorySpeedMhz: 5333, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 4, vrmCapacityW: 150, formFactor: "mATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 4, rgb5vPortCount: 2, rgb12vPortCount: 1, rgbPortCount: 3 }
  }),
  seed({
    id: "memory-ddr5-32-6000-expo",
    category: "memory",
    name: "TEAMGROUP DDR5-6000 CL30 32GB",
    brand: "TEAMGROUP",
    model: "DDR5-6000 32GB EXPO",
    priceWon: 139000,
    specs: { memoryType: "DDR5", capacityGb: 32, speedMhz: 6000, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["EXPO"], memoryTiming: "30-36-36-76", memoryCasLatency: 30, memoryRcdLatency: 36, memoryTrpLatency: 36, memoryTrasLatency: 76, memoryVoltageV: 1.35 }
  }),
  seed({
    id: "memory-ddr5-64-5600-xmp",
    category: "memory",
    name: "CORSAIR DDR5-5600 64GB",
    brand: "CORSAIR",
    model: "DDR5-5600 64GB XMP",
    priceWon: 229000,
    specs: { memoryType: "DDR5", capacityGb: 64, speedMhz: 5600, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["XMP"], memoryTiming: "36-36-36-76", memoryCasLatency: 36, memoryRcdLatency: 36, memoryTrpLatency: 36, memoryTrasLatency: 76, memoryVoltageV: 1.25 }
  }),
  seed({
    id: "memory-ddr4-32-3200-xmp",
    category: "memory",
    name: "Crucial DDR4-3200 32GB",
    brand: "Crucial",
    model: "DDR4-3200 32GB XMP",
    priceWon: 79000,
    specs: { memoryType: "DDR4", capacityGb: 32, speedMhz: 3200, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["XMP"], memoryTiming: "16-18-18-36", memoryCasLatency: 16, memoryRcdLatency: 18, memoryTrpLatency: 18, memoryTrasLatency: 36, memoryVoltageV: 1.35 }
  }),
  seed({
    id: "memory-ddr5-sodimm-32",
    category: "memory",
    name: "삼성 DDR5-5600 SO-DIMM 32GB",
    brand: "Samsung",
    model: "DDR5-5600 SO-DIMM 32GB",
    priceWon: 119000,
    specs: { memoryType: "DDR5", capacityGb: 32, speedMhz: 5600, formFactor: "SO-DIMM", memoryModuleCountPerKit: 1 }
  }),
  seed({
    id: "gpu-rtx-4070-super",
    category: "gpu",
    name: "NVIDIA GeForce RTX 4070 SUPER 12GB",
    brand: "NVIDIA",
    model: "RTX 4070 SUPER",
    priceWon: 899000,
    specs: { powerW: 220, recommendedPsuW: 650, vramGb: 12, gpuVendor: "nvidia", gpuArchitectureFamily: "Ada Lovelace", gpuStreamProcessors: 7168, gpuMemoryBandwidthGbps: 504, gpuBoostClockMhz: 2475, gpu3dmarkTimeSpyScore: 21200, gpu3dmarkPortRoyalScore: 13400, lengthMm: 244, thicknessMm: 50, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }], [{ kind: "12v2x6", count: 1 }]] }
  }),
  seed({
    id: "gpu-rtx-4080-super",
    category: "gpu",
    name: "NVIDIA GeForce RTX 4080 SUPER 16GB",
    brand: "NVIDIA",
    model: "RTX 4080 SUPER",
    priceWon: 1390000,
    specs: { powerW: 320, recommendedPsuW: 750, vramGb: 16, gpuVendor: "nvidia", gpuArchitectureFamily: "Ada Lovelace", gpuStreamProcessors: 10240, gpuMemoryBandwidthGbps: 736, gpuBoostClockMhz: 2550, gpu3dmarkTimeSpyScore: 28500, gpu3dmarkPortRoyalScore: 18200, lengthMm: 310, thicknessMm: 61, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "12v2x6", count: 1 }], [{ kind: "pcie_8pin_6plus2", count: 3 }]] }
  }),
  seed({
    id: "gpu-rx-7900-xtx",
    category: "gpu",
    name: "AMD Radeon RX 7900 XTX 24GB",
    brand: "AMD",
    model: "RX 7900 XTX",
    priceWon: 1190000,
    specs: { powerW: 355, recommendedPsuW: 800, vramGb: 24, gpuVendor: "amd", gpuArchitectureFamily: "RDNA 3", gpuStreamProcessors: 6144, gpuMemoryBandwidthGbps: 960, gpuBoostClockMhz: 2500, gpu3dmarkTimeSpyScore: 30100, gpu3dmarkPortRoyalScore: 15900, lengthMm: 344, thicknessMm: 72, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 3 }]] }
  }),
  seed({
    id: "gpu-arc-a770",
    category: "gpu",
    name: "Intel Arc A770 16GB",
    brand: "Intel",
    model: "Arc A770",
    priceWon: 429000,
    specs: { powerW: 225, recommendedPsuW: 600, vramGb: 16, gpuVendor: "intel", gpuArchitectureFamily: "Alchemist", gpuStreamProcessors: 4096, gpuMemoryBandwidthGbps: 560, gpuBoostClockMhz: 2100, gpu3dmarkTimeSpyScore: 13300, gpu3dmarkPortRoyalScore: 7300, lengthMm: 280, thicknessMm: 53, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]] }
  }),
  seed({
    id: "ssd-nvme-2tb-gen4",
    category: "ssd",
    name: "WD_BLACK SN850X M.2 NVMe 2TB",
    brand: "Western Digital",
    model: "WD_BLACK SN850X 2TB",
    priceWon: 189000,
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 2000, m2PcieGeneration: 4, sequentialReadMbps: 7300, sequentialWriteMbps: 6600, ssdTbwTb: 1200 }
  }),
  seed({
    id: "ssd-nvme-2tb-gen5",
    category: "ssd",
    name: "Crucial T705 M.2 NVMe 2TB",
    brand: "Crucial",
    model: "T705 2TB",
    priceWon: 359000,
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 2000, m2PcieGeneration: 5, sequentialReadMbps: 14500, sequentialWriteMbps: 12700, ssdTbwTb: 1200 }
  }),
  seed({
    id: "ssd-sata-2tb",
    category: "ssd",
    name: "Samsung 870 EVO SATA 2TB",
    brand: "Samsung",
    model: "870 EVO 2TB",
    priceWon: 179000,
    specs: { interface: "SATA", formFactor: "2.5인치", capacityGb: 2000, sequentialReadMbps: 560, sequentialWriteMbps: 530, ssdTbwTb: 1200 }
  }),
  seed({
    id: "hdd-seagate-2tb",
    category: "hdd",
    name: "Seagate BarraCuda 2TB",
    brand: "Seagate",
    model: "BarraCuda 2TB",
    priceWon: 79000,
    specs: { interface: "SATA", formFactor: "3.5인치", capacityGb: 2000 }
  }),
  seed({
    id: "hdd-wd-red-8tb",
    category: "hdd",
    name: "WD Red Plus 8TB",
    brand: "Western Digital",
    model: "Red Plus 8TB",
    priceWon: 249000,
    specs: { interface: "SATA", formFactor: "3.5인치", capacityGb: 8000 }
  }),
  seed({
    id: "case-itx-sfx-airflow",
    category: "case",
    name: "소형 ITX SFX 에어플로우 케이스",
    brand: "PC Supporter",
    model: "ITX-AIR-SFX",
    priceWon: 99000,
    specs: { maxGpuLengthMm: 330, maxCoolerHeightMm: 165, maxPsuLengthMm: 130, hddBays: 1, ssdBays: 2, motherboardFormFactors: ["ITX"], supportedPsuFormFactors: ["SFX"], fanCount: 2, rgbDeviceCount: 0, fanPortCount: 2 }
  }),
  seed({
    id: "case-atx-mesh-rgb",
    category: "case",
    name: "ATX 메쉬 강화유리 RGB 케이스",
    brand: "PC Supporter",
    model: "ATX-MESH-RGB",
    priceWon: 109000,
    specs: { maxGpuLengthMm: 360, maxCoolerHeightMm: 165, maxPsuLengthMm: 200, hddBays: 2, ssdBays: 3, motherboardFormFactors: ["ATX", "mATX", "ITX"], supportedPsuFormFactors: ["ATX"], fanCount: 4, rgbDeviceCount: 3, rgbDeviceVoltage: "5V", rgbControllerIncluded: true, fanPortCount: 4 }
  }),
  seed({
    id: "case-full-tower-420",
    category: "case",
    name: "대형 풀타워 420mm 지원 케이스",
    brand: "PC Supporter",
    model: "FULL-420",
    priceWon: 219000,
    specs: { maxGpuLengthMm: 450, maxCoolerHeightMm: 190, maxPsuLengthMm: 250, hddBays: 8, ssdBays: 5, motherboardFormFactors: ["E-ATX", "ATX", "mATX", "ITX"], supportedPsuFormFactors: ["ATX"], fanCount: 5, rgbDeviceCount: 4, rgbDeviceVoltage: "mixed", fanPortCount: 5 }
  }),
  seed({
    id: "psu-450w-sfx",
    category: "psu",
    name: "SFX 450W 80PLUS Gold 파워",
    brand: "PC Supporter",
    model: "SFX-450-GOLD",
    priceWon: 99000,
    specs: { wattageW: 450, psuDepthMm: 100, efficiency: "80PLUS Gold", psuFormFactor: "SFX", psuCableType: "fully_modular", psuRailType: "single", pciePowerConnectors: { pcie_8pin_6plus2: 2 } }
  }),
  seed({
    id: "psu-750w-atx-gold",
    category: "psu",
    name: "ATX 750W 80PLUS Gold 풀모듈러",
    brand: "PC Supporter",
    model: "ATX-750-GOLD",
    priceWon: 139000,
    specs: { wattageW: 750, psuDepthMm: 150, efficiency: "80PLUS Gold", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 3, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 4, "12v2x6": 1 } }
  }),
  seed({
    id: "psu-850w-atx-gold",
    category: "psu",
    name: "ATX 850W 80PLUS Gold 풀모듈러",
    brand: "PC Supporter",
    model: "ATX-850-GOLD",
    priceWon: 169000,
    specs: { wattageW: 850, psuDepthMm: 160, efficiency: "80PLUS Gold", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 4, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 4, "12v2x6": 1 } }
  }),
  seed({
    id: "psu-1200w-atx-platinum",
    category: "psu",
    name: "ATX 1200W 80PLUS Platinum 풀모듈러",
    brand: "PC Supporter",
    model: "ATX-1200-PLATINUM",
    priceWon: 289000,
    specs: { wattageW: 1200, psuDepthMm: 180, efficiency: "80PLUS Platinum", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 5, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 6, "12v2x6": 2 } }
  }),
  seed({
    id: "cpu-5700x",
    category: "cpu",
    name: "AMD 라이젠7-4세대 5700X",
    brand: "AMD",
    model: "5700X",
    priceWon: 219000,
    specs: { socket: "AM4", memoryType: "DDR4", cores: 8, threads: 16, boostClockGhz: 4.6, tdpW: 65, pptW: 88, integratedGraphics: false, coolerIncluded: false, maxMemorySpeedMhz: 3200 }
  }),
  seed({
    id: "cpu-9600x",
    category: "cpu",
    name: "AMD 라이젠5-6세대 9600X",
    brand: "AMD",
    model: "9600X",
    priceWon: 329000,
    specs: { socket: "AM5", memoryType: "DDR5", cores: 6, threads: 12, boostClockGhz: 5.4, tdpW: 65, pptW: 88, integratedGraphics: true, coolerIncluded: false, maxMemorySpeedMhz: 5600 }
  }),
  seed({
    id: "cpu-9700x",
    category: "cpu",
    name: "AMD 라이젠7-6세대 9700X",
    brand: "AMD",
    model: "9700X",
    priceWon: 469000,
    specs: { socket: "AM5", memoryType: "DDR5", cores: 8, threads: 16, boostClockGhz: 5.5, tdpW: 65, pptW: 88, integratedGraphics: true, coolerIncluded: false, maxMemorySpeedMhz: 5600 }
  }),
  seed({
    id: "cpu-i5-14500",
    category: "cpu",
    name: "인텔 코어 i5-14세대 14500",
    brand: "Intel",
    model: "i5-14500",
    priceWon: 329000,
    specs: { socket: "LGA1700", memoryType: "DDR5", cores: 14, threads: 20, boostClockGhz: 5.0, tdpW: 65, pptW: 154, integratedGraphics: true, coolerIncluded: true, maxMemorySpeedMhz: 5600 }
  }),
  seed({
    id: "cpu-i3-12100f",
    category: "cpu",
    name: "인텔 코어 i3-12세대 12100F",
    brand: "Intel",
    model: "i3-12100F",
    priceWon: 119000,
    specs: { socket: "LGA1700", memoryType: "DDR4", cores: 4, threads: 8, boostClockGhz: 4.3, tdpW: 58, pptW: 89, integratedGraphics: false, coolerIncluded: true, maxMemorySpeedMhz: 3200 }
  }),
  seed({
    id: "cooler-air-am4-compact",
    category: "cooler",
    name: "멀티소켓 싱글타워 155mm CPU 쿨러",
    brand: "PC Supporter",
    model: "AIR-155-MULTI",
    priceWon: 35000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"], maxCoolingW: 160, maxCoolerHeightMm: 155, coolerType: "air" }
  }),
  seed({
    id: "cooler-air-premium-multi",
    category: "cooler",
    name: "듀얼타워 고성능 멀티소켓 쿨러",
    brand: "PC Supporter",
    model: "AIR-250-DUAL",
    priceWon: 79000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"], maxCoolingW: 250, maxCoolerHeightMm: 168, coolerType: "air" }
  }),
  seed({
    id: "cooler-liquid-240-multi",
    category: "cooler",
    name: "240mm 일체형 수랭 쿨러",
    brand: "PC Supporter",
    model: "AIO-240-MULTI",
    priceWon: 99000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"], maxCoolingW: 280, coolerType: "liquid", radiatorSizeMm: 240, radiatorSizesMm: [240], radiatorPosition: "top" }
  }),
  seed({
    id: "mb-b550m-am4",
    category: "motherboard",
    name: "MSI B550M PRO-VDH WIFI",
    brand: "MSI",
    model: "B550M PRO-VDH WIFI",
    priceWon: 139000,
    specs: { socket: "AM4", memoryType: "DDR4", maxMemoryGb: 128, memorySlots: 4, maxMemorySpeedMhz: 4400, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4, 3], sataPorts: 6, vrmCapacityW: 140, formFactor: "mATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 4, rgb5vPortCount: 2, rgb12vPortCount: 1, rgbPortCount: 3 }
  }),
  seed({
    id: "mb-x570-am4",
    category: "motherboard",
    name: "ASUS TUF Gaming X570-PLUS",
    brand: "ASUS",
    model: "TUF Gaming X570-PLUS",
    priceWon: 199000,
    specs: { socket: "AM4", memoryType: "DDR4", maxMemoryGb: 128, memorySlots: 4, maxMemorySpeedMhz: 4400, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 8, vrmCapacityW: 180, formFactor: "ATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 5, rgb5vPortCount: 1, rgb12vPortCount: 2, rgbPortCount: 3 }
  }),
  seed({
    id: "mb-b650m-basic",
    category: "motherboard",
    name: "GIGABYTE B650M K",
    brand: "GIGABYTE",
    model: "B650M K",
    priceWon: 149000,
    specs: { socket: "AM5", memoryType: "DDR5", maxMemoryGb: 192, memorySlots: 4, maxMemorySpeedMhz: 7600, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 4, vrmCapacityW: 140, formFactor: "mATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 3, rgb5vPortCount: 1, rgb12vPortCount: 1, rgbPortCount: 2 }
  }),
  seed({
    id: "mb-b760-ddr4-basic",
    category: "motherboard",
    name: "MSI PRO B760M-P DDR4",
    brand: "MSI",
    model: "PRO B760M-P DDR4",
    priceWon: 139000,
    specs: { socket: "LGA1700", memoryType: "DDR4", maxMemoryGb: 128, memorySlots: 4, maxMemorySpeedMhz: 5333, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 4, vrmCapacityW: 120, formFactor: "mATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 3, rgb5vPortCount: 1, rgb12vPortCount: 1, rgbPortCount: 2 }
  }),
  seed({
    id: "mb-h610m-ddr4",
    category: "motherboard",
    name: "ASUS PRIME H610M-K D4",
    brand: "ASUS",
    model: "PRIME H610M-K D4",
    priceWon: 89000,
    specs: { socket: "LGA1700", memoryType: "DDR4", maxMemoryGb: 64, memorySlots: 2, maxMemorySpeedMhz: 3200, m2Slots: 1, m2Interfaces: ["NVMe"], m2PcieGenerations: [3], sataPorts: 4, vrmCapacityW: 100, formFactor: "mATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 2, rgb5vPortCount: 0, rgb12vPortCount: 1, rgbPortCount: 1 }
  }),
  seed({
    id: "memory-ddr4-64-3200",
    category: "memory",
    name: "CORSAIR DDR4-3200 64GB",
    brand: "CORSAIR",
    model: "DDR4-3200 64GB 2x32",
    priceWon: 149000,
    specs: { memoryType: "DDR4", capacityGb: 64, speedMhz: 3200, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["XMP"], memoryTiming: "16-20-20-38", memoryCasLatency: 16, memoryRcdLatency: 20, memoryTrpLatency: 20, memoryTrasLatency: 38, memoryVoltageV: 1.35 }
  }),
  seed({
    id: "memory-ddr5-32-5600-xmp",
    category: "memory",
    name: "ADATA DDR5-5600 32GB",
    brand: "ADATA",
    model: "DDR5-5600 32GB XMP",
    priceWon: 109000,
    specs: { memoryType: "DDR5", capacityGb: 32, speedMhz: 5600, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["XMP"], memoryTiming: "36-36-36-76", memoryCasLatency: 36, memoryRcdLatency: 36, memoryTrpLatency: 36, memoryTrasLatency: 76, memoryVoltageV: 1.25 }
  }),
  seed({
    id: "memory-ddr5-64-6000-expo",
    category: "memory",
    name: "G.SKILL DDR5-6000 CL30 64GB",
    brand: "G.SKILL",
    model: "Trident Z5 Neo DDR5-6000 64GB EXPO",
    priceWon: 219000,
    specs: { memoryType: "DDR5", capacityGb: 64, speedMhz: 6000, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["EXPO"], memoryTiming: "30-40-40-96", memoryCasLatency: 30, memoryRcdLatency: 40, memoryTrpLatency: 40, memoryTrasLatency: 96, memoryVoltageV: 1.35 }
  }),
  seed({
    id: "memory-ddr5-96-5600",
    category: "memory",
    name: "KINGSTON DDR5-5600 96GB",
    brand: "KINGSTON",
    model: "DDR5-5600 96GB 2x48",
    priceWon: 269000,
    specs: { memoryType: "DDR5", capacityGb: 96, speedMhz: 5600, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["XMP"], memoryTiming: "40-40-40-80", memoryCasLatency: 40, memoryRcdLatency: 40, memoryTrpLatency: 40, memoryTrasLatency: 80, memoryVoltageV: 1.25 }
  }),
  seed({
    id: "gpu-rtx-4060-ti",
    category: "gpu",
    name: "NVIDIA GeForce RTX 4060 Ti 8GB",
    brand: "NVIDIA",
    model: "RTX 4060 Ti",
    priceWon: 589000,
    specs: { powerW: 160, recommendedPsuW: 550, vramGb: 8, gpuVendor: "nvidia", gpuArchitectureFamily: "Ada Lovelace", gpuStreamProcessors: 4352, gpuMemoryBandwidthGbps: 288, gpuBoostClockMhz: 2535, gpu3dmarkTimeSpyScore: 13400, gpu3dmarkPortRoyalScore: 8100, lengthMm: 240, thicknessMm: 42, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]] }
  }),
  seed({
    id: "gpu-rtx-4070",
    category: "gpu",
    name: "NVIDIA GeForce RTX 4070 12GB",
    brand: "NVIDIA",
    model: "RTX 4070",
    priceWon: 769000,
    specs: { powerW: 200, recommendedPsuW: 650, vramGb: 12, gpuVendor: "nvidia", gpuArchitectureFamily: "Ada Lovelace", gpuStreamProcessors: 5888, gpuMemoryBandwidthGbps: 504, gpuBoostClockMhz: 2475, gpu3dmarkTimeSpyScore: 17900, gpu3dmarkPortRoyalScore: 11100, lengthMm: 244, thicknessMm: 42, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }], [{ kind: "12v2x6", count: 1 }]] }
  }),
  seed({
    id: "gpu-rtx-4070-ti-super",
    category: "gpu",
    name: "NVIDIA GeForce RTX 4070 Ti SUPER 16GB",
    brand: "NVIDIA",
    model: "RTX 4070 Ti SUPER",
    priceWon: 1090000,
    specs: { powerW: 285, recommendedPsuW: 700, vramGb: 16, gpuVendor: "nvidia", gpuArchitectureFamily: "Ada Lovelace", gpuStreamProcessors: 8448, gpuMemoryBandwidthGbps: 672, gpuBoostClockMhz: 2610, gpu3dmarkTimeSpyScore: 24300, gpu3dmarkPortRoyalScore: 15800, lengthMm: 305, thicknessMm: 61, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "12v2x6", count: 1 }], [{ kind: "pcie_8pin_6plus2", count: 2 }]] }
  }),
  seed({
    id: "gpu-rx-7800-xt",
    category: "gpu",
    name: "AMD Radeon RX 7800 XT 16GB",
    brand: "AMD",
    model: "RX 7800 XT",
    priceWon: 699000,
    specs: { powerW: 263, recommendedPsuW: 700, vramGb: 16, gpuVendor: "amd", gpuArchitectureFamily: "RDNA 3", gpuStreamProcessors: 3840, gpuMemoryBandwidthGbps: 624, gpuBoostClockMhz: 2430, gpu3dmarkTimeSpyScore: 19900, gpu3dmarkPortRoyalScore: 10600, lengthMm: 302, thicknessMm: 52, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 2 }]] }
  }),
  seed({
    id: "gpu-rx-7600",
    category: "gpu",
    name: "AMD Radeon RX 7600 8GB",
    brand: "AMD",
    model: "RX 7600",
    priceWon: 379000,
    specs: { powerW: 165, recommendedPsuW: 550, vramGb: 8, gpuVendor: "amd", gpuArchitectureFamily: "RDNA 3", gpuStreamProcessors: 2048, gpuMemoryBandwidthGbps: 288, gpuBoostClockMhz: 2655, gpu3dmarkTimeSpyScore: 10700, gpu3dmarkPortRoyalScore: 5500, lengthMm: 235, thicknessMm: 43, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]] }
  }),
  seed({
    id: "gpu-rtx-4090",
    category: "gpu",
    name: "NVIDIA GeForce RTX 4090 24GB",
    brand: "NVIDIA",
    model: "RTX 4090",
    priceWon: 2490000,
    specs: { powerW: 450, recommendedPsuW: 850, vramGb: 24, gpuVendor: "nvidia", gpuArchitectureFamily: "Ada Lovelace", gpuStreamProcessors: 16384, gpuMemoryBandwidthGbps: 1008, gpuBoostClockMhz: 2520, gpu3dmarkTimeSpyScore: 36000, gpu3dmarkPortRoyalScore: 25700, lengthMm: 336, thicknessMm: 75, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "12v2x6", count: 1 }], [{ kind: "pcie_8pin_6plus2", count: 3 }]] }
  }),
  seed({
    id: "ssd-nvme-1tb-gen4-mid",
    category: "ssd",
    name: "WD_BLACK SN770 M.2 NVMe 1TB",
    brand: "Western Digital",
    model: "WD_BLACK SN770 1TB",
    priceWon: 99000,
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 1000, m2PcieGeneration: 4, sequentialReadMbps: 5150, sequentialWriteMbps: 4900, ssdTbwTb: 600 }
  }),
  seed({
    id: "ssd-nvme-1tb-gen4-pro",
    category: "ssd",
    name: "Samsung 990 PRO M.2 NVMe 1TB",
    brand: "Samsung",
    model: "990 PRO 1TB",
    priceWon: 129000,
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 1000, m2PcieGeneration: 4, sequentialReadMbps: 7450, sequentialWriteMbps: 6900, ssdTbwTb: 600 }
  }),
  seed({
    id: "ssd-nvme-1tb-gen4-budget",
    category: "ssd",
    name: "Crucial P3 Plus M.2 NVMe 1TB",
    brand: "Crucial",
    model: "P3 Plus 1TB",
    priceWon: 79000,
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 1000, m2PcieGeneration: 4, sequentialReadMbps: 4700, sequentialWriteMbps: 1900, ssdTbwTb: 220 }
  }),
  seed({
    id: "ssd-sata-1tb-mid",
    category: "ssd",
    name: "Crucial MX500 SATA 1TB",
    brand: "Crucial",
    model: "MX500 1TB",
    priceWon: 89000,
    specs: { interface: "SATA", formFactor: "2.5인치", capacityGb: 1000, sequentialReadMbps: 560, sequentialWriteMbps: 510, ssdTbwTb: 360 }
  }),
  seed({
    id: "hdd-wd-blue-4tb",
    category: "hdd",
    name: "Western Digital Blue 4TB",
    brand: "Western Digital",
    model: "WD Blue 4TB",
    priceWon: 109000,
    specs: { interface: "SATA", formFactor: "3.5인치", capacityGb: 4000 }
  }),
  seed({
    id: "hdd-toshiba-8tb",
    category: "hdd",
    name: "Toshiba X300 8TB",
    brand: "Toshiba",
    model: "X300 8TB",
    priceWon: 239000,
    specs: { interface: "SATA", formFactor: "3.5인치", capacityGb: 8000 }
  }),
  seed({
    id: "case-atx-budget-mesh",
    category: "case",
    name: "ATX 미들타워 전면 메쉬 케이스",
    brand: "PC Supporter",
    model: "ATX-MESH-BASIC",
    priceWon: 59000,
    specs: { maxGpuLengthMm: 315, maxCoolerHeightMm: 160, maxPsuLengthMm: 180, hddBays: 2, ssdBays: 2, motherboardFormFactors: ["ATX", "mATX", "ITX"], supportedPsuFormFactors: ["ATX"], fanCount: 2, rgbDeviceCount: 0, fanPortCount: 2 }
  }),
  seed({
    id: "case-midtower-airflow",
    category: "case",
    name: "미들타워 고풍량 메쉬 케이스",
    brand: "PC Supporter",
    model: "MID-AIRFLOW-360",
    priceWon: 119000,
    specs: { maxGpuLengthMm: 380, maxCoolerHeightMm: 170, maxPsuLengthMm: 210, hddBays: 2, ssdBays: 4, motherboardFormFactors: ["ATX", "mATX", "ITX"], supportedPsuFormFactors: ["ATX"], fanCount: 4, rgbDeviceCount: 3, rgbDeviceVoltage: "5V", rgbControllerIncluded: true, fanPortCount: 4, radiatorSizesMm: [240, 280, 360] }
  }),
  seed({
    id: "case-dual-chamber",
    category: "case",
    name: "듀얼챔버 파노라마 강화유리 케이스",
    brand: "PC Supporter",
    model: "DUAL-CHAMBER-ATX",
    priceWon: 169000,
    specs: { maxGpuLengthMm: 400, maxCoolerHeightMm: 175, maxPsuLengthMm: 230, hddBays: 2, ssdBays: 4, motherboardFormFactors: ["ATX", "mATX", "ITX"], supportedPsuFormFactors: ["ATX"], fanCount: 4, rgbDeviceCount: 4, rgbDeviceVoltage: "5V", rgbControllerIncluded: true, fanPortCount: 4, radiatorSizesMm: [240, 360] }
  }),
  seed({
    id: "case-itx-compact-240",
    category: "case",
    name: "소형 ITX 240mm 수랭 지원 케이스",
    brand: "PC Supporter",
    model: "ITX-COMPACT-240",
    priceWon: 129000,
    specs: { maxGpuLengthMm: 305, maxCoolerHeightMm: 145, maxPsuLengthMm: 130, hddBays: 1, ssdBays: 2, motherboardFormFactors: ["ITX"], supportedPsuFormFactors: ["SFX"], fanCount: 2, rgbDeviceCount: 0, fanPortCount: 2, radiatorSizesMm: [240] }
  }),
  seed({
    id: "psu-550w-atx-bronze",
    category: "psu",
    name: "ATX 550W 80PLUS Bronze 파워",
    brand: "PC Supporter",
    model: "ATX-550-BRONZE",
    priceWon: 59000,
    specs: { wattageW: 550, psuDepthMm: 140, efficiency: "80PLUS Bronze", psuFormFactor: "ATX", psuCableType: "fixed", psuRailType: "single", pciePowerConnectors: { pcie_8pin_6plus2: 2 } }
  }),
  seed({
    id: "psu-650w-atx-gold-mod",
    category: "psu",
    name: "ATX 650W 80PLUS Gold 풀모듈러",
    brand: "PC Supporter",
    model: "ATX-650-GOLD-MOD",
    priceWon: 119000,
    specs: { wattageW: 650, psuDepthMm: 150, efficiency: "80PLUS Gold", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 4, "12v2x6": 1 } }
  }),
  seed({
    id: "psu-850w-atx-gold-mod",
    category: "psu",
    name: "ATX 850W 80PLUS Gold 풀모듈러 고출력",
    brand: "PC Supporter",
    model: "ATX-850-GOLD-MOD",
    priceWon: 179000,
    specs: { wattageW: 850, psuDepthMm: 160, efficiency: "80PLUS Gold", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 4, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 4, "12v2x6": 1 } }
  }),
  seed({
    id: "psu-1000w-atx-gold-mod",
    category: "psu",
    name: "ATX 1000W 80PLUS Gold 풀모듈러",
    brand: "PC Supporter",
    model: "ATX-1000-GOLD-MOD",
    priceWon: 219000,
    specs: { wattageW: 1000, psuDepthMm: 170, efficiency: "80PLUS Gold", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 5, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 6, "12v2x6": 2 } }
  }),
  seed({
    id: "cpu-am5-8c65-ref",
    category: "cpu",
    name: "AM5 8코어 65W 기준 프로세서",
    brand: "PC Supporter",
    model: "REF-AM5-8C65",
    priceWon: 299000,
    specs: { socket: "AM5", memoryType: "DDR5", cores: 8, threads: 16, boostClockGhz: 5.3, tdpW: 65, pptW: 88, integratedGraphics: true, coolerIncluded: false, maxMemorySpeedMhz: 5600 }
  }),
  seed({
    id: "cpu-am4-6c65-ref",
    category: "cpu",
    name: "AM4 6코어 65W 기준 프로세서",
    brand: "PC Supporter",
    model: "REF-AM4-6C65",
    priceWon: 129000,
    specs: { socket: "AM4", memoryType: "DDR4", cores: 6, threads: 12, boostClockGhz: 4.4, tdpW: 65, pptW: 76, integratedGraphics: false, coolerIncluded: true, maxMemorySpeedMhz: 3200 }
  }),
  seed({
    id: "cpu-lga1700-10c-ref",
    category: "cpu",
    name: "LGA1700 10코어 기준 프로세서",
    brand: "PC Supporter",
    model: "REF-LGA1700-10C",
    priceWon: 239000,
    specs: { socket: "LGA1700", memoryType: "DDR5", cores: 10, threads: 16, boostClockGhz: 4.8, tdpW: 65, pptW: 154, integratedGraphics: true, coolerIncluded: false, maxMemorySpeedMhz: 5600 }
  }),
  seed({
    id: "cooler-air-220-multi-ref",
    category: "cooler",
    name: "멀티소켓 듀얼타워 공랭 기준 쿨러",
    brand: "PC Supporter",
    model: "REF-AIR-220",
    priceWon: 59000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"], maxCoolingW: 220, maxCoolerHeightMm: 158, coolerType: "air" }
  }),
  seed({
    id: "cooler-liquid-280-multi-ref",
    category: "cooler",
    name: "280mm 멀티소켓 일체형 수랭 쿨러",
    brand: "PC Supporter",
    model: "REF-AIO-280",
    priceWon: 109000,
    specs: { supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"], maxCoolingW: 280, coolerType: "liquid", radiatorSizeMm: 280, radiatorSizesMm: [280], radiatorPosition: "top" }
  }),
  seed({
    id: "mb-am5-itx-ref",
    category: "motherboard",
    name: "AM5 DDR5 ITX 확장형 기준 메인보드",
    brand: "PC Supporter",
    model: "REF-AM5-ITX",
    priceWon: 189000,
    specs: { socket: "AM5", memoryType: "DDR5", maxMemoryGb: 96, memorySlots: 2, maxMemorySpeedMhz: 6400, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 4, vrmCapacityW: 140, formFactor: "ITX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 3, rgb5vPortCount: 1, rgb12vPortCount: 0, rgbPortCount: 1 }
  }),
  seed({
    id: "mb-lga1700-atx-ddr5-ref",
    category: "motherboard",
    name: "LGA1700 DDR5 ATX 확장형 기준 메인보드",
    brand: "PC Supporter",
    model: "REF-LGA1700-ATX-D5",
    priceWon: 239000,
    specs: { socket: "LGA1700", memoryType: "DDR5", maxMemoryGb: 192, memorySlots: 4, maxMemorySpeedMhz: 7200, m2Slots: 4, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 6, vrmCapacityW: 240, formFactor: "ATX", pcieX16Slots: 1, pcieX8Slots: 1, fanPortCount: 5, rgb5vPortCount: 2, rgb12vPortCount: 1, rgbPortCount: 3 }
  }),
  seed({
    id: "mb-am4-matx-ref",
    category: "motherboard",
    name: "AM4 DDR4 mATX 확장형 기준 메인보드",
    brand: "PC Supporter",
    model: "REF-AM4-MATX",
    priceWon: 109000,
    specs: { socket: "AM4", memoryType: "DDR4", maxMemoryGb: 128, memorySlots: 4, maxMemorySpeedMhz: 4400, m2Slots: 2, m2Interfaces: ["NVMe"], m2PcieGenerations: [4], sataPorts: 6, vrmCapacityW: 120, formFactor: "mATX", pcieX16Slots: 1, pcieX8Slots: 0, fanPortCount: 4, rgb5vPortCount: 1, rgb12vPortCount: 1, rgbPortCount: 2 }
  }),
  seed({
    id: "memory-ddr5-16-6000-ref",
    category: "memory",
    name: "DDR5-6000 16GB 기준 메모리",
    brand: "PC Supporter",
    model: "REF-DDR5-6000-16",
    priceWon: 69000,
    specs: { memoryType: "DDR5", capacityGb: 16, speedMhz: 6000, formFactor: "DIMM", memoryModuleCountPerKit: 1, memoryProfiles: ["EXPO"] }
  }),
  seed({
    id: "memory-ddr5-32-5600-ref",
    category: "memory",
    name: "DDR5-5600 32GB 기준 메모리",
    brand: "PC Supporter",
    model: "REF-DDR5-5600-32",
    priceWon: 119000,
    specs: { memoryType: "DDR5", capacityGb: 32, speedMhz: 5600, formFactor: "DIMM", memoryModuleCountPerKit: 2, memoryProfiles: ["XMP"] }
  }),
  seed({
    id: "memory-ddr4-16-3600-ref",
    category: "memory",
    name: "DDR4-3600 16GB 기준 메모리",
    brand: "PC Supporter",
    model: "REF-DDR4-3600-16",
    priceWon: 49000,
    specs: { memoryType: "DDR4", capacityGb: 16, speedMhz: 3600, formFactor: "DIMM", memoryModuleCountPerKit: 1, memoryProfiles: ["XMP"] }
  }),
  seed({
    id: "gpu-mainstream-8gb-ref",
    category: "gpu",
    name: "8GB 메인스트림 그래픽카드 기준 모델",
    brand: "PC Supporter",
    model: "REF-GPU-8GB",
    priceWon: 459000,
    specs: { powerW: 165, recommendedPsuW: 550, vramGb: 8, gpuVendor: "nvidia", gpuMemoryType: "GDDR6", gpuStreamProcessors: 3072, gpuMemoryBandwidthGbps: 288, gpuBoostClockMhz: 2460, lengthMm: 270, thicknessMm: 48, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]] }
  }),
  seed({
    id: "gpu-performance-12gb-ref",
    category: "gpu",
    name: "12GB 퍼포먼스 그래픽카드 기준 모델",
    brand: "PC Supporter",
    model: "REF-GPU-12GB",
    priceWon: 799000,
    specs: { powerW: 285, recommendedPsuW: 750, vramGb: 12, gpuVendor: "amd", gpuMemoryType: "GDDR6", gpuStreamProcessors: 5888, gpuMemoryBandwidthGbps: 504, gpuBoostClockMhz: 2475, lengthMm: 330, thicknessMm: 62, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 2 }]] }
  }),
  seed({
    id: "gpu-creator-16gb-ref",
    category: "gpu",
    name: "16GB 크리에이터 그래픽카드 기준 모델",
    brand: "PC Supporter",
    model: "REF-GPU-16GB",
    priceWon: 1090000,
    specs: { powerW: 250, recommendedPsuW: 750, vramGb: 16, gpuVendor: "nvidia", gpuMemoryType: "GDDR6", gpuStreamProcessors: 8448, gpuMemoryBandwidthGbps: 672, gpuBoostClockMhz: 2610, lengthMm: 310, thicknessMm: 55, pcieSlotWidth: 16, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 2 }]] }
  }),
  seed({
    id: "ssd-nvme-500gb-ref",
    category: "ssd",
    name: "M.2 NVMe 500GB 기준 SSD",
    brand: "PC Supporter",
    model: "REF-NVME-500",
    priceWon: 59000,
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 500, sequentialReadMbps: 5000, sequentialWriteMbps: 3500 }
  }),
  seed({
    id: "ssd-nvme-4tb-ref",
    category: "ssd",
    name: "M.2 NVMe 4TB 기준 SSD",
    brand: "PC Supporter",
    model: "REF-NVME-4000",
    priceWon: 329000,
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 4000, sequentialReadMbps: 7400, sequentialWriteMbps: 6800 }
  }),
  seed({
    id: "ssd-sata-4tb-ref",
    category: "ssd",
    name: "2.5인치 SATA 4TB 기준 SSD",
    brand: "PC Supporter",
    model: "REF-SATA-4000",
    priceWon: 299000,
    specs: { interface: "SATA", formFactor: "2.5인치", capacityGb: 4000, sequentialReadMbps: 560, sequentialWriteMbps: 530 }
  }),
  seed({
    id: "hdd-archive-6tb-ref",
    category: "hdd",
    name: "SATA 3.5인치 아카이브 HDD 6TB",
    brand: "PC Supporter",
    model: "REF-HDD-6000",
    priceWon: 139000,
    specs: { interface: "SATA", formFactor: "3.5인치", capacityGb: 6000 }
  }),
  seed({
    id: "hdd-nas-12tb-ref",
    category: "hdd",
    name: "SATA 3.5인치 NAS HDD 12TB",
    brand: "PC Supporter",
    model: "REF-HDD-12000",
    priceWon: 349000,
    specs: { interface: "SATA", formFactor: "3.5인치", capacityGb: 12000 }
  }),
  seed({
    id: "case-itx-sfx-compact-ref",
    category: "case",
    name: "소형 ITX SFX 컴팩트 기준 케이스",
    brand: "PC Supporter",
    model: "REF-ITX-SFX-COMPACT",
    priceWon: 119000,
    specs: { maxGpuLengthMm: 280, maxCoolerHeightMm: 130, maxPsuLengthMm: 130, hddBays: 0, ssdBays: 2, motherboardFormFactors: ["ITX"], supportedPsuFormFactors: ["SFX"], fanCount: 2, rgbDeviceCount: 0, fanPortCount: 2 }
  }),
  seed({
    id: "case-matx-airflow-ref",
    category: "case",
    name: "mATX 에어플로우 기준 케이스",
    brand: "PC Supporter",
    model: "REF-MATX-AIR",
    priceWon: 79000,
    specs: { maxGpuLengthMm: 340, maxCoolerHeightMm: 165, maxPsuLengthMm: 180, hddBays: 2, ssdBays: 3, motherboardFormFactors: ["mATX", "ITX"], supportedPsuFormFactors: ["ATX", "SFX"], fanCount: 3, rgbDeviceCount: 0, fanPortCount: 3 }
  }),
  seed({
    id: "case-atx-compact-ref",
    category: "case",
    name: "ATX 컴팩트 메쉬 기준 케이스",
    brand: "PC Supporter",
    model: "REF-ATX-COMPACT",
    priceWon: 99000,
    specs: { maxGpuLengthMm: 370, maxCoolerHeightMm: 175, maxPsuLengthMm: 220, hddBays: 4, ssdBays: 4, motherboardFormFactors: ["ATX", "mATX", "ITX"], supportedPsuFormFactors: ["ATX"], fanCount: 4, rgbDeviceCount: 2, rgbDeviceVoltage: "5V", rgbControllerIncluded: true, fanPortCount: 4, radiatorSizesMm: [240, 280] }
  }),
  seed({
    id: "psu-500w-sfx-bronze-ref",
    category: "psu",
    name: "SFX 500W 80PLUS Bronze 기준 파워",
    brand: "PC Supporter",
    model: "REF-SFX-500-BRONZE",
    priceWon: 79000,
    specs: { wattageW: 500, psuDepthMm: 100, efficiency: "80PLUS Bronze", psuFormFactor: "SFX", psuCableType: "fixed", psuRailType: "single", pciePowerConnectors: { pcie_8pin_6plus2: 1 } }
  }),
  seed({
    id: "psu-750w-atx-gold-ref",
    category: "psu",
    name: "ATX 750W 80PLUS Gold 기준 파워",
    brand: "PC Supporter",
    model: "REF-ATX-750-GOLD",
    priceWon: 139000,
    specs: { wattageW: 750, psuDepthMm: 150, efficiency: "80PLUS Gold", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 3, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 4, "12v2x6": 1 } }
  }),
  seed({
    id: "psu-1200w-atx-platinum-ref",
    category: "psu",
    name: "ATX 1200W 80PLUS Platinum 기준 파워",
    brand: "PC Supporter",
    model: "REF-ATX-1200-PLATINUM",
    priceWon: 279000,
    specs: { wattageW: 1200, psuDepthMm: 180, efficiency: "80PLUS Platinum", psuFormFactor: "ATX", psuCableType: "fully_modular", psuRailType: "single", psuIndependentPcieCableRuns: 5, psuPcieCableTopology: "independent", pciePowerConnectors: { pcie_8pin_6plus2: 6, "12v2x6": 2 } }
  })
];

export const starterCatalog: Part[] = [...seedCatalog, ...extendedSeedCatalog];
