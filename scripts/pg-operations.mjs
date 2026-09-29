#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, link, mkdtemp, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_MAGIC = Buffer.from("PC-SUPPORTER-POSTGRES-BACKUP\n", "ascii");
const MAX_MANIFEST_BYTES = 64 * 1024;
const PROJECT_PATTERN = /^pc-supporter-rehearsal-([a-z0-9]{4,20})$/;
const SERVICE_PATTERN = /^pc_supporter_rehearsal_([a-z0-9]{4,20})$/;
const SOURCE_DATABASE = "pcsupporter";

class OperationsError extends Error {
  constructor(message) {
    super(message);
    this.name = "OperationsError";
  }
}

function fail(message) {
  throw new OperationsError(message);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/pg-operations.mjs backup --service-file <private-pg_service.conf> --service <pc_supporter_rehearsal_slug> --project <pc-supporter-rehearsal-slug> --output <absolute-private-path.pcsbackup>",
    "  node scripts/pg-operations.mjs restore --service-file <private-pg_service.conf> --service <pc_supporter_rehearsal_slug> --project <pc-supporter-rehearsal-slug> --target-database <pcsupporter_rehearsal_slug> --input <absolute-private-path.pcsbackup>",
    "",
    "The service file must be owner-only, name a local PostgreSQL endpoint, and keep any password out of command arguments.",
    "Restore only accepts an explicitly named, empty rehearsal database whose slug matches the rehearsal project."
  ].join("\n");
}

function parseArgs(argv) {
  const [operation, ...rest] = argv;
  if (operation === "--help" || operation === "-h" || operation === undefined) {
    return { help: true };
  }
  if (operation !== "backup" && operation !== "restore") fail("Operation must be backup or restore.");

  const values = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag.startsWith("--")) fail("Arguments must use named options.");
    if (values.has(flag)) fail("An option was provided more than once.");
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) fail("A required option value is missing.");
    values.set(flag, value);
    index += 1;
  }

  const required = operation === "backup"
    ? ["--service-file", "--service", "--project", "--output"]
    : ["--service-file", "--service", "--project", "--target-database", "--input"];
  for (const name of required) {
    if (!values.has(name)) fail(`A value is required for ${name}.`);
  }
  const allowed = new Set(required);
  for (const name of values.keys()) {
    if (!allowed.has(name)) fail("An unsupported option was provided.");
  }

  return {
    operation,
    serviceFile: values.get("--service-file"),
    serviceName: values.get("--service"),
    projectName: values.get("--project"),
    ...(operation === "backup"
      ? { outputPath: values.get("--output") }
      : { targetDatabase: values.get("--target-database"), inputPath: values.get("--input") })
  };
}

function pathIsWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent));
}

async function canonicalRepositoryRoot() {
  return realpath(REPOSITORY_ROOT);
}

async function rejectRepositoryPath(path, label) {
  const canonicalPath = await realpath(path);
  if (pathIsWithin(await canonicalRepositoryRoot(), canonicalPath)) {
    fail(`${label} must be outside the repository checkout.`);
  }
  return canonicalPath;
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function assertOwnerOnly(info, label) {
  if ((info.mode & 0o077) !== 0) fail(`${label} must not grant group or other permissions.`);
  const uid = currentUid();
  if (uid !== undefined && info.uid !== uid) fail(`${label} must be owned by the current user.`);
}

async function resolvePrivateDirectory(filePath, label) {
  if (!isAbsolute(filePath)) fail(`${label} must be an absolute path.`);
  const resolvedInput = resolve(filePath);
  const parent = await realpath(dirname(resolvedInput)).catch(() => fail(`${label} parent directory must already exist.`));
  if (pathIsWithin(await canonicalRepositoryRoot(), parent)) fail(`${label} must be outside the repository checkout.`);
  const parentInfo = await stat(parent);
  if (!parentInfo.isDirectory()) fail(`${label} parent must be a directory.`);
  assertOwnerOnly(parentInfo, `${label} parent directory`);
  if ((parentInfo.mode & 0o700) !== 0o700) fail(`${label} parent directory must be owner-readable, writable, and searchable.`);
  return { parent, filePath: join(parent, resolvedInput.split(sep).at(-1) ?? "") };
}

async function resolvePrivateRegularFile(filePath, label) {
  const { parent, filePath: canonicalFilePath } = await resolvePrivateDirectory(filePath, label);
  const info = await lstat(canonicalFilePath).catch(() => fail(`${label} does not exist.`));
  if (info.isSymbolicLink() || !info.isFile()) fail(`${label} must be a regular file, not a link.`);
  assertOwnerOnly(info, label);
  await rejectRepositoryPath(canonicalFilePath, label);
  return { parent, filePath: canonicalFilePath, info };
}

function decodeServiceValue(rawValue, label) {
  let value = rawValue.trim();
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) fail(`Invalid PostgreSQL service configuration for ${label}.`);
    value = value.slice(1, -1).replace(/\\(.)/g, "$1");
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) fail(`Invalid PostgreSQL service configuration for ${label}.`);
  return value;
}

function parseServiceFileContents(contents, serviceName) {
  const services = new Map();
  let currentService;
  for (const [lineIndex, sourceLine] of contents.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      currentService = section[1].trim();
      if (!currentService || services.has(currentService)) fail("PostgreSQL service file contains an invalid or duplicate section.");
      services.set(currentService, new Map());
      continue;
    }
    const entry = sourceLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!entry || !currentService) fail(`Invalid PostgreSQL service file syntax on line ${lineIndex + 1}.`);
    const key = entry[1].toLowerCase();
    const values = services.get(currentService);
    if (values.has(key)) fail(`Duplicate PostgreSQL service setting on line ${lineIndex + 1}.`);
    values.set(key, decodeServiceValue(entry[2], key));
  }
  const settings = services.get(serviceName);
  if (!settings) fail("The requested PostgreSQL service is not defined in the service file.");
  for (const forbidden of ["service", "servicefile", "include", "include_dir"]) {
    if (settings.has(forbidden)) fail("Nested PostgreSQL service configuration is not allowed.");
  }
  if (settings.has("passfile")) fail("An external PostgreSQL passfile is not allowed; keep the local test password in the private service file.");

  const host = settings.get("host");
  const hostAddress = settings.get("hostaddr");
  if (host !== undefined) {
    const normalizedHost = host.toLowerCase();
    const localHost = normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "::1" || (host.startsWith("/") && !host.includes(","));
    if (!localHost) fail("Only a loopback host or Unix socket is allowed for PostgreSQL operations.");
  }
  if (hostAddress !== undefined && !["127.0.0.1", "::1"].includes(hostAddress)) {
    fail("Only a loopback host address is allowed for PostgreSQL operations.");
  }
  if (host === undefined && hostAddress !== undefined) fail("A local host name is required when hostaddr is set.");
  if (settings.has("hostssl") || settings.has("hostnossl")) fail("Multiple-host PostgreSQL service definitions are not allowed.");
  const port = settings.get("port");
  if (port !== undefined && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    fail("The PostgreSQL service port is invalid.");
  }
  const user = settings.get("user");
  if (user !== undefined && !/^[A-Za-z0-9_.-]{1,63}$/.test(user)) fail("The PostgreSQL service user name is invalid.");
  const database = settings.get("dbname");
  if (database !== SOURCE_DATABASE) fail(`The rehearsal source service must use database ${SOURCE_DATABASE}.`);
  return { database };
}

async function loadLocalService(serviceFilePath, serviceName, projectSlug) {
  const serviceMatch = serviceName.match(SERVICE_PATTERN);
  if (!serviceMatch || serviceMatch[1] !== projectSlug) {
    fail("The PostgreSQL service name must match the explicit rehearsal project slug.");
  }
  const serviceFile = await resolvePrivateRegularFile(serviceFilePath, "PostgreSQL service file");
  const contents = await readFile(serviceFile.filePath, "utf8");
  const config = parseServiceFileContents(contents, serviceName);
  return { ...serviceFile, serviceName, ...config };
}

function rehearsalSlug(projectName) {
  const match = projectName.match(PROJECT_PATTERN);
  if (!match) fail("Project must be named pc-supporter-rehearsal-<lowercase-alphanumeric-slug>.");
  return match[1];
}

function targetDatabaseForSlug(database, slug) {
  if (database !== `pcsupporter_rehearsal_${slug}`) {
    fail("Restore target database must be pcsupporter_rehearsal_<same-project-slug>.");
  }
  return database;
}

function connectionInfo(serviceName, database) {
  // Conninfo contains only allowlisted identifiers. Passwords stay in the private libpq service file.
  return `service=${serviceName} dbname=${database} application_name=pc-supporter-pg-operations`;
}

function childEnvironment(serviceFilePath) {
  const env = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    LC_ALL: "C",
    PGSERVICEFILE: serviceFilePath,
    // Never inherit DATABASE_URL, PGPASSWORD, PGHOST, PGPORT, or the caller's .pgpass file.
    PGPASSFILE: "/dev/null"
  };
  if (process.platform === "win32" && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

function runPostgresTool(command, args, env, { captureStdout = false } = {}) {
  const result = spawnSync(command, args, {
    env,
    encoding: captureStdout ? "utf8" : undefined,
    stdio: captureStdout ? ["ignore", "pipe", "ignore"] : ["ignore", "ignore", "ignore"],
    maxBuffer: captureStdout ? 32 * 1024 : undefined
  });
  if (result.error || result.status !== 0) {
    fail(`${command} failed${Number.isInteger(result.status) ? ` (exit ${result.status})` : ""}. Details were suppressed to avoid logging connection data.`);
  }
  return captureStdout ? String(result.stdout ?? "").trim() : "";
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    sizeBytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

async function writeBundle(bundlePath, manifest, dumpPath) {
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  if (manifestBuffer.length > MAX_MANIFEST_BYTES) fail("Backup manifest exceeds its size limit.");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(manifestBuffer.length, 0);

  async function* bundleChunks() {
    yield BUNDLE_MAGIC;
    yield lengthBuffer;
    yield manifestBuffer;
    for await (const chunk of createReadStream(dumpPath)) yield chunk;
  }

  await pipeline(
    Readable.from(bundleChunks()),
    createWriteStream(bundlePath, { flags: "wx", mode: 0o600 })
  );
  await chmod(bundlePath, 0o600);
  const bundleHandle = await open(bundlePath, "r+");
  try {
    await bundleHandle.sync();
  } finally {
    await bundleHandle.close();
  }
}

function readExactly(handle, buffer, position) {
  return handle.read(buffer, 0, buffer.length, position).then(({ bytesRead }) => {
    if (bytesRead !== buffer.length) fail("Backup bundle is truncated.");
  });
}

async function extractBundle(bundlePath, stageDirectory) {
  const bundleInfo = await lstat(bundlePath);
  if (bundleInfo.isSymbolicLink() || !bundleInfo.isFile()) fail("Backup input must be a regular file.");
  assertOwnerOnly(bundleInfo, "Backup file");

  const handle = await open(bundlePath, "r");
  let payloadStart;
  let manifest;
  try {
    const magic = Buffer.alloc(BUNDLE_MAGIC.length);
    await readExactly(handle, magic, 0);
    if (!magic.equals(BUNDLE_MAGIC)) fail("Backup bundle format is not recognized.");
    const lengthBuffer = Buffer.alloc(4);
    await readExactly(handle, lengthBuffer, BUNDLE_MAGIC.length);
    const manifestLength = lengthBuffer.readUInt32BE(0);
    if (manifestLength < 2 || manifestLength > MAX_MANIFEST_BYTES) fail("Backup manifest size is invalid.");
    const manifestBuffer = Buffer.alloc(manifestLength);
    await readExactly(handle, manifestBuffer, BUNDLE_MAGIC.length + 4);
    try {
      manifest = JSON.parse(manifestBuffer.toString("utf8"));
    } catch {
      fail("Backup manifest is invalid.");
    }
    payloadStart = BUNDLE_MAGIC.length + 4 + manifestLength;
    if (bundleInfo.size <= payloadStart) fail("Backup payload is empty.");
  } finally {
    await handle.close();
  }

  const expectedKeys = ["archive", "createdAt", "format", "manifestVersion", "source"];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || Object.keys(manifest).sort().join(",") !== expectedKeys.join(",")
    || manifest.manifestVersion !== 1
    || manifest.format !== "pg_dump_custom"
    || !Number.isFinite(Date.parse(manifest.createdAt))
    || !manifest.archive || typeof manifest.archive !== "object"
    || Object.keys(manifest.archive).sort().join(",") !== "sha256,sizeBytes"
    || !/^[0-9a-f]{64}$/.test(manifest.archive.sha256)
    || !Number.isSafeInteger(manifest.archive.sizeBytes) || manifest.archive.sizeBytes <= 0
    || !manifest.source || typeof manifest.source !== "object"
    || Object.keys(manifest.source).sort().join(",") !== "database,project,service"
    || manifest.source.database !== SOURCE_DATABASE
    || !PROJECT_PATTERN.test(manifest.source.project)
    || !SERVICE_PATTERN.test(manifest.source.service)) {
    fail("Backup manifest does not match the supported rehearsal format.");
  }
  const sourceProjectSlug = rehearsalSlug(manifest.source.project);
  if (manifest.source.service !== `pc_supporter_rehearsal_${sourceProjectSlug}`) {
    fail("Backup manifest rehearsal project and service do not match.");
  }

  const payloadPath = join(stageDirectory, "payload.custom.dump");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  await pipeline(
    createReadStream(bundlePath, { start: payloadStart }),
    hasher,
    createWriteStream(payloadPath, { flags: "wx", mode: 0o600 })
  );
  await chmod(payloadPath, 0o600);
  const actualDigest = hash.digest("hex");
  if (sizeBytes !== manifest.archive.sizeBytes || actualDigest !== manifest.archive.sha256) {
    fail("Backup checksum or size does not match its manifest.");
  }
  return { manifest, payloadPath };
}

async function backup({ serviceFile, serviceName, projectName, outputPath }) {
  const slug = rehearsalSlug(projectName);
  const service = await loadLocalService(serviceFile, serviceName, slug);
  if (!isAbsolute(outputPath) || !outputPath.endsWith(".pcsbackup")) {
    fail("Backup output must be an explicit absolute path ending in .pcsbackup.");
  }
  const destination = await resolvePrivateDirectory(outputPath, "Backup output");
  const existing = await lstat(destination.filePath).catch((error) => error?.code === "ENOENT" ? undefined : fail("Backup output path cannot be inspected."));
  if (existing) fail("Backup output already exists; refusing to overwrite it.");

  const stagingDirectory = await mkdtemp(join(destination.parent, ".pc-supporter-pg-ops-"));
  await chmod(stagingDirectory, 0o700);
  const dumpPath = join(stagingDirectory, "payload.custom.dump");
  const stagedBundle = join(stagingDirectory, "bundle.pcsbackup");
  const childEnv = childEnvironment(service.filePath);
  try {
    runPostgresTool("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--dbname=${connectionInfo(serviceName, SOURCE_DATABASE)}`,
      `--file=${dumpPath}`
    ], childEnv);
    await chmod(dumpPath, 0o600).catch(() => fail("pg_dump did not create its custom-format backup."));
    const dumpInfo = await stat(dumpPath).catch(() => fail("pg_dump did not create its custom-format backup."));
    if (!dumpInfo.isFile() || dumpInfo.size <= 0) fail("pg_dump created an empty backup.");

    runPostgresTool("pg_restore", ["--list", dumpPath], childEnv);
    const archive = await sha256File(dumpPath);
    const manifest = {
      manifestVersion: 1,
      format: "pg_dump_custom",
      createdAt: new Date().toISOString(),
      source: { project: projectName, service: serviceName, database: service.database },
      archive
    };
    await writeBundle(stagedBundle, manifest, dumpPath);
    try {
      // A same-filesystem hard link atomically publishes a complete file and fails if the path exists.
      await link(stagedBundle, destination.filePath);
    } catch (error) {
      if (error?.code === "EEXIST") fail("Backup output already exists; refusing to overwrite it.");
      fail("Backup could not be published atomically.");
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, operation: "backup", project: projectName, service: serviceName })}\n`);
}

function emptyDatabaseQuery(targetDatabase) {
  return `SELECT CASE
    WHEN current_database() <> '${targetDatabase}' THEN 'wrong_database'
    WHEN EXISTS (
      SELECT 1 FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
        AND nspname !~ '^pg_toast'
        AND nspname !~ '^pg_temp'
    ) THEN 'not_empty'
    WHEN EXISTS (
      SELECT 1 FROM pg_class AS relation
      JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
      WHERE ns.nspname = 'public' AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ) THEN 'not_empty'
    WHEN EXISTS (
      SELECT 1 FROM pg_proc AS routine
      JOIN pg_namespace AS ns ON ns.oid = routine.pronamespace
      WHERE ns.nspname = 'public'
    ) THEN 'not_empty'
    WHEN EXISTS (
      SELECT 1 FROM pg_type AS custom_type
      JOIN pg_namespace AS ns ON ns.oid = custom_type.typnamespace
      WHERE ns.nspname = 'public' AND custom_type.typtype <> 'p'
    ) THEN 'not_empty'
    ELSE 'empty'
  END;`;
}

async function restore({ serviceFile, serviceName, projectName, targetDatabase, inputPath }) {
  const slug = rehearsalSlug(projectName);
  targetDatabaseForSlug(targetDatabase, slug);
  const service = await loadLocalService(serviceFile, serviceName, slug);
  const input = await resolvePrivateRegularFile(inputPath, "Backup input");
  if (!input.filePath.endsWith(".pcsbackup")) fail("Backup input path must end in .pcsbackup.");

  const stagingDirectory = await mkdtemp(join(input.parent, ".pc-supporter-pg-restore-"));
  await chmod(stagingDirectory, 0o700);
  try {
    const { manifest, payloadPath } = await extractBundle(input.filePath, stagingDirectory);
    runPostgresTool("pg_restore", ["--list", payloadPath], childEnvironment(service.filePath));

    const connection = connectionInfo(serviceName, targetDatabase);
    const targetState = runPostgresTool("psql", [
      "--dbname", connection,
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      "--command", emptyDatabaseQuery(targetDatabase)
    ], childEnvironment(service.filePath), { captureStdout: true });
    if (targetState !== "empty") fail("Restore target is not the explicitly named empty rehearsal database.");

    runPostgresTool("pg_restore", [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      `--dbname=${connection}`,
      payloadPath
    ], childEnvironment(service.filePath));
    process.stdout.write(`${JSON.stringify({ ok: true, operation: "restore", project: projectName, service: serviceName, targetDatabase, sourceProject: manifest.source.project, sourceDatabase: manifest.source.database })}\n`);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.operation === "backup") await backup(options);
  else await restore(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof OperationsError ? error.message : "PostgreSQL rehearsal operation failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

export {
  BUNDLE_MAGIC,
  emptyDatabaseQuery,
  extractBundle,
  parseArgs,
  parseServiceFileContents,
  rehearsalSlug,
  targetDatabaseForSlug
};
