import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BUNDLE_MAGIC } from "./pg-operations.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI_PATH = resolve(ROOT, "scripts/pg-operations.mjs");
const SOURCE_SLUG = "smoke123";
const SOURCE_PROJECT = `pc-supporter-rehearsal-${SOURCE_SLUG}`;
const SOURCE_SERVICE = `pc_supporter_rehearsal_${SOURCE_SLUG}`;
const TEST_DATABASE_URL = "postgresql://dummy-user:dummy-url-password@remote.invalid/not-used";
const TEST_PASSWORD = "dummy-process-password-must-not-leak";
const SERVICE_PASSWORD = "dummy-service-file-password-must-not-leak";

async function privateMkdir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function executableScript(logPath, contents) {
  return `#!/usr/bin/env node\nimport { appendFileSync, writeFileSync } from "node:fs";\nconst args = process.argv.slice(2);\nappendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, hasDatabaseUrl: Boolean(process.env.DATABASE_URL), hasPgpassword: Boolean(process.env.PGPASSWORD), hasHost: Boolean(process.env.PGHOST), hasPassfile: process.env.PGPASSFILE }) + "\\n");\n${contents}\n`;
}

function mockPgDumpBody(mode) {
  return `
const output = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length);
if (!output) process.exit(31);
writeFileSync(output, ${JSON.stringify(mode === "fail" ? "partial custom archive" : "synthetic pg_dump custom archive")});
${mode === "fail" ? "process.exit(17);" : ""}
`;
}

function mockPgRestoreBody(mode) {
  const listFailure = mode === "list-fail" ? "process.exit(18);" : "";
  const restoreFailure = mode === "restore-fail" ? "if (!args.includes('--list')) process.exit(19);" : "";
  return `
${listFailure}
${restoreFailure}
`;
}

function mockPsqlBody(result) {
  return `process.stdout.write(${JSON.stringify(`${result}\n`)});`;
}

async function makeHarness({ dumpMode = "success", restoreMode = "success", psqlResult = "empty" } = {}) {
  const root = await privateMkdir(await mkdtemp(join(tmpdir(), "pc-supporter-pg-ops-test-")));
  const privateDir = await privateMkdir(join(root, "private"));
  const binDir = await privateMkdir(join(root, "mock-bin"));
  const logsDir = await privateMkdir(join(root, "logs"));
  const logs = {
    pgDump: join(logsDir, "pg_dump.jsonl"),
    pgRestore: join(logsDir, "pg_restore.jsonl"),
    psql: join(logsDir, "psql.jsonl")
  };
  const serviceFile = join(privateDir, "pg_service.conf");
  await writeFile(serviceFile, `[${SOURCE_SERVICE}]\nhost=127.0.0.1\nport=5432\ndbname=pcsupporter\nuser=pcsupporter\npassword=${SERVICE_PASSWORD}\n`, { mode: 0o600 });
  await chmod(serviceFile, 0o600);
  await setMockCommands({ binDir, logs, dumpMode, restoreMode, psqlResult });
  return { root, privateDir, binDir, logs, serviceFile, outputPath: join(privateDir, "sample.pcsbackup") };
}

async function setMockCommands({ binDir, logs, dumpMode = "success", restoreMode = "success", psqlResult = "empty" }) {
  const commandScripts = {
    pg_dump: executableScript(logs.pgDump, mockPgDumpBody(dumpMode)),
    pg_restore: executableScript(logs.pgRestore, mockPgRestoreBody(restoreMode)),
    psql: executableScript(logs.psql, mockPsqlBody(psqlResult))
  };
  for (const [name, contents] of Object.entries(commandScripts)) {
    const path = join(binDir, name);
    await writeFile(path, contents, { mode: 0o700 });
    await chmod(path, 0o700);
  }
}

function invoker(harness, extraEnv = {}) {
  return (args) => spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${harness.binDir}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
      DATABASE_URL: TEST_DATABASE_URL,
      PGPASSWORD: TEST_PASSWORD,
      PGHOST: "remote.invalid",
      PGPORT: "6432",
      ...extraEnv
    },
    maxBuffer: 1024 * 1024
  });
}

function backupArgs(harness, outputPath = harness.outputPath, project = SOURCE_PROJECT, service = SOURCE_SERVICE) {
  return [
    "backup",
    "--service-file", harness.serviceFile,
    "--service", service,
    "--project", project,
    "--output", outputPath
  ];
}

function restoreArgs(harness, inputPath = harness.outputPath, project = "pc-supporter-rehearsal-restore234", service = "pc_supporter_rehearsal_restore234", database = "pcsupporter_rehearsal_restore234") {
  return [
    "restore",
    "--service-file", harness.serviceFile,
    "--service", service,
    "--project", project,
    "--target-database", database,
    "--input", inputPath
  ];
}

async function appendService(harness, slug) {
  const existing = await readFile(harness.serviceFile, "utf8");
  await writeFile(harness.serviceFile, `${existing}\n[pc_supporter_rehearsal_${slug}]\nhost=127.0.0.1\nport=5432\ndbname=pcsupporter\nuser=pcsupporter\npassword=${SERVICE_PASSWORD}\n`, { mode: 0o600 });
  await chmod(harness.serviceFile, 0o600);
}

async function readLog(logPath) {
  try {
    const data = await readFile(logPath, "utf8");
    return data.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function withHarness(options, callback) {
  const harness = await makeHarness(options);
  try {
    await callback(harness);
  } finally {
    await rm(harness.root, { recursive: true, force: true });
  }
}

test("backup publishes a private custom-format bundle with a verified SHA-256 manifest and no secret leakage", async () => {
  await withHarness({}, async (harness) => {
    const result = invoker(harness)(backupArgs(harness));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const outputInfo = await stat(harness.outputPath);
    assert.equal(outputInfo.mode & 0o777, 0o600);
    const bundle = await readFile(harness.outputPath);
    assert.ok(bundle.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC));
    const manifestLength = bundle.readUInt32BE(BUNDLE_MAGIC.length);
    const manifestStart = BUNDLE_MAGIC.length + 4;
    const manifest = JSON.parse(bundle.subarray(manifestStart, manifestStart + manifestLength).toString("utf8"));
    const payload = bundle.subarray(manifestStart + manifestLength);
    assert.equal(manifest.format, "pg_dump_custom");
    assert.equal(manifest.source.project, SOURCE_PROJECT);
    assert.equal(manifest.source.service, SOURCE_SERVICE);
    assert.equal(manifest.source.database, "pcsupporter");
    assert.equal(manifest.archive.sizeBytes, payload.length);
    assert.equal(manifest.archive.sha256, createHash("sha256").update(payload).digest("hex"));

    const pgDumpCalls = await readLog(harness.logs.pgDump);
    const pgRestoreCalls = await readLog(harness.logs.pgRestore);
    assert.equal(pgDumpCalls.length, 1);
    assert.ok(pgDumpCalls[0].args.includes("--format=custom"));
    assert.ok(pgDumpCalls[0].args.some((arg) => arg.includes(`service=${SOURCE_SERVICE} dbname=pcsupporter`)));
    assert.equal(pgRestoreCalls.length, 1);
    assert.deepEqual(pgRestoreCalls[0].args.slice(0, 1), ["--list"]);
    for (const call of [...pgDumpCalls, ...pgRestoreCalls]) {
      assert.equal(call.hasDatabaseUrl, false);
      assert.equal(call.hasPgpassword, false);
      assert.equal(call.hasHost, false);
      assert.equal(call.hasPassfile, "/dev/null");
    }
    const combinedOutput = `${result.stdout}\n${result.stderr}\n${JSON.stringify(pgDumpCalls)}\n${JSON.stringify(pgRestoreCalls)}`;
    for (const secret of [TEST_DATABASE_URL, TEST_PASSWORD, SERVICE_PASSWORD]) assert.ok(!combinedOutput.includes(secret));
    const stagingEntries = (await readdir(harness.privateDir)).filter((name) => name.startsWith(".pc-supporter-pg-ops-"));
    assert.deepEqual(stagingEntries, []);
  });
});

test("backup does not overwrite an existing output path", async () => {
  await withHarness({}, async (harness) => {
    const first = invoker(harness)(backupArgs(harness));
    assert.equal(first.status, 0, first.stderr);
    const original = await readFile(harness.outputPath);
    const second = invoker(harness)(backupArgs(harness));
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists/);
    assert.deepEqual(await readFile(harness.outputPath), original);
    assert.equal((await readLog(harness.logs.pgDump)).length, 1, "existing destination is rejected before pg_dump is run again");
  });
});

test("backup refuses a non-private output parent before launching PostgreSQL tools", async () => {
  await withHarness({}, async (harness) => {
    const publicDirectory = join(harness.root, "not-private");
    await mkdir(publicDirectory, { mode: 0o755 });
    await chmod(publicDirectory, 0o755);
    const result = invoker(harness)(backupArgs(harness, join(publicDirectory, "unsafe.pcsbackup")));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not grant group or other permissions/);
    assert.equal((await readLog(harness.logs.pgDump)).length, 0);
  });
});

test("backup failure leaves no published file and removes its temporary staging directory", async () => {
  await withHarness({ dumpMode: "fail" }, async (harness) => {
    const result = invoker(harness)(backupArgs(harness));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pg_dump failed/);
    await assert.rejects(stat(harness.outputPath), { code: "ENOENT" });
    assert.deepEqual((await readdir(harness.privateDir)).filter((name) => name.startsWith(".pc-supporter-pg-ops-")), []);
  });
});

test("unreadable custom-format archive is not published", async () => {
  await withHarness({ restoreMode: "list-fail" }, async (harness) => {
    const result = invoker(harness)(backupArgs(harness));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pg_restore failed/);
    await assert.rejects(stat(harness.outputPath), { code: "ENOENT" });
  });
});

test("restore detects checksum changes before querying or changing the target", async () => {
  await withHarness({}, async (harness) => {
    const backup = invoker(harness)(backupArgs(harness));
    assert.equal(backup.status, 0, backup.stderr);
    await appendService(harness, "restore234");
    const bundle = await readFile(harness.outputPath);
    bundle[bundle.length - 1] ^= 0x01;
    await writeFile(harness.outputPath, bundle);
    await chmod(harness.outputPath, 0o600);

    const restore = invoker(harness)(restoreArgs(harness));
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /checksum or size/);
    assert.equal((await readLog(harness.logs.psql)).length, 0);
    assert.equal((await readLog(harness.logs.pgRestore)).length, 1, "only the backup creation list check ran");
    assert.deepEqual((await readdir(harness.privateDir)).filter((name) => name.startsWith(".pc-supporter-pg-restore-")), []);
  });
});

test("restore refuses databases or projects outside the rehearsal allowlist before invoking PostgreSQL tools", async () => {
  await withHarness({}, async (harness) => {
    const backup = invoker(harness)(backupArgs(harness));
    assert.equal(backup.status, 0, backup.stderr);
    const beforeRestoreCalls = (await readLog(harness.logs.pgRestore)).length;

    const invalidDatabase = invoker(harness)(restoreArgs(harness, harness.outputPath, "pc-supporter-rehearsal-restore234", "pc_supporter_rehearsal_restore234", "pcsupporter"));
    assert.notEqual(invalidDatabase.status, 0);
    assert.match(invalidDatabase.stderr, /target database/);

    const invalidProject = invoker(harness)(restoreArgs(harness, harness.outputPath, "default", "pc_supporter_rehearsal_restore234", "pcsupporter_rehearsal_restore234"));
    assert.notEqual(invalidProject.status, 0);
    assert.match(invalidProject.stderr, /Project must be named/);
    assert.equal((await readLog(harness.logs.pgRestore)).length, beforeRestoreCalls);
    assert.equal((await readLog(harness.logs.psql)).length, 0);
  });
});

test("restore checks the target is empty and applies a valid archive in one transaction", async () => {
  await withHarness({}, async (harness) => {
    const backup = invoker(harness)(backupArgs(harness));
    assert.equal(backup.status, 0, backup.stderr);
    await appendService(harness, "restore234");
    const restore = invoker(harness)(restoreArgs(harness));
    assert.equal(restore.status, 0, restore.stderr);

    const psqlCalls = await readLog(harness.logs.psql);
    assert.equal(psqlCalls.length, 1);
    assert.ok(psqlCalls[0].args.some((arg) => arg.includes("pcsupporter_rehearsal_restore234")));
    assert.ok(psqlCalls[0].args.some((arg) => arg.includes("current_database()")));
    const pgRestoreCalls = await readLog(harness.logs.pgRestore);
    const applyCall = pgRestoreCalls.at(-1);
    assert.ok(applyCall.args.includes("--exit-on-error"));
    assert.ok(applyCall.args.includes("--single-transaction"));
    assert.ok(applyCall.args.includes("--no-owner"));
    assert.ok(applyCall.args.includes("--no-privileges"));
    assert.ok(applyCall.args.some((arg) => arg.includes(`service=pc_supporter_rehearsal_restore234 dbname=pcsupporter_rehearsal_restore234`)));
    for (const call of [...psqlCalls, ...pgRestoreCalls]) {
      assert.equal(call.hasDatabaseUrl, false);
      assert.equal(call.hasPgpassword, false);
    }
    for (const secret of [TEST_DATABASE_URL, TEST_PASSWORD, SERVICE_PASSWORD]) {
      assert.ok(!`${restore.stdout}\n${restore.stderr}\n${JSON.stringify(psqlCalls)}\n${JSON.stringify(pgRestoreCalls)}`.includes(secret));
    }
  });
});

test("restore refuses a non-empty target", async () => {
  await withHarness({ psqlResult: "not_empty" }, async (harness) => {
    const backup = invoker(harness)(backupArgs(harness));
    assert.equal(backup.status, 0, backup.stderr);
    await appendService(harness, "restore234");
    const restore = invoker(harness)(restoreArgs(harness));
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /not the explicitly named empty rehearsal database/);
    assert.equal((await readLog(harness.logs.psql)).length, 1);
    const calls = await readLog(harness.logs.pgRestore);
    assert.equal(calls.length, 2, "backup list validation and restore-input list validation ran; no restore was applied");
    assert.ok(calls.every((call) => call.args.includes("--list")));
  });
});

test("remote service hosts are refused before any PostgreSQL binary is launched", async () => {
  await withHarness({}, async (harness) => {
    await writeFile(harness.serviceFile, `[${SOURCE_SERVICE}]\nhost=203.0.113.8\ndbname=pcsupporter\nuser=pcsupporter\npassword=${SERVICE_PASSWORD}\n`, { mode: 0o600 });
    await chmod(harness.serviceFile, 0o600);
    const result = invoker(harness)(backupArgs(harness));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Only a loopback host/);
    assert.equal((await readLog(harness.logs.pgDump)).length, 0);
  });
});

test("service files cannot redirect libpq to another password file", async () => {
  await withHarness({}, async (harness) => {
    await writeFile(harness.serviceFile, `[${SOURCE_SERVICE}]\nhost=127.0.0.1\nport=5432\ndbname=pcsupporter\nuser=pcsupporter\npassfile=/absolute/private/path/other.pgpass\n`, { mode: 0o600 });
    await chmod(harness.serviceFile, 0o600);
    const result = invoker(harness)(backupArgs(harness));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /external PostgreSQL passfile is not allowed/);
    assert.equal((await readLog(harness.logs.pgDump)).length, 0);
  });
});

test("argument errors do not echo URL-like or password-bearing values", async () => {
  await withHarness({}, async (harness) => {
    const positionalUrl = invoker(harness)([TEST_DATABASE_URL]);
    assert.notEqual(positionalUrl.status, 0);
    assert.ok(!positionalUrl.stderr.includes(TEST_DATABASE_URL));
    const optionUrl = invoker(harness)(["backup", `--database-url=${TEST_DATABASE_URL}`]);
    assert.notEqual(optionUrl.status, 0);
    assert.ok(!optionUrl.stderr.includes(TEST_DATABASE_URL));
    assert.equal((await readLog(harness.logs.pgDump)).length, 0);
  });
});
