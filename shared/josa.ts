// 마지막 글자의 받침 유무로 자연스러운 조사를 붙인다.
// 영어·숫자로 끝나는 부품명도 한국어 발음 기준으로 판별한다.

const VOWEL_END_LETTERS = new Set("ABCDEGHIJKOPQTUVWY".split(""));
const BATCHIM_DIGITS = new Set(["0", "1", "3", "6", "7", "8"]);
const RIEUL_DIGITS = new Set(["1", "7", "8"]);
const RIEUL_LETTERS = new Set(["L", "R"]);

function lastSignificantChar(word: string) {
  for (let i = word.length - 1; i >= 0; i--) {
    const ch = word[i];
    if (/[\s)\]}>'"”’·.,;:!?%\-_]/.test(ch)) continue;
    return ch;
  }
  return undefined;
}

function hangulJong(ch: string) {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return undefined;
  return (code - 0xac00) % 28;
}

export function hasBatchim(word: string) {
  const ch = lastSignificantChar(word);
  if (!ch) return false;
  const jong = hangulJong(ch);
  if (jong !== undefined) return jong !== 0;
  if (/[A-Za-z]/.test(ch)) return !VOWEL_END_LETTERS.has(ch.toUpperCase());
  if (/[0-9]/.test(ch)) return BATCHIM_DIGITS.has(ch);
  return false;
}

export function endsWithRieul(word: string) {
  const ch = lastSignificantChar(word);
  if (!ch) return false;
  const jong = hangulJong(ch);
  if (jong !== undefined) return jong === 8;
  if (/[A-Za-z]/.test(ch)) return RIEUL_LETTERS.has(ch.toUpperCase());
  if (/[0-9]/.test(ch)) return RIEUL_DIGITS.has(ch);
  return false;
}

export const eul = (word: string) => `${word}${hasBatchim(word) ? "을" : "를"}`;
export const eun = (word: string) => `${word}${hasBatchim(word) ? "은" : "는"}`;
export const iGa = (word: string) => `${word}${hasBatchim(word) ? "이" : "가"}`;
export const gwa = (word: string) => `${word}${hasBatchim(word) ? "과" : "와"}`;
export const euro = (word: string) => `${word}${hasBatchim(word) && !endsWithRieul(word) ? "으로" : "로"}`;
