import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { afterAll, beforeAll } from "vitest";
import type { Request, Response } from "express";
import { app } from "./index";
import { securityHeaders } from "./security-headers";

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

    expect(headers).toEqual(new Map([
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "DENY"],
      ["x-permitted-cross-domain-policies", "none"],
      ["referrer-policy", "strict-origin-when-cross-origin"],
      ["permissions-policy", "camera=(), geolocation=(), microphone=()"]
    ]));
    expect(next).toHaveBeenCalledOnce();
  });

  it("adds HSTS only when Express reports a secure request", () => {
    const { headers, response } = responseHarness();

    securityHeaders()({ secure: true } as Request, response, vi.fn());

    expect(headers.get("strict-transport-security")).toBe("max-age=15552000");
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
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });
});
