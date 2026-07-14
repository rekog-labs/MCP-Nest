/**
 * Benchmark server: `@rekog/mcp-nest` v2, stateless `StreamableHttpTransport`.
 *
 * See `./v2-app.ts` for the shared Nest module/controller/tool wiring; this
 * file only picks the transport mode.
 */
import 'reflect-metadata';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { bootstrap } from './v2-app';

const mcp = new McpStrategy({
  name: 'perf-bench',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
});

void bootstrap(mcp);
