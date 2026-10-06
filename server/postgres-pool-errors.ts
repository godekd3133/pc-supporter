import type { Pool, PoolClient } from "pg";

type ConnectionErrorHandler = (error: Error) => void;

interface PoolErrorRegistration {
  notify: ConnectionErrorHandler;
  clients: WeakSet<PoolClient>;
}

// Repository modules can be reloaded while their Pool stays alive. Keep one set
// of listeners per Pool, but let the current repository own the readiness state.
const registrations = ((globalThis as {
  __pcSupporterPgPoolErrorHandlers?: WeakMap<Pool, PoolErrorRegistration>;
}).__pcSupporterPgPoolErrorHandlers ??= new WeakMap<Pool, PoolErrorRegistration>());

export function registerPostgresPoolErrorHandlers(pool: Pool, notify: ConnectionErrorHandler) {
  // Some repository tests use minimal Pool doubles without EventEmitter APIs.
  if (typeof pool.on !== "function") return;

  const existing = registrations.get(pool);
  if (existing) {
    existing.notify = notify;
    return;
  }

  const registration: PoolErrorRegistration = { notify, clients: new WeakSet() };
  registrations.set(pool, registration);

  pool.on("error", (error) => registration.notify(error));
  pool.on("connect", (client) => {
    if (registration.clients.has(client)) return;
    registration.clients.add(client);
    // pg-pool removes its own idle error listener when a client is acquired.
    // Retain ours through BEGIN, callback work, and COMMIT/ROLLBACK. pg marks a
    // failed client non-queryable; operation queries reject and finally releases
    // discard it. Releasing here would race the transaction's own cleanup.
    client.on("error", (error) => registration.notify(error));
  });
}
