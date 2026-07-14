import * as fs from 'node:fs';
import * as path from 'node:path';
import { BenchRunFile, ScenarioRunResult, ServerId } from './types';

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'results');

function findLatestResultsFile(): string {
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => /^results-.*\.json$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error(`No results-*.json files found in ${RESULTS_DIR}`);
  }
  return path.join(RESULTS_DIR, files[files.length - 1]);
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

function pctDelta(candidate: number, baseline: number): string {
  if (!Number.isFinite(baseline) || baseline === 0) return 'n/a';
  const delta = ((candidate - baseline) / baseline) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function groupKey(r: ScenarioRunResult): string {
  return `${r.scenarioId}|c=${r.concurrency}`;
}

export function buildReportMarkdown(data: BenchRunFile): string {
  const lines: string[] = [];
  lines.push('# Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${data.meta.generatedAt}`);
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push(`- Node: ${data.meta.nodeVersion}`);
  lines.push(`- Platform: ${data.meta.platform}/${data.meta.arch}`);
  lines.push(`- CPU: ${data.meta.cpus}`);
  lines.push(`- @rekog/mcp-nest v2: ${data.meta.mcpNestV2Version}`);
  lines.push(`- @rekog/mcp-nest v1: ${data.meta.mcpNestV1Version}`);
  lines.push('');

  lines.push('## Smoke Check');
  lines.push('');
  lines.push('| Server | Supports Bare Call | Driver Used | Note |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of data.smokeCheck) {
    lines.push(
      `| ${s.serverId} | ${s.supportsBareCall} | ${s.driverUsed} | ${
        s.note ?? ''
      } |`,
    );
  }
  lines.push('');

  lines.push('## Scenario Results');
  lines.push('');

  const groups = new Map<string, ScenarioRunResult[]>();
  for (const run of data.runs) {
    const key = groupKey(run);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(run);
  }

  const sortedKeys = Array.from(groups.keys()).sort();

  for (const key of sortedKeys) {
    const [scenarioId, cPart] = key.split('|');
    const runs = groups.get(key)!;
    const driversInGroup = new Set(runs.map((r) => r.driver));
    const nonComparable = driversInGroup.size > 1;

    lines.push(`### ${scenarioId} (${cPart})`);
    lines.push('');
    if (nonComparable) {
      lines.push(
        '> NOTE: servers in this group used different drivers (autocannon vs sdk-client-loop) - req/s and latency are NOT directly comparable across drivers.',
      );
      lines.push('');
    }

    lines.push(
      '| Server | Driver | Req/s | p50 (ms) | p99 (ms) | CPU % | Peak RSS (MB) | Errors | non-2xx |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    let hasInvalidRow = false;
    for (const r of runs) {
      // A run where most responses were non-2xx is measuring error replies,
      // not real work (e.g. v1 rejects >100kb bodies with HTTP 413) — flag it.
      const invalid = r.non2xx > 0 && r.non2xx >= r.requests.total * 0.5;
      if (invalid) hasInvalidRow = true;
      const flag = invalid ? ' ⚠️' : '';
      lines.push(
        `| ${r.serverId}${flag} | ${r.driver} | ${fmt(r.requests.average)} | ${fmt(
          r.latencyMs.p50,
        )} | ${fmt(r.latencyMs.p99)} | ${fmt(r.cpuPercentAvg)} | ${fmt(
          r.rssPeakMB,
        )} | ${r.errors} | ${r.non2xx} |`,
      );
    }
    lines.push('');
    if (hasInvalidRow) {
      lines.push(
        '> ⚠️ = the flagged server returned mostly non-2xx (error) responses for this cell, so its req/s reflects fast rejections, NOT completed tool calls — not comparable.',
      );
      lines.push('');
    }

    const byServer = new Map<ServerId, ScenarioRunResult>(
      runs.map((r) => [r.serverId, r]),
    );
    const v2 = byServer.get('v2-stateless');
    const rawSdk = byServer.get('raw-sdk-stateless');
    const rawSdkNest = byServer.get('raw-sdk-nest');
    const v1 = byServer.get('v1-stateless');

    if (v2 && (rawSdk || rawSdkNest || v1)) {
      lines.push('**Deltas (v2-stateless vs baseline)**');
      lines.push('');
      lines.push('| Comparison | Req/s delta | p99 delta | Comparable? |');
      lines.push('| --- | --- | --- | --- |');
      if (rawSdk) {
        const comparable = v2.driver === rawSdk.driver;
        lines.push(
          `| v2-stateless vs raw-sdk-stateless | ${pctDelta(
            v2.requests.average,
            rawSdk.requests.average,
          )} | ${pctDelta(v2.latencyMs.p99, rawSdk.latencyMs.p99)} | ${
            comparable ? 'yes' : 'NO (different drivers)'
          } |`,
        );
      }
      if (rawSdkNest) {
        const comparable = v2.driver === rawSdkNest.driver;
        lines.push(
          `| v2-stateless vs raw-sdk-nest | ${pctDelta(
            v2.requests.average,
            rawSdkNest.requests.average,
          )} | ${pctDelta(v2.latencyMs.p99, rawSdkNest.latencyMs.p99)} | ${
            comparable ? 'yes' : 'NO (different drivers)'
          } |`,
        );
      }
      if (v1) {
        const comparable = v2.driver === v1.driver;
        lines.push(
          `| v2-stateless vs v1-stateless | ${pctDelta(
            v2.requests.average,
            v1.requests.average,
          )} | ${pctDelta(v2.latencyMs.p99, v1.latencyMs.p99)} | ${
            comparable ? 'yes' : 'NO (different drivers)'
          } |`,
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function generateReport(resultsFilePath?: string): Promise<void> {
  const filePath = resultsFilePath ?? findLatestResultsFile();
  const raw = fs.readFileSync(filePath, 'utf8');
  const data: BenchRunFile = JSON.parse(raw);

  const markdown = buildReportMarkdown(data);
  const outPath = path.join(RESULTS_DIR, 'report.md');
  fs.writeFileSync(outPath, markdown);

  console.log(markdown);
  console.log(`\n[report] wrote ${outPath}`);
}

if (require.main === module) {
  const arg = process.argv[2];
  generateReport(arg ? path.resolve(arg) : undefined).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
