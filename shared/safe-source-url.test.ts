import { describe, expect, it } from "vitest";
import { SAFE_EXTERNAL_SOURCE_HOSTS, safeExternalUrl } from "./safe-source-url";

describe("safe external image URLs", () => {
  it("accepts HTTPS URLs only for the shared catalog image host contract", () => {
    for (const host of SAFE_EXTERNAL_SOURCE_HOSTS) {
      expect(safeExternalUrl(`https://${host}/image.png`)).toBe(`https://${host}/image.png`);
      expect(safeExternalUrl(`https://${host}:443/image.png`)).toBe(`https://${host}/image.png`);
    }
    expect(safeExternalUrl("https://untrusted.example/image.png")).toBeUndefined();
    expect(safeExternalUrl("http://img.danawa.com/image.png")).toBeUndefined();
  });

  it("rejects non-default ports that the matching CSP host source cannot authorize", () => {
    for (const host of SAFE_EXTERNAL_SOURCE_HOSTS) {
      expect(safeExternalUrl(`https://${host}:8443/image.png`)).toBeUndefined();
    }
  });
});
