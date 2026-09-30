# Local PostgreSQL backup and restore rehearsal

This procedure is for a disposable local PostgreSQL rehearsal only. It does not connect to Lightsail, cloud databases, or production. It creates a custom-format `pg_dump` backup bundle on a private local path and can restore that bundle into a separately named, empty rehearsal database.

It does **not** back up `PC_SUPPORTER_DATA_DIR`, Docker volumes as a whole, browser-local state, or application configuration. It does not migrate JSON user state to PostgreSQL, schedule backups, copy backups off-device, rotate backup history, or prove production recovery.

## Guardrails

- Use an isolated Docker Compose project with a fresh local PostgreSQL volume and synthetic/test records. Keep the source and restore project names unique for each rehearsal.
- Create a libpq service file outside the repository with mode `0600` and an owner-only parent directory. Put the local test database password in that file if the local server requires it. Do not pass a database URL or password as a CLI option or shell argument.
- The service profile and Compose project must use the same lowercase alphanumeric slug: `pc_supporter_rehearsal_<slug>` and `pc-supporter-rehearsal-<slug>`. The service profile must use `dbname=pcsupporter` and a loopback address or Unix socket.
- The CLI ignores `DATABASE_URL` and strips inherited libpq host/password variables from child processes. It passes only the libpq service name and database name to `pg_dump`, `pg_restore`, and `psql`; child output that could contain connection details is suppressed.
- The CLI checks local endpoint settings from the explicit service file. The project name is an operator-provided rehearsal namespace; the CLI does not inspect Docker labels or prove that the local service profile belongs to a particular Docker daemon project. Use a newly created Compose project and its isolated volume.
- Backup output and input must be absolute paths outside the checkout, in an owner-only directory. Backup bundle files are mode `0600`; output paths are never overwritten. The bundle contains a manifest with the source service/project/database, creation time, custom format, archive byte count, and SHA-256 digest.
- Restore accepts only a project named `pc-supporter-rehearsal-<slug>` with target database `pcsupporter_rehearsal_<same-slug>`. It requires that database to exist and be empty; restore runs with `--single-transaction --exit-on-error` and never uses `--clean` or drops objects.

## Schema owner and runtime role

Production schema changes and application writes use separate PostgreSQL roles. `DATABASE_MIGRATION_URL` plus the owner's libpq settings (for example `PGPASSWORD`) are read only by `npm run db:migrate` and the one-shot runtime-role bootstrap. `DATABASE_URL` and its matching runtime `PGPASSWORD` are the only database credentials provided to the API and worker. Do not put owner credentials in the API/worker environment file.

The deployment order is schema migration, idempotent runtime-role provisioning, then API/worker startup. `db:migrate` hashes the exact `db/schema.sql`, applies or replays the canonical schema in a transaction, and records its version and checksum. In production, API startup checks that ledger and the full column/type/nullability/key/index contract with read-only catalog queries. It does not run DDL. Development and test startup retain automatic schema setup, and a process without `DATABASE_URL` refuses to start.

The bootstrap role must differ from the schema-owner connection role. It receives database `CONNECT`, the schema's `USAGE`, and `SELECT`/`INSERT`/`UPDATE`/`DELETE` on canonical application tables. It receives `SELECT` only on `pc_supporter_schema_revision`; `CREATE` and database temporary-table privileges are revoked, while elevated role attributes, role memberships, ownership, and access to non-canonical relations fail closed. The role password is read separately as `DATABASE_RUNTIME_PASSWORD` and must contain at least 32 printable characters. The helper quotes SQL identifiers and passwords and never writes credentials to its output.

The dedicated migration owner must retain `CREATEROLE` so the idempotent runtime-role bootstrap can create or rotate the DML role on later deployments. Keep that role in the root-only migration environment, separate from API and worker credentials; it must not have `SUPERUSER`, `CREATEDB`, or `BYPASSRLS`. The existing-role bootstrap branch only resets `LOGIN`, `INHERIT`, and the password after its read-only checks confirm the runtime role has no elevated attributes, memberships, or application-object ownership.

Docker Compose runs `migrate`, then `runtime-role-bootstrap`, and only then starts `app`, `api-reader`, or `worker`. Existing Postgres volumes keep their initialized `pcsupporter` owner; the bootstrap creates or updates the separate runtime role without dropping, resetting, or rewriting application data. Set `POSTGRES_OWNER_PASSWORD`, `POSTGRES_RUNTIME_ROLE`, and `POSTGRES_RUNTIME_PASSWORD` in the private Compose `.env`. When carrying forward an older `.env`, rename the existing owner password value to `POSTGRES_OWNER_PASSWORD`; use the same value to authenticate to an existing owner account.

For Lightsail, the `--env-file` is the runtime-only systemd `EnvironmentFile`. Supply a separate owner-only file with `--migration-env-file`; the deploy script installs it at `/etc/pc-supporter/migration.env` as root mode `0600` and invokes migration, bootstrap, and a smoke against the configured runtime `DATABASE_URL` as separate one-shot systemd services before restarting the API or worker. The smoke must prove app-table CRUD and deny public-schema DDL and ledger writes, so an old owner connection string in a preserved runtime file blocks startup. The separate file must define `DATABASE_MIGRATION_URL`, `DATABASE_RUNTIME_ROLE`, and `DATABASE_RUNTIME_PASSWORD`; it may also define `PGPASSWORD` and standard `PG*` connection settings. Do not put `DATABASE_URL`, Compose `POSTGRES_PASSWORD`, or `POSTGRES_OWNER_PASSWORD` in it. The runtime backend file should use a `DATABASE_URL` whose username matches `DATABASE_RUNTIME_ROLE` and a runtime-only `PGPASSWORD` (or a runtime password in the URL); the deployment refuses owner/bootstrap keys in this file and explicitly unsets them from the API and worker units. Uploads use a per-deploy staging directory with mode `0700`, and staged env copies are mode `0600`; only those uploaded copies are removed afterward.

## PostgreSQL startup and role smoke

After migration and bootstrap have run against a disposable PostgreSQL database, verify the same runtime environment used by the app with:

```bash
node scripts/postgres-runtime-role-smoke.mjs
```

The smoke reads the schema revision and exercises application-table insert, update, select, and delete inside a rolled-back transaction. It verifies that public-schema `CREATE` and schema-ledger insert, update, and delete fail with PostgreSQL permission-denied SQLSTATE `42501`. It prints only a compact pass/fail summary and role/database identifiers, never connection strings, passwords, or raw database errors. CI runs this smoke against its fresh Compose database. It does not test backup recovery or production deployment.

## Private libpq service file

Create the file in a private directory outside the checkout. Example values below are placeholders for the disposable local PostgreSQL instance:

```ini
[pc_supporter_rehearsal_src123]
host=127.0.0.1
port=55432
dbname=pcsupporter
user=pcsupporter
password=<local-test-container-password>

[pc_supporter_rehearsal_dst234]
host=127.0.0.1
port=55433
dbname=pcsupporter
user=pcsupporter
password=<local-test-container-password>
```

The example uses separate rehearsal slugs for source and restore namespaces. Each profile must match the `--project` slug used with it. Do not copy a production service profile into the rehearsal file.

The commands below use loopback PostgreSQL host port `55432` for the source project and `55433` for the restore project. Set those values in the two temporary Compose env files so both instances can run without a port collision.

## Commands

Set these shell variables to explicit private local paths before using the commands:

```bash
PG_SERVICE_FILE=/absolute/private/path/pg_service.conf
PRIVATE_BACKUP_DIR=/absolute/private/path/pc-supporter-backups
```

The private backup directory must already exist with mode `0700`; the service file and its parent directory must also be owner-only. For example, prepare a new disposable directory with `mkdir -m 700 /absolute/private/path/pc-supporter-backups`, then set the service file to mode `0600`.

Create a unique Compose source project and bring up only its local PostgreSQL service. The project must use a disposable volume and synthetic/test records. Then create the backup bundle:

```bash
docker compose --project-name pc-supporter-rehearsal-src123 --env-file /absolute/private/path/rehearsal.env up -d postgres
npm run db:backup:local -- --service-file "$PG_SERVICE_FILE" --service pc_supporter_rehearsal_src123 --project pc-supporter-rehearsal-src123 --output "$PRIVATE_BACKUP_DIR/src123.pcsbackup"
```

The output path must not exist. The command creates a custom-format dump in a temporary staging directory, asks `pg_restore --list` to validate it, hashes the dump, packages the dump and manifest, and atomically publishes the complete bundle with a no-overwrite hard link.

For restore, create a separate disposable project with its own PostgreSQL volume, then create the empty target database `pcsupporter_rehearsal_dst234` inside that local instance. Configure the destination libpq profile above to that project’s loopback port. Restore with:

```bash
docker compose --project-name pc-supporter-rehearsal-dst234 --env-file /absolute/private/path/restore-rehearsal.env up -d postgres
npm run db:restore:rehearsal -- --service-file "$PG_SERVICE_FILE" --service pc_supporter_rehearsal_dst234 --project pc-supporter-rehearsal-dst234 --target-database pcsupporter_rehearsal_dst234 --input "$PRIVATE_BACKUP_DIR/src123.pcsbackup"
```

The restore command checks the bundle header, manifest format, payload length and SHA-256 before invoking PostgreSQL. It then validates the custom archive, connects through the named local service, confirms that the current database is the requested target and that the target has no user schema or objects, and restores it in one transaction. It fails closed if any of those checks fail.

## Focused automated checks

Run the focused test command from the repository root:

```bash
npm run test:pg-operations
```

The tests use temporary mock `pg_dump`, `pg_restore`, and `psql` executables. They cover restrictive permissions, private-output path requirements, no-overwrite publication, checksum validation, failure cleanup, service-host locality, explicit rehearsal target allowlists, empty-target enforcement, one-transaction restore arguments, and absence of `DATABASE_URL`/passwords from child argv, environment, and logs. They do not connect to PostgreSQL and do not produce a real backup. `scripts/bootstrap-postgres-runtime-role.test.mjs` also covers the migration-only connection choice, canonical table selection, identifier/password quoting, and credential-safe failure output.

The schema parity test reads the `POSTGRES_SCHEMA_SQL` template from `server/repository.ts` as text without importing or executing server code. It combines `CREATE TABLE` declarations with additive `ALTER TABLE ... ADD COLUMN` declarations, compares effective table declarations and indexes with `db/schema.sql`, and explicitly checks the previously missing `saved_builds.my_pc_at`, `saved_budget_ladders`, `saved_generator_variants`, and owner-session tables/indexes.

## Import existing catalog override maps

The explicit `import:catalog-overrides` command imports the raw stored `catalog-spec-overrides.json` and `m2-slot-overrides.json` full maps. Do not use the admin review/export payloads. The command preserves record timestamps and source-check metadata.

Provide both exact source paths. The default is dry-run: it validates both maps and prints only record counts and source SHA-256 digests. It does not read `DATABASE_URL`, create a connection pool, contact PostgreSQL, or modify either source file:

```bash
npm run import:catalog-overrides -- \
  --catalog-spec-file /private/path/catalog-spec-overrides.json \
  --m2-slot-file /private/path/m2-slot-overrides.json
```

Review both dry-run digests before explicitly applying. Supply those exact digests and a `DATABASE_URL` through the operator's protected environment:

```bash
# Set these from the reviewed dry-run output in the protected shell environment.
npm run import:catalog-overrides -- \
  --catalog-spec-file /private/path/catalog-spec-overrides.json \
  --m2-slot-file /private/path/m2-slot-overrides.json \
  --apply \
  --catalog-spec-sha256 "$CATALOG_SPEC_SHA256" \
  --m2-slot-sha256 "$M2_SLOT_SHA256"
```

Apply uses one PostgreSQL client and one transaction. It acquires the existing `pc-supporter:catalog-spec-overrides` then `pc-supporter:m2-slot-overrides` transaction advisory locks before reading either singleton. Both target tables must already exist; the command never executes schema DDL or falls back to JSON-file persistence. An absent row or empty object map may be initialized, an exact canonical map is an idempotent no-op, and any different nonempty target rejects the whole transaction without per-key merging. The original files remain untouched.

Validation covers the stored record shape and values, including metadata, but does not re-check part existence, current catalog missing fields, or motherboard M.2 slot-count agreement. Those catalog-dependent checks and any real PostgreSQL import/cutover require separate review and verification. This command is an explicit data import tool; it is not run at application startup and does not replace a schema migration runner.

The focused importer regression command is:

```bash
npm test -- scripts/import-catalog-overrides.test.ts
```

These tests use a fake PostgreSQL client. They cover dry-run without dotenv or pool creation, explicit source/hash checks, strict map parsing, lossless maps above 500 records and long part IDs, lock order, empty/exact/conflicting destinations, and transaction rollback after a partial write failure. They do not connect to PostgreSQL or apply a production data cutover.

## Evidence boundary and remaining work

The backup/restore CLI's focused tests check its guards using mocked `pg_dump`, `pg_restore`, and `psql` binaries; the override importer has separate fake-client tests for map validation and atomic writes. Neither test group connects to real PostgreSQL or proves real backup/restore/import readback.

On 2026-09-30, the candidate also ran a separate destructive-scope-limited PostgreSQL 18.4 rehearsal under `/private/tmp/pc-supporter-pg-validation-ab0dc06`. It applied a fresh schema, replayed the exact version/checksum, rejected a changed-schema checksum, preserved a synthetic legacy `saved_builds` row, and rolled back malformed missing-payload/type/key schemas. It changed only that temporary cluster's IPv4/IPv6 loopback host rules to SCRAM-SHA-256; Unix socket trust remained unchanged. Correct owner/runtime passwords connected and wrong passwords failed. The runtime role passed real app-table CRUD, rejected public-schema DDL and schema-ledger writes, and left no smoke rows. The production API started read-only against that restricted role and reported PostgreSQL readiness. Synthetic override maps completed dry-run, apply, unchanged replay, conflict rejection with unchanged DB readback, followed by a real `pg-operations` custom-format backup, restore to an empty disposable DB, and synthetic application readback. The manifest and sanitized command logs are at [`/private/tmp/pc-supporter-pg-validation-ab0dc06/evidence/manifest.json`](/private/tmp/pc-supporter-pg-validation-ab0dc06/evidence/manifest.json). This is local disposable-database evidence; it is separate from a remote CI run, Lightsail deployment, production data import, and the open backup-retention/RPO/RTO work.

Before production use, a separate approved operating procedure still needs off-device backup storage, encryption/key ownership, schedule and retention, integrity monitoring, restore access control, RPO/RTO targets, file-volume coverage, production-scope recovery rehearsal, Lightsail migration/deploy rollback rehearsal, and a policy for writes created after cutover. The completed dump/restore used only synthetic records on a disposable database. The backup/restore CLI moves PostgreSQL data only; it does not migrate file-backed application state. The override importer covers only the two named maps and does not perform a broader file→PostgreSQL state cutover. The deployment confirmation flag must not be treated as proof that user state was imported.
