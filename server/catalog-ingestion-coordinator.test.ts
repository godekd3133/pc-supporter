import { describe, expect, it, vi } from "vitest";

const { withBackgroundJobLeaseMock } = vi.hoisted(() => ({
  withBackgroundJobLeaseMock: vi.fn()
}));

vi.mock("./repository", () => ({
  withBackgroundJobLease: withBackgroundJobLeaseMock
}));

describe("catalog ingestion coordinator", () => {
  it("uses one shared lease for nested public writers in the same operation", async () => {
    withBackgroundJobLeaseMock.mockReset().mockImplementation(async (_scope: string, operation: () => Promise<string>) => ({
      backend: "postgres",
      acquired: true,
      value: await operation()
    }));
    vi.resetModules();
    const { CATALOG_INGESTION_LEASE_SCOPE, withCatalogIngestionLease } = await import("./catalog-ingestion-coordinator");

    const result = await withCatalogIngestionLease(() => withCatalogIngestionLease(async () => "done"));

    expect(result).toBe("done");
    expect(withBackgroundJobLeaseMock).toHaveBeenCalledTimes(1);
    expect(withBackgroundJobLeaseMock).toHaveBeenCalledWith(CATALOG_INGESTION_LEASE_SCOPE, expect.any(Function));
  });

  it("returns promptly after a start acquires the lease and keeps it until completion", async () => {
    let finish!: (value: string) => void;
    const operationCompletion = new Promise<string>((resolve) => { finish = resolve; });
    withBackgroundJobLeaseMock.mockReset().mockImplementation(async (_scope: string, operation: () => Promise<string>) => ({
      backend: "file",
      acquired: true,
      value: await operation()
    }));
    vi.resetModules();
    const { startCatalogIngestionJob, withCatalogIngestionLease } = await import("./catalog-ingestion-coordinator");

    const started = await startCatalogIngestionJob(() => withCatalogIngestionLease(() => operationCompletion));

    expect(started.started).toBe(true);
    expect(withBackgroundJobLeaseMock).toHaveBeenCalledTimes(1);
    if (!started.started) throw new Error("expected the coordinator to start the job");
    finish("finished");
    await expect(started.completion).resolves.toBe("finished");
  });

  it("reports a busy lease and propagates storage errors without fallback", async () => {
    withBackgroundJobLeaseMock.mockReset().mockResolvedValue({ backend: "postgres", acquired: false });
    vi.resetModules();
    const { startCatalogIngestionJob, withCatalogIngestionLease } = await import("./catalog-ingestion-coordinator");

    await expect(withCatalogIngestionLease(async () => "unreachable")).rejects.toMatchObject({ name: "CatalogIngestionBusyError" });
    await expect(startCatalogIngestionJob(async () => "unreachable")).resolves.toEqual({ started: false });
    expect(withBackgroundJobLeaseMock).toHaveBeenCalledTimes(2);

    const storageError = new Error("postgres unavailable");
    withBackgroundJobLeaseMock.mockReset().mockRejectedValue(storageError);
    vi.resetModules();
    const retryingCoordinator = await import("./catalog-ingestion-coordinator");
    await expect(retryingCoordinator.withCatalogIngestionLease(async () => "unreachable")).rejects.toBe(storageError);
    expect(withBackgroundJobLeaseMock).toHaveBeenCalledTimes(1);
  });
});
