import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { configureQuoteGenerationGate, inferListingType, isCurrentGenerationPart, isListingAllowed, isQuoteBrandAllowed, isQuoteSelectable, partQuoteGenerationFor, quoteBrandOptionsFor, quoteGenerationBoundaryFor } from "./listing";

function part(overrides: Partial<Part>): Part {
  return {
    id: "part-1",
    category: "ssd",
    name: "정상 SSD 1TB",
    source: "danawa",
    specs: { interface: "NVMe", formFactor: "M.2 2280", capacityGb: 1000 },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}

describe("listing policy", () => {
  it("classifies listing conditions and storage accessories", () => {
    expect(inferListingType(part({ name: "정상 SSD 1TB" }))).toBe("retail");
    expect(inferListingType(part({ name: "정상 SSD 1TB 벌크" }))).toBe("bulk");
    expect(inferListingType(part({ name: "정상 SSD 1TB 병행수입" }))).toBe("parallel_import");
    expect(inferListingType(part({ name: "정상 SSD 1TB 해외구매" }))).toBe("overseas");
    expect(inferListingType(part({ name: "정상 SSD 1TB 중고" }))).toBe("used");
    expect(inferListingType(part({ name: "USB 3.0 to SATA 컨버터 4TB" }))).toBe("accessory");
    expect(inferListingType(part({ category: "ssd", name: "M.2 SSD 보관케이스", rawSpecText: "보관케이스 / SSD전용" }))).toBe("accessory");
    expect(inferListingType(part({ category: "psu", name: "듀얼파워 커넥터", rawSpecText: "전용 액세서리 / 메인전원: 24핀" }))).toBe("accessory");
  });

  it("separates case-category riser accessories without classifying case features as accessories", () => {
    expect(inferListingType(part({ category: "case", name: "AONE PCI-E 4.0 라이저 케이블", rawSpecText: "액세서리 / PCIe 라이저" }))).toBe("accessory");
    expect(inferListingType(part({ category: "case", name: "bequiet! HDD CAGE 서린" }))).toBe("accessory");
    expect(inferListingType(part({ category: "case", name: "Phanteks PREMIUM GEN5 VERTICAL GPU BRACKET (블랙)" }))).toBe("accessory");
    expect(inferListingType(part({ category: "case", name: "정상 케이스", rawSpecText: "ATX 케이스 / 라이저 케이블 장착 지원" }))).toBe("retail");
  });

  it("keeps bulk opt-in but never allows a storage accessory as a core part", () => {
    const bulk = part({ name: "정상 SSD 1TB 벌크" });
    const used = part({ name: "정상 SSD 1TB 중고" });
    const accessory = part({ name: "USB-SATA 컨버터" });

    expect(isListingAllowed(bulk, "retail_only")).toBe(false);
    expect(isListingAllowed(bulk, "include_bulk")).toBe(true);
    expect(isListingAllowed(used, "include_bulk")).toBe(false);
    expect(isListingAllowed(used, "all")).toBe(true);
    expect(isListingAllowed(accessory, "all")).toBe(false);
  });

  it("excludes high-confidence non-PC products mislabeled as motherboards from every listing policy", () => {
    const embedded = part({ category: "motherboard", name: "Raspberry Pi 4 Model B", rawSpecText: "임베디드 보드" });
    const oldBoard = part({ category: "motherboard", name: "Z390 중고 메인보드", rawSpecText: "인텔(소켓1151v2) / 인텔 Z390" });

    expect(isListingAllowed(embedded, "retail_only")).toBe(false);
    expect(isListingAllowed(embedded, "include_bulk")).toBe(false);
    expect(isListingAllowed(embedded, "all")).toBe(false);
    expect(isListingAllowed(oldBoard, "all")).toBe(true);
  });
});

describe("quote brand policy", () => {
  it("allows only Samsung and SK hynix for ssd and memory in both spelling variants", () => {
    for (const category of ["ssd", "memory"] as const) {
      expect(isQuoteBrandAllowed(category, "삼성전자")).toBe(true);
      expect(isQuoteBrandAllowed(category, "Samsung")).toBe(true);
      expect(isQuoteBrandAllowed(category, "SK하이닉스")).toBe(true);
      expect(isQuoteBrandAllowed(category, "SK hynix")).toBe(true);
      expect(isQuoteBrandAllowed(category, "G.SKILL")).toBe(false);
      expect(isQuoteBrandAllowed(category, "마이크론")).toBe(false);
      expect(isQuoteBrandAllowed(category, "PC Supporter")).toBe(false);
      expect(isQuoteBrandAllowed(category, undefined)).toBe(false);
    }
  });

  it("allows only Seasonic and Micronics for psu", () => {
    expect(isQuoteBrandAllowed("psu", "시소닉")).toBe(true);
    expect(isQuoteBrandAllowed("psu", "Seasonic")).toBe(true);
    expect(isQuoteBrandAllowed("psu", "마이크로닉스")).toBe(true);
    expect(isQuoteBrandAllowed("psu", "Micronics")).toBe(true);
    expect(isQuoteBrandAllowed("psu", "SuperFlower")).toBe(false);
    expect(isQuoteBrandAllowed("psu", "잘만")).toBe(false);
  });

  it("leaves unrestricted categories untouched and trims the brand options", () => {
    expect(isQuoteBrandAllowed("cpu", "AMD")).toBe(true);
    expect(isQuoteBrandAllowed("case", "앱코")).toBe(true);
    expect(quoteBrandOptionsFor("cpu", [{ brand: "AMD", count: 2 }])).toEqual([{ brand: "AMD", count: 2 }]);
    expect(quoteBrandOptionsFor("memory", [{ brand: "삼성전자", count: 20 }, { brand: "G.SKILL", count: 101 }])).toEqual([{ brand: "삼성전자", count: 20 }]);
  });
});

describe("current generation policy", () => {
  const cpuPart = (name: string) => part({ category: "cpu", name, priceWon: 300000, specs: {} });
  const gpuPart = (name: string, gpuArchitectureFamily?: string, rawSpecText?: string) =>
    part({ category: "gpu", name, priceWon: 500000, rawSpecText, specs: gpuArchitectureFamily ? { gpuArchitectureFamily } : {} });

  it("keeps latest CPU generations and rejects legacy series", () => {
    for (const name of [
      "AMD 라이젠7-6세대 9800X3D (그래니트 릿지) (멀티팩 정품)",
      "AMD 라이젠5-6세대 9500F (그래니트 릿지) (멀티팩 정품)",
      "인텔 코어 울트라7 시리즈2 265K (애로우레이크) (정품)",
      "인텔 코어 울트라5 시리즈2 250K Plus (애로우레이크 리프레시) (정품)",
      "AMD 라이젠9-7세대 10950X3D",
      "AMD 라이젠7 PRO 9645 (그래니트 릿지) (멀티팩 정품)",
      "인텔 코어 울트라5 225F"
    ]) {
      expect(isCurrentGenerationPart(cpuPart(name)), name).toBe(true);
    }
    for (const name of [
      // 직전 세대도 제외 — Ryzen 7000/8000G·Core i 12~14세대는 구세대 취급
      "AMD 라이젠7-5세대 7800X3D",
      "AMD 라이젠5-5세대 7500F",
      "AMD 라이젠7-5세대 8700G (피닉스) (멀티팩 정품)",
      "인텔 코어 i7-14세대 14700K",
      "인텔 코어 i5-12세대 12400F (엘더레이크) (정품)",
      "AMD 라이젠5-4세대 5600 (버미어) (멀티팩 정품)",
      "AMD 라이젠5 PRO 7645 (라파엘) (멀티팩 정품)",
      "인텔 프로세서 300 (랩터레이크 리프레시) (정품)",
      "AMD 라이젠5-1세대 1600 (서밋 릿지)",
      "AMD 라이젠5-3세대 3600 (마티스)",
      "인텔 코어 i7-9세대 9700K",
      "인텔 코어 i5-11세대 11400F",
      "AMD EPYC 4585PX (그라도) (멀티팩 정품)",
      "인텔 셀러론 G5905 (코멧레이크S) (정품)",
      "AM5 8코어 65W 기준 프로세서"
    ]) {
      expect(isCurrentGenerationPart(cpuPart(name)), name).toBe(false);
    }
  });

  it("keeps latest GPU generations and rejects legacy or workstation lookalikes", () => {
    for (const name of [
      "MSI GeForce RTX 5090 게이밍 트리오",
      "ZOTAC GAMING 지포스 RTX 5060 Ti Twin Edge OC D7 8GB",
      "GIGABYTE 라데온 RX 9070 XT GAMING OC D7 16GB",
      "인텔 Arc B580",
      "인텔 Arc Pro B70 D6 32GB",
      "NVIDIA RTX PRO 6000 Blackwell 워크스테이션 에디션 D7 96GB",
      "GIGABYTE 라데온 AI PRO R9700 AI TOP D6 32GB"
    ]) {
      expect(isCurrentGenerationPart(gpuPart(name)), name).toBe(true);
    }
    for (const name of [
      // 직전 세대(RTX 30/40, RX 6000/7000, Arc A)도 구세대 취급해 제외한다.
      "ZOTAC GeForce RTX 4060 Twin Edge",
      "MSI 지포스 RTX 3070 게이밍",
      "Intel Arc A770 16GB",
      "GIGABYTE 라데온 RX 7600 GAMING OC D6 8GB",
      "MSI 지포스 RTX 3060 벤투스 2X",
      "SAPPHIRE 라데온 RX 6600 PULSE",
      "AFOX 지포스 GT1030 L5 D5 2GB LP",
      "이엠텍 지포스 RTX 2060 STORM X Dual",
      "MSI 지포스 GTX 1650",
      "GIGABYTE 라데온 RX 580",
      "NVIDIA 쿼드로 RTX 6000 D6 24GB",
      "NVIDIA RTX 2000 Ada Generation D6 16GB",
      "NVIDIA RTX A6000 D6 48GB"
    ]) {
      expect(isCurrentGenerationPart(gpuPart(name)), name).toBe(false);
    }
    // "RTX 5000 Ada"처럼 세대 패턴이 아닌 워크스테이션 번호는 저장된 family가
    // "RTX 50"으로 남아 있어도 이름의 Ada 표기로 걸러낸다.
    expect(isCurrentGenerationPart(gpuPart("NVIDIA RTX 5000 Ada Generation D6 32GB", "RTX 50"))).toBe(false);
    // 이름에 모델이 없어도 재파싱된 architecture family로 판별한다.
    expect(isCurrentGenerationPart(gpuPart("MSI 지포스 신형 그래픽카드", "RTX 50"))).toBe(true);
    expect(isCurrentGenerationPart(gpuPart("MSI 지포스 그래픽카드", "RTX 40"))).toBe(false);
  });

  it("gates quote selectability only for cpu and gpu", () => {
    expect(isQuoteSelectable(cpuPart("AMD 라이젠7-6세대 9800X3D"))).toBe(true);
    expect(isQuoteSelectable(cpuPart("AMD 라이젠7-5세대 7800X3D"))).toBe(false);
    expect(isQuoteSelectable(cpuPart("AMD 라이젠5-2세대 2600 (피나클 릿지)"))).toBe(false);
    expect(isQuoteSelectable(gpuPart("ZOTAC GeForce RTX 5060 Twin Edge"))).toBe(true);
    expect(isQuoteSelectable(gpuPart("ZOTAC GeForce RTX 4060 Twin Edge"))).toBe(false);
    expect(isQuoteSelectable(gpuPart("ZOTAC GeForce RTX 2060 Twin Edge"))).toBe(false);
    // 이름에서 세대를 못 읽어도 정규화된 cpuSeries 스펙을 신뢰한다.
    expect(isQuoteSelectable(part({ category: "cpu", name: "테스트 CPU", priceWon: 300000, specs: { cpuSeries: "Ryzen 9000" } }))).toBe(true);
    expect(isQuoteSelectable(part({ category: "cpu", name: "테스트 CPU", priceWon: 300000, specs: { cpuSeries: "Ryzen 7000" } }))).toBe(false);
    expect(isQuoteSelectable(cpuPart("테스트 CPU"))).toBe(false);
    expect(isQuoteSelectable(part({ category: "case", name: "아주 오래된 케이스", priceWon: 50000 }))).toBe(true);
    expect(isQuoteSelectable({ ...cpuPart("AMD 라이젠7-6세대 9800X3D"), priceWon: undefined })).toBe(false);
  });
});

describe("dynamic generation boundary", () => {
  const cpuPart = (name: string) => part({ category: "cpu", name, priceWon: 300000, specs: {} });
  const gpuPart = (name: string, gpuArchitectureFamily?: string) =>
    part({ category: "gpu", name, priceWon: 500000, specs: gpuArchitectureFamily ? { gpuArchitectureFamily } : {} });
  const rtx50 = (id: string) => gpuPart(`ZOTAC 지포스 RTX 5090 OC ${id}`);
  const rtx60 = (id: string) => gpuPart(`ZOTAC 지포스 RTX 6090 OC ${id}`);

  it("derives the newest generation from the catalog and demotes the previous one when a new generation arrives", () => {
    const before = [rtx50("a"), rtx50("b"), gpuPart("ZOTAC 지포스 RTX 4060")];
    expect(quoteGenerationBoundaryFor(before).get("nvidia-geforce")?.topLabel).toBe("RTX 50");
    expect(isCurrentGenerationPart(rtx50("a"), before)).toBe(true);
    expect(isCurrentGenerationPart(gpuPart("ZOTAC 지포스 RTX 4060"), before)).toBe(false);

    // 크롤러가 RTX 60 상품을 충분히 수집하면 경계가 자동 상승해 RTX 50이 구세대가 된다.
    const after = [...before, rtx60("c"), rtx60("d")];
    expect(quoteGenerationBoundaryFor(after).get("nvidia-geforce")?.topLabel).toBe("RTX 60");
    expect(isCurrentGenerationPart(rtx60("c"), after)).toBe(true);
    expect(isCurrentGenerationPart(rtx50("a"), after)).toBe(false);
  });

  it("requires market depth before a new generation takes over the boundary", () => {
    // 신세대 1종만으로는 경계가 안 올라간다 — 잘못 분류된 상품의 경계 오염 방지.
    const catalog = [rtx50("a"), rtx50("b"), rtx60("c")];
    expect(quoteGenerationBoundaryFor(catalog).get("nvidia-geforce")?.thresholdRank).toBe(50);
    expect(isCurrentGenerationPart(rtx50("a"), catalog)).toBe(true);
    // 신세대 단품 자체는 경계 위라 항상 통과한다.
    expect(isCurrentGenerationPart(rtx60("c"), catalog)).toBe(true);
  });

  it("ignores workstation products so they cannot corrupt the consumer boundary", () => {
    const catalog = [
      rtx50("a"), rtx50("b"),
      gpuPart("NVIDIA RTX PRO 6000 Blackwell 워크스테이션 에디션 D7 96GB"),
      gpuPart("NVIDIA RTX PRO 5000 Blackwell D7 48GB"),
      gpuPart("NVIDIA RTX 6000 Ada Generation D6 48GB"),
      gpuPart("NVIDIA RTX 5000 Ada Generation D6 32GB")
    ];
    // RTX PRO·Ada 제품이 있어도 소비형 경계는 RTX 50이다.
    expect(quoteGenerationBoundaryFor(catalog).get("nvidia-geforce")?.topRank).toBe(50);
    expect(isCurrentGenerationPart(rtx50("a"), catalog)).toBe(true);
    expect(isCurrentGenerationPart(gpuPart("ZOTAC 지포스 RTX 4060"), catalog)).toBe(false);
    // 워크스테이션 신형은 여전히 견적 후보로 살아 있다.
    expect(isCurrentGenerationPart(gpuPart("NVIDIA RTX PRO 6000 Blackwell 워크스테이션 에디션 D7 96GB"), catalog)).toBe(true);
    expect(isCurrentGenerationPart(gpuPart("NVIDIA RTX 5000 Ada Generation D6 32GB"), catalog)).toBe(false);
  });

  it("applies the same automatic boundary to CPU lines", () => {
    const catalog = [
      cpuPart("AMD 라이젠7-6세대 9800X3D"),
      cpuPart("AMD 라이젠5-6세대 9500F"),
      cpuPart("AMD 라이젠7-5세대 7800X3D")
    ];
    expect(isCurrentGenerationPart(cpuPart("AMD 라이젠7-5세대 7800X3D"), catalog)).toBe(false);
    // 라이젠 7세대(Ryzen 10000)가 수집되면 6세대가 구세대로 밀린다.
    const next = [...catalog, cpuPart("AMD 라이젠9-7세대 10950X3D"), cpuPart("AMD 라이젠7-7세대 10700X")];
    expect(isCurrentGenerationPart(cpuPart("AMD 라이젠7-6세대 9800X3D"), next)).toBe(false);
    expect(isCurrentGenerationPart(cpuPart("AMD 라이젠7-7세대 10700X"), next)).toBe(true);
    // 인텔 라인은 코어 울트라 시리즈 번호가 코어 i 세대보다 항상 위다.
    const intel = [
      cpuPart("인텔 코어 울트라7 시리즈2 265K"),
      cpuPart("인텔 코어 울트라5 시리즈2 245K"),
      cpuPart("인텔 코어 i7-14세대 14700K")
    ];
    expect(isCurrentGenerationPart(cpuPart("인텔 코어 i7-14세대 14700K"), intel)).toBe(false);
    expect(isCurrentGenerationPart(cpuPart("인텔 코어 울트라5 시리즈2 245K"), intel)).toBe(true);
  });

  it("does not count delisted or unpriced listings toward the boundary", () => {
    const catalog = [
      rtx50("a"), rtx50("b"),
      { ...rtx60("c"), delistedAt: "2026-10-01T00:00:00.000Z" },
      { ...rtx60("d"), priceWon: undefined }
    ];
    // 신세대가 단종·미가격 상태면 경계가 올라가지 않는다 — 세대가 실제로
    // 사라지면 이전 세대가 다시 견적에 돌아온다.
    expect(quoteGenerationBoundaryFor(catalog).get("nvidia-geforce")?.topRank).toBe(50);
    expect(isCurrentGenerationPart(rtx50("a"), catalog)).toBe(true);
  });

  it("lets generationDepth widen the allowed window", () => {
    const catalog = [rtx50("a"), rtx50("b"), gpuPart("ZOTAC 지포스 RTX 4060 a"), gpuPart("ZOTAC 지포스 RTX 4060 b"), gpuPart("MSI 지포스 RTX 3070")];
    try {
      configureQuoteGenerationGate({ depth: 2 });
      expect(isCurrentGenerationPart(gpuPart("ZOTAC 지포스 RTX 4060 a"), catalog)).toBe(true);
      expect(isCurrentGenerationPart(gpuPart("MSI 지포스 RTX 3070"), catalog)).toBe(false);
      configureQuoteGenerationGate({ enabled: false });
      expect(isCurrentGenerationPart(gpuPart("MSI 지포스 RTX 3070"), catalog)).toBe(true);
    } finally {
      configureQuoteGenerationGate({ enabled: true, depth: 1 });
    }
  });

  it("keeps parts with unreadable generations out of quotes even with a catalog context", () => {
    const catalog = [rtx50("a"), rtx50("b")];
    expect(partQuoteGenerationFor(gpuPart("이엠텍 지포스 이상한모델"))).toBeUndefined();
    expect(isCurrentGenerationPart(gpuPart("이엠텍 지포스 이상한모델"), catalog)).toBe(false);
    expect(isCurrentGenerationPart(cpuPart("AMD EPYC 4585PX"), [])).toBe(false);
  });
});
