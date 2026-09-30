export const TEST_POSTGRES_CONTAINER = "pc-supporter-test-pg";
export const TEST_POSTGRES_PORT = 55439;

// Parallel vitest workers share the embedded cluster but must not share one
// database: every file truncates all tables before each test, so files running
// in different workers would erase each other's fixtures mid-test.
const workerId = process.env.VITEST_WORKER_ID?.trim() || "1";
export const TEST_DATABASE = `pcsupporter_test_w${workerId}`;
export const TEST_DATABASE_URL = `postgresql://postgres:pc-supporter-test-password@127.0.0.1:${TEST_POSTGRES_PORT}/${TEST_DATABASE}`;
export const TEST_ADMIN_DATABASE_URL = `postgresql://postgres:pc-supporter-test-password@127.0.0.1:${TEST_POSTGRES_PORT}/postgres`;
