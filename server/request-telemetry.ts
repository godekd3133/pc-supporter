import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export type HttpRequestLog = {
  event: "http.request";
  requestId: string;
  method: string;
  route: string;
  outcome: "completed" | "aborted";
  statusCode: number;
  durationMs: number;
};

export type HttpRequestLogSink = (record: HttpRequestLog) => void;

function defaultLogSink(record: HttpRequestLog) {
  console.log(JSON.stringify(record));
}

/** Adds a private request ID to the response and emits bounded, low-cardinality access records. */
export function requestTelemetry(log: HttpRequestLogSink = defaultLogSink): RequestHandler {
  return (request, response, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    response.setHeader("X-Request-Id", requestId);
    let recorded = false;

    const record = (outcome: HttpRequestLog["outcome"]) => {
      if (recorded) return;
      recorded = true;
      if ((!request.path.startsWith("/api/") && request.path !== "/api") || request.path === "/api/health" || request.method === "OPTIONS") return;

      const routePath = request.route?.path;
      const entry: HttpRequestLog = {
        event: "http.request",
        requestId,
        method: request.method,
        route: typeof routePath === "string" ? routePath : "unmatched",
        outcome,
        statusCode: response.statusCode,
        durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10)
      };
      try {
        log(entry);
      } catch {
        // Logging must never change the result of an application request.
      }
    };

    response.once("finish", () => record("completed"));
    response.once("close", () => record("aborted"));
    next();
  };
}
