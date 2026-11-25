// 제조사 공식 사양으로 확인한 케이스 장착 규격(라디에이터 위치·크기, SSD 베이, PSU 규격).
// 다나와 원문에는 기본 장착 팬만 있고 장착 가능 위치가 없어, 수랭·팬 판정이 "확인 필요"로 남는 것을 보강한다.
import snapshot from "./reference-data/case-mount-specs.json";
import type { Part, PartSpecs } from "../shared/types";

type CaseMountSpecItem = {
  partId: string;
  category: "case";
  fields: Pick<PartSpecs, "supportedPsuFormFactors" | "ssdBays" | "radiatorSupports" | "radiatorSizesMm">;
  /** 카탈로그 값이 공식 사양과 다르다고 확인된 필드. 이 필드만 덮어쓴다. */
  overwriteFields?: Array<keyof PartSpecs>;
  sourceUrl: string;
};

export const caseMountSpecItems: readonly CaseMountSpecItem[] = snapshot.items as CaseMountSpecItem[];
const itemsByPartId = new Map(caseMountSpecItems.map((item) => [item.partId, item]));

function missing(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

/** 카탈로그에 비어 있는 케이스 장착 필드를 채운다. overwriteFields가 아닌 기존 값은 그대로 둔다. */
export function applyCaseMountSpecSnapshot(catalog: Part[]): Part[] {
  return catalog.map((part) => {
    if (part.category !== "case") return part;
    const item = itemsByPartId.get(part.id);
    if (!item) return part;
    const filled: Partial<PartSpecs> = {};
    for (const [field, value] of Object.entries(item.fields) as Array<[keyof PartSpecs, unknown]>) {
      const overwrite = item.overwriteFields?.includes(field) ?? false;
      if ((overwrite || missing(part.specs[field])) && !missing(value)) (filled as Record<string, unknown>)[field] = structuredClone(value);
    }
    if (Object.keys(filled).length === 0) return part;
    return { ...part, specs: { ...part.specs, ...filled }, missingFields: part.missingFields.filter((field) => !(field in filled)) };
  });
}
