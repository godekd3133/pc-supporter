// 공유 견적 링크의 미리보기 카드(og:image)와 meta 태그.
// 카카오톡·디스코드·커뮤니티에 링크를 붙였을 때 견적 이름·합계·호환 상태·핵심 부품이 바로 보이게 한다.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { CATEGORY_LABELS, type PartCategory, type SavedBuildCheckSnapshot, type SavedBuildSummary } from "../shared/types";

export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

export type BuildOgCardInput = {
  name: string;
  summary?: Pick<SavedBuildSummary, "totalPriceWon" | "priceComplete" | "coreLines">;
  checkSnapshot?: Pick<SavedBuildCheckSnapshot, "status" | "blockerCount" | "warningCount" | "unknownCount">;
};

const CARD_CATEGORIES: PartCategory[] = ["cpu", "gpu", "motherboard", "memory", "ssd", "psu"];

export function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

/** 대략적인 글자 폭(em). 한글·전각은 1, 영문·숫자는 약 0.56으로 본다. */
function charWidthEm(char: string) {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60))) return 1;
  if (char === " ") return 0.3;
  return 0.56;
}

/** maxWidthPx 안에 들어가도록 자르고, 잘렸으면 말줄임표를 붙인다. */
export function truncateToWidth(text: string, fontSizePx: number, maxWidthPx: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const limitEm = maxWidthPx / fontSizePx;
  let used = 0;
  let out = "";
  for (const char of normalized) {
    const width = charWidthEm(char);
    if (used + width > limitEm) return `${out.trimEnd()}…`;
    used += width;
    out += char;
  }
  return out;
}

function statusBadge(check: BuildOgCardInput["checkSnapshot"]) {
  if (!check) return { label: "호환 확인 전", fill: "#eef1f5", color: "#4e5968" };
  if (check.status === "incompatible") return { label: `호환 불가 ${check.blockerCount}개`, fill: "#ffeceb", color: "#e5372b" };
  if (check.status === "needs_review") return { label: `확인 필요 ${check.unknownCount + check.warningCount}개`, fill: "#fff5e0", color: "#c77700" };
  if (check.warningCount > 0) return { label: `호환 가능 · 주의 ${check.warningCount}개`, fill: "#e6f8f1", color: "#0b8a62" };
  return { label: "모든 부품 호환", fill: "#e6f8f1", color: "#0b8a62" };
}

export function buildOgCardSvg(input: BuildOgCardInput) {
  const badge = statusBadge(input.checkSnapshot);
  const badgeWidth = Math.round(badge.label.split("").reduce((sum, char) => sum + charWidthEm(char), 0) * 26 + 48);
  const total = input.summary && input.summary.totalPriceWon > 0 ? `${input.summary.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요";
  const priceNote = input.summary && input.summary.totalPriceWon > 0 && !input.summary.priceComplete ? "일부 부품 가격 미확인" : "";
  const lines = CARD_CATEGORIES.flatMap((category) => {
    const matches = input.summary?.coreLines.filter((line) => line.category === category) ?? [];
    if (matches.length === 0) return [];
    const first = matches[0];
    const quantity = matches.reduce((sum, line) => sum + line.quantity, 0);
    const name = `${first.name}${matches.length > 1 ? ` 외 ${matches.length - 1}` : quantity > 1 ? ` ×${quantity}` : ""}`;
    return [{ label: CATEGORY_LABELS[category], name }];
  });
  const title = truncateToWidth(input.name || "PC 견적", 52, 1060);
  const rows = lines.map((line, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 70 + column * 540;
    const y = 386 + row * 72;
    return `<text x="${x}" y="${y}" font-size="22" font-weight="600" fill="#8b95a1">${escapeXml(line.label)}</text>`
      + `<text x="${x}" y="${y + 32}" font-size="26" font-weight="600" fill="#191f28">${escapeXml(truncateToWidth(line.name, 26, 490))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_CARD_WIDTH}" height="${OG_CARD_HEIGHT}" viewBox="0 0 ${OG_CARD_WIDTH} ${OG_CARD_HEIGHT}" font-family="Pretendard">`
    + `<rect width="100%" height="100%" fill="#f2f4f6"/>`
    + `<rect x="30" y="30" width="1140" height="570" rx="36" fill="#ffffff"/>`
    + `<rect x="70" y="70" width="40" height="40" rx="10" fill="#191f28"/><rect x="80" y="82" width="20" height="4" rx="2" fill="#3182f6"/><rect x="80" y="89" width="20" height="4" rx="2" fill="#ffffff"/><rect x="80" y="96" width="14" height="4" rx="2" fill="#ffffff"/>`
    + `<text x="124" y="100" font-size="26" font-weight="700" fill="#191f28">PC Supporter</text>`
    + `<rect x="${1130 - badgeWidth}" y="64" width="${badgeWidth}" height="52" rx="26" fill="${badge.fill}"/>`
    + `<text x="${1130 - badgeWidth / 2}" y="99" font-size="26" font-weight="700" fill="${badge.color}" text-anchor="middle">${escapeXml(badge.label)}</text>`
    + `<text x="70" y="196" font-size="52" font-weight="800" fill="#191f28">${escapeXml(title)}</text>`
    + `<text x="70" y="290" font-size="72" font-weight="800" fill="#3182f6">${escapeXml(total)}</text>`
    + (priceNote ? `<text x="70" y="330" font-size="22" font-weight="500" fill="#8b95a1">${escapeXml(priceNote)}</text>` : "")
    + `<line x1="70" y1="346" x2="1130" y2="346" stroke="#e5e8eb" stroke-width="2"/>`
    + rows
    + `</svg>`;
}

type ResvgModule = typeof import("@resvg/resvg-js");
let resvgModule: ResvgModule | null | undefined;
let fontFiles: string[] | undefined;

function loadResvg(): ResvgModule | null {
  if (resvgModule !== undefined) return resvgModule;
  try {
    const require = createRequire(import.meta.url);
    resvgModule = require("@resvg/resvg-js") as ResvgModule;
    const fontDir = resolve(dirname(require.resolve("pretendard/package.json")), "dist/public/static");
    fontFiles = ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"].map((weight) => resolve(fontDir, `Pretendard-${weight}.otf`));
  } catch {
    resvgModule = null;
  }
  return resvgModule;
}

/** SVG 카드를 PNG로 렌더링한다. 렌더러를 불러올 수 없는 환경이면 undefined. */
export function renderBuildOgCardPng(input: BuildOgCardInput): Buffer | undefined {
  const resvg = loadResvg();
  if (!resvg || !fontFiles) return undefined;
  const renderer = new resvg.Resvg(buildOgCardSvg(input), {
    fitTo: { mode: "width", value: OG_CARD_WIDTH },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Pretendard" }
  });
  return renderer.render().asPng();
}

export function buildOgDescription(input: BuildOgCardInput) {
  const badge = statusBadge(input.checkSnapshot).label;
  const total = input.summary && input.summary.totalPriceWon > 0 ? `합계 ${input.summary.totalPriceWon.toLocaleString("ko-KR")}원` : "합계 가격 확인 필요";
  const parts = CARD_CATEGORIES.flatMap((category) => input.summary?.coreLines.find((line) => line.category === category)?.name ?? []).slice(0, 2);
  return [total, badge, ...parts].join(" · ");
}

/** index.html의 </head> 앞에 공유 견적용 og/twitter meta를 넣는다. */
export function injectShareMeta(html: string, meta: { title: string; description: string; imageUrl: string; pageUrl: string }) {
  const title = escapeXml(meta.title);
  const description = escapeXml(meta.description);
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="PC Supporter" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeXml(meta.pageUrl)}" />`,
    `<meta property="og:image" content="${escapeXml(meta.imageUrl)}" />`,
    `<meta property="og:image:width" content="${OG_CARD_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_CARD_HEIGHT}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${escapeXml(meta.imageUrl)}" />`
  ].join("\n    ");
  return html.replace(/<title>[^<]*<\/title>/, `<title>${title} | PC Supporter</title>`).replace("</head>", `    ${tags}\n  </head>`);
}
