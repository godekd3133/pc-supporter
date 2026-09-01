export const VALUE_SCORE_MAX = 200 as const;

export function valueScoreText(score: number) {
  return `${score}/${VALUE_SCORE_MAX}점`;
}
