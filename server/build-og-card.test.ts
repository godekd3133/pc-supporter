import { describe, expect, it } from "vitest";
import { buildOgCardSvg, buildOgDescription, injectShareMeta, renderBuildOgCardPng, truncateToWidth } from "./build-og-card";

const input = {
  name: "QHD 게이밍 <150만원> 견적",
  summary: {
    totalPriceWon: 1_523_400,
    priceComplete: true,
    coreLines: [
      { category: "cpu" as const, name: "AMD 라이젠5 9600X", quantity: 1 },
      { category: "gpu" as const, name: "지포스 RTX 5070", quantity: 1 },
      { category: "memory" as const, name: "DDR5 16GB", quantity: 2 }
    ]
  },
  checkSnapshot: { status: "incompatible" as const, blockerCount: 2, warningCount: 1, unknownCount: 0 }
};

describe("build og card", () => {
  it("escapes user text and shows total, status and parts", () => {
    const svg = buildOgCardSvg(input);
    expect(svg).toContain("QHD 게이밍 &lt;150만원&gt; 견적");
    expect(svg).toContain("1,523,400원");
    expect(svg).toContain("호환 불가 2개");
    expect(svg).toContain("DDR5 16GB ×2");
    expect(svg).not.toContain("<150만원>");
  });

  it("marks unchecked builds and missing prices without claiming compatibility", () => {
    const svg = buildOgCardSvg({ name: "빈 견적" });
    expect(svg).toContain("호환 확인 전");
    expect(svg).toContain("가격 확인 필요");
    expect(buildOgDescription({ name: "빈 견적" })).toBe("합계 가격 확인 필요 · 호환 확인 전");
  });

  it("truncates long names by visual width", () => {
    expect(truncateToWidth("가".repeat(40), 20, 200)).toBe(`${"가".repeat(10)}…`);
    expect(truncateToWidth("짧은 이름", 20, 400)).toBe("짧은 이름");
  });

  it("injects escaped og meta and replaces the title", () => {
    const html = injectShareMeta("<html><head><title>PC Supporter</title></head><body></body></html>", { title: "내 \"견적\"", description: "합계", imageUrl: "https://x.test/a.png", pageUrl: "https://x.test/share/1" });
    expect(html).toContain("<title>내 &quot;견적&quot; | PC Supporter</title>");
    expect(html).toContain('<meta property="og:image" content="https://x.test/a.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("renders a 1200x630 PNG", () => {
    const png = renderBuildOgCardPng(input);
    expect(png).toBeDefined();
    expect(png!.subarray(1, 4).toString()).toBe("PNG");
    expect(png!.readUInt32BE(16)).toBe(1200);
    expect(png!.readUInt32BE(20)).toBe(630);
  });
});
