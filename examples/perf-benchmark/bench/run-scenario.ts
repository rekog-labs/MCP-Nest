import autocannon from 'autocannon';
import pidusage from 'pidusage';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ScenarioSpec, ScenarioRunResult, ServerSpec, Driver } from './types';

const PID_SAMPLE_INTERVAL_MS = 500;

interface DriverStats {
  requests: {
    total: number;
    average: number;
    p50: number;
    p90: number;
    p99: number;
    max: number;
  };
  latencyMs: {
    average: number;
    p50: number;
    p90: number;
    p99: number;
    max: number;
  };
  throughputBytesPerSec: number;
  errors: number;
  non2xx: number;
}

/**
 * Runs autocannon programmatically against `url` with a fixed JSON-RPC body.
 * Field mapping from autocannon's Result (see @types/autocannon):
 *  - requests.average/p50/p90/p99/max -> our requests.* (req/s distribution
 *    across autocannon's 1s sampling windows)
 *  - requests.total = total number of completed requests (2xx + non2xx)
 *  - latency.average/p50/p90/p99/max (ms) -> our latencyMs.*
 *  - throughput.average (bytes/sec) -> our throughputBytesPerSec
 *  - errors -> connection-level errors (incl. timeouts)
 *  - non2xx -> non-2xx HTTP responses
 */
export async function runAutocannon(
  url: string,
  body: Record<string, unknown>,
  concurrency: number,
  durationSec: number,
): Promise<DriverStats> {
  const bodyStr = JSON.stringify(body);
  const result = await autocannon({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: bodyStr,
    connections: concurrency,
    duration: durationSec,
  });

  return {
    requests: {
      total: result.requests.total,
      average: result.requests.average,
      p50: result.requests.p50,
      p90: result.requests.p90,
      p99: result.requests.p99,
      max: result.requests.max,
    },
    latencyMs: {
      average: result.latency.average,
      p50: result.latency.p50,
      p90: result.latency.p90,
      p99: result.latency.p99,
      max: result.latency.max,
    },
    throughputBytesPerSec: result.throughput.average,
    errors: result.errors,
    non2xx: result.non2xx,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

/**
 * Drives S4 (stateful) load: opens `concurrency` persistent SDK client
 * sessions against `url` (each performs its own initialize handshake), then
 * hammers `tools/call echo` on each client in a tight loop until the
 * deadline. Per-call latencies are recorded and reduced to the same
 * requests/latencyMs shape autocannon produces so results are comparable.
 */
export async function runSdkClientLoop(
  url: string,
  scenario: ScenarioSpec,
  concurrency: number,
  durationSec: number,
): Promise<DriverStats> {
  const body = scenario.bodyFactory() as {
    params: { name: string; arguments: Record<string, unknown> };
  };
  const toolName = body.params.name;
  const toolArgs = body.params.arguments;

  const clients: Client[] = [];
  for (let i = 0; i < concurrency; i++) {
    const client = new Client({ name: 'bench-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    clients.push(client);
  }

  const latencies: number[] = [];
  let errors = 0;
  let bytes = 0;
  const deadline = Date.now() + durationSec * 1000;

  const workers = clients.map(async (client) => {
    while (Date.now() < deadline) {
      const start = performance.now();
      try {
        const result = await client.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        bytes += Buffer.byteLength(JSON.stringify(result));
      } catch {
        errors++;
      }
    }
  });

  await Promise.all(workers);

  for (const client of clients) {
    try {
      await client.close();
    } catch {
      // ignore close errors
    }
  }

  latencies.sort((a, b) => a - b);
  const total = latencies.length;
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const avgLatency = total > 0 ? sum / total : 0;
  const actualDurationSec = durationSec;
  const reqPerSec = total / actualDurationSec;

  return {
    requests: {
      total,
      average: reqPerSec,
      p50: reqPerSec,
      p90: reqPerSec,
      p99: reqPerSec,
      max: reqPerSec,
    },
    latencyMs: {
      average: avgLatency,
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p99: percentile(latencies, 99),
      max: total > 0 ? latencies[total - 1] : 0,
    },
    throughputBytesPerSec: bytes / actualDurationSec,
    errors,
    non2xx: 0,
  };
}

interface PidSample {
  totalCpu: number;
  totalRssMB: number;
}

async function samplePids(pids: number[]): Promise<PidSample | null> {
  if (pids.length === 0) return null;
  try {
    const stats = await pidusage(pids);
    let totalCpu = 0;
    let totalRssBytes = 0;
    for (const pid of pids) {
      const s = stats[String(pid)];
      if (s) {
        totalCpu += s.cpu;
        totalRssBytes += s.memory;
      }
    }
    return { totalCpu, totalRssMB: totalRssBytes / (1024 * 1024) };
  } catch {
    return null;
  }
}

/**
 * Runs a warmup pass (discarded) followed by the measured pass for
 * `scenario` against `spec` at the given `concurrency`, sampling pidusage
 * over `serverPids` during the measured window.
 */
export async function runScenarioAgainstServer(
  spec: ServerSpec,
  scenario: ScenarioSpec,
  concurrency: number,
  serverPids: number[],
  opts: {
    warmupSec: number;
    durationSec: number;
    driver: Driver;
  },
): Promise<ScenarioRunResult> {
  const url = `http://127.0.0.1:${spec.port}${spec.endpoint}`;
  const body = scenario.bodyFactory();

  const drive = (durationSec: number) =>
    opts.driver === 'autocannon'
      ? runAutocannon(url, body, concurrency, durationSec)
      : runSdkClientLoop(url, scenario, concurrency, durationSec);

  // Warmup (discarded)
  if (opts.warmupSec > 0) {
    await drive(opts.warmupSec);
  }

  const before = await samplePids(serverPids);

  const samples: PidSample[] = [];
  const sampleTimer = setInterval(() => {
    samplePids(serverPids).then((s) => {
      if (s) samples.push(s);
    });
  }, PID_SAMPLE_INTERVAL_MS);

  const startedAt = new Date().toISOString();
  const stats = await drive(opts.durationSec);
  clearInterval(sampleTimer);

  const after = await samplePids(serverPids);

  const rssValues = [
    before?.totalRssMB ?? 0,
    ...samples.map((s) => s.totalRssMB),
    after?.totalRssMB ?? 0,
  ].filter((v) => v > 0);
  const cpuValues = samples.map((s) => s.totalCpu);

  const rssPeakMB = rssValues.length > 0 ? Math.max(...rssValues) : 0;
  const cpuPercentAvg =
    cpuValues.length > 0
      ? cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length
      : (before?.totalCpu ?? 0);

  return {
    serverId: spec.id,
    scenarioId: scenario.id,
    driver: opts.driver,
    concurrency,
    durationSec: opts.durationSec,
    requests: stats.requests,
    latencyMs: stats.latencyMs,
    throughputBytesPerSec: stats.throughputBytesPerSec,
    errors: stats.errors,
    non2xx: stats.non2xx,
    rssBeforeMB: before?.totalRssMB ?? 0,
    rssAfterMB: after?.totalRssMB ?? 0,
    rssPeakMB,
    cpuPercentAvg,
    startedAt,
  };
}
