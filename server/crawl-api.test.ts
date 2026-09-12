import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";

const { cancelCrawlPageRetryBatchMock, crawlPageRetryBatchPlanForMock, crawlPageRetryPlanForMock, crawlResumePlanForMock, isCrawlPageRetryBatchRunningMock, isCrawlRunningMock, readCrawlStatusMock, runCrawlJobMock, runCrawlPageRetryBatchJobMock, runCrawlPageRetryJobMock } = vi.hoisted(() => ({
  cancelCrawlPageRetryBatchMock: vi.fn(),
  crawlPageRetryBatchPlanForMock: vi.fn(),
  crawlPageRetryPlanForMock: vi.fn(),
  crawlResumePlanForMock: vi.fn(),
  isCrawlPageRetryBatchRunningMock: vi.fn(),
  isCrawlRunningMock: vi.fn(),
  readCrawlStatusMock: vi.fn(),
  runCrawlJobMock: vi.fn(),
  runCrawlPageRetryBatchJobMock: vi.fn(),
  runCrawlPageRetryJobMock: vi.fn()
}));

vi.mock("./crawler", () => ({
  cancelCrawlPageRetryBatch: cancelCrawlPageRetryBatchMock,
  crawlPageRetryBatchPlanFor: crawlPageRetryBatchPlanForMock,
  crawlPageRetryPlanFor: crawlPageRetryPlanForMock,
  crawlResumePlanFor: crawlResumePlanForMock,
  isCrawlPageRetryBatchRunning: isCrawlPageRetryBatchRunningMock,
  isCrawlRunning: isCrawlRunningMock,
  readCrawlStatus: readCrawlStatusMock,
  runCrawlJob: runCrawlJobMock,
  runCrawlPageRetryBatchJob: runCrawlPageRetryBatchJobMock,
  runCrawlPageRetryJob: runCrawlPageRetryJobMock
}));

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("core catalog crawl API", () => {
  it("forwards a selected category, keeps all-crawl behavior, and rejects unknown categories", async () => {
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    isCrawlRunningMock.mockReset().mockReturnValue(false);
    readCrawlStatusMock.mockReset().mockResolvedValue({ status: "idle" });
    runCrawlJobMock.mockReset().mockResolvedValue({ status: "running" });
    let server: Server | undefined;

    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("crawl API test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const categoryResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "gpu", pages: 2, limitPerCategory: 7, details: false, all: true })
      });
      expect(categoryResponse.status).toBe(202);
      expect(await categoryResponse.json()).toMatchObject({ category: "gpu", mode: "all" });
      expect(runCrawlJobMock).toHaveBeenLastCalledWith({ category: "gpu", pages: 2, limitPerCategory: 7, details: false, all: true });

      const allResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "all", pages: 1, limitPerCategory: 16, details: true, all: true })
      });
      expect(allResponse.status).toBe(202);
      expect(await allResponse.json()).toMatchObject({ message: "카탈로그 갱신을 시작했습니다.", mode: "all" });
      expect(runCrawlJobMock).toHaveBeenLastCalledWith({ pages: 1, limitPerCategory: 16, details: true, all: true });

      const invalidResumeModeResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: true })
      });
      expect(invalidResumeModeResponse.status).toBe(400);
      expect(await invalidResumeModeResponse.json()).toMatchObject({ error: "재개는 전체 수집 모드에서만 사용할 수 있습니다." });

      crawlResumePlanForMock.mockReturnValue({
        available: true,
        completedReports: [],
        completedCategories: ["cpu"],
        remainingCategories: ["gpu"],
        remainingConfigs: [{ category: "gpu", categoryId: "112753" }]
      });
      const resumePreviewResponse = await fetch(`${baseUrl}/api/admin/crawl/resume-preview?category=gpu`);
      expect(resumePreviewResponse.status).toBe(200);
      expect(await resumePreviewResponse.json()).toMatchObject({ kind: "crawl-resume-preview", schemaVersion: 1, readOnly: true, available: true, category: "gpu", completedCategories: ["cpu"], remainingCategories: ["gpu"] });
      const resumeResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "gpu", pages: 1, limitPerCategory: 0, details: true, all: true, resume: true })
      });
      expect(resumeResponse.status).toBe(202);
      expect(await resumeResponse.json()).toMatchObject({ category: "gpu", mode: "all", resumed: true });
      expect(runCrawlJobMock).toHaveBeenLastCalledWith({ category: "gpu", pages: 1, limitPerCategory: 0, details: true, all: true, resume: true });

      crawlResumePlanForMock.mockReturnValue({
        available: false,
        reason: "재개할 미완료 범주가 없습니다.",
        completedReports: [],
        completedCategories: [],
        remainingCategories: [],
        remainingConfigs: []
      });
      const unavailableResumeResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "gpu", all: true, resume: true })
      });
      expect(unavailableResumeResponse.status).toBe(409);
      expect(await unavailableResumeResponse.json()).toMatchObject({ code: "CRAWL_RESUME_UNAVAILABLE", error: "재개할 미완료 범주가 없습니다." });

      crawlPageRetryPlanForMock.mockReturnValue({ available: true, report: { category: "cpu", pagesExpected: 4 }, failure: { category: "cpu", page: 2, stage: "list" } });
      runCrawlPageRetryJobMock.mockReset().mockResolvedValue({ status: "completed" });
      const retryPageResponse = await fetch(`${baseUrl}/api/admin/crawl/retry-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "cpu", page: 2, details: true })
      });
      expect(retryPageResponse.status).toBe(202);
      expect(await retryPageResponse.json()).toMatchObject({ mode: "page-retry", category: "cpu", page: 2 });
      expect(runCrawlPageRetryJobMock).toHaveBeenLastCalledWith({ category: "cpu", page: 2, details: true, delayMs: 850, timeoutMs: 20000, retries: 2 });

      crawlPageRetryPlanForMock.mockReturnValue({ available: false, reason: "재시도할 실패 페이지를 찾을 수 없습니다." });
      const unavailableRetryPageResponse = await fetch(`${baseUrl}/api/admin/crawl/retry-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "cpu", page: 2 })
      });
      expect(unavailableRetryPageResponse.status).toBe(409);
      expect(await unavailableRetryPageResponse.json()).toMatchObject({ code: "CRAWL_PAGE_RETRY_UNAVAILABLE" });

      crawlPageRetryBatchPlanForMock.mockReturnValue({
        available: true,
        failures: [
          { category: "cpu", page: 2, stage: "list" },
          { category: "gpu", page: 5, stage: "list" }
        ]
      });
      runCrawlPageRetryBatchJobMock.mockReset().mockResolvedValue({ status: "running" });
      const retryBatchResponse = await fetch(`${baseUrl}/api/admin/crawl/retry-failed-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ details: false })
      });
      expect(retryBatchResponse.status).toBe(202);
      expect(await retryBatchResponse.json()).toMatchObject({ mode: "page-retry-batch", total: 2 });
      expect(runCrawlPageRetryBatchJobMock).toHaveBeenLastCalledWith({ details: false, delayMs: 850, timeoutMs: 20000, retries: 2 });

      isCrawlPageRetryBatchRunningMock.mockReset().mockReturnValue(true);
      cancelCrawlPageRetryBatchMock.mockReset().mockReturnValue(true);
      const cancelRetryBatchResponse = await fetch(`${baseUrl}/api/admin/crawl/retry-failed-pages/cancel`, { method: "POST" });
      expect(cancelRetryBatchResponse.status).toBe(202);
      expect(await cancelRetryBatchResponse.json()).toMatchObject({ mode: "page-retry-batch", status: "cancelling" });
      expect(cancelCrawlPageRetryBatchMock).toHaveBeenCalledTimes(1);

      isCrawlPageRetryBatchRunningMock.mockReturnValue(false);
      const unavailableCancelRetryBatchResponse = await fetch(`${baseUrl}/api/admin/crawl/retry-failed-pages/cancel`, { method: "POST" });
      expect(unavailableCancelRetryBatchResponse.status).toBe(409);
      expect(await unavailableCancelRetryBatchResponse.json()).toMatchObject({ code: "CRAWL_PAGE_RETRY_BATCH_NOT_RUNNING" });

      isCrawlRunningMock.mockReturnValue(true);
      const otherCrawlCancelResponse = await fetch(`${baseUrl}/api/admin/crawl/retry-failed-pages/cancel`, { method: "POST" });
      expect(otherCrawlCancelResponse.status).toBe(409);
      expect(await otherCrawlCancelResponse.json()).toMatchObject({ code: "CRAWL_PAGE_RETRY_RUNNING" });
      isCrawlRunningMock.mockReturnValue(false);

      crawlPageRetryBatchPlanForMock.mockReturnValue({ available: false, reason: "재시도할 목록 실패 페이지가 없습니다.", failures: [] });
      const unavailableRetryBatchResponse = await fetch(`${baseUrl}/api/admin/crawl/retry-failed-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(unavailableRetryBatchResponse.status).toBe(409);
      expect(await unavailableRetryBatchResponse.json()).toMatchObject({ code: "CRAWL_PAGE_RETRY_UNAVAILABLE" });

      const invalidResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "monitor" })
      });
      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toMatchObject({ error: "유효하지 않은 핵심 부품 카테고리입니다." });

      const invalidPagesResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: 1001 })
      });
      expect(invalidPagesResponse.status).toBe(400);
      expect(await invalidPagesResponse.json()).toMatchObject({ code: "CRAWL_INPUT_INVALID" });

      const invalidLimitResponse = await fetch(`${baseUrl}/api/admin/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitPerCategory: -1 })
      });
      expect(invalidLimitResponse.status).toBe(400);
      expect(await invalidLimitResponse.json()).toMatchObject({ code: "CRAWL_INPUT_INVALID" });
      expect(runCrawlJobMock).toHaveBeenCalledTimes(3);
    } finally {
      if (server) await closeServer(server);
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
    }
  }, 15_000);
});
