import * as fs from 'node:fs';
import * as path from 'node:path';
import { startServer } from './process-utils';
import { runAutocannon } from './run-scenario';
import { SCENARIOS } from './scenarios';
import { ServerSpec } from './types';

const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, 'results', 'profiles');
const LOG_DIR = path.join(ROOT, 'results', 'logs');
const PORT = 4001;
const CONCURRENCY = 10;
const DURATION_SEC = 15;

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const before = new Set(
    fs.existsSync(PROFILE_DIR) ? fs.readdirSync(PROFILE_DIR) : [],
  );

  const spec: ServerSpec = {
    id: 'v2-stateless',
    label: '@rekog/mcp-nest v2 (stateless) [CPU profiling]',
    cwd: ROOT,
    command: 'node',
    args: [
      '--cpu-prof',
      `--cpu-prof-dir=${PROFILE_DIR}`,
      '--require',
      'ts-node/register/transpile-only',
      'servers/v2-stateless.ts',
    ],
    port: PORT,
    endpoint: '/mcp',
    env: { TS_NODE_TRANSPILE_ONLY: '1' },
  };

  console.log('[profile] booting v2-stateless with --cpu-prof ...');
  const started = await startServer(spec, { toolCount: 50, logDir: LOG_DIR });

  const scenario = SCENARIOS.find((s) => s.id === 'S1-echo')!;
  const url = `http://127.0.0.1:${PORT}${spec.endpoint}`;
  const body = scenario.bodyFactory();

  console.log(
    `[profile] driving S1-echo at c=${CONCURRENCY} for ${DURATION_SEC}s ...`,
  );
  await runAutocannon(url, body, CONCURRENCY, DURATION_SEC);

  console.log(
    '[profile] stopping server with SIGTERM (the .cpuprofile only flushes on a clean exit; SIGKILL would lose it) ...',
  );
  await started.kill();

  // Give the filesystem a brief moment in case the exit handler was still
  // flushing when waitForPortRelease resolved.
  await new Promise((r) => setTimeout(r, 500));

  const after = fs.existsSync(PROFILE_DIR) ? fs.readdirSync(PROFILE_DIR) : [];
  const newFiles = after.filter((f) => !before.has(f) && f.endsWith('.cpuprofile'));

  if (newFiles.length === 0) {
    console.warn(
      `[profile] WARNING: no new .cpuprofile file found in ${PROFILE_DIR}. The process may have been force-killed before it could flush.`,
    );
    return;
  }

  for (const f of newFiles) {
    console.log(`[profile] wrote ${path.join(PROFILE_DIR, f)}`);
  }
  console.log(
    '[profile] open the .cpuprofile file with Chrome DevTools (Performance tab -> Load profile) or https://www.speedscope.app/',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
