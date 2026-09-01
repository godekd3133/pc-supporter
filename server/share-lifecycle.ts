export type ShareExpiryDays = 7 | 30;

export function shareExpiryDaysFrom(value: unknown): ShareExpiryDays | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return value === 7 || value === 30 ? value : undefined;
}

export function shareExpiryValueProvided(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

export function shareExpiresAtFor(expiryDays: ShareExpiryDays | undefined, now: number | Date = Date.now()) {
  if (expiryDays === undefined) return undefined;
  const timestamp = now instanceof Date ? now.getTime() : now;
  return new Date(timestamp + expiryDays * 24 * 60 * 60 * 1000).toISOString();
}

export function normalizeShareExpiryAt(value: unknown): { valid: boolean; value?: string } {
  if (!shareExpiryValueProvided(value)) return { valid: true };
  if (typeof value !== "string") return { valid: false };
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? { valid: true, value: new Date(timestamp).toISOString() } : { valid: false };
}

export function shareExpired(expiresAt: string | undefined, now = Date.now()) {
  if (expiresAt === undefined) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}
