/**
 * Shared contract between the benchmark servers and the bench harness.
 *
 * Server contract (every server script MUST satisfy):
 * - Reads PORT from process.env.PORT, listens on 127.0.0.1:PORT.
 * - Reads TOOL_COUNT from process.env.TOOL_COUNT (default 50): registers the
 *   decorator-based `echo` tool + (TOOL_COUNT - 1) synthetic tools generated
 *   from the shared tool factory.
 * - MCP endpoint is `/mcp`.
 * - Readiness: responds to any HTTP request on GET /mcp (any status incl. 405).
 * - Prints exactly one line `MCP server started on port <PORT>` to stdout.
 * - NODE_ENV=production is set by the runner; Nest servers pass `logger: false`.
 * - Terminates on SIGTERM (default behavior is fine).
 */

export type ServerId =
  | 'v2-stateless'
  | 'v2-stateful'
  | 'raw-sdk-stateless'
  | 'raw-sdk-nest'
  | 'v1-stateless';

export type Driver = 'autocannon' | 'sdk-client-loop';

export interface ServerSpec {
  id: ServerId;
  label: string;
  /** Working directory to spawn from (v1 uses v1-baseline/, others the project root). */
  cwd: string;
  command: string;
  args: string[];
  port: number;
  endpoint: string; // '/mcp' for all servers
  env?: Record<string, string>;
}

export interface ScenarioSpec {
  id: string; // 'S1-echo', 'S2-list-n50', ...
  description: string;
  method: 'tools/call' | 'tools/list';
  /** Builds the JSON-RPC request body for this scenario. */
  bodyFactory: () => Record<string, unknown>;
  /** If set, the server is booted with TOOL_COUNT=<value> for this scenario (default 50). */
  toolCountOverride?: number;
  /** Which servers this scenario runs against. */
  servers: ServerId[];
  /** 'sdk-client-loop' only for stateful S4 (and smoke-check fallback). */
  driver: Driver;
}

export interface ScenarioRunResult {
  serverId: ServerId;
  scenarioId: string;
  driver: Driver;
  concurrency: number;
  durationSec: number;
  requests: {
    total: number;
    average: number; // req/s
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
  rssBeforeMB: number;
  rssAfterMB: number;
  rssPeakMB: number;
  cpuPercentAvg: number;
  startedAt: string; // ISO timestamp
}

export interface SmokeCheckResult {
  serverId: ServerId;
  supportsBareCall: boolean;
  driverUsed: Driver;
  note?: string;
}

export interface BenchRunFile {
  meta: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpus: string;
    mcpNestV2Version: string;
    mcpNestV1Version: string;
    generatedAt: string;
  };
  smokeCheck: SmokeCheckResult[];
  runs: ScenarioRunResult[];
}
