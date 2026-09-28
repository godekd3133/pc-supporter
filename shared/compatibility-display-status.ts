import type { CompatibilityResult } from "./types";

type CompatibilityStatusInput = Pick<CompatibilityResult, "status"> & {
  accessoryCompatibility?: Pick<NonNullable<CompatibilityResult["accessoryCompatibility"]>, "status">;
};

export function compatibilityDisplayStatusFor(result: CompatibilityStatusInput): CompatibilityResult["status"] {
  const accessoryStatus = result.accessoryCompatibility?.status;
  if (result.status === "incompatible" || accessoryStatus === "incompatible") return "incompatible";
  if (result.status === "needs_review" || accessoryStatus === "needs_review") return "needs_review";
  return "compatible";
}
