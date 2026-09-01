import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const COOKIE_NAME = "pc_supporter_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const sessionSecret = process.env.ADMIN_SESSION_SECRET?.trim() || "pc-supporter-local-session-secret";

export function adminAuthEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
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
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function isAdminAuthenticated(request: Request) {
  if (!adminAuthEnabled()) return true;
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(expiresAt);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function adminSession(request: Request) {
  return {
    enabled: adminAuthEnabled(),
    authenticated: isAdminAuthenticated(request)
  };
}

export function loginAdmin(request: Request, response: Response) {
  if (!adminAuthEnabled()) {
    response.json({ enabled: false, authenticated: true });
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
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(sessionToken())}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
  response.json({ enabled: true, authenticated: true });
}

export function logoutAdmin(_request: Request, response: Response) {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  response.json({ enabled: adminAuthEnabled(), authenticated: false });
}

export const requireAdmin: RequestHandler = (request, response, next: NextFunction) => {
  if (isAdminAuthenticated(request)) {
    next();
    return;
  }
  response.status(401).json({ error: "관리자 로그인이 필요합니다.", code: "ADMIN_AUTH_REQUIRED" });
};
