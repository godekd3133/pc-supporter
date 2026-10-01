import { describe, expect, it } from "vitest";
import { httpMetricsSnapshot, recordHttpRequestMetric, resetHttpMetricsForTest } from "./request-metrics";

describe("http request metrics", () => {
  it("라우트별 요청 수·오류·지연 분포를 집계한다", () => {
    resetHttpMetricsForTest();
    recordHttpRequestMetric({ event: "http.request", requestId: "a", method: "GET", route: "/api/parts", outcome: "completed", statusCode: 200, durationMs: 10 });
    recordHttpRequestMetric({ event: "http.request", requestId: "b", method: "GET", route: "/api/parts", outcome: "completed", statusCode: 200, durationMs: 30 });
    recordHttpRequestMetric({ event: "http.request", requestId: "c", method: "GET", route: "/api/parts", outcome: "completed", statusCode: 500, durationMs: 90 });
    recordHttpRequestMetric({ event: "http.request", requestId: "d", method: "POST", route: "/api/builds/check", outcome: "completed", statusCode: 422, durationMs: 5 });
    // 중단(aborted) 요청은 완료 지표에 넣지 않는다.
    recordHttpRequestMetric({ event: "http.request", requestId: "e", method: "GET", route: "/api/parts", outcome: "aborted", statusCode: 499, durationMs: 1 });

    const snapshot = httpMetricsSnapshot();
    expect(snapshot.totalRequests).toBe(4);
    expect(snapshot.totalErrors).toBe(1);
    const parts = snapshot.routes.find((route) => route.route === "GET /api/parts");
    expect(parts).toMatchObject({ count: 3, errors: 1, clientErrors: 0, maxMs: 90 });
    const check = snapshot.routes.find((route) => route.route === "POST /api/builds/check");
    expect(check).toMatchObject({ count: 1, errors: 0, clientErrors: 1 });
  });
});
