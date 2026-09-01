export function fanCurrentAFromText(text: string) {
  // RGB/ARGB LED 부하 표기는 팬 모터 전류로 재사용하지 않는다.
  // 붙여 쓴 `LED팬`과 띄어 쓴 `LED 팬`을 모두 후보에서 제외한다.
  const currentPattern = /(?:팬\s*)?(?:소비\s*전류|정격\s*전류|팬\s*전류|전류)\s*[:：]?\s*([\d,.]+)\s*A(?![A-Za-z])/gi;
  for (const match of text.matchAll(currentPattern)) {
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 12), start);
    if (/(?:LED|RGB|ARGB)\s*(?:팬\s*)?$/i.test(before)) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}
