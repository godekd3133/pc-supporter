import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  executePostgresRuntimeRoleBootstrap,
  parseCanonicalRuntimeTableNames,
  quotePostgresIdentifier,
  quotePostgresPasswordLiteral,
  runtimeRoleProvisioningSql,
  readRuntimeBootstrapConfig,
  runPostgresRuntimeRoleBootstrap
} from "./bootstrap-postgres-runtime-role.mjs";

const schemaPath = resolve(process.cwd(), "db/schema.sql");

describe("PostgreSQL runtime-role bootstrap", () => {
  it("derives only canonical app tables and keeps the schema ledger separate", async () => {
    const schemaSql = await readFile(schemaPath, "utf8");
    const tables = parseCanonicalRuntimeTableNames(schemaSql);

    expect(tables.appTables).toContain("catalog_parts");
    expect(tables.appTables).toContain("saved_builds");
    expect(tables.appTables).not.toContain("pc_supporter_schema_revision");
    expect(tables.revisionTable).toBe("pc_supporter_schema_revision");
    expect(new Set(tables.appTables).size).toBe(tables.appTables.length);
  });

  it("fails closed if only the runtime URL exists and validates role/password inputs", () => {
    expect(() => readRuntimeBootstrapConfig({ DATABASE_URL: "postgres://runtime@db/app" })).toThrow(/DATABASE_MIGRATION_URL/);
    expect(() => readRuntimeBootstrapConfig({
      DATABASE_MIGRATION_URL: "postgres://owner@db/app",
      DATABASE_RUNTIME_ROLE: "runtime;drop-owned-schema",
      DATABASE_RUNTIME_PASSWORD: "x".repeat(40)
    })).toThrow(/DATABASE_RUNTIME_ROLE/);
    expect(() => readRuntimeBootstrapConfig({
      DATABASE_MIGRATION_URL: "postgres://owner@db/app",
      DATABASE_RUNTIME_ROLE: "pcsupporter_runtime",
      DATABASE_RUNTIME_PASSWORD: "short"
    })).toThrow(/DATABASE_RUNTIME_PASSWORD/);
  });

  it("quotes SQL identifiers and password literals without allowing statement injection", () => {
    expect(quotePostgresIdentifier('runtime"role')).toBe('"runtime""role"');
    expect(quotePostgresPasswordLiteral(`${"p".repeat(32)}'\\; SELECT 1 --`)).toContain("''");
    expect(() => quotePostgresIdentifier("runtime\u0000role")).toThrow(/identifier/);
  });

  it("replays an already-checked non-superuser role without altering superuser-only attributes", () => {
    const existingRoleSql = runtimeRoleProvisioningSql('"pcsupporter_runtime"', "'runtime-password'", true);
    expect(existingRoleSql).toBe('ALTER ROLE "pcsupporter_runtime" WITH LOGIN INHERIT PASSWORD \'runtime-password\'');
    expect(existingRoleSql).not.toMatch(/NOSUPERUSER|NOCREATEDB|NOCREATEROLE|NOREPLICATION|NOBYPASSRLS/);

    const createRoleSql = runtimeRoleProvisioningSql('"pcsupporter_runtime"', "'runtime-password'", false);
    expect(createRoleSql).toContain("WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  });

  it("connects using the migration URL only and never echoes credentials on failure", async () => {
    const ownerUrl = "postgresql://schema-owner:owner-secret@127.0.0.1:5432/pcsupporter";
    const runtimeUrl = "postgresql://runtime:runtime-secret@127.0.0.1:5432/pcsupporter";
    const createPool = vi.fn(() => { throw new Error(`connection failed for ${ownerUrl} and ${runtimeUrl}`); });
    const stderr = [];
    const exitCode = await runPostgresRuntimeRoleBootstrap({
      env: {
        DATABASE_MIGRATION_URL: ownerUrl,
        DATABASE_URL: runtimeUrl,
        DATABASE_RUNTIME_ROLE: "pcsupporter_runtime",
        DATABASE_RUNTIME_PASSWORD: "r".repeat(48)
      },
      readCanonicalSchema: async () => Buffer.from("CREATE TABLE IF NOT EXISTS example_app_table (id TEXT);\nCREATE TABLE IF NOT EXISTS pc_supporter_schema_revision (singleton_id TEXT);")
        .toString("utf8"),
      createPool,
      writeStdout: vi.fn(),
      writeStderr: (text) => stderr.push(text)
    });

    expect(exitCode).toBe(1);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith(ownerUrl);
    expect(stderr.join("")).not.toContain("owner-secret");
    expect(stderr.join("")).not.toContain("runtime-secret");
    expect(stderr.join("")).toContain("connection could not be created");
  });

  it("rejects unsupported table declarations instead of granting from a partial parse", () => {
    expect(() => parseCanonicalRuntimeTableNames(`
CREATE TABLE app_records (id TEXT);
CREATE TABLE IF NOT EXISTS pc_supporter_schema_revision (singleton_id TEXT);
`)).toThrow(/not safe/);
  });
});
