import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";
import { ensureTestDatabase, truncatePostgresTables } from "./postgres";
import { TEST_DATABASE_URL } from "./postgres-url";

// PostgreSQL is the only persistence backend; every test file defaults to this
// worker's own database (started by vitest globalSetup) and an isolated data
// directory for crawl-style file artifacts. Individual tests may still
// override these values before calling vi.resetModules().
process.env.DATABASE_URL = TEST_DATABASE_URL;
await ensureTestDatabase();
if (!process.env.PC_SUPPORTER_DATA_DIR?.trim()) {
  process.env.PC_SUPPORTER_DATA_DIR = mkdtempSync(join(tmpdir(), "pc-supporter-test-data-"));
}
process.env.DANAWA_CRAWL_ON_START = "false";
process.env.DANAWA_CRAWL_SCHEDULER_ENABLED = "false";
process.env.PRICE_REFRESH_SCHEDULER_ENABLED = "false";
process.env.BUILD_MONITOR_SCHEDULER_ENABLED = "false";

// The test database is shared across files in this worker, so each test starts
// from empty PostgreSQL state. Files that mock "pg" or point DATABASE_URL at a
// synthetic pool own their state and make this call fail; that is intentional.
beforeEach(async () => {
  try {
    await truncatePostgresTables();
  } catch {
    // Mocked or deliberately unreachable PostgreSQL pools own their own state.
  }
});
