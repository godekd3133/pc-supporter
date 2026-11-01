export const TEST_POSTGRES_CONTAINER = "pc-supporter-test-pg";
export const TEST_POSTGRES_PORT = 55439;

// Parallel vitest workers share the embedded cluster but must not share one
// database: every file truncates all tables before each test, so files running
// in different workers would erase each other's fixtures mid-test.
// The cluster port is shared by every checkout on this machine (including the
// self-hosted CI runner), so each test run also gets its own databases: two
// concurrent runs must not truncate each other's tables or share advisory locks.
const workerId = process.env.VITEST_WORKER_ID?.trim() || "1";
const runId = process.env.PC_SUPPORTER_TEST_RUN_ID?.trim().replace(/[^a-z0-9]/gi, "").toLowerCase() || "local";
export const TEST_DATABASE_PREFIX = `pcsupporter_test_${runId}_`;
export const TEST_DATABASE = `${TEST_DATABASE_PREFIX}w${workerId}`;
export const TEST_DATABASE_URL = `postgresql://postgres:pc-supporter-test-password@127.0.0.1:${TEST_POSTGRES_PORT}/${TEST_DATABASE}`;
export const TEST_ADMIN_DATABASE_URL = `postgresql://postgres:pc-supporter-test-password@127.0.0.1:${TEST_POSTGRES_PORT}/postgres`;
