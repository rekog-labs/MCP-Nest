import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  MCP_STRATEGY,
  McpStrategy,
  McpTransport,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';

export {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
  StdioTransport,
} from '@rekog/mcp-nest';

export interface BootstrapMcpConfig {
  controllers: ModuleMetadata['controllers'];
  providers?: ModuleMetadata['providers'];
  imports?: ModuleMetadata['imports'];
  /** Defaults to a stateful streamable-HTTP transport. */
  transports?: McpTransport[];
  name?: string;
  version?: string;
  allowUnauthenticatedAccess?: boolean;
  /** Extra MCP server capabilities merged with the auto-derived ones. */
  capabilities?: Record<string, unknown>;
  serverMutator?: (server: any) => any;
  /**
   * Hook to configure the app after the microservice is connected but BEFORE
   * `startAllMicroservices()` / `listen()`. Use it for app-level setup such as
   * `app.enableCors(...)` or `app.use(cookieParser())`. Authentication should
   * NOT go here — mount the MCP route as an `McpHttpControllerFor` controller
   * and protect it with a `@UseGuards()` guard (passed via `controllers` /
   * `providers`) instead.
   */
  configure?: (app: INestApplication) => void | Promise<void>;
}

/**
 * Bootstraps a hybrid NestJS app wired with an {@link McpStrategy} for tests.
 * Returns the app, the chosen HTTP port, and the strategy instance.
 */
export async function bootstrapMcpApp(
  config: BootstrapMcpConfig,
): Promise<{ app: INestApplication; port: number; strategy: McpStrategy }> {
  const strategy = new McpStrategy({
    name: config.name ?? 'test-mcp-server',
    version: config.version ?? '0.0.1',
    allowUnauthenticatedAccess: config.allowUnauthenticatedAccess,
    ...('capabilities' in config ? { capabilities: config.capabilities } : {}),
    serverMutator: config.serverMutator,
    transports: config.transports ?? [
      new StreamableHttpTransport({ statefulMode: true }),
    ],
  });

  const moduleFixture = await Test.createTestingModule({
    imports: config.imports ?? [],
    controllers: config.controllers,
    providers: [
      ...(config.providers ?? []),
      { provide: MCP_STRATEGY, useValue: strategy },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  if (config.configure) {
    await config.configure(app);
  }
  await app.startAllMicroservices();
  await app.listen(0);
  const port = (app.getHttpServer().address() as { port: number }).port;
  return { app, port, strategy };
}

/**
 * The two protocol revisions one endpoint serves. Feature suites run under
 * `describe.each(ERAS)` so every behavior is asserted on both.
 *
 * The two eras take genuinely different server-side paths — modern traffic is
 * routed to `createMcpHandler`, legacy traffic to the pre-existing wiring — so
 * a feature can work on one and break on the other. Unlike `e2e/`, both clients
 * here are the SAME package; only `versionNegotiation` differs.
 */
export const ERAS = ['legacy', 'modern'] as const;
export type Era = (typeof ERAS)[number];

/**
 * Written out literally on purpose. The SDK's `LATEST_PROTOCOL_VERSION` is
 * `2025-11-25` (the newest *legacy* revision); the modern revision string is
 * not exported.
 */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/**
 * Creates and connects a new MCP (Model Context Protocol) client using Streamable HTTP for testing
 *
 * @param port - The port number to connect to on localhost
 * @param options - Optional configuration options for the streamable HTTP client
 * @returns A connected MCP Client instance
 * @example
 * ```ts
 * const client = await createStreamableMCPClient(3000, {
 *   requestInit: {
 *     headers: {
 *       'any-header': 'any-value'
 *     }
 *   }
 * });
 * ```
 */
export async function createStreamableClient(
  port: number,
  options: {
    endpoint?: string;
    requestInit?: RequestInit;
    /** Defaults to `legacy`, which is also the SDK client's own default. */
    era?: Era;
  } = {},
): Promise<Client> {
  const endpoint = options.endpoint || '/mcp';
  const era = options.era ?? 'legacy';
  const client = new Client(
    { name: 'example-client', version: '1.0.0' },
    {
      capabilities: {},
      // Pinned, not `mode: 'auto'`: `auto` probes and silently falls back to
      // `initialize`, so a server that lost its modern leg would still pass.
      ...(era === 'modern'
        ? {
            versionNegotiation: {
              mode: { pin: MODERN_PROTOCOL_VERSION },
            } as const,
          }
        : {}),
    },
  );
  const url = new URL(`http://localhost:${port}${endpoint}`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: options.requestInit,
  });
  await client.connect(transport);
  return client;
}

/**
 * A client pinned to the modern revision (`2026-07-28`) — no probe, no legacy
 * fallback, so a missing modern leg fails loudly instead of passing.
 */
export async function createModernClient(
  port: number,
  options: { endpoint?: string; requestInit?: RequestInit } = {},
): Promise<Client> {
  return createStreamableClient(port, { ...options, era: 'modern' });
}

/** Era-parameterised client, for `describe.each(ERAS)` suites. */
export async function createEraClient(
  era: Era,
  port: number,
  options: { endpoint?: string; requestInit?: RequestInit } = {},
): Promise<Client> {
  return createStreamableClient(port, { ...options, era });
}

/**
 * Creates and connects a new MCP (Model Context Protocol) client using STDIO for testing
 *
 * @param serverScriptPath - The path to the server script to run.
 * @param options - Optional configuration options for the stdio client transport.
 * @returns A connected MCP Client instance
 * @example
 * ```ts
 * const client = await createStdioClient('path/to/server.ts');
 * ```
 */
export async function createStdioClient(options: {
  serverScriptPath: string;
}): Promise<Client> {
  const client = new Client(
    { name: 'example-stdio-client', version: '1.0.0' },
    {
      capabilities: {},
    },
  );

  const isBun = !!process.versions.bun;
  const transport = new StdioClientTransport({
    command: isBun ? 'bun' : 'ts-node-dev',
    args: isBun
      ? ['run', options.serverScriptPath!]
      : ['--respawn', options.serverScriptPath!],
  });

  await client.connect(transport);
  return client;
}

/**
 * Creates and connects a new MCP client using Streamable HTTP with elicitation capabilities for testing
 *
 * @param port - The port number to connect to on localhost
 * @param options - Optional configuration options for the streamable HTTP client
 * @returns A connected MCP Client instance with elicitation support
 */
export async function createStreamableClientWithElicitation(
  port: number,
  options: {
    endpoint?: string;
    requestInit?: RequestInit;
  } = {},
): Promise<Client> {
  const endpoint = options.endpoint || '/mcp';
  const client = new Client(
    { name: 'example-client-elicitation', version: '1.0.0' },
    {
      capabilities: {
        elicitation: {},
      },
    },
  );

  // Set up elicit request handler
  client.setRequestHandler('elicitation/create', (params) => ({
    action: 'accept',
    content: {
      surname: params.params.message.includes('name')
        ? 'TestSurname'
        : undefined,
    },
  }));

  const url = new URL(`http://localhost:${port}${endpoint}`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: options.requestInit,
  });
  await client.connect(transport);
  return client;
}
