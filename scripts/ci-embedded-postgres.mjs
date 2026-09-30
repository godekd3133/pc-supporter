// Long-running helper for CI: provisions a scratch database on the embedded
// PostgreSQL cluster, writes the connection URL to a file, and stays alive so
// the embedded postgres child process survives for the rest of the job.
// Usage: node scripts/ci-embedded-postgres.mjs <database> <url-output-file>
import { writeFileSync } from "node:fs";
import { ensureEmbeddedPostgres } from "./ensure-embedded-postgres.mjs";

const [database, outputFile] = process.argv.slice(2);
if (!database || !outputFile) {
  console.error("usage: node scripts/ci-embedded-postgres.mjs <database> <url-output-file>");
  process.exit(1);
}

const { url } = await ensureEmbeddedPostgres(database);
writeFileSync(outputFile, url);
setInterval(() => undefined, 60_000);
