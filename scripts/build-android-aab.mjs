import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const homebrewJavaHome = "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home";
if (existsSync(resolve(homebrewJavaHome, "bin/java"))) process.env.JAVA_HOME = homebrewJavaHome;

execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:mobile"], { stdio: "inherit" });
execFileSync(process.platform === "win32" ? "gradlew.bat" : "./gradlew", ["bundleRelease"], { cwd: resolve("android"), stdio: "inherit" });

const aabPath = resolve("android/app/build/outputs/bundle/release/app-release.aab");
if (!existsSync(aabPath)) {
  console.error("Android release build completed without producing app-release.aab.");
  process.exit(1);
}
console.log(`Android unsigned AAB: ${aabPath}`);
