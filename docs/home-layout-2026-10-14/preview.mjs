// Isolated local preview; starter catalog is demonstration data, not live pricing.
import { ensureEmbeddedPostgres } from '../../scripts/ensure-embedded-postgres.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const scratch = await ensureEmbeddedPostgres(`pcsupporter_home_preview_${process.pid}`);
const dataDir = await mkdtemp(join(tmpdir(), 'pcsupporter-home-preview-'));
const api = spawn('node', ['--import', 'tsx', 'server/index.ts'], {stdio:'inherit', env:{...process.env, DATABASE_URL:scratch.url, PORT:'4194', SERVER_HOST:'127.0.0.1', PC_SUPPORTER_DATA_DIR:dataDir, PC_SUPPORTER_PROCESS_ROLE:'api', DANAWA_CRAWL_ON_START:'false', DANAWA_CRAWL_SCHEDULER_ENABLED:'false', PRICE_REFRESH_SCHEDULER_ENABLED:'false', BUILD_MONITOR_SCHEDULER_ENABLED:'false', NODE_ENV:'test'}});
const web = spawn('node', ['node_modules/vite/bin/vite.js', '--host','127.0.0.1','--port','5175','--strictPort'], {stdio:'inherit', env:{...process.env,VITE_API_PROXY_TARGET:'http://127.0.0.1:4194',VITE_API_BASE_URL:''}});
let closing = false;
async function close() { if(closing) return; closing=true; api.kill('SIGTERM'); web.kill('SIGTERM'); await new Promise(r=>setTimeout(r,500)); await scratch.stop(); process.exit(0); }
process.on('SIGINT',close); process.on('SIGTERM',close);
