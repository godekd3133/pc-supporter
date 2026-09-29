import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { afterAll, beforeAll } from "vitest";
import type { Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { app } from "./index";
import { contentSecurityPolicyHeaderFromBuiltHtml, securityHeaders } from "./security-headers";
import { apiBaseUrlCspOrigin, contentSecurityPolicyMetaFromHtml, createContentSecurityPolicy, THEME_SCRIPT_CSP_HASH } from "../shared/content-security-policy";

function responseHarness() {
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return response;
    }
  } as unknown as Response;
  return { headers, response };
}

describe("securityHeaders", () => {
  it("sets browser protections without adding transport policy to local HTTP", () => {
    const { headers, response } = responseHarness();
    const next = vi.fn();

    securityHeaders()({ secure: false } as Request, response, next);

    const csp = headers.get("content-security-policy");
    headers.delete("content-security-policy");
    expect(headers).toEqual(new Map([
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "DENY"],
      ["x-permitted-cross-domain-policies", "none"],
      ["referrer-policy", "strict-origin-when-cross-origin"],
      ["permissions-policy", "camera=(), geolocation=(), microphone=()"]
    ]));
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(next).toHaveBeenCalledOnce();
  });

  it("adds HSTS only when Express reports a secure request", () => {
    const { headers, response } = responseHarness();

    securityHeaders()({ secure: true } as Request, response, vi.fn());

    expect(headers.get("strict-transport-security")).toBe("max-age=15552000");
  });

  it("allows only the reviewed inline theme initializer in scripts", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const actualHash = `sha256-${createHash("sha256").update(script!).digest("base64")}`;
    expect(actualHash).toBe(THEME_SCRIPT_CSP_HASH);

    const { headers, response } = responseHarness();
    securityHeaders()({ secure: false } as Request, response, vi.fn());
    expect(headers.get("content-security-policy")).toContain(`script-src 'self' '${actualHash}'`);
    expect(headers.get("content-security-policy")).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("uses the built document CSP as the HTTP policy source when a Vite build is present", () => {
    const builtIndexPath = resolve(process.cwd(), "dist/index.html");
    const builtHtml = existsSync(builtIndexPath) ? readFileSync(builtIndexPath, "utf8") : undefined;
    const builtPolicy = builtHtml ? contentSecurityPolicyMetaFromHtml(builtHtml) : undefined;
    const fallbackApiOrigin = apiBaseUrlCspOrigin(process.env.VITE_API_BASE_URL);
    const expectedHeader = builtPolicy
      ? `${builtPolicy}; frame-ancestors 'none'`
      : createContentSecurityPolicy({ connectOrigins: fallbackApiOrigin ? [fallbackApiOrigin] : [], includeFrameAncestors: true });

    const { headers, response } = responseHarness();
    securityHeaders()({ secure: false } as Request, response, vi.fn());

    expect(headers.get("content-security-policy")).toBe(expectedHeader);
  });

  it("keeps Express and the HTML meta on the same API-origin policy", () => {
    const documentPolicy = createContentSecurityPolicy({ connectOrigins: ["https://api.example.com"] });
    const html = `<meta http-equiv="Content-Security-Policy" content="${documentPolicy}">`;

    expect(contentSecurityPolicyHeaderFromBuiltHtml(html)).toBe(`${documentPolicy}; frame-ancestors 'none'`);
  });
});

describe("registered app security headers", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    server = await new Promise<Server>((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("applies browser protections to API error responses", async () => {
    const response = await fetch(`${baseUrl}/api/__security_headers_test__`);

    expect(response.status).toBe(404);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });
});
