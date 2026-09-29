import type { NextFunction, Request, Response } from "express";

const defaultAllowedOrigins = new Set([
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);
const configuredAllowedOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean));

export function corsOriginIsAllowed(origin: string) {
  return defaultAllowedOrigins.has(origin) || configuredAllowedOrigins.has(origin);
}

/**
 * Browsers attach Origin to unsafe requests. Validate it independently of CORS,
 * because omitting Access-Control-Allow-Origin does not prevent the server from
 * processing a cross-site form request.
 */
export function adminRequestOriginIsAllowed(request: Pick<Request, "method" | "protocol" | "header" | "get">) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = request.header("Origin");
  if (!origin) return request.header("Sec-Fetch-Site")?.toLowerCase() !== "cross-site";
  // Capacitor uses an opaque origin according to the URL standard. Exact
  // allowlist matching is required before URL.origin normalization.
  if (corsOriginIsAllowed(origin)) return true;

  let parsedOrigin: string;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    parsedOrigin = parsed.origin;
  } catch {
    return false;
  }

  try {
    const requestOrigin = new URL(`${request.protocol}://${request.get("host")}`).origin;
    return parsedOrigin === requestOrigin;
  } catch {
    return false;
  }
}

export function requireAdminRequestOrigin(request: Request, response: Response, next: NextFunction) {
  if (adminRequestOriginIsAllowed(request)) {
    next();
    return;
  }
  response.status(403).json({ error: "관리자 요청의 출처를 확인할 수 없습니다.", code: "ADMIN_CSRF_ORIGIN_INVALID" });
}
