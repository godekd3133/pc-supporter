import { createHash } from "node:crypto";

export function entityTagFor(value: unknown) {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
  return `"${digest}"`;
}

export function ifNoneMatchMatches(header: string | undefined, entityTag: string) {
  if (!header) return false;
  return header.trim() === "*" || header.split(",").some((candidate) => candidate.trim() === entityTag);
}
