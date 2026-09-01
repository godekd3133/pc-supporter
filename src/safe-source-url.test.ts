import { describe, expect, it } from "vitest";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";

describe("safe catalog source URL", () => {
  it("allows HTTPS Danawa hosts", () => {
    expect(safeExternalUrl("https://prod.danawa.com/info/?pcode=123")).toBe("https://prod.danawa.com/info/?pcode=123");
  });

  it("rejects insecure and unrelated hosts", () => {
    expect(safeExternalUrl("http://www.danawa.com/info/?pcode=123")).toBeUndefined();
    expect(safeExternalUrl("https://example.com/item")).toBeUndefined();
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("handles missing or malformed input", () => {
    expect(safeExternalUrl(undefined)).toBeUndefined();
    expect(safeExternalUrl("not-a-url")).toBeUndefined();
  });

  it("allows any HTTPS host only for manually reviewed evidence links", () => {
    expect(safeHttpsUrl("https://vendor.example/manual#gpu")).toBe("https://vendor.example/manual#gpu");
    expect(safeHttpsUrl("http://vendor.example/manual")).toBeUndefined();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpsUrl("https://")).toBeUndefined();
  });
});
