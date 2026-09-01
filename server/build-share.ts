import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SavedBuild } from "../shared/types";
import type { SavedBuildMonitorSubscription } from "../shared/saved-build-monitor-subscription";

export type SavedBuildRecord = SavedBuild & {
  ownerTokenHash?: string;
  monitorState?: SavedBuildMonitorSubscription;
};

export function createShareOwnerCredential() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashShareOwnerToken(token) };
}

export function hashShareOwnerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function shareOwnerTokenMatches(record: { ownerTokenHash?: string }, token: string | undefined) {
  if (!record.ownerTokenHash || !token) return false;
  const expected = Buffer.from(record.ownerTokenHash, "hex");
  const supplied = Buffer.from(hashShareOwnerToken(token), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function shareOwnerOrEnabledAdminCanManage(record: { ownerTokenHash?: string }, token: string | undefined, adminEnabled: boolean, adminAuthenticated: boolean) {
  return shareOwnerTokenMatches(record, token) || (adminEnabled && adminAuthenticated);
}

export function publicSavedBuild(record: SavedBuildRecord): SavedBuild {
  const { ownerTokenHash: _ownerTokenHash, monitorState: _monitorState, ...build } = record;
  return build;
}
