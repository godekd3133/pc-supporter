import { describe, expect, it } from "vitest";
import { ownerSessionModeSupportedFor } from "./owner-session-mode";

describe("owner session browser mode", () => {
  it("supports HTTPS browser origins and the explicitly supported local Vite origin", () => {
    expect(ownerSessionModeSupportedFor({ protocol: "https:", hostname: "pc.example.com", port: "", origin: "https://pc.example.com" }, { apiOrigin: "https://pc.example.com" })).toBe(true);
    expect(ownerSessionModeSupportedFor({ protocol: "http:", hostname: "localhost", port: "5173" })).toBe(true);
    expect(ownerSessionModeSupportedFor({ protocol: "http:", hostname: "127.0.0.1", port: "5173" })).toBe(true);
  });

  it("keeps offline, native, Capacitor and unsupported HTTP origins out of session-v1", () => {
    expect(ownerSessionModeSupportedFor({ protocol: "https:", hostname: "pc.example.com", port: "" }, { offline: true })).toBe(false);
    expect(ownerSessionModeSupportedFor({ protocol: "https:", hostname: "pc.example.com", port: "" }, { native: true })).toBe(false);
    expect(ownerSessionModeSupportedFor({ protocol: "capacitor:", hostname: "localhost", port: "" })).toBe(false);
    expect(ownerSessionModeSupportedFor({ protocol: "http:", hostname: "localhost", port: "4173" })).toBe(false);
    expect(ownerSessionModeSupportedFor({ protocol: "http:", hostname: "0.0.0.0", port: "5173" })).toBe(false);
  });

  it("keeps cross-origin API deployments on the legacy owner-token path", () => {
    expect(ownerSessionModeSupportedFor(
      { protocol: "https:", hostname: "app.example.com", port: "", origin: "https://app.example.com" },
      { apiOrigin: "https://api.other-site.example" }
    )).toBe(false);
  });
});
