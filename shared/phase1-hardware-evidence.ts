import type { Part } from "./types";

/**
 * Source facts and the project's conservative recommendation policy are separate.
 * A power-stage rating in amperes cannot be compared directly with CPU PPT in
 * watts. No synthetic vrmCapacityW is written into catalog specifications.
 */
export const PHASE1_HARDWARE_EVIDENCE_VERSION = "phase1-hardware-2026-10-04";

export const PHASE1_MOTHERBOARD_EVIDENCE = [
  {
    model: "A520M-HVS",
    socket: "AM4",
    sourceUrl: "https://www.asrock.com/MB/AMD/A520M-HVS/index.asp",
    cpuSupportUrl: "https://www.asrock.com/support/cpu.us.asp?s=AM4&u=744",
    sourceFacts: "6 power phases; 50A power chokes. 5500GT supported from BIOS P3.30. DrMOS and VRM heatsink are not established by this source.",
    reviewedAt: "2026-10-04",
    conservativeMaxTdpW: 65,
    policyNote: "1차 테스트에서는 저전력 AM4만 사용하며 PBO/수동 오버클럭을 가정하지 않는다."
  },
  {
    model: "TUF GAMING B550M-PLUS",
    socket: "AM4",
    sourceUrl: "https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b550m-plus/",
    cpuSupportUrl: "https://www.asus.com/uk/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b550m-plus/helpdesk_cpu?model2Name=TUF-GAMING-B550M-PLUS",
    sourceFacts: "8+2 DrMOS power stages and VRM heatsinks. Official CPU support includes Ryzen 5000 through 5950X (105W). BIOS revision depends on CPU.",
    reviewedAt: "2026-10-04",
    conservativeMaxTdpW: 105,
    policyNote: "공식 CPU 지원과 전원부 냉각 설계를 확인한 Ryzen 5000 기본 설정 조합에 사용한다."
  },
  {
    model: "B850M GAMING X WIFI6E",
    socket: "AM5",
    sourceUrl: "https://www.gigabyte.com/tw/Motherboard/B850M-GAMING-X-WIFI6E-rev-10",
    cpuSupportUrl: "https://www.gigabyte.com/kr/Motherboard/B850M-GAMING-X-WIFI6E-rev-10/support",
    sourceFacts: "10 Vcore phases with 60A DrMOS and VRM heatsinks; supports Ryzen 7000 and 9000. Board revision and BIOS must match the purchased unit.",
    reviewedAt: "2026-10-04",
    conservativeMaxTdpW: 120,
    policyNote: "제조사 보장 출력 상한이 아닌 1차 추천 정책이다. 170W Ryzen 9는 X870E로 보낸다."
  },
  {
    model: "MAG X870E TOMAHAWK WIFI",
    socket: "AM5",
    sourceUrl: "https://www.msi.com/Motherboard/MAG-X870E-TOMAHAWK-WIFI",
    cpuSupportUrl: "https://www.msi.com/Motherboard/MAG-X870E-TOMAHAWK-WIFI/support#cpu",
    sourceFacts: "14+2+1 power phases; 80A SPS Vcore stages and extended VRM heatsinks; supports Ryzen 7000 and 9000.",
    reviewedAt: "2026-10-04",
    conservativeMaxTdpW: 170,
    policyNote: "170W 기본 설정 CPU까지 허용하는 보수 추천 정책이며 오버클럭을 가정하지 않는다."
  }
] as const;

function boardEvidenceFor(motherboard: Part) {
  if (motherboard.category !== "motherboard") return undefined;
  const text = `${motherboard.name} ${motherboard.model ?? ""}`;
  if (/ASRock\s+A520M-HVS\s+대원씨티에스/i.test(text)) return PHASE1_MOTHERBOARD_EVIDENCE[0];
  if (/ASUS\s+TUF\s+Gaming\s+B550M-PLUS\s+STCOM/i.test(text)) return PHASE1_MOTHERBOARD_EVIDENCE[1];
  if (/GIGABYTE\s+B850M\s+GAMING\s+X\s+WIFI6E\s+제이씨현/i.test(text)) return PHASE1_MOTHERBOARD_EVIDENCE[2];
  if (/MSI\s+MAG\s+X870E\s+(?:토마호크|TOMAHAWK)\s+WIFI\b/i.test(text)) return PHASE1_MOTHERBOARD_EVIDENCE[3];
  return undefined;
}

/** CPU-board gate shared by generation, minimum-price and adjustment paths. */
export function phase1MotherboardSupportsCpu(cpu: Part, motherboard: Part): boolean {
  if (cpu.category !== "cpu") return false;
  const evidence = boardEvidenceFor(motherboard);
  const text = `${cpu.model ?? ""} ${cpu.name}`;
  const modelMatch = /\b([579]\d{3}(?:X3D|GT|XT|[XGF])?)\b/i.exec(text);
  if (!evidence || !modelMatch || !/AMD|라이젠|Ryzen/i.test(text)) return false;
  const series = Number(modelMatch[1][0]);
  const tdp = cpu.specs.tdpW;
  if (tdp === undefined || !Number.isFinite(tdp) || tdp <= 0 || tdp > evidence.conservativeMaxTdpW) return false;
  if (cpu.specs.socket !== evidence.socket || motherboard.specs.socket !== evidence.socket) return false;
  if (evidence.socket === "AM4") return series === 5;
  return series === 7 || series === 9;
}

export const PHASE1_COOLER_EVIDENCE = [
  {
    model: "AG400 G2",
    sourceUrl: "https://www.deepcool.com/products/Cooling/cpuaircoolers/AG400-G2-Superior-Performance-4-Heatpipe-Single-Tower-CPU-Cooler/2025/22515.shtml",
    retailSpecUrl: "https://prod.danawa.com/info/?pcode=106047347",
    sourceFacts: "Single tower, 4 heatpipes, AM4/AM5 support and 154.5mm height. Retail spec lists 230W thermal capacity; this is not a CPU temperature guarantee."
  },
  {
    model: "Peerless Assassin 120 SE",
    sourceUrl: "https://www.thermalright.com/product/peerless-assassin-120-se/",
    retailSpecUrl: "https://prod.danawa.com/info/?pcode=16525058",
    sourceFacts: "Dual tower, 6 heatpipes, 155mm height; sockets must be checked against the purchased mounting kit."
  },
  {
    model: "NAUTILUS 360 RS",
    sourceUrl: "https://www.corsair.com/kr/ko/p/cpu-coolers/cw-9061060-ww/nautilus-360-rs-aio-liquid-cpu-cooler-cw-9061060-ww",
    retailSpecUrl: "https://prod.danawa.com/info/?pcode=70003022",
    sourceFacts: "360mm radiator with three RS120 fans and AM4/AM5 support. Exact non-ARGB model confirmed in domestic retail; ARGB/LCD are different products."
  }
] as const;

/**
 * A conservative stock-settings selection rule, not a measured cooling wattage.
 * Physical clearance and radiator placement remain separate compatibility gates.
 */
export function phase1CoolerSupportsCpu(cooler: Part, cpu: Part): boolean {
  if (cooler.category !== "cooler" || cpu.category !== "cpu") return false;
  const socket = cpu.specs.socket;
  const tdp = cpu.specs.tdpW;
  if (!socket || !cooler.specs.supportedSockets?.includes(socket) || tdp === undefined || !Number.isFinite(tdp) || tdp <= 0) return false;
  const text = `${cooler.name} ${cooler.model ?? ""}`;
  if (/DEEPCOOL\s+AG400\s+G2\b/i.test(text)) return cooler.specs.coolerType === "air" && tdp <= 120;
  if (/Thermalright\s+Peerless\s+Assassin\s+120\s+SE\s+서린/i.test(text)) return cooler.specs.coolerType === "air" && tdp <= 170;
  if (/CORSAIR\s+NAUTILUS\s+360\s+RS(?:$|\s)/i.test(text) && !/ARGB|LCD/i.test(text)) {
    return cooler.specs.coolerType === "liquid" && cooler.specs.radiatorSizeMm === 360 && tdp <= 170;
  }
  return false;
}

/** C10M supports only the small 234×203mm mATX subset, not all mATX boards. */
export function phase1CaseSupportsMotherboard(casePart: Part, motherboard: Part): boolean {
  if (!/앱코\s+C10M\s+컴팩트/i.test(casePart.name)) return true;
  return /ASRock\s+A520M-HVS\s+대원씨티에스/i.test(`${motherboard.name} ${motherboard.model ?? ""}`);
}

export const PHASE1_RX580_POWER_BUDGET_EVIDENCE = {
  productSpecUrl: "https://image3.compuzone.co.kr/img/product_img_detail/2025/0324/1225450/0d4bf5d683d49a1a7318b580f6dbf752.jpg",
  connectorSpecUrl: "https://help.corsair.com/hc/en-us/articles/10700487373197-PSU-How-to-Avoid-Current-Overload-Connector-Issues",
  standardUrl: "https://pcisig.com/PCIExpress/Spec/CEM/CardElectromechanical_6.0",
  note: "측정 TGP가 없는 정확한 디앤디컴 RX580은 PCIe 슬롯 75W + 8핀 1개 150W를 전력 예산의 보수 상한으로만 사용한다. 제품의 소비전력 스펙으로 기록하지 않는다."
};

/** Planning allowance; never expose this as the product's measured TGP. */
export function phase1GpuPowerUpperBoundW(gpu: Part): number | undefined {
  const statedPower = gpu.specs.powerW;
  if (statedPower !== undefined && Number.isFinite(statedPower) && statedPower > 0) return statedPower;
  const reviewed5060Ti = gpu.category === "gpu" && ["93704792", "81715985"].includes(gpu.sourceProductCode ?? "") && /RTX\s*5060\s*Ti/i.test(gpu.name) && gpu.specs.vramGb === 16;
  if (gpu.category !== "gpu" || (!reviewed5060Ti && !/^AFOX\s+라데온\s+RX\s+580\s+2048SP\s+D5\s+8GB\s+디앤디컴$/i.test(gpu.name))) return undefined;
  const options = gpu.specs.pciePowerOptions;
  if (!options?.some((option) => option.length === 1 && option[0].kind === "pcie_8pin_6plus2" && option[0].count === 1)) return undefined;
  return 225;
}
