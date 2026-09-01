import { describe, expect, it } from "vitest";
import { createShareOwnerCredential, hashShareOwnerToken, publicSavedBuild, shareOwnerOrEnabledAdminCanManage, shareOwnerTokenMatches } from "./build-share";

const build = { id: "build-1", name: "테스트 견적", selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true }, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" };

describe("saved build share ownership", () => {
  it("creates a high-entropy token and matching hash", () => {
    const credential = createShareOwnerCredential();
    expect(credential.token.length).toBeGreaterThanOrEqual(40);
    expect(credential.hash).toBe(hashShareOwnerToken(credential.token));
    expect(credential.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches only the exact owner token", () => {
    const credential = createShareOwnerCredential();
    const record = { ...build, ownerTokenHash: credential.hash };
    expect(shareOwnerTokenMatches(record, credential.token)).toBe(true);
    expect(shareOwnerTokenMatches(record, `${credential.token}x`)).toBe(false);
    expect(shareOwnerTokenMatches(record, undefined)).toBe(false);
    expect(shareOwnerTokenMatches({ ownerTokenHash: undefined }, credential.token)).toBe(false);
  });

  it("allows admin fallback only when admin authentication is explicitly enabled", () => {
    const credential = createShareOwnerCredential();
    const record = { ...build, ownerTokenHash: credential.hash };
    expect(shareOwnerOrEnabledAdminCanManage(record, credential.token, false, false)).toBe(true);
    expect(shareOwnerOrEnabledAdminCanManage(record, undefined, false, true)).toBe(false);
    expect(shareOwnerOrEnabledAdminCanManage(record, undefined, true, false)).toBe(false);
    expect(shareOwnerOrEnabledAdminCanManage(record, undefined, true, true)).toBe(true);
  });

  it("never includes the owner hash in public build responses", () => {
    const credential = createShareOwnerCredential();
    const publicBuild = publicSavedBuild({ ...build, ownerTokenHash: credential.hash, monitorState: { enabled: true, intervalMinutes: 60, alertPolicy: "all", updatedAt: "2026-08-31T01:00:00.000Z", alerts: [] } });
    expect(publicBuild).toEqual(build);
    expect("ownerTokenHash" in publicBuild).toBe(false);
    expect("monitorState" in publicBuild).toBe(false);
  });
});
