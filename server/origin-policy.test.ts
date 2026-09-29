import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { adminRequestOriginIsAllowed } from "./origin-policy";

function requestFor(options: {
  method?: string;
  protocol?: string;
  host?: string;
  origin?: string;
  secFetchSite?: string;
} = {}) {
  const headers = new Map<string, string>();
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.secFetchSite !== undefined) headers.set("sec-fetch-site", options.secFetchSite);
  return {
    method: options.method ?? "POST",
    protocol: options.protocol ?? "https",
    header(name: string) {
      return headers.get(name.toLowerCase());
    },
    get(name: string) {
      return name.toLowerCase() === "host" ? options.host ?? "app.example" : undefined;
    }
  } as unknown as Pick<Request, "method" | "protocol" | "header" | "get">;
}

describe("admin request origin policy", () => {
  it("accepts canonical same-origin requests, including normalized default ports", () => {
    expect(adminRequestOriginIsAllowed(requestFor({ origin: "https://app.example" }))).toBe(true);
    expect(adminRequestOriginIsAllowed(requestFor({ origin: "https://app.example", host: "app.example:443" }))).toBe(true);
  });

  it("accepts exact configured native and local development origins", () => {
    expect(adminRequestOriginIsAllowed(requestFor({ origin: "capacitor://localhost" }))).toBe(true);
    expect(adminRequestOriginIsAllowed(requestFor({ origin: "https://localhost" }))).toBe(true);
    expect(adminRequestOriginIsAllowed(requestFor({ origin: "http://localhost:5173" }))).toBe(true);
  });

  it.each([
    "https://attacker.example",
    "null",
    "https://app.example/",
    "https://app.example.evil"
  ])("rejects untrusted or non-canonical Origin %s", (origin) => {
    expect(adminRequestOriginIsAllowed(requestFor({ origin }))).toBe(false);
  });

  it("rejects cross-site unsafe requests with missing Origin and preserves non-browser callers without fetch metadata", () => {
    expect(adminRequestOriginIsAllowed(requestFor({ secFetchSite: "cross-site" }))).toBe(false);
    expect(adminRequestOriginIsAllowed(requestFor())).toBe(true);
  });

  it("allows safe methods regardless of their Origin", () => {
    expect(adminRequestOriginIsAllowed(requestFor({ method: "GET", origin: "https://attacker.example" }))).toBe(true);
  });
});
