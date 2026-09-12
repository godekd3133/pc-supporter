import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";

describe("JSON body error contract", () => {
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

  it("returns a structured 400 for malformed JSON instead of Express HTML", async () => {
    const response = await fetch(`${baseUrl}/api/compatibility/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"cpu":'
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "요청 본문 JSON 형식이 올바르지 않습니다.", code: "INVALID_JSON" });
  });

  it("returns a structured 413 when the JSON body exceeds the parser limit", async () => {
    const response = await fetch(`${baseUrl}/api/compatibility/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(1_048_576) })
    });

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "요청 본문이 너무 큽니다.", code: "REQUEST_BODY_TOO_LARGE" });
  }, 15_000);
});
