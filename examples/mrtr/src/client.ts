/**
 * Drives the MRTR example server so you can watch the round trips.
 *
 *   npm run client -- --era modern           # auto-fulfilment (default)
 *   npm run client -- --era modern --manual  # hand-rolled retry loop, prints the wire
 *   npm run client -- --era legacy           # 2025-era client: the SDK shim does the rounds
 *
 * Env: MCP_URL (default http://localhost:3000/mcp), ENV (default staging).
 */
import { createInterface } from 'node:readline/promises';
import {
  Client,
  isInputRequiredResult,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { CallToolResult, InputRequiredResult } from '@modelcontextprotocol/client';

const args = process.argv.slice(2);
const era = args.includes('--era') ? args[args.indexOf('--era') + 1] : 'modern';
const manual = args.includes('--manual');
const url = process.env.MCP_URL ?? 'http://localhost:3000/mcp';
const env = process.env.ENV ?? 'staging';

// Interactive on a terminal; scriptable when piped (`printf 'y\nreason\n' | npm run client`):
// piped lines are read up front so none are lost before a question is asked.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const scripted: string[] | undefined = process.stdin.isTTY ? undefined : [];
const scriptedReady = scripted
  ? (async () => { for await (const line of rl) scripted.push(line); })()
  : Promise.resolve();
async function ask(q: string): Promise<string> {
  if (!scripted) return rl.question(`  ? ${q} `);
  await scriptedReady;
  const answer = scripted.shift() ?? '';
  console.log(`  ? ${q} ${answer}`);
  return answer;
}

type ElicitContent = Record<string, string | number | boolean | string[]>;

function log(label: string, value: unknown) {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(value, null, 2));
}

let active: Client | undefined;

async function connect(options: Record<string, unknown> = {}): Promise<Client> {
  const client = (active = new Client(
    { name: 'mrtr-example-client', version: '1.0.0' },
    {
      capabilities: { elicitation: {}, sampling: {}, roots: {} },
      versionNegotiation:
        era === 'modern' ? { mode: { pin: '2026-07-28' } } : { mode: 'legacy' },
      ...options,
    },
  ));
  // ONE set of handlers serves both eras. On 2026-07-28 the client's MRTR
  // driver dispatches the embedded requests through them; on 2025 they answer
  // real server→client requests.
  client.setRequestHandler('elicitation/create', async (req) => {
    const params = req.params as { message: string; requestedSchema: { properties: Record<string, unknown> } };
    log('elicitation/create ← server asks', params.message);
    const content: ElicitContent = {};
    for (const [key, schema] of Object.entries(params.requestedSchema.properties)) {
      const answer = await ask(`${key} (${(schema as { type: string }).type}):`);
      if (answer === '') return { action: 'decline' };
      content[key] = (schema as { type: string }).type === 'boolean' ? /^(y|yes|true)$/i.test(answer) : answer;
    }
    return { action: 'accept', content };
  });
  client.setRequestHandler('sampling/createMessage', async (req) => {
    const params = req.params as { messages: { content: { text?: string } }[] };
    log('sampling/createMessage ← server asks the model', params.messages[0]?.content?.text);
    const text = await ask('model answer:');
    return { role: 'assistant', content: { type: 'text', text }, model: 'you' };
  });
  client.setRequestHandler('roots/list', async () => ({
    roots: [{ uri: 'file:///workspace/example', name: 'example' }],
  }));
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  console.log(`connected (${era} era) to ${url}`);
  return client;
}

async function autoMode() {
  const client = await connect();
  const tool = await ask('tool to call [deploy|capital|list-roots|vault|interview]:');
  let result: unknown;
  switch (tool || 'deploy') {
    case 'capital':
      result = await client.callTool({ name: 'capital', arguments: { country: await ask('country:') } });
      break;
    case 'list-roots':
      result = await client.callTool({ name: 'list-roots', arguments: {} });
      break;
    case 'vault':
      result = await client.readResource({ uri: 'mcp://vault' });
      break;
    case 'interview':
      result = await client.getPrompt({ name: 'interview' });
      break;
    default:
      result = await client.callTool({ name: 'deploy', arguments: { env } });
  }
  log('final result', result);
  await client.close();
}

async function manualMode() {
  if (era !== 'modern') throw new Error('--manual shows the 2026-07-28 wire; use --era modern');
  // Manual mode: the client hands input_required results back to us, and WE
  // collect responses, echo requestState byte-exact, and retry on a new id.
  const client = await connect({ inputRequired: { autoFulfill: false } });
  let inputResponses: Record<string, unknown> | undefined;
  let requestState: string | undefined;
  for (let round = 1; round <= 10; round++) {
    const params = {
      name: 'deploy',
      arguments: { env },
      ...(inputResponses && { inputResponses }),
      ...(requestState && { requestState }),
    };
    log(`round ${round} → tools/call params`, params);
    const value = (await client.request(
      { method: 'tools/call', params },
      { allowInputRequired: true },
    )) as CallToolResult | InputRequiredResult;
    log(`round ${round} ← result`, value);
    if (!isInputRequiredResult(value)) break;
    inputResponses = {};
    for (const [key, entry] of Object.entries(value.inputRequests ?? {})) {
      const message = (entry.params as { message?: string }).message ?? entry.method;
      const answer = await ask(`${key} — ${message}`);
      const isBool = key === 'confirm';
      inputResponses[key] = answer === ''
        ? { action: 'decline' }
        : { action: 'accept', content: { [key]: isBool ? /^(y|yes|true)$/i.test(answer) : answer } };
    }
    requestState = value.requestState; // MUST be echoed unchanged; never parse it
  }
  await client.close();
}

(manual ? manualMode() : autoMode())
  .catch((err) => { console.error('\nERROR', err?.message ?? err); process.exitCode = 1; })
  .finally(async () => {
    rl.close();
    // A legacy session keeps a standing GET stream open; close it so the
    // process can exit even on the error path.
    await active?.close().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
