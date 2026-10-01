import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccessoryItem, BuildSelection, Part } from "../shared/types";
import { HomeView, MobileHomeAdditionalSelections, MobileHomeRequiredSelectionCount } from "./HomeView";

function build(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true, ...overrides };
}

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "cpu-1",
    category: "cpu",
    name: "테스트 CPU",
    source: "manual",
    priceWon: 100000,
    specs: { coolerIncluded: false },
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function accessory(overrides: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "fan-1",
    category: "cooling_fan",
    name: "테스트 주변 부품",
    source: "manual",
    listingType: "accessory",
    priceWon: 10000,
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

describe("mobile home build summary", () => {
  it("shows one clear start action before the concise guided steps for an empty build", () => {
    const noop = () => undefined;
    const markup = renderToStaticMarkup(<HomeView
      meta={null}
      build={build()}
      result={null}
      resultIsStale={false}
      partMap={new Map()}
      accessoryMap={new Map()}
      budgetLadderShares={[]}
      alternativeComparisonShares={[]}
      savedBuildVersionShares={[]}
      alertItems={[]}
      alertUnreadCount={0}
      hasBuildAlerts={false}
      hasWatchlistAlerts={false}
      savedBuilds={[]}
      onJourneyAction={noop}
      onOpenSavedBuild={noop}
      onStart={noop}
      onGuidedStart={noop}
      onGenerate={noop}
      onDemo={noop}
      onCompatibleDemo={noop}
      onResume={noop}
      onOpenResult={noop}
      onOpenHistory={noop}
      onOpenWatchlist={noop}
      onCopyBudgetLadderShare={noop}
      onRemoveBudgetLadderShare={noop}
      onToastBudgetLadderShare={noop}
      onCopyAlternativeComparisonShare={noop}
      onRemoveAlternativeComparisonShare={noop}
      onRevokeAlternativeComparisonShare={async () => true}
      onToastAlternativeComparisonShare={noop}
      onCopySavedBuildVersionShare={noop}
      onRemoveSavedBuildVersionShare={noop}
      onRevokeSavedBuildVersionShare={async () => true}
      onToastSavedBuildVersionShare={noop}
      onToast={noop}
    />);
    const primaryActionIndex = markup.indexOf('data-testid="mobile-home-primary-action"');
    const guidedEntryIndex = markup.indexOf('data-testid="mobile-home-guided-entry"');

    expect(primaryActionIndex).toBeGreaterThan(-1);
    expect(primaryActionIndex).toBeLessThan(guidedEntryIndex);
    expect(markup).toContain(">용도와 예산 정하기</span>");
    expect(markup).toContain('aria-label="다른 구성 방법"');
    expect(markup).toContain("<h2>직접 구성</h2>");
    expect(markup).toContain(">부품 선택하기</strong>");
    expect(markup).toContain("원하는 부품을 선택하고 호환성을 확인해요.");
    expect(markup).toContain('aria-label="견적 진행 순서"');
    expect(markup).toContain("용도와 예산부터 정해요.");
    expect(markup).toContain("1</span>용도");
    expect(markup).toContain("2</span>화면·성능");
    expect(markup).toContain("3</span>예산");
    expect(markup).toContain("선택한 조건에 맞춰 부품을 추천하고, 호환 결과까지 확인해요.");
    expect(markup).toContain("견적의 부품 선택이나 주변 부품 찾기에서 목록을 불러오면 여기에 표시됩니다.");
    expect(markup).not.toContain("부품 목록을 열면 최근 항목이 이 기기에 저장됩니다.");
  });

  it("uses the shared preflight total for its required-parts denominator", () => {
    const selectedBuild = build({
      cpu: { partId: "cpu-boxed", quantity: 1 },
      motherboard: { partId: "board-1", quantity: 1 },
      memory: [{ partId: "memory-1", quantity: 1 }],
      case: { partId: "case-1", quantity: 1 },
      psu: { partId: "psu-1", quantity: 1 }
    });
    const partMap = new Map([
      ["cpu-boxed", part({ id: "cpu-boxed", specs: { coolerIncluded: true } })],
      ["board-1", part({ id: "board-1", category: "motherboard", name: "테스트 메인보드" })],
      ["memory-1", part({ id: "memory-1", category: "memory", name: "테스트 RAM" })],
      ["case-1", part({ id: "case-1", category: "case", name: "테스트 케이스" })],
      ["psu-1", part({ id: "psu-1", category: "psu", name: "테스트 파워" })]
    ]);
    const markup = renderToStaticMarkup(<MobileHomeRequiredSelectionCount build={selectedBuild} partMap={partMap} accessoryMap={new Map()} />);

    expect(markup).toContain("<strong>5/5</strong>");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="필수 부품 선택 진행률"');
    expect(markup).toContain('aria-valuetext="5개 선택, 5개 중"');
    expect(markup).toContain('style="width:100%"');
  });

  it("shows selected omitted categories, extra memory, and accessories in the mobile disclosure", () => {
    const selectedBuild = build({
      memory: [{ partId: "memory-1", quantity: 1 }, { partId: "memory-2", quantity: 1 }],
      cooler: { partId: "cooler-1", quantity: 1 },
      ssd: [{ partId: "ssd-1", quantity: 2 }],
      hdd: [{ partId: "hdd-1", quantity: 1 }],
      case: { partId: "case-1", quantity: 1 },
      psu: { partId: "psu-1", quantity: 1 },
      accessories: [{ accessoryId: "heatsink-1", quantity: 2 }]
    });
    const partMap = new Map([
      ["memory-1", part({ id: "memory-1", category: "memory", name: "DDR5 16GB A" })],
      ["memory-2", part({ id: "memory-2", category: "memory", name: "DDR5 16GB B" })],
      ["cooler-1", part({ id: "cooler-1", category: "cooler", name: "타워 쿨러" })],
      ["ssd-1", part({ id: "ssd-1", category: "ssd", name: "NVMe SSD" })],
      ["hdd-1", part({ id: "hdd-1", category: "hdd", name: "SATA HDD" })],
      ["case-1", part({ id: "case-1", category: "case", name: "미들타워 케이스" })],
      ["psu-1", part({ id: "psu-1", category: "psu", name: "850W 파워" })]
    ]);
    const accessoryMap = new Map([["heatsink-1", accessory({ id: "heatsink-1", category: "m2_heatsink", name: "M.2 SSD 방열판" })]]);
    const markup = renderToStaticMarkup(<MobileHomeAdditionalSelections build={selectedBuild} partMap={partMap} accessoryMap={accessoryMap} />);
    const summaryMarkup = markup.slice(markup.indexOf("<summary>"), markup.indexOf("</summary>") + "</summary>".length);

    expect(markup).toContain("추가 구성 보기");
    expect(summaryMarkup).toContain("CPU 쿨러");
    expect(summaryMarkup).toContain("SSD");
    expect(summaryMarkup).toContain("HDD");
    expect(summaryMarkup).toContain("케이스");
    expect(summaryMarkup).toContain("파워서플라이");
    expect(summaryMarkup).toContain("RAM 2개");
    expect(summaryMarkup).toContain("주변 부품 2개");
    expect(markup).toContain("DDR5 16GB A");
    expect(markup).toContain("DDR5 16GB B");
    expect(markup).toContain("NVMe SSD ×2");
    expect(markup).toContain("SATA HDD");
    expect(markup).toContain("타워 쿨러");
    expect(markup).toContain("미들타워 케이스");
    expect(markup).toContain("850W 파워");
    expect(markup).toContain("M.2 SSD 방열판 ×2");
  });
});
