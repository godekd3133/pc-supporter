import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";

describe("API route error contract", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("returns a structured JSON 404 for an unknown API route", async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "요청한 API 경로를 찾을 수 없습니다.", code: "API_NOT_FOUND" });
  });

  it("treats the API root as an API route even when the SPA bundle exists", async () => {
    const response = await fetch(`${baseUrl}/api`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "요청한 API 경로를 찾을 수 없습니다.", code: "API_NOT_FOUND" });
  });

  it("returns a structured JSON 400 for an invalid encoded API path", async () => {
    const response = await fetch(`${baseUrl}/api/builds/%E0%A4%A`);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "API 요청 경로 형식이 올바르지 않습니다.", code: "API_INVALID_PATH" });
  });
});
