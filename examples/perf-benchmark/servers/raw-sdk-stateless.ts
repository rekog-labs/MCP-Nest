/**
 * Benchmark server: bare `@modelcontextprotocol/sdk`, no `@rekog/mcp-nest`,
 * no Nest, no Express — a plain `node:http` server.
 *
 * Rationale (deliberate methodological choice): this replicates, by hand,
 * exactly what mcp-nest does per stateless request so that comparing it
 * against `v2-stateless.ts` isolates the overhead of the mcp-nest + Nest
 * layers (DI, HTTP adapter abstraction, decorator/MessagePattern dispatch)
 * rather than architectural differences.
 *
 * What mcp-nest's stateless path does per POST (see
 * packages/mcp-nest/src/mcp/transport/transports/streamable-http.transport.ts
 * `handleStateless()` and packages/mcp-nest/src/mcp/transport/mcp.strategy.ts
 * `createServer()` / `bindRequestHandlers()`):
 *   1. create a fresh `McpServer` (capabilities computed from the registry)
 *   2. create a fresh `StreamableHTTPServerTransport`
 *      ({ sessionIdGenerator: undefined, enableJsonResponse: true })
 *   3. `server.connect(transport)`
 *   4. bind ListTools/CallTool request-handler closures over the
 *      PRE-BUILT tool registry (built once at bootstrap). The ListTools
 *      closure converts each tool's zod schema to JSON schema on EVERY call
 *      (uncached) — mirrored here with the very same SDK helpers
 *      (`normalizeObjectSchema` + `toJsonSchemaCompat`).
 *   5. tear both down when the HTTP response finishes
 *
 * Notably, mcp-nest does NOT rebuild zod schemas or re-register tools per
 * request — the registry is a bootstrap-time artifact — so this server
 * precomputes TOOL_DEFS at module load too.
 */
import * as http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { ZodObject, ZodRawShape } from 'zod';
import {
  ECHO_TOOL_DESCRIPTION,
  ECHO_TOOL_NAME,
  echoParameters,
  generateSyntheticTools,
  getToolCount,
  textResult,
} from '../tools/shared-tools';

interface ToolDef {
  name: string;
  description: string;
  parameters: ZodObject<ZodRawShape>;
  handler: (args: Record<string, unknown>) => { content: unknown[] };
}

// Built ONCE at bootstrap, exactly like mcp-nest's registry.
const TOOL_DEFS: ToolDef[] = [
  {
    name: ECHO_TOOL_NAME,
    description: ECHO_TOOL_DESCRIPTION,
    parameters: echoParameters as unknown as ZodObject<ZodRawShape>,
    handler: (args) => textResult(String(args.text)),
  },
  ...generateSyntheticTools(getToolCount()).map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters as unknown as ZodObject<ZodRawShape>,
    handler: () => textResult('ok'),
  })),
];

function createServer(): McpServer {
  // Mirrors McpStrategy#createServer(): fresh server, capabilities derived
  // from the (non-empty) tool registry.
  return new McpServer(
    { name: 'perf-bench', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } }, instructions: '' },
  );
}

function bindRequestHandlers(server: McpServer): void {
  // Mirrors McpStrategy#bindToolHandlers(): fresh closures per request over
  // the prebuilt registry; zod -> JSON schema conversion happens per
  // tools/list call, uncached, using the same SDK helpers mcp-nest uses.
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_DEFS.map((tool) => {
      const schema: Record<string, unknown> = {
        name: tool.name,
        description: tool.description,
      };
      const input = normalizeObjectSchema(tool.parameters);
      if (input) schema.inputSchema = toJsonSchemaCompat(input);
      return schema;
    }),
  }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOL_DEFS.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`,
      );
    }
    // Validate args against the zod schema, as the framework pipeline does.
    const args = tool.parameters.parse(request.params.arguments ?? {});
    return tool.handler(args as Record<string, unknown>);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer | string) => {
      data += chunk.toString();
    });
    req.on('end', () => {
      if (!data) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

async function handleMcpPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readJsonBody(req);

  // Per-request pattern, mirroring handleStateless().
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  bindRequestHandlers(server);

  res.on('finish', () => {
    void transport.close();
    void server.close();
  });

  await transport.handleRequest(req, res, body);
}

const httpServer = http.createServer((req, res) => {
  const url = req.url ?? '';
  const path = url.split('?')[0];

  if (path !== '/mcp') {
    res.writeHead(404).end();
    return;
  }

  if (req.method === 'POST') {
    handleMcpPost(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
      // eslint-disable-next-line no-console
      console.error('Error handling MCP request', error);
    });
    return;
  }

  // GET/DELETE (session management) are not supported in stateless mode —
  // mirrors mcp-nest's stateless behavior, and satisfies the readiness
  // contract (any status, including 405, on GET /mcp).
  res.writeHead(405).end();
});

const port = process.env.PORT ? Number(process.env.PORT) : 3030;
httpServer.listen(port, '127.0.0.1', () => {
  console.log(`MCP server started on port ${port}`);
});
