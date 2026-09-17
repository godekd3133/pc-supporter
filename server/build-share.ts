import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { SavedBuild } from "../shared/types";
import type { SavedBuildMonitorSubscription } from "../shared/saved-build-monitor-subscription";
import type { SavedBuildMetadataHistoryEntry } from "../shared/saved-build-decision-note";

export type SavedBuildRecord = SavedBuild & {
  ownerTokenHash?: string;
  recoveryCodeHash?: string;
  monitorState?: SavedBuildMonitorSubscription;
  metadataHistory?: SavedBuildMetadataHistoryEntry[];
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

// 혼동하기 쉬운 문자(0/O, 1/I/L)를 뺀 복구 코드 알파벳 — 사용자가 손으로 옮겨 적는다.
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_LENGTH = 12;

export function createShareRecoveryCode() {
  const raw = Array.from({ length: RECOVERY_CODE_LENGTH }, () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)]).join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  return { code, hash: hashShareRecoveryCode(code) };
}

export function normalizeShareRecoveryCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const compact = value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === RECOVERY_CODE_LENGTH ? compact : undefined;
}

export function hashShareRecoveryCode(code: string) {
  const normalized = normalizeShareRecoveryCode(code);
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

export function shareRecoveryCodeMatches(record: { recoveryCodeHash?: string }, code: string | undefined) {
  if (!record.recoveryCodeHash) return false;
  const normalized = normalizeShareRecoveryCode(code);
  if (!normalized) return false;
  const expected = Buffer.from(record.recoveryCodeHash, "hex");
  const supplied = Buffer.from(hashShareRecoveryCode(normalized), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function shareOwnerOrEnabledAdminCanManage(record: { ownerTokenHash?: string }, token: string | undefined, adminEnabled: boolean, adminAuthenticated: boolean) {
  return shareOwnerTokenMatches(record, token) || (adminEnabled && adminAuthenticated);
}

export function publicSavedBuild(record: SavedBuildRecord): SavedBuild {
  const { ownerTokenHash: _ownerTokenHash, recoveryCodeHash: _recoveryCodeHash, monitorState: _monitorState, metadataHistory: _metadataHistory, ...build } = record;
  return build;
}
