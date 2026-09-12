import "dotenv/config";
import { execFileSync } from "node:child_process";

const rawApiBaseUrl = (process.env.VITE_API_BASE_URL ?? "").trim();
if (!rawApiBaseUrl) {
  console.error("VITE_API_BASE_URL is required for a native build. Set it to the HTTPS API origin used by the mobile app.");
  process.exit(1);
}

let apiBaseUrl;
try {
  apiBaseUrl = new URL(rawApiBaseUrl);
} catch {
  console.error("VITE_API_BASE_URL must be an absolute HTTP(S) URL.");
  process.exit(1);
}

if (!['http:', 'https:'].includes(apiBaseUrl.protocol) || apiBaseUrl.username || apiBaseUrl.password) {
  console.error("VITE_API_BASE_URL must use HTTP(S) without embedded credentials.");
  process.exit(1);
}

if (apiBaseUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "10.0.2.2"].includes(apiBaseUrl.hostname)) {
  console.error("A non-local native build requires an HTTPS VITE_API_BASE_URL.");
  process.exit(1);
}

console.log(`Building mobile web assets for ${apiBaseUrl.origin}`);
const mobileBuildDirectory = "dist-mobile";
const mobileBuildEnvironment = {
  ...process.env,
  PC_SUPPORTER_BUILD_OUT_DIR: mobileBuildDirectory,
  CAPACITOR_WEB_DIR: mobileBuildDirectory
};
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { env: mobileBuildEnvironment, stdio: "inherit" });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "cap", "sync"], { env: mobileBuildEnvironment, stdio: "inherit" });
