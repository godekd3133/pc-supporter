import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requestTelemetry } from "./request-telemetry";

function responseDouble() {
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number;
    setHeader: ReturnType<typeof vi.fn>;
  };
  response.statusCode = 200;
  response.setHeader = vi.fn();
  return response;
}

function requestDouble(overrides: Partial<Request> = {}) {
  return {
    method: "GET",
    path: "/api/builds/private-build-id",
    route: { path: "/api/builds/:id" },
    ...overrides
  } as Request;
}

describe("requestTelemetry", () => {
  it("returns a generated request ID and logs the route template without request data", () => {
    const log = vi.fn();
    const response = responseDouble();
    const next = vi.fn();

    requestTelemetry(log)(requestDouble(), response as unknown as Response, next);
    const [, requestId] = response.setHeader.mock.calls[0];
    response.emit("finish");

    expect(requestId).toEqual(expect.any(String));
    expect(next).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    const record = log.mock.calls[0][0];
    expect(record).toMatchObject({
      event: "http.request",
      requestId,
      method: "GET",
      route: "/api/builds/:id",
      outcome: "completed",
      statusCode: 200
    });
    expect(JSON.stringify(record)).not.toContain("private-build-id");
  });

  it("records an aborted response once", () => {
    const log = vi.fn();
    const response = responseDouble();
    requestTelemetry(log)(requestDouble(), response as unknown as Response, vi.fn());

    response.emit("close");
    response.emit("finish");

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({ outcome: "aborted" });
  });

  it("does not log health probes or CORS preflight requests", () => {
    const log = vi.fn();
    const healthResponse = responseDouble();
    requestTelemetry(log)(requestDouble({ path: "/api/health", route: { path: "/api/health" } }), healthResponse as unknown as Response, vi.fn());
    healthResponse.emit("finish");

    const optionsResponse = responseDouble();
    requestTelemetry(log)(requestDouble({ method: "OPTIONS" }), optionsResponse as unknown as Response, vi.fn());
    optionsResponse.emit("finish");

    expect(log).not.toHaveBeenCalled();
  });

  it("does not log static app requests", () => {
    const log = vi.fn();
    const response = responseDouble();
    requestTelemetry(log)(requestDouble({ path: "/assets/app.js", route: undefined }), response as unknown as Response, vi.fn());

    response.emit("finish");

    expect(log).not.toHaveBeenCalled();
  });

  it("keeps a logging failure from changing request flow", () => {
    const response = responseDouble();
    const next = vi.fn();
    const log = vi.fn(() => {
      throw new Error("sink unavailable");
    });

    requestTelemetry(log)(requestDouble(), response as unknown as Response, next);
    expect(() => response.emit("finish")).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
  });
});
