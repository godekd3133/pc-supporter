export const OWNER_SESSION_RESOURCE_TYPES = [
  "build",
  "watchlist",
  "comparison",
  "version-comparison",
  "budget-ladder",
  "generator-variants"
] as const;

export type OwnerSessionResourceType = typeof OWNER_SESSION_RESOURCE_TYPES[number];

const ownerSessionResourceTypeValues: ReadonlySet<string> = new Set(OWNER_SESSION_RESOURCE_TYPES);

export function isOwnerSessionResourceType(value: unknown): value is OwnerSessionResourceType {
  return typeof value === "string" && ownerSessionResourceTypeValues.has(value);
}
