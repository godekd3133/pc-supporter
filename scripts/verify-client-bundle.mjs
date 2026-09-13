import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const buildOutputDirectory = process.env.PC_SUPPORTER_BUILD_OUT_DIR?.trim() || "dist";
const distDirectory = join(process.cwd(), buildOutputDirectory, "assets");
const maxEntryBytes = 545_000;
const requiredDomainChunks = ["catalog-change-domain-", "saved-build-domain-", "purchase-domain-"];

const assetNames = await readdir(distDirectory);
const entryNames = assetNames.filter((name) => /^index-[^/]+\.js$/.test(name));
if (entryNames.length !== 1) {
  throw new Error(`클라이언트 entry chunk를 정확히 1개 찾을 수 없습니다: ${entryNames.join(", ") || "없음"}`);
}

const entryName = entryNames[0];
const entryBytes = (await stat(join(distDirectory, entryName))).size;
if (entryBytes > maxEntryBytes) {
  throw new Error(`클라이언트 entry가 ${maxEntryBytes}바이트 예산을 초과했습니다: ${entryName} = ${entryBytes}바이트`);
}

const missingDomainChunks = requiredDomainChunks.filter((prefix) => !assetNames.some((name) => name.startsWith(prefix) && name.endsWith(".js")));
if (missingDomainChunks.length > 0) {
  throw new Error(`필수 도메인 chunk가 생성되지 않았습니다: ${missingDomainChunks.join(", ")}`);
}

console.log(JSON.stringify({
  ok: true,
  entry: entryName,
  entryBytes,
  maxEntryBytes,
  requiredDomainChunks
}, null, 2));
