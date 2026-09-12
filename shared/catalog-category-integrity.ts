import type { Part, PartCategory } from "./types";

/**
 * High-confidence category identity checks used at the catalog boundary.
 *
 * These rules deliberately avoid generic words such as `모듈`, `센서`, or
 * `전원부`: those words can appear in valid motherboard specifications. A
 * record is only marked as a mismatch when the product identity is explicit.
 */
export const CATALOG_CATEGORY_INTEGRITY_RULE_VERSION = 1 as const;

export type CatalogCategoryIntegritySignal =
  | "raspberry_pi"
  | "arduino"
  | "embedded_board"
  | "non_pc_component";

export interface CatalogCategoryMismatch {
  status: "mismatch";
  category: PartCategory;
  signal: CatalogCategoryIntegritySignal;
  label: string;
  reason: string;
}

export interface CatalogCategoryIntegritySignalCount {
  signal: CatalogCategoryIntegritySignal;
  label: string;
  count: number;
}

export interface CatalogCategoryIntegritySummary {
  ruleVersion: typeof CATALOG_CATEGORY_INTEGRITY_RULE_VERSION;
  checkedCount: number;
  mismatchCount: number;
  byCategory: Partial<Record<PartCategory, number>>;
  bySignal: CatalogCategoryIntegritySignalCount[];
}

const SIGNAL_LABELS: Record<CatalogCategoryIntegritySignal, string> = {
  raspberry_pi: "라즈베리파이 식별자",
  arduino: "아두이노 식별자",
  embedded_board: "임베디드 보드 표기",
  non_pc_component: "비-PC 부품명"
};

const RASPBERRY_PI_PATTERN = /라즈베리\s*파이|raspberry\s*pi/i;
const ARDUINO_PATTERN = /아두이노|arduino/i;
const EMBEDDED_BOARD_PATTERN = /임베디드\s*보드/i;

// Keep this list intentionally narrow. For example, `센서` alone is not a
// mismatch because valid motherboards can document an onboard temperature
// sensor in their raw specification.
const NON_PC_COMPONENT_NAME_PATTERN = /(?:서보\s*모터|서보모터|타이머\s*IC|타이머IC|브레드보드|릴레이\s*모듈|조이스틱\s*모듈|충전\s*모듈)/i;

type CatalogCategoryIntegrityInput = Pick<Part, "category" | "name" | "rawSpecText">;

function mismatchForSignal(category: PartCategory, signal: CatalogCategoryIntegritySignal): CatalogCategoryMismatch {
  const label = SIGNAL_LABELS[signal];
  return {
    status: "mismatch",
    category,
    signal,
    label,
    reason: `메인보드 범주에서 ${label}이 확인되었습니다.`
  };
}

export function catalogCategoryMismatchFor(part: CatalogCategoryIntegrityInput): CatalogCategoryMismatch | undefined {
  if (part.category !== "motherboard") return undefined;

  const name = part.name ?? "";
  const rawSpecText = part.rawSpecText ?? "";
  const identityText = `${name} ${rawSpecText}`;

  // Prefer the most specific product identity signal so the admin summary
  // explains why a record was excluded instead of reporting only "embedded".
  if (RASPBERRY_PI_PATTERN.test(identityText)) return mismatchForSignal(part.category, "raspberry_pi");
  if (ARDUINO_PATTERN.test(identityText)) return mismatchForSignal(part.category, "arduino");
  if (EMBEDDED_BOARD_PATTERN.test(identityText)) return mismatchForSignal(part.category, "embedded_board");
  if (NON_PC_COMPONENT_NAME_PATTERN.test(name)) return mismatchForSignal(part.category, "non_pc_component");
  return undefined;
}

export function catalogCategoryIntegritySummaryFor(catalog: Part[]): CatalogCategoryIntegritySummary {
  const signalOrder: CatalogCategoryIntegritySignal[] = ["raspberry_pi", "arduino", "embedded_board", "non_pc_component"];
  const signalCounts = Object.fromEntries(signalOrder.map((signal) => [signal, 0])) as Record<CatalogCategoryIntegritySignal, number>;
  let checkedCount = 0;
  let mismatchCount = 0;
  for (const part of catalog) {
    if (part.category !== "motherboard") continue;
    checkedCount += 1;
    const mismatch = catalogCategoryMismatchFor(part);
    if (!mismatch) continue;
    mismatchCount += 1;
    signalCounts[mismatch.signal] += 1;
  }

  return {
    ruleVersion: CATALOG_CATEGORY_INTEGRITY_RULE_VERSION,
    checkedCount,
    mismatchCount,
    byCategory: mismatchCount > 0 ? { motherboard: mismatchCount } : {},
    bySignal: signalOrder
      .map((signal) => ({ signal, label: SIGNAL_LABELS[signal], count: signalCounts[signal] }))
      .filter((entry) => entry.count > 0)
  };
}

export function catalogCategoryIntegritySignalLabelFor(signal: CatalogCategoryIntegritySignal) {
  return SIGNAL_LABELS[signal];
}
