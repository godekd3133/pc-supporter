import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const previewPort = process.env.PREVIEW_PORT ?? "4184";
const apiPort = process.env.PREVIEW_API_PORT ?? process.env.PORT ?? "4174";
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? `http://127.0.0.1:${apiPort}`;
const crawlOnStart = process.env.DANAWA_CRAWL_ON_START ?? "false";

try {
  await access("dist/index.html", constants.F_OK);
} catch {
  console.error("production preview를 시작하려면 먼저 npm run build를 실행해 주세요.");
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  const children = [
    spawn(npmCommand, ["run", "start"], {
      env: { ...process.env, PORT: apiPort, DANAWA_CRAWL_ON_START: crawlOnStart },
      stdio: "inherit"
    }),
    spawn(npmCommand, ["run", "preview", "--", "--port", previewPort], {
      env: { ...process.env, VITE_API_PROXY_TARGET: apiTarget },
      stdio: "inherit"
    })
  ];

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    children.forEach((child) => {
      if (child.exitCode === null) child.kill(signal);
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  const exitCode = await new Promise((resolve) => {
    children.forEach((child) => child.once("exit", (code, signal) => {
      if (!shuttingDown) {
        shuttingDown = true;
        children.filter((other) => other !== child).forEach((other) => {
          if (other.exitCode === null) other.kill("SIGTERM");
        });
      }
      resolve(signal ? 1 : code ?? 1);
    }));
  });
  process.exitCode = exitCode;
}
