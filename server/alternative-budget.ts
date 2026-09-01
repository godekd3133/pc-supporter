export function alternativeCandidatePriceWon(priceWon: number | undefined, recommendedQuantity = 1) {
  if (typeof priceWon !== "number" || !Number.isFinite(priceWon) || priceWon <= 0) return undefined;
  if (!Number.isInteger(recommendedQuantity) || recommendedQuantity <= 0) return undefined;
  return priceWon * recommendedQuantity;
}

export function alternativeCandidateWithinBudget(priceWon: number | undefined, recommendedQuantity: number | undefined, budgetWon: number | undefined) {
  if (budgetWon === undefined) return true;
  const candidatePriceWon = alternativeCandidatePriceWon(priceWon, recommendedQuantity ?? 1);
  return candidatePriceWon !== undefined && candidatePriceWon <= budgetWon;
}
