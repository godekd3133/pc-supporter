import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  OWNER_SESSION_COOKIE_MAX_AGE_SECONDS,
  OWNER_SESSION_COOKIE_NAME,
  clearOwnerSessionCookie,
  createOwnerSessionToken,
  ownerSessionCookieModeFor,
  ownerSessionCookieTokenForRequest,
  ownerSessionHashFromRequest,
  setOwnerSessionCookie
} from "./owner-session-cookie";

function requestFor(options: {
  protocol?: string;
  secure?: boolean;
  host?: string;
  origin?: string;
  cookie?: string;
}) {
  const headers: Record<string, string | undefined> = {
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.cookie ? { cookie: options.cookie } : {})
  };
  return {
    protocol: options.protocol ?? "https",
    secure: options.secure ?? true,
    headers,
    header(name: string) { return headers[name.toLowerCase()]; },
    get(name: string) { return name.toLowerCase() === "host" ? options.host ?? "api.example.com" : undefined; }
  } as unknown as Pick<Request, "protocol" | "secure" | "header" | "get" | "headers">;
}

describe("owner session cookie", () => {
  it("hashes only a valid base64url session token from the HttpOnly cookie", () => {
    const token = "A".repeat(43);
    const request = requestFor({ cookie: `other=value; ${OWNER_SESSION_COOKIE_NAME}=${token}` });

    expect(ownerSessionCookieTokenForRequest(request)).toBe(token);
    expect(ownerSessionHashFromRequest(request)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(ownerSessionCookieTokenForRequest(requestFor({ cookie: `${OWNER_SESSION_COOKIE_NAME}=short` }))).toBeUndefined();
    expect(ownerSessionCookieTokenForRequest(requestFor({ cookie: `${OWNER_SESSION_COOKIE_NAME}=${token}; ${OWNER_SESSION_COOKIE_NAME}=${token}` }))).toBeUndefined();
  });

  it("sets a host-scoped HttpOnly Secure cookie for an allowlisted native origin", () => {
    const request = requestFor({ origin: "capacitor://localhost" });
    const response = { append: vi.fn() } as unknown as Response;
    const { token } = createOwnerSessionToken();

    expect(ownerSessionCookieModeFor(request)).toEqual({ supported: true, sameSite: "None", secure: true });
    expect(setOwnerSessionCookie(response, request, token)).toBe(true);
    expect(response.append).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining(`${OWNER_SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/api; SameSite=None; Max-Age=${OWNER_SESSION_COOKIE_MAX_AGE_SECONDS}; Secure`));
  });

  it("allows insecure cookies only for local HTTP development", () => {
    const request = requestFor({ protocol: "http", secure: false, host: "localhost:4174", origin: "http://localhost:5173" });

    expect(ownerSessionCookieModeFor(request)).toEqual({ supported: true, sameSite: "Lax", secure: false });
    expect(ownerSessionCookieModeFor(requestFor({ protocol: "http", secure: false, host: "api.example.com", origin: "http://api.example.com" })).supported).toBe(false);
  });

  it("rejects an untrusted origin and does not clear a session cookie for it", () => {
    const request = requestFor({ origin: "https://attacker.example" });
    const response = { append: vi.fn() } as unknown as Response;

    expect(ownerSessionCookieModeFor(request).supported).toBe(false);
    expect(setOwnerSessionCookie(response, request, "A".repeat(43))).toBe(false);
    expect(clearOwnerSessionCookie(response, request)).toBe(false);
    expect(response.append).not.toHaveBeenCalled();
  });

  it("fails closed when the browser omits Origin", () => {
    expect(ownerSessionCookieModeFor(requestFor({ origin: undefined })).supported).toBe(false);
  });
});
