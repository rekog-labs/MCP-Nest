/**
 * Benchmark server: `@rekog/mcp-nest` v2, stateful `StreamableHttpTransport`
 * (session-managed via the `mcp-session-id` header).
 *
 * See `./v2-app.ts` for the shared Nest module/controller/tool wiring; this
 * file only picks the transport mode.
 *
 * Note: unlike the stateless servers, a bare `tools/call`/`tools/list` POST
 * (no prior `initialize`) is rejected by the SDK's stateful transport — a
 * session must be established first via `initialize`, which returns an
 * `mcp-session-id` response header that must be replayed on subsequent
 * requests. The bench harness therefore drives this server with the
 * `sdk-client-loop` driver (see bench/types.ts) rather than bare autocannon
 * requests.
 */
import 'reflect-metadata';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { bootstrap } from './v2-app';

const mcp = new McpStrategy({
  name: 'perf-bench',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ statefulMode: true })],
});

void bootstrap(mcp);
