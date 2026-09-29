import type { RequestHandler } from "express";

/** Apply response protections that do not constrain the app's remote asset or API origins. */
export function securityHeaders(): RequestHandler {
  return (request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");

    // Express trusts only the same-host loopback proxy, so request.secure reflects the TLS edge.
    if (request.secure) response.setHeader("Strict-Transport-Security", "max-age=15552000");

    next();
  };
}
