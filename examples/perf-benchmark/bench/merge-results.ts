/**
 * Merges multiple results-*.json files (e.g. from per-server chunked runs of
 * `npm run bench -- --server <id>`) into a single BenchRunFile so report.ts
 * can build one comparison table.
 *
 * Usage:
 *   npx ts-node --transpile-only bench/merge-results.ts <file1> <file2> ...
 *   npx ts-node --transpile-only bench/merge-results.ts --all   # merge every results-*.json
 *
 * Writes results/results-merged-<ts>.json and prints its path.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BenchRunFile, ScenarioRunResult, SmokeCheckResult } from './types';

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'results');

function main(): void {
  let files = process.argv.slice(2);
  if (files[0] === '--all') {
    files = fs
      .readdirSync(RESULTS_DIR)
      .filter((f) => /^results-(?!merged).*\.json$/.test(f))
      .sort()
      .map((f) => path.join(RESULTS_DIR, f));
  } else {
    files = files.map((f) => path.resolve(f));
  }
  if (files.length === 0) {
    throw new Error('No results files given (or found with --all)');
  }

  const parts: BenchRunFile[] = files.map((f) =>
    JSON.parse(fs.readFileSync(f, 'utf8')),
  );

  // Latest smoke result per server wins; runs are de-duplicated by
  // (server, scenario, concurrency) with the LAST occurrence winning, so a
  // re-run chunk supersedes earlier data for the same cell.
  const smokeByServer = new Map<string, SmokeCheckResult>();
  const runsByKey = new Map<string, ScenarioRunResult>();
  for (const part of parts) {
    for (const s of part.smokeCheck) smokeByServer.set(s.serverId, s);
    for (const r of part.runs) {
      runsByKey.set(`${r.serverId}|${r.scenarioId}|${r.concurrency}`, r);
    }
  }

  const merged: BenchRunFile = {
    meta: {
      ...parts[parts.length - 1].meta,
      generatedAt: new Date().toISOString(),
    },
    smokeCheck: Array.from(smokeByServer.values()),
    runs: Array.from(runsByKey.values()),
  };

  const outPath = path.join(
    RESULTS_DIR,
    `results-merged-${merged.meta.generatedAt.replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(outPath);
}

main();
