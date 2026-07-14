/**
 * Benchmark server: raw `@modelcontextprotocol/sdk` hosted inside a NestJS
 * (Express) application — but with ZERO `@rekog/mcp-nest` code.
 *
 * Purpose: three-way decomposition of v2's overhead vs the bare SDK.
 *
 *   raw-sdk-stateless  (node:http + SDK)       -> baseline
 *   raw-sdk-nest       (Nest/Express + SDK)    -> + framework hosting tax
 *   v2-stateless       (Nest/Express + mcp-nest) -> + mcp-nest library tax
 *
 * The delta raw-sdk-stateless -> raw-sdk-nest is what NestJS/Express itself
 * costs; the delta raw-sdk-nest -> v2-stateless is what mcp-nest's own code
 * (HTTP adapter abstraction, strategy, Nest RPC dispatch of tool handlers)
 * costs.
 *
 * Faithfulness notes (mirrors how mcp-nest v2 actually integrates):
 * - mcp-nest self-mounts its POST /mcp route directly on the Express
 *   instance, BEFORE Nest's body-parser middleware, and reads the raw
 *   request stream itself (see packages/mcp-nest/src/mcp/transport/
 *   transports/read-body.ts). We do the same: `bodyParser: false` + a route
 *   mounted on the underlying Express app + manual stream read.
 * - The per-request MCP handling is identical to raw-sdk-stateless.ts:
 *   fresh McpServer + StreamableHTTPServerTransport per POST, handlers
 *   bound as closures over a bootstrap-time TOOL_DEFS registry, teardown on
 *   response finish.
 */
import 'reflect-metadata';
import * as http from 'node:http';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
  return new McpServer(
    { name: 'perf-bench', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } }, instructions: '' },
  );
}

function bindRequestHandlers(server: McpServer): void {
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

@Module({})
class AppModule {}

async function bootstrap() {
  const port = process.env.PORT ? Number(process.env.PORT) : 3030;
  const app = await NestFactory.create(AppModule, {
    logger: false,
    bodyParser: false, // mcp-nest's route never sees Nest's body-parser either
  });

  // Mount directly on the Express instance, mirroring mcp-nest's self-mount.
  const express = app.getHttpAdapter().getInstance();
  express.post(
    '/mcp',
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      handleMcpPost(req, res).catch((error: unknown) => {
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
    },
  );
  // Readiness contract: any HTTP response on GET /mcp (405 like the others).
  express.get('/mcp', (_req: unknown, res: http.ServerResponse) => {
    res.writeHead(405).end();
  });

  await app.listen(port, '127.0.0.1');
  console.log(`MCP server started on port ${port}`);
}

void bootstrap();
