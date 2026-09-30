import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_DATABASE_URL } from "./postgres-url";

// PostgreSQL is the only persistence backend; every test file defaults to the
// shared dockerized test database (started by vitest globalSetup) and an
// isolated data directory for crawl-style file artifacts. Individual tests may
// still override these values before calling vi.resetModules().
process.env.DATABASE_URL = TEST_DATABASE_URL;
if (!process.env.PC_SUPPORTER_DATA_DIR?.trim()) {
  process.env.PC_SUPPORTER_DATA_DIR = mkdtempSync(join(tmpdir(), "pc-supporter-test-data-"));
}
process.env.DANAWA_CRAWL_ON_START = "false";
process.env.DANAWA_CRAWL_SCHEDULER_ENABLED = "false";
process.env.PRICE_REFRESH_SCHEDULER_ENABLED = "false";
process.env.BUILD_MONITOR_SCHEDULER_ENABLED = "false";
