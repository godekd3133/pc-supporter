/** Canonical model spelling without collapsing unrelated words or SKU boundaries. */
export function normalizeCatalogSearchText(value: string) {
  return value.toLocaleLowerCase("ko-KR").trim().replace(/\s+/g, " ")
    .replace(/\b(rtx|gtx|rx)\s*(\d{3,4})/g, "$1 $2")
    .replace(/\b(\d{3,4})\s*(ti|super|xtx|xt)(?=\b)/g, "$1$2");
}

const WORD_CHAR = /[a-z0-9가-힣]/;
const DIGIT = /\d/;

/** 0 = 없음, 1 = 접두/부분 일치(9500 → 9500F, 5060 → 5060 Ti), 2 = 단어 단위 완전 일치. */
function tokenMatchStrength(text: string, token: string): 0 | 1 | 2 {
  const digitStart = DIGIT.test(token[0] ?? "");
  let best: 0 | 1 | 2 = 0;
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(token, from);
    if (index < 0) break;
    from = index + 1;
    const before = index > 0 ? text[index - 1] : "";
    // 숫자로 시작하는 모델 토큰은 다른 숫자의 꼬리와 맞추지 않는다(9500 ≠ 19500, 4400 ≠ 14400).
    if (digitStart && before && DIGIT.test(before)) continue;
    const after = text[index + token.length] ?? "";
    const exact = (!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after));
    if (exact) return 2;
    best = 1;
  }
  return best;
}

export interface CatalogSearchMatcher {
  /** 모든 검색어 토큰이 haystack에 있으면 true. */
  matches(haystack: string): boolean;
  /** 낮을수록 관련도가 높다 — 단어 단위로 완전히 일치하지 않은(접두 일치) 토큰 수. 불일치는 Infinity. */
  relevance(haystack: string): number;
}

/**
 * 검색어를 공백 단위 토큰으로 나눠 모두 포함되는 부품을 찾는다. 각 토큰은
 * 부품 이름의 단어 접두로도 일치한다 — "9500"은 "9500F", "14400"은 "14400F",
 * "5060"은 "5060 Ti"를 찾는다. 완전 일치 토큰이 많은 부품이 관련도가 높다.
 */
export function catalogSearchMatcherFor(query: string | undefined): CatalogSearchMatcher {
  const tokens = normalizeCatalogSearchText(query ?? "").split(" ").filter(Boolean);
  const relevance = (haystack: string) => {
    if (tokens.length === 0) return 0;
    const normalized = normalizeCatalogSearchText(haystack);
    let partial = 0;
    for (const token of tokens) {
      const strength = tokenMatchStrength(normalized, token);
      if (strength === 0) return Number.POSITIVE_INFINITY;
      if (strength === 1) partial += 1;
    }
    return partial;
  };
  return {
    matches: (haystack) => relevance(haystack) !== Number.POSITIVE_INFINITY,
    relevance
  };
}

export function catalogSearchMatches(haystack: string, query: string) {
  return catalogSearchMatcherFor(query).matches(haystack);
}
