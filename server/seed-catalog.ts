import type { Part } from "../shared/types";

const updatedAt = "2026-08-26T00:00:00.000Z";

const seed = (part: Omit<Part, "source" | "dataQuality" | "missingFields" | "updatedAt">): Part => ({
  ...part,
  source: "seed",
  listingType: "retail",
  dataQuality: "seed",
  missingFields: [],
  updatedAt
});

export const seedCatalog: Part[] = [
  seed({
    id: "cpu-7800x3d",
    category: "cpu",
    name: "AMD 라이젠7-5세대 7800X3D",
    brand: "AMD",
    model: "7800X3D",
    priceWon: 499000,
    specs: {
      socket: "AM5",
      memoryType: "DDR5",
      tdpW: 120,
      pptW: 162,
      integratedGraphics: true,
      coolerIncluded: false,
      maxMemorySpeedMhz: 5200
    }
  }),
  seed({
    id: "cpu-7500f",
    category: "cpu",
    name: "AMD 라이젠5-5세대 7500F",
    brand: "AMD",
    model: "7500F",
    priceWon: 182000,
    specs: {
      socket: "AM5",
      memoryType: "DDR5",
      tdpW: 65,
      pptW: 88,
      integratedGraphics: false,
      coolerIncluded: false,
      maxMemorySpeedMhz: 5200
    }
  }),
  seed({
    id: "cpu-i7-14700k",
    category: "cpu",
    name: "인텔 코어 i7-14세대 14700K",
    brand: "Intel",
    model: "i7-14700K",
    priceWon: 541000,
    specs: {
      socket: "LGA1700",
      memoryType: "DDR5",
      tdpW: 125,
      pptW: 253,
      integratedGraphics: true,
      coolerIncluded: false,
      maxMemorySpeedMhz: 5600
    }
  }),
  seed({
    id: "cooler-tower-am5-1700",
    category: "cooler",
    name: "DeepCool AK620 듀얼타워",
    brand: "DeepCool",
    model: "AK620",
    priceWon: 69000,
    specs: {
      supportedSockets: ["AM5", "AM4", "LGA1700", "LGA1200"],
      maxCoolingW: 260,
      maxCoolerHeightMm: 160
    }
  }),
  seed({
    id: "cooler-small-am5",
    category: "cooler",
    name: "기본형 싱글타워 AM5 쿨러",
    brand: "PC Supporter",
    model: "Basic 95W",
    priceWon: 29000,
    specs: {
      supportedSockets: ["AM5", "AM4"],
      maxCoolingW: 95,
      maxCoolerHeightMm: 145
    }
  }),
  seed({
    id: "mb-b650-4x3",
    category: "motherboard",
    name: "MSI MAG B650 토마호크 WIFI",
    brand: "MSI",
    model: "MAG B650 TOMAHAWK WIFI",
    priceWon: 249000,
    specs: {
      socket: "AM5",
      memoryType: "DDR5",
      maxMemoryGb: 192,
      memorySlots: 4,
      maxMemorySpeedMhz: 7600,
      m2Slots: 3,
      m2Interfaces: ["NVMe"],
      sataPorts: 4,
      vrmCapacityW: 180,
      formFactor: "ATX",
      pcieX16Slots: 1,
      pcieX8Slots: 0
    }
  }),
  seed({
    id: "mb-a620-small",
    category: "motherboard",
    name: "ASRock A620M-HDV/M.2",
    brand: "ASRock",
    model: "A620M-HDV/M.2",
    priceWon: 119000,
    specs: {
      socket: "AM5",
      memoryType: "DDR5",
      maxMemoryGb: 96,
      memorySlots: 2,
      maxMemorySpeedMhz: 6400,
      m2Slots: 2,
      m2Interfaces: ["NVMe"],
      sataPorts: 4,
      vrmCapacityW: 90,
      formFactor: "mATX",
      pcieX16Slots: 1,
      pcieX8Slots: 0
    }
  }),
  seed({
    id: "mb-b760-intel",
    category: "motherboard",
    name: "GIGABYTE B760M AORUS ELITE AX",
    brand: "GIGABYTE",
    model: "B760M AORUS ELITE AX",
    priceWon: 189000,
    specs: {
      socket: "LGA1700",
      memoryType: "DDR5",
      maxMemoryGb: 192,
      memorySlots: 4,
      maxMemorySpeedMhz: 7600,
      m2Slots: 3,
      m2Interfaces: ["NVMe"],
      sataPorts: 4,
      vrmCapacityW: 220,
      formFactor: "mATX",
      pcieX16Slots: 1,
      pcieX8Slots: 0
    }
  }),
  seed({
    id: "memory-ddr5-16-5600",
    category: "memory",
    name: "삼성전자 DDR5-5600 16GB",
    brand: "Samsung",
    model: "DDR5-5600 16GB",
    priceWon: 58000,
    specs: {
      memoryType: "DDR5",
      capacityGb: 16,
      speedMhz: 5600,
      formFactor: "DIMM"
    }
  }),
  seed({
    id: "memory-ddr5-32-7200",
    category: "memory",
    name: "G.SKILL DDR5-7200 32GB",
    brand: "G.SKILL",
    model: "DDR5-7200 32GB",
    priceWon: 169000,
    specs: {
      memoryType: "DDR5",
      capacityGb: 32,
      speedMhz: 7200,
      formFactor: "DIMM"
    }
  }),
  seed({
    id: "memory-ddr4-16-3200",
    category: "memory",
    name: "삼성전자 DDR4-3200 16GB",
    brand: "Samsung",
    model: "DDR4-3200 16GB",
    priceWon: 42000,
    specs: {
      memoryType: "DDR4",
      capacityGb: 16,
      speedMhz: 3200,
      formFactor: "DIMM"
    }
  }),
  seed({
    id: "gpu-rtx-5090",
    category: "gpu",
    name: "MSI GeForce RTX 5090 게이밍 트리오",
    brand: "MSI",
    model: "RTX 5090 Gaming Trio",
    priceWon: 3490000,
    specs: {
      powerW: 575,
      recommendedPsuW: 1000,
      lengthMm: 359,
      thicknessMm: 72,
      pcieSlotWidth: 16,
      pciePowerOptions: [[{ kind: "12v2x6", count: 1 }], [{ kind: "pcie_8pin_6plus2", count: 4 }]]
    }
  }),
  seed({
    id: "gpu-rtx-4060",
    category: "gpu",
    name: "ZOTAC GeForce RTX 4060 Twin Edge",
    brand: "ZOTAC",
    model: "RTX 4060 Twin Edge",
    priceWon: 439000,
    specs: {
      powerW: 115,
      recommendedPsuW: 550,
      lengthMm: 221,
      thicknessMm: 40,
      pcieSlotWidth: 16,
      pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]]
    }
  }),
  seed({
    id: "ssd-nvme-1tb",
    category: "ssd",
    name: "SK하이닉스 Platinum P41 M.2 NVMe 1TB",
    brand: "SK hynix",
    model: "Platinum P41 1TB",
    priceWon: 109000,
    specs: {
      interface: "NVMe",
      formFactor: "M.2 2280",
      capacityGb: 1000
    }
  }),
  seed({
    id: "ssd-sata-1tb",
    category: "ssd",
    name: "Samsung 870 EVO SATA 1TB",
    brand: "Samsung",
    model: "870 EVO 1TB",
    priceWon: 99000,
    specs: {
      interface: "SATA",
      formFactor: "2.5인치",
      capacityGb: 1000
    }
  }),
  seed({
    id: "hdd-seagate-4tb",
    category: "hdd",
    name: "Seagate BarraCuda 4TB",
    brand: "Seagate",
    model: "BarraCuda 4TB",
    priceWon: 119000,
    specs: {
      interface: "SATA",
      formFactor: "3.5인치",
      capacityGb: 4000
    }
  }),
  seed({
    id: "case-compact-matx",
    category: "case",
    name: "마이크로닉스 WIZMAX 오로라",
    brand: "Micronics",
    model: "WIZMAX Aurora",
    priceWon: 69000,
    specs: {
      maxGpuLengthMm: 300,
      maxCoolerHeightMm: 155,
      maxPsuLengthMm: 180,
      hddBays: 2,
      ssdBays: 2,
      motherboardFormFactors: ["mATX", "ITX"],
      supportedPsuFormFactors: ["ATX", "SFX"]
    }
  }),
  seed({
    id: "case-full-airflow",
    category: "case",
    name: "Fractal Design Pop Air XL",
    brand: "Fractal Design",
    model: "Pop Air XL",
    priceWon: 159000,
    specs: {
      maxGpuLengthMm: 420,
      maxCoolerHeightMm: 185,
      maxPsuLengthMm: 220,
      hddBays: 8,
      ssdBays: 4,
      motherboardFormFactors: ["ATX", "mATX", "ITX"],
      supportedPsuFormFactors: ["ATX", "SFX"]
    }
  }),
  seed({
    id: "psu-650w",
    category: "psu",
    name: "마이크로닉스 Classic II 650W",
    brand: "Micronics",
    model: "Classic II 650W",
    priceWon: 72000,
    specs: {
      wattageW: 650,
      psuDepthMm: 140,
      efficiency: "80PLUS Bronze",
      psuFormFactor: "ATX",
      pciePowerConnectors: { pcie_8pin_6plus2: 2 }
    }
  }),
  seed({
    id: "psu-1000w",
    category: "psu",
    name: "Seasonic FOCUS GX-1000",
    brand: "Seasonic",
    model: "FOCUS GX-1000",
    priceWon: 229000,
    specs: {
      wattageW: 1000,
      psuDepthMm: 150,
      efficiency: "80PLUS Gold",
      psuFormFactor: "ATX",
      pciePowerConnectors: { pcie_8pin_6plus2: 4, "12v2x6": 1 }
    }
  }),
  seed({
    id: "psu-1300w",
    category: "psu",
    name: "SuperFlower LEADEX VII 1300W",
    brand: "SuperFlower",
    model: "LEADEX VII 1300W",
    priceWon: 319000,
    specs: {
      wattageW: 1300,
      psuDepthMm: 160,
      efficiency: "80PLUS Gold",
      psuFormFactor: "ATX",
      pciePowerConnectors: { pcie_8pin_6plus2: 6, "12v2x6": 2 }
    }
  }),
  {
    ...seed({
      id: "psu-unknown-850w",
      category: "psu",
      name: "정격 정보가 부족한 850W 파워",
      brand: "Unknown",
      model: "850W",
      priceWon: 85000,
      specs: {
        wattageW: 850
      }
    }),
    dataQuality: "incomplete",
    missingFields: ["efficiency", "12V output", "connectors"]
  }
];
