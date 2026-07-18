import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SERVERS } from './servers.config';
import { startServer } from './process-utils';
import { SmokeCheckResult, ServerSpec } from './types';

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'results', 'logs');
const EXPECTED_TOOL_COUNT = 50;

/** Parses either a plain JSON body or an SSE-formatted body (`event: ...\ndata: {...}`). */
function parseJsonRpcBody(text: string): any {
  const trimmed = text.trim();
  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const dataLine = trimmed
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('data:'));
    if (!dataLine) {
      throw new Error(`SSE body had no data: line:\n${text}`);
    }
    return JSON.parse(dataLine.slice('data:'.length).trim());
  }
  return JSON.parse(trimmed);
}

async function bareToolCall(
  url: string,
): Promise<{ ok: boolean; note?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'smoke' } },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, note: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = parseJsonRpcBody(text);
    if (json.error) {
      return { ok: false, note: `JSON-RPC error: ${JSON.stringify(json.error)}` };
    }
    if (!json.result) {
      return { ok: false, note: `No result field in response: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, note: `Request failed: ${(err as Error).message}` };
  }
}

async function checkToolsListCount(url: string): Promise<number> {
  const client = new Client({ name: 'smoke-check', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    return tools.tools.length;
  } finally {
    await client.close();
  }
}

export async function checkOneServer(spec: ServerSpec): Promise<SmokeCheckResult> {
  const url = `http://127.0.0.1:${spec.port}${spec.endpoint}`;
  const started = await startServer(spec, {
    toolCount: EXPECTED_TOOL_COUNT,
    logDir: LOG_DIR,
  });

  try {
    const bare = await bareToolCall(url);
    const supportsBareCall = bare.ok;
    const driverUsed = supportsBareCall ? 'autocannon' : 'sdk-client-loop';

    const isExpectedStatefulRejection =
      spec.id === 'v2-stateful' && !supportsBareCall;

    let note = bare.note;
    if (isExpectedStatefulRejection) {
      note = `expected: stateful server rejects bare calls without a session (${bare.note ?? ''})`.trim();
    } else if (!supportsBareCall) {
      note = `WARNING: ${spec.id} unexpectedly rejected a bare tools/call: ${bare.note}`;
    }

    let listCount = -1;
    let listError: string | undefined;
    try {
      listCount = await checkToolsListCount(url);
    } catch (err) {
      listError = (err as Error).message;
    }

    if (listCount !== EXPECTED_TOOL_COUNT) {
      const msg = `tools/list returned ${listCount} tools, expected ${EXPECTED_TOOL_COUNT}${
        listError ? ` (error: ${listError})` : ''
      }`;
      note = note ? `${note}; ${msg}` : msg;
      if (!isExpectedStatefulRejection) {
        console.error(`[smoke] FAIL ${spec.id}: ${msg}`);
      }
    }

    return {
      serverId: spec.id,
      supportsBareCall,
      driverUsed,
      note,
    };
  } finally {
    await started.kill();
  }
}

function checkDrift(): { ok: boolean; message: string } {
  const sharedPath = path.join(ROOT, 'tools', 'shared-tools.ts');
  const v1Path = path.join(ROOT, 'v1-baseline', 'src', 'shared-tools.ts');

  if (!fs.existsSync(v1Path)) {
    return {
      ok: true,
      message: `WARNING: ${v1Path} does not exist yet - skipping drift check`,
    };
  }
  if (!fs.existsSync(sharedPath)) {
    return {
      ok: true,
      message: `WARNING: ${sharedPath} does not exist yet - skipping drift check`,
    };
  }

  const a = fs.readFileSync(sharedPath);
  const b = fs.readFileSync(v1Path);
  if (Buffer.compare(a, b) === 0) {
    return { ok: true, message: 'tools/shared-tools.ts matches v1-baseline/src/shared-tools.ts (byte-identical)' };
  }
  return {
    ok: false,
    message: `DRIFT DETECTED: tools/shared-tools.ts and v1-baseline/src/shared-tools.ts differ!`,
  };
}

export async function runSmokeCheck(): Promise<SmokeCheckResult[]> {
  const results: SmokeCheckResult[] = [];
  for (const spec of SERVERS) {
    console.log(`[smoke] checking ${spec.id} ...`);
    const result = await checkOneServer(spec);
    results.push(result);
    console.log(
      `[smoke] ${spec.id}: supportsBareCall=${result.supportsBareCall} driverUsed=${result.driverUsed}${
        result.note ? ` note="${result.note}"` : ''
      }`,
    );
  }
  return results;
}

function printSummaryTable(results: SmokeCheckResult[]): void {
  const rows = results.map((r) => ({
    server: r.serverId,
    supportsBareCall: String(r.supportsBareCall),
    driverUsed: r.driverUsed,
    note: r.note ?? '',
  }));
  console.log('\n=== Smoke Check Summary ===');
  console.table(rows);
}

async function main() {
  const results = await runSmokeCheck();
  printSummaryTable(results);

  const drift = checkDrift();
  console.log(`\n[drift] ${drift.message}`);

  const unexpectedFailures = results.filter(
    (r) => !r.supportsBareCall && r.serverId !== 'v2-stateful',
  );

  if (!drift.ok || unexpectedFailures.length > 0) {
    console.error('\n[smoke] FAILED');
    process.exitCode = 1;
    return;
  }

  console.log('\n[smoke] OK');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
