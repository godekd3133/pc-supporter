import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const homebrewJavaHome = "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home";
if (existsSync(resolve(homebrewJavaHome, "bin/java"))) process.env.JAVA_HOME = homebrewJavaHome;

execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:mobile"], { stdio: "inherit" });
execFileSync(process.platform === "win32" ? "gradlew.bat" : "./gradlew", ["assembleDebug"], { cwd: resolve("android"), stdio: "inherit" });

const apkPath = resolve("android/app/build/outputs/apk/debug/app-debug.apk");
if (!existsSync(apkPath)) {
  console.error("Android debug build completed without producing app-debug.apk.");
  process.exit(1);
}
console.log(`Android debug APK: ${apkPath}`);
