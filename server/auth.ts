import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const COOKIE_NAME = "pc_supporter_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const DEFAULT_SESSION_SECRET = "pc-supporter-local-session-secret";
const configuredSessionSecret = process.env.ADMIN_SESSION_SECRET?.trim();
const sessionSecret = configuredSessionSecret || DEFAULT_SESSION_SECRET;

export type AdminSecurityStatus = {
  environment: "development" | "production";
  passwordConfigured: boolean;
  sessionSecretConfigured: boolean;
  productionReady: boolean;
};

export function adminAuthEnabled() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.ADMIN_PASSWORD?.trim());
}

export function adminSecurityStatus(): AdminSecurityStatus {
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const passwordConfigured = Boolean(process.env.ADMIN_PASSWORD?.trim());
  const sessionSecretConfigured = Boolean(configuredSessionSecret && configuredSessionSecret !== DEFAULT_SESSION_SECRET);
  return {
    environment,
    passwordConfigured,
    sessionSecretConfigured,
    productionReady: environment !== "production" || (passwordConfigured && sessionSecretConfigured)
  };
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret).update(payload).digest("hex");
}

function sessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(";")) {
    const [key, ...value] = entry.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function isAdminAuthenticated(request: Request) {
  const security = adminSecurityStatus();
  if (!adminAuthEnabled()) return true;
  if (security.environment === "production" && !security.productionReady) return false;
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(expiresAt);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function adminSession(request: Request) {
  const security = adminSecurityStatus();
  const authenticated = isAdminAuthenticated(request);
  return {
    enabled: adminAuthEnabled(),
    authenticated,
    ...((authenticated || security.environment === "production" && !security.productionReady) ? { security } : {})
  };
}

function adminCookieAttributes(request: Request, clear = false) {
  const origin = request.header("Origin") ?? "";
  const nativeAppOrigin = /^(?:capacitor|https?):\/\/localhost(?::\d+)?$/.test(origin);
  const sameSiteNone = process.env.ADMIN_COOKIE_SAMESITE?.trim().toLowerCase() === "none" || nativeAppOrigin;
  const sameSite = sameSiteNone ? "None" : "Lax";
  const secure = process.env.NODE_ENV === "production" || sameSiteNone;
  return `HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${clear ? 0 : SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function loginAdmin(request: Request, response: Response) {
  const security = adminSecurityStatus();
  if (security.environment === "production" && !security.productionReady) {
    response.status(503).json({ error: "운영 관리자 인증 설정이 필요합니다.", code: "ADMIN_AUTH_MISCONFIGURED", security });
    return;
  }
  if (!adminAuthEnabled()) {
    response.json({ enabled: false, authenticated: true, security });
    return;
  }
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const configured = process.env.ADMIN_PASSWORD ?? "";
  const suppliedBuffer = Buffer.from(password);
  const configuredBuffer = Buffer.from(configured);
  const matches = suppliedBuffer.length === configuredBuffer.length && timingSafeEqual(suppliedBuffer, configuredBuffer);
  if (!matches) {
    response.status(401).json({ error: "관리자 비밀번호가 올바르지 않습니다." });
    return;
  }
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(sessionToken())}; ${adminCookieAttributes(request)}`);
  response.json({ enabled: true, authenticated: true, security });
}

export function logoutAdmin(request: Request, response: Response) {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; ${adminCookieAttributes(request, true)}`);
  response.json({ enabled: adminAuthEnabled(), authenticated: false });
}

export const requireAdmin: RequestHandler = (request, response, next: NextFunction) => {
  const security = adminSecurityStatus();
  if (security.environment === "production" && !security.productionReady) {
    response.status(503).json({ error: "운영 관리자 인증 설정이 필요합니다.", code: "ADMIN_AUTH_MISCONFIGURED", security });
    return;
  }
  if (isAdminAuthenticated(request)) {
    next();
    return;
  }
  response.status(401).json({ error: "관리자 로그인이 필요합니다.", code: "ADMIN_AUTH_REQUIRED" });
};
