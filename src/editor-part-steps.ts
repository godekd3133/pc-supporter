// One-step upgrade/downgrade targets for a part already in the manual build.
// Uses the shared gaming tier ladders when the model is on them, otherwise the
// next priced part in the same category that keeps the platform key (socket / DDR).
import { gamingPartTierAdjacencyFor } from "../shared/gaming-part-tiers";
import { type BuildSelection, type Part, isKnownPrice } from "../shared/types";

export type PartStepDirection = "up" | "down";

const LADDER_CATEGORIES = new Set(["cpu", "gpu", "ssd", "hdd"]);

function platformKeyFor(part: Part): string | undefined {
  if (part.category === "cpu" || part.category === "motherboard" || part.category === "cooler") return part.category === "cooler" ? undefined : part.specs.socket;
  if (part.category === "memory") return part.specs.memoryType;
  return undefined;
}

function sellable(part: Part) {
  return isKnownPrice(part.priceWon) && !part.priceUnavailableAt;
}

export function partStepFor(parts: readonly Part[], build: BuildSelection, current: Part, direction: PartStepDirection): Part | undefined {
  if (LADDER_CATEGORIES.has(current.category)) {
    const byId = (id: string | undefined) => id ? parts.find((part) => part.id === id) : undefined;
    const adjacency = gamingPartTierAdjacencyFor(parts, current.id, {
      cpu: byId(build.cpu?.partId),
      gpu: byId(build.gpu?.partId),
      motherboard: byId(build.motherboard?.partId),
      cooler: byId(build.cooler?.partId),
      psu: byId(build.psu?.partId)
    });
    const target = byId(direction === "up" ? adjacency.upId : adjacency.downId);
    if (target && target.id !== current.id) return target;
  }
  if (!isKnownPrice(current.priceWon)) return undefined;
  const key = platformKeyFor(current);
  const candidates = parts
    .filter((part) => part.category === current.category && part.id !== current.id && sellable(part) && (key === undefined || platformKeyFor(part) === key))
    .filter((part) => direction === "up" ? part.priceWon! > current.priceWon! : part.priceWon! < current.priceWon!)
    .sort((a, b) => direction === "up" ? a.priceWon! - b.priceWon! : b.priceWon! - a.priceWon!);
  return candidates[0];
}
