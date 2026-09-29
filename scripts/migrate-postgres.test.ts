import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executePostgresMigrationCommand, runPostgresMigrationCommand } from "./migrate-postgres";

describe("db:migrate command contract", () => {
  it("requires DATABASE_MIGRATION_URL and never falls back to runtime DATABASE_URL", async () => {
    let createPoolCalls = 0;
    await expect(executePostgresMigrationCommand([], {
      env: { DATABASE_URL: "postgres://runtime-only.invalid/app" },
      readCanonicalSchema: async () => readFile(resolve(process.cwd(), "db/schema.sql")),
      createPool: () => { createPoolCalls += 1; throw new Error("must not connect"); }
    })).rejects.toThrow(/DATABASE_MIGRATION_URL/);
    expect(createPoolCalls).toBe(0);
  });

  it("checks the canonical schema checksum before creating a pool", async () => {
    let createPoolCalls = 0;
    await expect(executePostgresMigrationCommand([], {
      env: { DATABASE_MIGRATION_URL: "postgres://migration.invalid/schema-owner" },
      readCanonicalSchema: async () => Buffer.from("different canonical schema"),
      createPool: () => { createPoolCalls += 1; throw new Error("must not connect"); }
    })).rejects.toThrow(/checksum does not match/);
    expect(createPoolCalls).toBe(0);
  });

  it("passes only DATABASE_MIGRATION_URL to the pool and sanitizes failures", async () => {
    const migrationUrl = "postgres://migration-user:migration-secret@127.0.0.1:55570/pcsupporter";
    const runtimeUrl = "postgres://runtime-user:runtime-secret@127.0.0.1:55570/pcsupporter";
    const poolUrls: string[] = [];
    await expect(executePostgresMigrationCommand([], {
      env: { DATABASE_URL: runtimeUrl, DATABASE_MIGRATION_URL: migrationUrl },
      readCanonicalSchema: async () => readFile(resolve(process.cwd(), "db/schema.sql")),
      createPool: (connectionString) => {
        poolUrls.push(connectionString);
        throw new Error(`simulated pool failure ${connectionString}`);
      }
    })).rejects.toThrow(/connection pool could not be created/);

    expect(poolUrls).toEqual([migrationUrl]);
    expect(poolUrls.join()).not.toContain(runtimeUrl);
    expect(poolUrls.join()).not.toContain("runtime-secret");

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runPostgresMigrationCommand([], {
      env: { DATABASE_URL: runtimeUrl },
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text)
    });
    expect(exitCode).toBe(1);
    expect(stdout.join()).not.toContain(runtimeUrl);
    expect(stderr.join()).not.toContain(runtimeUrl);
    expect(stderr.join()).not.toContain("runtime-secret");
  });

});
