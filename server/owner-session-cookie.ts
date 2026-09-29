import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { corsOriginIsAllowed } from "./origin-policy";

export const OWNER_SESSION_COOKIE_NAME = "pc_supporter_owner_session";
export const OWNER_SESSION_COOKIE_PATH = "/api";
export const OWNER_SESSION_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

type CookieRequest = Pick<Request, "protocol" | "secure" | "header" | "get" | "headers">;

function cookieTokenFromRequest(request: Pick<Request, "headers">) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  const matches = cookieHeader.split(";").map((entry) => entry.trim()).filter((entry) => entry.slice(0, entry.indexOf("=")) === OWNER_SESSION_COOKIE_NAME);
  if (matches.length !== 1) return undefined;
  const separator = matches[0]!.indexOf("=");
  const candidate = matches[0]!.slice(separator + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : undefined;
}

export function ownerSessionHashFromRequest(request: Pick<Request, "headers">) {
  const token = cookieTokenFromRequest(request);
  return token ? createHash("sha256").update(token).digest("hex") : undefined;
}

export function createOwnerSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

function requestOrigin(request: Pick<CookieRequest, "protocol" | "get">) {
  try {
    const host = request.get("host");
    if (!host) return undefined;
    return new URL(`${request.protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}

function localViteDevOrigin(origin: string | undefined) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.port === "5173";
  } catch {
    return false;
  }
}

function localHttpOrigin(origin: string | undefined) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function ownerSessionCookieModeFor(request: CookieRequest) {
  const origin = request.header("Origin");
  if (!origin) return { supported: false as const, sameSite: "Lax" as const, secure: request.secure };

  const sameOrigin = origin === requestOrigin(request);
  if (!sameOrigin && !corsOriginIsAllowed(origin)) {
    return { supported: false as const, sameSite: "Lax" as const, secure: request.secure };
  }
  const localDevOrigin = localViteDevOrigin(origin);
  const sameSite = sameOrigin || localDevOrigin ? "Lax" as const : "None" as const;
  const secure = request.secure || sameSite === "None";
  if (!request.secure && !localHttpOrigin(origin)) return { supported: false as const, sameSite, secure };
  return { supported: true as const, sameSite, secure };
}

export function ownerSessionCookieTokenForRequest(request: CookieRequest) {
  return cookieTokenFromRequest(request);
}

export function setOwnerSessionCookie(response: Response, request: CookieRequest, token: string) {
  const policy = ownerSessionCookieModeFor(request);
  if (!policy.supported) return false;
  const attributes = [
    "HttpOnly",
    `Path=${OWNER_SESSION_COOKIE_PATH}`,
    `SameSite=${policy.sameSite}`,
    `Max-Age=${OWNER_SESSION_COOKIE_MAX_AGE_SECONDS}`,
    ...(policy.secure ? ["Secure"] : [])
  ];
  response.append("Set-Cookie", `${OWNER_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attributes.join("; ")}`);
  return true;
}

export function clearOwnerSessionCookie(response: Response, request: CookieRequest) {
  const policy = ownerSessionCookieModeFor(request);
  if (!policy.supported) return false;
  const attributes = [
    "HttpOnly",
    `Path=${OWNER_SESSION_COOKIE_PATH}`,
    `SameSite=${policy.sameSite}`,
    "Max-Age=0",
    ...(policy.secure ? ["Secure"] : [])
  ];
  response.append("Set-Cookie", `${OWNER_SESSION_COOKIE_NAME}=; ${attributes.join("; ")}`);
  return true;
}
