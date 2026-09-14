/**
 * Multi Round-Trip Requests (MRTR) — protocol revision `2026-07-28`.
 *
 * Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
 *
 * A handler returns `inputRequired({ inputRequests, requestState })` instead of
 * pushing a server→client request. On `2026-07-28` the client fulfils the
 * embedded requests and retries the SAME call (new id) with `inputResponses`
 * and a byte-exact echo of `requestState`; the handler reads them back through
 * `McpContext`. On the legacy era the SDK's shim turns the embedded requests
 * into real 2025-style server→client requests and re-enters the handler, so a
 * handler written once serves both eras — which is what the `describe.each`
 * block below proves.
 *
 * The raw-POST block asserts the wire shape (the SDK client papers over it).
 */
import { Controller, Injectable } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  createRequestStateCodec,
  inputRequired,
  McpContext,
  McpController,
  Prompt,
  Resource,
  Tool,
} from '@rekog/mcp-nest';
import {
  bootstrapMcpApp,
  ERAS,
  Era,
  MODERN_PROTOCOL_VERSION as MODERN,
  StreamableHttpTransport,
} from './utils';

// ---------------------------------------------------------------------------
// Server under test
// ---------------------------------------------------------------------------

type DeployState = { step: 'confirm'; env: string };

const codec = createRequestStateCodec<DeployState>({
  key: 'test-key-that-is-at-least-32-bytes-long!',
  ttlSeconds: 60,
});

const CONFIRM_SCHEMA = {
  type: 'object' as const,
  properties: { confirm: { type: 'boolean' as const } },
  required: ['confirm'],
};

@Injectable()
@Controller()
@McpController()
class MrtrCapabilities {
  /**
   * The canonical write-once flow: ask for confirmation, keep asking until the
   * user actually confirms (spec: a server SHOULD re-request missing input
   * rather than error), then do the work. State rides in a signed
   * `requestState`; the handler reads it back verified and decoded.
   */
  @Tool({
    name: 'deploy',
    description: 'Deploys after a confirmation',
    parameters: z.object({ env: z.string() }),
  })
  async deploy(@Payload() { env }: { env: string }, @Ctx() ctx: McpContext) {
    const state = ctx.getRequestState<DeployState>();
    const confirmed = ctx.getAcceptedContent(
      'confirm',
      z.object({ confirm: z.boolean() }),
    );
    if (!confirmed?.confirm) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `Deploy to ${env}?`,
            requestedSchema: CONFIRM_SCHEMA,
          }),
        },
        requestState: await codec.mint({ step: 'confirm', env }),
      });
    }
    return {
      content: [
        { type: 'text', text: `deployed to ${state?.env ?? env} (state ok)` },
      ],
    };
  }

  /** Sampling via MRTR — `getInputResponse()` discriminates the response kind. */
  @Tool({
    name: 'capital',
    description: 'Asks the client model a question',
    parameters: z.object({ country: z.string() }),
  })
  async capital(
    @Payload() { country }: { country: string },
    @Ctx() ctx: McpContext,
  ) {
    const answer = ctx.getInputResponse('answer');
    if (answer.kind !== 'sampling') {
      return inputRequired({
        inputRequests: {
          answer: inputRequired.createMessage({
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: `Capital of ${country}?` },
              },
            ],
            maxTokens: 20,
          }),
        },
      });
    }
    const content = answer.result.content as { type: string; text?: string };
    return { content: [{ type: 'text', text: `answer: ${content.text}` }] };
  }

  /** Surfaces what the SDK dropped from a malformed `inputResponses`. */
  @Tool({
    name: 'report-dropped',
    description: 'Reports dropped input response keys',
    parameters: z.object({}),
  })
  async reportDropped(@Payload() _a: unknown, @Ctx() ctx: McpContext) {
    if (ctx.getRequestState() === undefined) {
      return inputRequired({ requestState: await codec.mint({ step: 'confirm', env: 'x' }) });
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            dropped: ctx.getDroppedInputResponseKeys(),
            kept: Object.keys(ctx.getInputResponses() ?? {}),
            missing: ctx.getInputResponse('nope').kind,
          }),
        },
      ],
    };
  }

  /** An `input_required` result must bypass `outputSchema` validation. */
  @Tool({
    name: 'typed-needs-input',
    description: 'Declares an outputSchema but asks for input first',
    parameters: z.object({}),
    outputSchema: z.object({ answer: z.string() }),
  })
  typedNeedsInput() {
    return inputRequired({ requestState: 'opaque' });
  }

  /** Never satisfied — for the legacy shim's `maxRounds` cap. */
  @Tool({
    name: 'insatiable',
    description: 'Always asks for more',
    parameters: z.object({}),
  })
  insatiable() {
    return inputRequired({
      inputRequests: {
        more: inputRequired.elicit({
          message: 'more?',
          requestedSchema: CONFIRM_SCHEMA,
        }),
      },
    });
  }

  /** Hand-built and invalid: neither `inputRequests` nor `requestState`. */
  @Tool({
    name: 'malformed',
    description: 'Returns an invalid input_required result',
    parameters: z.object({}),
  })
  malformed() {
    return { resultType: 'input_required' } as any;
  }

  @Resource({ uri: 'mcp://vault', name: 'vault', mimeType: 'text/plain' })
  async vault(@Payload() _a: unknown, @Ctx() ctx: McpContext) {
    const key = ctx.getAcceptedContent<{ passphrase: string }>('unlock');
    if (!key) {
      return inputRequired({
        inputRequests: {
          unlock: inputRequired.elicit({
            message: 'Passphrase?',
            requestedSchema: {
              type: 'object',
              properties: { passphrase: { type: 'string' } },
              required: ['passphrase'],
            },
          }),
        },
      });
    }
    return {
      contents: [
        {
          uri: 'mcp://vault',
          mimeType: 'text/plain',
          text: `unlocked with ${key.passphrase}`,
        },
      ],
    };
  }

  @Prompt({ name: 'interview', description: 'Asks for a topic first' })
  async interview(@Payload() _a: unknown, @Ctx() ctx: McpContext) {
    const topic = ctx.getAcceptedContent<{ topic: string }>('topic');
    if (!topic) {
      return inputRequired({
        inputRequests: {
          topic: inputRequired.elicit({
            message: 'Topic?',
            requestedSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
            },
          }),
        },
      });
    }
    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Tell me about ${topic.topic}` },
        },
      ],
    };
  }
}

/** Reads `requestState` raw — for the server without a verify hook. */
@Injectable()
@Controller()
@McpController()
class RawStateCapabilities {
  @Tool({
    name: 'raw-state',
    description: 'Echoes the raw requestState',
    parameters: z.object({}),
  })
  rawState(@Payload() _a: unknown, @Ctx() ctx: McpContext) {
    const state = ctx.getRequestState<string>();
    if (state === undefined) {
      return inputRequired({ requestState: 'round-1' });
    }
    return { content: [{ type: 'text', text: `raw:${state}:${typeof state}` }] };
  }

  @Tool({
    name: 'ask',
    description: 'Asks via elicitation',
    parameters: z.object({}),
  })
  ask(@Payload() _a: unknown, @Ctx() ctx: McpContext) {
    if (ctx.getInputResponse('who').kind === 'missing') {
      return inputRequired({
        inputRequests: {
          who: inputRequired.elicit({
            message: 'who?',
            requestedSchema: CONFIRM_SCHEMA,
          }),
        },
      });
    }
    return { content: [{ type: 'text', text: 'answered' }] };
  }
}

// ---------------------------------------------------------------------------
// Boot: one verified + stateful server, one raw + stateless server
// ---------------------------------------------------------------------------

let app: any;
let port: number;
let rawApp: any;
let rawPort: number;

beforeAll(async () => {
  const boot = await bootstrapMcpApp({
    controllers: [MrtrCapabilities],
    transports: [new StreamableHttpTransport({ statefulMode: true })],
    requestState: { verify: codec.verify },
    inputRequired: { maxRounds: 3 },
  });
  app = boot.app;
  port = boot.port;

  const rawBoot = await bootstrapMcpApp({
    controllers: [RawStateCapabilities],
    transports: [new StreamableHttpTransport({ statefulMode: false })],
  });
  rawApp = rawBoot.app;
  rawPort = rawBoot.port;
});

afterAll(async () => {
  await app?.close();
  await rawApp?.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function rawPost(
  p: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://localhost:${p}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const envelope = (capabilities: Record<string, unknown> = {}) => ({
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientCapabilities': capabilities,
  'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '1' },
});

const headers = (method: string, name?: string) => ({
  'MCP-Protocol-Version': MODERN,
  'Mcp-Method': method,
  ...(name ? { 'Mcp-Name': name } : {}),
});

let nextId = 100;

/** `tools/call` on the modern wire, with optional retry material. */
function callTool(
  p: number,
  name: string,
  args: Record<string, unknown>,
  retry: { requestState?: string; inputResponses?: Record<string, unknown> } = {},
  capabilities: Record<string, unknown> = { elicitation: {} },
) {
  return rawPost(
    p,
    {
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name, arguments: args, _meta: envelope(capabilities), ...retry },
    },
    headers('tools/call', name),
  );
}

/** An SDK client on either era that can answer elicitation and sampling. */
async function createInteractiveClient(
  era: Era,
  p: number,
  answers: {
    elicit?: (message: string) => Record<string, unknown>;
    sample?: () => string;
  } = {},
): Promise<Client> {
  const client = new Client(
    { name: `mrtr-${era}-client`, version: '1.0.0' },
    {
      capabilities: { elicitation: {}, sampling: {} },
      ...(era === 'modern'
        ? { versionNegotiation: { mode: { pin: MODERN } } as const }
        : {}),
    },
  );
  client.setRequestHandler('elicitation/create', (req) => ({
    action: 'accept',
    content: answers.elicit?.((req.params as { message: string }).message) ?? {
      confirm: true,
    },
  }));
  client.setRequestHandler('sampling/createMessage', () => ({
    role: 'assistant',
    content: { type: 'text', text: answers.sample?.() ?? 'Paris' },
    model: 'test-model',
  }));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://localhost:${p}/mcp`)),
  );
  return client;
}

// ---------------------------------------------------------------------------
// Wire shape on 2026-07-28
// ---------------------------------------------------------------------------

describe('MRTR — 2026-07-28 wire', () => {
  it('round 1 answers input_required with the embedded request and a signed state', async () => {
    const { status, json } = await callTool(port, 'deploy', { env: 'prod' });
    expect(status).toBe(200);
    expect(json.result.resultType).toBe('input_required');
    expect(json.result.content).toBeUndefined();
    expect(json.result.inputRequests.confirm.method).toBe('elicitation/create');
    expect(json.result.inputRequests.confirm.params.message).toBe(
      'Deploy to prod?',
    );
    expect(json.result.requestState).toStartWith('v1.');
  });

  it('round 2 completes: the handler reads inputResponses and the verified state', async () => {
    const r1 = await callTool(port, 'deploy', { env: 'prod' });
    const r2 = await callTool(port, 'deploy', { env: 'prod' }, {
      requestState: r1.json.result.requestState,
      inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
    });
    expect(r2.status).toBe(200);
    expect(r2.json.result.resultType).toBe('complete');
    expect(r2.json.result.content[0].text).toBe('deployed to prod (state ok)');
  });

  it('asks again when the user declines (SHOULD re-request, not error)', async () => {
    const r1 = await callTool(port, 'deploy', { env: 'prod' });
    const r2 = await callTool(port, 'deploy', { env: 'prod' }, {
      requestState: r1.json.result.requestState,
      inputResponses: { confirm: { action: 'decline' } },
    });
    expect(r2.json.result.resultType).toBe('input_required');
    expect(r2.json.result.inputRequests.confirm).toBeDefined();
    // A schema-invalid accept reads the same way as a decline.
    const r3 = await callTool(port, 'deploy', { env: 'prod' }, {
      requestState: r1.json.result.requestState,
      inputResponses: { confirm: { action: 'accept', content: { confirm: 'yes' } } },
    });
    expect(r3.json.result.resultType).toBe('input_required');
  });

  it('rejects a tampered requestState with -32602 before the handler runs', async () => {
    const r1 = await callTool(port, 'deploy', { env: 'prod' });
    const r2 = await callTool(port, 'deploy', { env: 'prod' }, {
      requestState: r1.json.result.requestState + 'x',
      inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
    });
    expect(r2.json.error.code).toBe(-32602);
    expect(r2.json.error.message).toBe('Invalid or expired requestState');
    expect(r2.json.error.data.reason).toBe('invalid_request_state');
  });

  it('refuses an input request for a capability the client did not declare', async () => {
    const { status, json } = await callTool(port, 'deploy', { env: 'prod' }, {}, {});
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32021);
    expect(json.error.message).toContain("Cannot request input 'confirm'");
  });

  it('surfaces dropped (non-bare) inputResponses entries to the handler', async () => {
    const r1 = await callTool(port, 'report-dropped', {});
    const r2 = await callTool(port, 'report-dropped', {}, {
      requestState: r1.json.result.requestState,
      inputResponses: {
        good: { action: 'accept', content: {} },
        wrapped: { method: 'elicitation/create', result: { action: 'accept' } },
      },
    });
    expect(JSON.parse(r2.json.result.content[0].text)).toEqual({
      dropped: ['wrapped'],
      kept: ['good'],
      missing: 'missing',
    });
  });

  it('passes an input_required result through untouched even when the tool declares an outputSchema', async () => {
    const { json } = await callTool(port, 'typed-needs-input', {});
    expect(json.result.resultType).toBe('input_required');
    expect(json.result.requestState).toBe('opaque');
    expect(json.result.structuredContent).toBeUndefined();
    expect(json.result.content).toBeUndefined();
  });

  it('answers a hand-built result with neither inputRequests nor requestState with -32603', async () => {
    const { json } = await callTool(port, 'malformed', {});
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain('neither inputRequests nor requestState');
  });

  it('hands the raw wire string to the handler when no verify hook is configured', async () => {
    const r1 = await callTool(rawPort, 'raw-state', {});
    expect(r1.json.result.requestState).toBe('round-1');
    const r2 = await callTool(rawPort, 'raw-state', {}, { requestState: 'round-1' });
    expect(r2.json.result.content[0].text).toBe('raw:round-1:string');
  });

  it('serves MRTR on resources/read', async () => {
    const read = (retry: Record<string, unknown> = {}) =>
      rawPost(
        port,
        {
          jsonrpc: '2.0',
          id: nextId++,
          method: 'resources/read',
          params: { uri: 'mcp://vault', _meta: envelope({ elicitation: {} }), ...retry },
        },
        headers('resources/read', 'mcp://vault'),
      );
    const r1 = await read();
    expect(r1.json.result.resultType).toBe('input_required');
    expect(r1.json.result.inputRequests.unlock.method).toBe('elicitation/create');
    const r2 = await read({
      inputResponses: { unlock: { action: 'accept', content: { passphrase: 'sesame' } } },
    });
    expect(r2.json.result.contents[0].text).toBe('unlocked with sesame');
  });

  it('serves MRTR on prompts/get', async () => {
    const get = (retry: Record<string, unknown> = {}) =>
      rawPost(
        port,
        {
          jsonrpc: '2.0',
          id: nextId++,
          method: 'prompts/get',
          params: { name: 'interview', _meta: envelope({ elicitation: {} }), ...retry },
        },
        headers('prompts/get', 'interview'),
      );
    const r1 = await get();
    expect(r1.json.result.resultType).toBe('input_required');
    const r2 = await get({
      inputResponses: { topic: { action: 'accept', content: { topic: 'MCP' } } },
    });
    expect(r2.json.result.messages[0].content.text).toBe('Tell me about MCP');
  });
});

// ---------------------------------------------------------------------------
// One handler, both eras, through the SDK client
// ---------------------------------------------------------------------------

describe.each(ERAS)('MRTR — SDK client (%s era)', (era) => {
  it('completes a tools/call round trip', async () => {
    const client = await createInteractiveClient(era, port);
    try {
      const result: any = await client.callTool({
        name: 'deploy',
        arguments: { env: 'staging' },
      });
      expect(result.content[0].text).toBe('deployed to staging (state ok)');
    } finally {
      await client.close();
    }
  });

  it('completes a sampling round trip', async () => {
    const client = await createInteractiveClient(era, port, {
      sample: () => 'Paris',
    });
    try {
      const result: any = await client.callTool({
        name: 'capital',
        arguments: { country: 'France' },
      });
      expect(result.content[0].text).toBe('answer: Paris');
    } finally {
      await client.close();
    }
  });

  it('completes a resources/read round trip', async () => {
    const client = await createInteractiveClient(era, port, {
      elicit: () => ({ passphrase: 'sesame' }),
    });
    try {
      const result: any = await client.readResource({ uri: 'mcp://vault' });
      expect(result.contents[0].text).toBe('unlocked with sesame');
    } finally {
      await client.close();
    }
  });

  it('completes a prompts/get round trip', async () => {
    const client = await createInteractiveClient(era, port, {
      elicit: () => ({ topic: 'MCP' }),
    });
    try {
      const result: any = await client.getPrompt({ name: 'interview' });
      expect(result.messages[0].content.text).toBe('Tell me about MCP');
    } finally {
      await client.close();
    }
  });

  it('keeps re-asking while the answer is a decline, then completes', async () => {
    let asked = 0;
    const client = await createInteractiveClient(era, port, {
      elicit: () => ({ confirm: ++asked >= 2 }),
    });
    try {
      const result: any = await client.callTool({
        name: 'deploy',
        arguments: { env: 'qa' },
      });
      expect(asked).toBe(2);
      expect(result.content[0].text).toBe('deployed to qa (state ok)');
    } finally {
      await client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Legacy-era specifics: the shim's cap, and stateless serving
// ---------------------------------------------------------------------------

describe('MRTR — legacy era specifics', () => {
  it('stops the shim after inputRequired.maxRounds and returns isError', async () => {
    const client = await createInteractiveClient('legacy', port);
    try {
      const result: any = await client.callTool({ name: 'insatiable', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('after 3 rounds');
    } finally {
      await client.close();
    }
  });

  it('fails clearly on a stateless legacy connection, which cannot receive server→client requests', async () => {
    const client = await createInteractiveClient('legacy', rawPort);
    try {
      const result: any = await client.callTool({ name: 'ask', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot request input 'who'");
    } finally {
      await client.close();
    }
  });
});
