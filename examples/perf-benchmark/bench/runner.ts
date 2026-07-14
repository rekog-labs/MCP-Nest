import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getServer } from './servers.config';
import { SCENARIOS, CONCURRENCIES, WARMUP_SEC, DURATION_SEC } from './scenarios';
import { runSmokeCheck } from './smoke-check';
import { startServer, resolveServerPids } from './process-utils';
import { runScenarioAgainstServer } from './run-scenario';
import { generateReport } from './report';
import {
  BenchRunFile,
  ScenarioRunResult,
  ServerId,
  SmokeCheckResult,
} from './types';

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'results', 'logs');
const RESULTS_DIR = path.join(ROOT, 'results');

interface CliOptions {
  quick: boolean;
  scenarioFilter?: string;
  serverFilter?: ServerId;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { quick: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quick') {
      opts.quick = true;
    } else if (arg === '--scenario') {
      opts.scenarioFilter = argv[++i];
    } else if (arg === '--server') {
      opts.serverFilter = argv[++i] as ServerId;
    }
  }
  return opts;
}

function readPackageVersion(pkgJsonPath: string): string {
  try {
    const raw = fs.readFileSync(pkgJsonPath, 'utf8');
    const json = JSON.parse(raw);
    return json.version ?? 'unknown';
  } catch {
    return 'n/a';
  }
}

function buildMeta() {
  const cpuList = os.cpus();
  const cpus =
    cpuList.length > 0 ? `${cpuList[0].model} x${cpuList.length}` : 'unknown';

  return {
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpus,
    mcpNestV2Version: readPackageVersion(
      path.join(ROOT, 'node_modules', '@rekog', 'mcp-nest', 'package.json'),
    ),
    mcpNestV1Version: readPackageVersion(
      path.join(
        ROOT,
        'v1-baseline',
        'node_modules',
        '@rekog',
        'mcp-nest',
        'package.json',
      ),
    ),
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const durationSec = opts.quick ? 5 : DURATION_SEC;
  const warmupSec = opts.quick ? 2 : WARMUP_SEC;
  const concurrencies = opts.quick ? [1, 10] : CONCURRENCIES;

  console.log('[runner] running smoke check ...');
  const smokeResults = await runSmokeCheck();
  const smokeByServer = new Map<ServerId, SmokeCheckResult>(
    smokeResults.map((r) => [r.serverId, r]),
  );

  const scenarios = SCENARIOS.filter(
    (s) => !opts.scenarioFilter || s.id === opts.scenarioFilter,
  );

  const runs: ScenarioRunResult[] = [];

  for (const scenario of scenarios) {
    const serverIds = scenario.servers.filter(
      (id) => !opts.serverFilter || id === opts.serverFilter,
    );

    for (const serverId of serverIds) {
      const spec = getServer(serverId);
      const toolCount = scenario.toolCountOverride ?? 50;

      const smoke = smokeByServer.get(serverId);
      const driver =
        scenario.driver === 'autocannon' && smoke && !smoke.supportsBareCall
          ? 'sdk-client-loop'
          : scenario.driver;

      console.log(
        `[runner] booting ${serverId} for ${scenario.id} (toolCount=${toolCount}, driver=${driver}) ...`,
      );
      const started = await startServer(spec, {
        toolCount,
        logDir: LOG_DIR,
      });

      try {
        const serverPids = await resolveServerPids(started.pid);

        for (const concurrency of concurrencies) {
          console.log(
            `[runner] ${serverId} / ${scenario.id} / c=${concurrency} - warming up ${warmupSec}s, measuring ${durationSec}s ...`,
          );
          const result = await runScenarioAgainstServer(
            spec,
            scenario,
            concurrency,
            serverPids,
            { warmupSec, durationSec, driver },
          );
          runs.push(result);
          console.log(
            `[runner] ${serverId} / ${scenario.id} / c=${concurrency} -> ${result.requests.average.toFixed(
              1,
            )} req/s, p99=${result.latencyMs.p99.toFixed(1)}ms, errors=${result.errors}, cpu=${result.cpuPercentAvg.toFixed(
              1,
            )}%, rssPeak=${result.rssPeakMB.toFixed(1)}MB`,
          );
        }
      } finally {
        console.log(`[runner] stopping ${serverId} ...`);
        await started.kill();
      }
    }
  }

  const benchRun: BenchRunFile = {
    meta: buildMeta(),
    smokeCheck: smokeResults,
    runs,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `results-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(benchRun, null, 2));
  console.log(`[runner] wrote ${outPath}`);

  await generateReport(outPath);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
