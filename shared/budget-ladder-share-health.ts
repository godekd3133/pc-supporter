export type BudgetLadderShareHealthStatus = "unknown" | "checking" | "active" | "expired" | "revoked" | "error";

export function budgetLadderShareHealthFromHttp(status: number, message = ""): Exclude<BudgetLadderShareHealthStatus, "unknown" | "checking"> {
  if (status >= 200 && status < 300) return "active";
  if (status === 404 && /만료/.test(message)) return "expired";
  if (status === 404) return "revoked";
  return "error";
}

export function budgetLadderShareHealthLabel(status: BudgetLadderShareHealthStatus, locallyExpired = false) {
  if (status === "active") return "서버 활성";
  if (status === "checking") return "서버 확인 중";
  if (status === "expired") return "서버 만료";
  if (status === "revoked") return "서버 취소됨";
  if (status === "error") return "확인 실패";
  return locallyExpired ? "로컬 만료 · 서버 미확인" : "서버 확인 전";
}

export function budgetLadderShareHealthTone(status: BudgetLadderShareHealthStatus, locallyExpired = false) {
  if (status === "active") return "active";
  if (status === "checking") return "checking";
  if (status === "expired" || status === "revoked" || locallyExpired) return "expired";
  if (status === "error") return "error";
  return "unknown";
}
