import { McpServer } from "@modelcontextprotocol/server";

/**
 * Instrumentation is the canonical use of `serverMutator`: wrap the server so
 * every request the strategy dispatches (tool calls, resource reads, prompt
 * gets) is observed. The mutator runs *before* the strategy installs its
 * decorator-tool handlers via `server.server.setRequestHandler(...)`, so
 * wrapping that seam here lets us trace the decorator tools too.
 *
 * This is the dependency-free shape of what `Sentry.wrapMcpServerWithSentry`
 * does — see the note at the bottom of this file for the real Sentry drop-in.
 */
export const tracingMutator = (server: McpServer): McpServer => {
  const lowLevel = server.server;
  const originalSetRequestHandler = lowLevel.setRequestHandler.bind(lowLevel);

  lowLevel.setRequestHandler = ((schema: unknown, handler: (req: any, extra: any) => unknown) => {
    const instrumented = async (request: any, extra: any) => {
      const span = request?.params?.name ?? request?.method ?? 'unknown';
      const start = Date.now();
      try {
        const result = await handler(request, extra);
        console.log(`[trace] ${request?.method} ${span} ok ${Date.now() - start}ms`);
        return result;
      } catch (err) {
        console.log(`[trace] ${request?.method} ${span} error ${Date.now() - start}ms`);
        throw err;
      }
    };
    return originalSetRequestHandler(schema as any, instrumented as any);
  }) as typeof lowLevel.setRequestHandler;

  return server;
};

/**
 * A second, tiny instrumentation mutator to demonstrate composition. It bumps a
 * counter every time a tool-call handler is installed (once per session).
 */
export const loggingMutator = (server: McpServer): McpServer => {
  console.log('[audit] mcp server session created');
  return server;
};

/**
 * Mutators are just `(server) => server`, so compose them by threading the
 * result through each in turn (or use `reduce`).
 */
export const combinedMutator = (server: McpServer): McpServer =>
  [tracingMutator, loggingMutator].reduce((s, mutate) => mutate(s), server);

/*
 * Real-world drop-in with Sentry — same shape, backed by real spans:
 *
 *   import * as Sentry from '@sentry/node';
 *   Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });
 *   export const sentryMutator = (server: McpServer): McpServer =>
 *     Sentry.wrapMcpServerWithSentry(server, {
 *       recordInputs: true,
 *       recordOutputs: true,
 *     });
 *
 * `wrapMcpServerWithSentry` captures spans for tool executions, resource
 * access, and client connections. Requires @sentry/node >= 9.46.0.
 */
