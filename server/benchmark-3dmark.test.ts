import { describe, expect, it } from "vitest";
import { Benchmark3DMarkImportError, benchmark3DMarkIdentityFor, import3DMarkResult, parse3DMarkResultHtml } from "./benchmark-3dmark";

const TIME_SPY_HTML = `
  <html>
    <head><title>NVIDIA GeForce RTX 5070 video card benchmark result - AMD Ryzen 7 9800X3D</title></head>
    <body>
      <h1>Score 18 385 with NVIDIA GeForce RTX 5070</h1>
      <div>Graphics Score 22 779</div>
      <script>Graphics Score 999999 should not be read</script>
    </body>
  </html>
`;

const PORT_ROYAL_HTML = `
  <html>
    <head><title>AMD Radeon RX 7900 XTX video card benchmark result</title></head>
    <body><div>Graphics Score 9&nbsp;876</div></body>
  </html>
`;

describe("3DMark result preview", () => {
  it("parses a Time Spy result without treating script text as page data", () => {
    const preview = parse3DMarkResultHtml(TIME_SPY_HTML, "https://www.3dmark.com/spy/62191556#details", "2026-09-05T00:00:00.000Z");

    expect(preview).toMatchObject({
      sourceUrl: "https://www.3dmark.com/spy/62191556",
      resultId: "62191556",
      benchmark: "time_spy",
      benchmarkLabel: "3DMark Time Spy",
      scoreKey: "gpu3dmarkTimeSpyScore",
      score: 22779,
      gpuName: "NVIDIA GeForce RTX 5070",
      identityStatus: "manual_required",
      fetchedAt: "2026-09-05T00:00:00.000Z"
    });
  });

  it("parses a Port Royal result and selects the Port Royal score field", () => {
    const preview = parse3DMarkResultHtml(PORT_ROYAL_HTML, "https://3dmark.com/prt/123456/", "2026-09-05T01:00:00.000Z");

    expect(preview).toMatchObject({
      sourceUrl: "https://3dmark.com/prt/123456",
      resultId: "123456",
      benchmark: "port_royal",
      benchmarkLabel: "3DMark Port Royal",
      scoreKey: "gpu3dmarkPortRoyalScore",
      score: 9876,
      gpuName: "AMD Radeon RX 7900 XTX"
    });
  });

  it.each([
    ["http://www.3dmark.com/spy/123", "기본 HTTPS"],
    ["https://example.com/spy/123", "공식 결과 주소"],
    ["https://www.3dmark.com/result/123", "Time Spy는"],
    ["https://www.3dmark.com/spy/not-a-number", "Time Spy는"]
  ])("rejects an unsupported result URL: %s", (url, message) => {
    expect(() => parse3DMarkResultHtml(TIME_SPY_HTML, url)).toThrowError(new RegExp(message));
  });

  it("rejects a page that does not contain a positive Graphics Score", () => {
    expect(() => parse3DMarkResultHtml("<title>GPU result</title><p>Overall Score 12 345</p>", "https://www.3dmark.com/spy/123")).toThrowError(Benchmark3DMarkImportError);
    expect(() => parse3DMarkResultHtml("<p>Graphics Score 0</p>", "https://www.3dmark.com/spy/123")).toThrowError(/형식을 해석/);
  });

  it("matches GPU identity conservatively and keeps uncertain names for manual review", () => {
    expect(benchmark3DMarkIdentityFor("ASUS GeForce RTX 5070 OC", undefined, "NVIDIA GeForce RTX 5070")).toEqual({
      identityStatus: "matched",
      identityDetail: expect.stringContaining("RTX5070")
    });
    expect(benchmark3DMarkIdentityFor("ASUS GeForce RTX 5070 OC", undefined, "NVIDIA GeForce RTX 5080")).toMatchObject({ identityStatus: "not_found" });
    expect(benchmark3DMarkIdentityFor("그래픽카드", undefined, "NVIDIA GeForce RTX 5070")).toMatchObject({ identityStatus: "manual_required" });
    expect(benchmark3DMarkIdentityFor("ASUS GeForce RTX 5070 OC", undefined, undefined)).toMatchObject({ identityStatus: "manual_required" });
  });

  it("fetches only the validated result URL and returns an identity-aware preview", async () => {
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;
    const preview = await import3DMarkResult(
      "https://www.3dmark.com/spy/62191556#details",
      "ASUS GeForce RTX 5070 OC",
      undefined,
      {
        now: () => "2026-09-05T02:00:00.000Z",
        fetcher: async (input, init) => {
          requestedUrl = input;
          requestInit = init;
          return new Response(TIME_SPY_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
        }
      }
    );

    expect(requestedUrl).toBe("https://www.3dmark.com/spy/62191556");
    expect(requestInit).toMatchObject({ method: "GET", redirect: "error" });
    expect(preview).toMatchObject({ score: 22779, scoreKey: "gpu3dmarkTimeSpyScore", identityStatus: "matched", fetchedAt: "2026-09-05T02:00:00.000Z" });
  });

  it("rejects non-HTML and non-success responses before parsing", async () => {
    await expect(import3DMarkResult("https://www.3dmark.com/spy/123", "GPU", undefined, {
      fetcher: async () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })
    })).rejects.toThrow(/HTTP 404/);

    await expect(import3DMarkResult("https://www.3dmark.com/spy/123", "GPU", undefined, {
      fetcher: async () => new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } })
    })).rejects.toThrow(/HTML 문서가 아닙니다/);
  });

  it("keeps the timeout active while the response body is being read", async () => {
    await expect(import3DMarkResult("https://www.3dmark.com/spy/123", "GPU", undefined, {
      timeoutMs: 1_000,
      fetcher: async (_input, init) => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: () => new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        })
      } as Response)
    })).rejects.toThrow(/응답 시간이 초과되었습니다/);
  });
});
