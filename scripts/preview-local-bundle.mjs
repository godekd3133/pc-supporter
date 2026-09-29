import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const dataDirectory = resolve(process.cwd(), "dist-local", "data");
const manifestPath = resolve(dataDirectory, "catalog-bundle-manifest.json");
for (const path of [resolve(dataDirectory, "catalog.json"), resolve(dataDirectory, "accessories.json"), manifestPath]) {
  await access(path);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
console.log(JSON.stringify({
  status: manifest.coverage?.status ?? "unknown",
  core: manifest.coverage?.core,
  accessories: manifest.coverage?.accessories,
  dataDirectory
}, null, 2));
if (manifest.coverage?.status !== "complete") {
  console.warn("Bundled catalog data is partial. Check dist/catalog-data/manifest.json before treating the catalog as complete.");
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["run", "preview:full"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "",
    PC_SUPPORTER_DATA_DIR: dataDirectory,
    PRICE_REFRESH_SCHEDULER_ENABLED: "false",
    BUILD_MONITOR_SCHEDULER_ENABLED: "false",
    DANAWA_CRAWL_SCHEDULER_ENABLED: "false",
    DANAWA_CRAWL_ON_START: "false"
  },
  stdio: "inherit"
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child.exitCode === null) child.kill(signal);
  });
}
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (!shuttingDown && signal) process.exitCode = 1;
  else process.exitCode = code ?? 0;
});
