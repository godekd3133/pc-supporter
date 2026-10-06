import snapshot from "./reference-data/phase1-catalog.json";
import type { Part } from "../shared/types";
import { mergeReferenceCatalogPart } from "./reference-catalog-merge";

const MANLI_5090_SPEC_SOURCE = "https://storage.googleapis.com/www.taiwantradeshow.com.tw/product/202503/T-32063560.pdf";

/** Manufacturer's COMPUTEX submission for the exact OC SKU, not a different 5090. */
function applyPhase1ManufacturerSpecs(part: Part): Part {
  if (part.category === "gpu" && part.sourceProductCode === "78306452" && /^AFOX\s+라데온\s+RX\s+580\s+2048SP\s+D5\s+8GB\s+디앤디컴$/i.test(part.name)) {
    if (part.specs.catalogSpecProvenance || part.specs.physicalEvidenceSourceUrl) return part;
    return {
      ...part,
      missingFields: part.missingFields.filter((field) => !["lengthMm", "widthMm", "thicknessMm", "recommendedPsuW"].includes(field)),
      specs: {
        ...part.specs,
        lengthMm: 212,
        widthMm: 111,
        thicknessMm: 41.5,
        recommendedPsuW: 400,
        pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]],
        physicalEvidenceSourceUrl: "https://image3.compuzone.co.kr/img/product_img_detail/2025/0324/1225450/0d4bf5d683d49a1a7318b580f6dbf752.jpg",
        physicalEvidenceManufacturerModel: "AFRX580-8192D5H3-V3 / R-R-ACl-RX580H3V3 (디앤디컴)",
        physicalEvidenceUpdatedAt: "2026-10-04T14:45:00.000Z",
        physicalEvidenceSourceNote: "디앤디컴 제조사 제공 이미지의 상세사양: 212×111×41.5mm, 권장 파워 400W, 8핀 1개. 다른 유통사의 H3 모델 규격이나 일반 RX580 TGP를 복사하지 않음."
      }
    };
  }
  if (part.category === "case" && part.sourceProductCode === "96308750" && /앱코\s+C10M\s+컴팩트/i.test(part.name)) {
    if (part.specs.catalogSpecProvenance || part.specs.physicalEvidenceSourceUrl) return part;
    return {
      ...part,
      dataQuality: "manual",
      missingFields: part.missingFields.filter((field) => field !== "hddBays" && field !== "ssdBays"),
      specs: {
        ...part.specs,
        hddBays: 2,
        ssdBays: 2,
        physicalEvidenceSourceUrl: "https://www.abko.co.kr/brand/detail.php?it_id=1770626260",
        physicalEvidenceManufacturerModel: "C10M COMPACT",
        physicalEvidenceUpdatedAt: "2026-10-04T14:36:00.000Z",
        physicalEvidenceSourceNote: "공식 제품 이미지: HDD 2개/SSD 2개, Micro-ATX(Minimum) 최대 234×203mm, PCI 슬롯 3개. 일반 244×244mm mATX 보드는 장착할 수 없음."
      }
    };
  }
  if (part.category !== "gpu" || part.sourceProductCode !== "75656861" || !/MANLI.*RTX\s*5090\s*Gallardo\s*OC.*32GB.*인텍앤컴퍼니/i.test(part.name)) return part;
  // Preserve a separately reviewed administrator decision rather than replacing it.
  if (part.specs.catalogSpecProvenance || part.specs.physicalEvidenceSourceUrl) return part;
  return {
    ...part,
    dataQuality: "manual",
    missingFields: part.missingFields.filter((field) => !["powerW", "lengthMm", "widthMm", "thicknessMm", "recommendedPsuW"].includes(field)),
    specs: {
      ...part.specs,
      powerW: 600,
      recommendedPsuW: 1000,
      lengthMm: 359,
      widthMm: 145,
      thicknessMm: 69,
      gpuSlotOccupancy: 4,
      pciePowerOptions: part.specs.pciePowerOptions ?? [[{ kind: "12v2x6", count: 1 }]],
      pciePowerAdapterOptions: [[{ kind: "pcie_8pin_6plus2", count: 4 }]],
      physicalEvidenceSourceUrl: MANLI_5090_SPEC_SOURCE,
      physicalEvidenceManufacturerModel: "M-N509GO/D732G-M3626",
      physicalEvidenceUpdatedAt: "2026-10-04T14:36:00.000Z",
      physicalEvidenceSourceNote: "제조사 COMPUTEX 제품 시트: TGP 600W, 시스템 파워 1000W, 359×145×69mm, 4슬롯 공간, 16핀 1개 및 8핀 4개 변환 케이블."
    }
  };
}

/** Actual domestic source reads, not illustrative seed prices. */
export const phase1VerifiedCatalog: readonly Part[] = (snapshot.parts as unknown as Part[]).map(applyPhase1ManufacturerSpecs);
export const PHASE1_CATALOG_REFRESHED_AT = snapshot.refreshedAt;

function sourceIdentity(part: Part) {
  return part.sourceProductCode ? `${part.category}:${part.sourceProductCode}` : undefined;
}

/**
 * Install the narrow testbed source snapshot before runtime spec overrides.
 * Newer crawls/price checks win, so a checked-in October snapshot cannot undo
 * a later refresh. IDs and product codes retain the same source identity.
 */
export function applyPhase1CatalogSnapshot(catalog: readonly Part[]): Part[] {
  const verified = new Map(phase1VerifiedCatalog.map((part) => [sourceIdentity(part), part]));
  const matched = new Set<string>();
  const result = catalog.map((part) => {
    const identity = sourceIdentity(part);
    const source = identity ? verified.get(identity) : undefined;
    if (!source || !identity) return part;
    matched.add(identity);
    return mergeReferenceCatalogPart(part, source);
  });
  for (const part of phase1VerifiedCatalog) {
    const identity = sourceIdentity(part)!;
    if (!matched.has(identity) && !result.some((existing) => existing.id === part.id)) {
      result.push({ ...part, specs: { ...part.specs } });
    }
  }
  return result.map(applyPhase1ManufacturerSpecs);
}
