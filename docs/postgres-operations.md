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

The tests use temporary mock `pg_dump`, `pg_restore`, and `psql` executables. They cover restrictive permissions, private-output path requirements, no-overwrite publication, checksum validation, failure cleanup, service-host locality, explicit rehearsal target allowlists, empty-target enforcement, one-transaction restore arguments, and absence of `DATABASE_URL`/passwords from child argv, environment, and logs. They do not connect to PostgreSQL and do not produce a real backup.

The schema parity test reads the `POSTGRES_SCHEMA_SQL` template from `server/repository.ts` as text without importing or executing server code. It combines `CREATE TABLE` declarations with additive `ALTER TABLE ... ADD COLUMN` declarations, compares effective table declarations and indexes with `db/schema.sql`, and explicitly checks the previously missing `saved_builds.my_pc_at`, `saved_budget_ladders`, `saved_generator_variants`, and owner-session tables/indexes.

## Evidence boundary and remaining work

Passing the focused mock tests proves the local CLI’s guard behavior around mocked binaries. It does not prove that a real PostgreSQL server accepts the commands, that a real dump can be restored, or that the restored application reads equivalent production state. No real dump or restore is claimed here.

Before production use, a separate approved operating procedure still needs off-device backup storage, encryption/key ownership, schedule and retention, integrity monitoring, restore access control, RPO/RTO targets, file-volume coverage, real PostgreSQL dump-and-restore rehearsal, application readback, migration/rollback rehearsal, and a policy for writes created after cutover. The CLI is not a file→PostgreSQL state migration tool; the deployment confirmation flag must not be treated as proof that user state was imported.
