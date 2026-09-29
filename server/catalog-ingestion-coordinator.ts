import { AsyncLocalStorage } from "node:async_hooks";
import { withBackgroundJobLease } from "./repository";

export const CATALOG_INGESTION_LEASE_SCOPE = "catalog-ingestion";
export const CATALOG_INGESTION_BUSY_MESSAGE = "카탈로그 데이터 수집 작업이 이미 실행 중입니다. 다른 API 인스턴스에서 실행 중일 수 있습니다.";

const catalogIngestionLeaseContext = new AsyncLocalStorage<boolean>();

export class CatalogIngestionBusyError extends Error {
  constructor(message = CATALOG_INGESTION_BUSY_MESSAGE) {
    super(message);
    this.name = "CatalogIngestionBusyError";
  }
}

export type CatalogIngestionStartResult<T> =
  | { started: false }
  | { started: true; completion: Promise<T> };

/**
 * Run a catalog writer under the shared lease. API start handlers can acquire
 * the lease before returning 202; the run function they invoke re-enters this
 * helper through AsyncLocalStorage instead of acquiring a second advisory lock.
 */
export async function withCatalogIngestionLease<T>(operation: () => Promise<T>): Promise<T> {
  if (catalogIngestionLeaseContext.getStore()) return operation();

  const lease = await withBackgroundJobLease(CATALOG_INGESTION_LEASE_SCOPE, () => catalogIngestionLeaseContext.run(true, operation));
  if (!lease.acquired) throw new CatalogIngestionBusyError();
  return lease.value;
}

/**
 * Start a long-running API job without waiting for it to finish. The callback
 * runs inside the same context used by withCatalogIngestionLease, so public run
 * functions remain safe when called directly by a CLI or another service.
 */
export async function startCatalogIngestionJob<T>(operation: () => Promise<T>): Promise<CatalogIngestionStartResult<T>> {
  let signalStarted!: () => void;
  const startedSignal = new Promise<void>((resolve) => { signalStarted = resolve; });
  const leasedCompletion = withBackgroundJobLease(CATALOG_INGESTION_LEASE_SCOPE, () => {
    signalStarted();
    return catalogIngestionLeaseContext.run(true, operation);
  });
  const started = await Promise.race([
    startedSignal.then(() => true),
    leasedCompletion.then((result) => result.acquired)
  ]);
  if (!started) return { started: false };

  const completion = leasedCompletion.then((result) => {
    if (!result.acquired) throw new CatalogIngestionBusyError();
    return result.value;
  });
  return { started: true, completion };
}
