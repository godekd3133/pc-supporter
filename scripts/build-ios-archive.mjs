import "dotenv/config";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const teamId = (process.env.APPLE_TEAM_ID ?? "").trim();
if (!/^[A-Z0-9]{10}$/.test(teamId)) {
  console.error("APPLE_TEAM_ID must be the 10-character Apple Developer Team ID for automatic signing.");
  process.exit(1);
}

execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:mobile"], { stdio: "inherit" });

const iosProjectDir = resolve("ios/App");
const archivePath = resolve(iosProjectDir, "App.xcarchive");
const exportPath = resolve(iosProjectDir, "output");
const exportOptionsPath = resolve(iosProjectDir, "archive-options.plist");
writeFileSync(exportOptionsPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>method</key>
<string>app-store-connect</string>
<key>signingStyle</key>
<string>automatic</string>
<key>teamID</key>
<string>${teamId}</string>
</dict>
</plist>
`);

try {
  execFileSync("xcodebuild", [
    "-project",
    "App.xcodeproj",
    "-scheme",
    "App",
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    archivePath,
    "archive",
    "-configuration",
    "Release",
    `DEVELOPMENT_TEAM=${teamId}`,
    "-allowProvisioningUpdates",
    "-allowProvisioningDeviceRegistration"
  ], { cwd: iosProjectDir, stdio: "inherit" });
  execFileSync("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archivePath,
    "-exportPath",
    exportPath,
    "-exportOptionsPlist",
    exportOptionsPath,
    "-allowProvisioningUpdates"
  ], { cwd: iosProjectDir, stdio: "inherit" });
} finally {
  rmSync(exportOptionsPath, { force: true });
  rmSync(archivePath, { force: true, recursive: true });
}
