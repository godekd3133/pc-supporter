#!/usr/bin/env node
/**
 * Precompile API/worker modules without collapsing imported CLI entry guards.
 * Keep npm crawl/crawl:accessories on their original TSX source entries: the
 * auxiliary bundle entries exist to move their side effects into shared chunks,
 * not to provide executable crawl launchers.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'server-runtime');
const entries = ['server/index.ts', 'server/crawler.ts', 'server/accessory-crawler.ts'];
const guardPattern = /if\s*\([^\n]*import\.meta\.url\s*===\s*`file:\/\/\$\{[^\n]+\}\`\)\s*\{/g;
for (const entry of entries) {
  const source = await readFile(resolve(root, entry), 'utf8');
  if ([...source.matchAll(guardPattern)].length !== 1) {
    throw new Error(`Expected one direct-entry CLI guard in ${entry}; review bundling before deployment.`);
  }
}
const result = await build({
  absWorkingDir: root,
  entryPoints: entries,
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  metafile: true,
  write: false,
  logLevel: 'warning'
});
const emitted = new Map(result.outputFiles.map(file => [relative(root, file.path).replaceAll('\\', '/'), file]));
const indexOutput = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint === 'server/index.ts');
if (!indexOutput) throw new Error('API entry output is missing.');
const [indexPath, indexMeta] = indexOutput;
const indexFile = emitted.get(indexPath);
if (!indexFile || [...indexFile.text.matchAll(guardPattern)].length !== 1) {
  throw new Error('API entry must retain exactly its own direct-entry guard.');
}
const crawlerGuardOutputs = [];
for (const crawler of entries.slice(1)) {
  const owners = Object.entries(result.metafile.outputs).filter(([, output]) => output.inputs[crawler]?.bytesInOutput > 0);
  if (owners.length !== 1 || owners[0][0] === indexPath || indexMeta.inputs[crawler]?.bytesInOutput > 0) {
    throw new Error(`${crawler} was merged into the API entry; its CLI may execute during API startup.`);
  }
  const [ownerPath] = owners[0];
  const owner = emitted.get(ownerPath);
  if (!owner || [...owner.text.matchAll(guardPattern)].length === 0 || result.metafile.outputs[ownerPath].entryPoint) {
    throw new Error(`${crawler} CLI guard must live in a shared chunk rather than any executable entry.`);
  }
  crawlerGuardOutputs.push({ source: crawler, output: ownerPath });
}
const guardTotal = result.outputFiles.reduce((total, file) => total + [...file.text.matchAll(guardPattern)].length, 0);
if (guardTotal !== entries.length) throw new Error(`Unexpected CLI guard count: ${guardTotal}; review all direct-entry side effects.`);
const outputs = result.outputFiles.map(file => ({
  path: relative(root, file.path).replaceAll('\\', '/'),
  bytes: file.contents.length,
  sha256: createHash('sha256').update(file.contents).digest('hex')
}));
await mkdir(outdir, { recursive: true });
for (const file of result.outputFiles) await writeFile(file.path, file.contents);
await writeFile(resolve(outdir, 'build-meta.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  target: 'node20',
  apiEntry: indexPath,
  workingDirectory: 'release root (contains package.json, dist, db and node_modules)',
  deployEntireDirectory: true,
  sourceCrawlerCommandsUnchanged: ['tsx server/crawler.ts', 'tsx server/accessory-crawler.ts'],
  auxiliaryEntriesAreNotCliLaunchers: true,
  crawlerGuardOutputs,
  outputs,
  metafile: result.metafile
}, null, 2) + '\n');
console.log(JSON.stringify({ event: 'server-runtime.build', status: 'ok', apiEntry: indexPath, files: outputs.length, bytes: outputs.reduce((sum, file) => sum + file.bytes, 0), cliGuards: guardTotal, crawlerGuardOutputs }));
