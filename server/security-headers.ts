import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RequestHandler } from "express";
import { apiBaseUrlCspOrigin, contentSecurityPolicyMetaFromHtml, createContentSecurityPolicy } from "../shared/content-security-policy";

export function contentSecurityPolicyHeaderFromBuiltHtml(html: string) {
  const builtPolicy = contentSecurityPolicyMetaFromHtml(html);
  if (!builtPolicy) throw new Error("dist/index.html is missing its build-time Content-Security-Policy meta tag.");
  if (/\bframe-ancestors\b/i.test(builtPolicy)) throw new Error("frame-ancestors must only be set in the HTTP Content-Security-Policy header.");
  return `${builtPolicy}; frame-ancestors 'none'`;
}

function contentSecurityPolicyHeader() {
  const builtIndexPath = resolve(process.cwd(), "dist/index.html");
  if (existsSync(builtIndexPath)) return contentSecurityPolicyHeaderFromBuiltHtml(readFileSync(builtIndexPath, "utf8"));

  const apiOrigin = apiBaseUrlCspOrigin(process.env.VITE_API_BASE_URL);
  return createContentSecurityPolicy({
    connectOrigins: apiOrigin ? [apiOrigin] : [],
    includeFrameAncestors: true
  });
}

const contentSecurityPolicy = contentSecurityPolicyHeader();

/** Apply response protections while allowing only the app's declared browser resource origins. */
export function securityHeaders(): RequestHandler {
  return (request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
    response.setHeader("Content-Security-Policy", contentSecurityPolicy);

    // Express trusts only the same-host loopback proxy, so request.secure reflects the TLS edge.
    if (request.secure) response.setHeader("Strict-Transport-Security", "max-age=15552000");

    next();
  };
}
