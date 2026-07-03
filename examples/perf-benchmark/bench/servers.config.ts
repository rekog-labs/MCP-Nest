import * as path from 'node:path';
import { ServerSpec } from './types';

const ROOT = path.resolve(__dirname, '..');

/**
 * Registry of benchmark servers. The runner boots them one at a time,
 * never concurrently. TOOL_COUNT is injected per scenario (default 50);
 * PORT and NODE_ENV=production are injected by the runner.
 */
export const SERVERS: ServerSpec[] = [
  {
    id: 'v2-stateless',
    label: '@rekog/mcp-nest v2 (stateless)',
    cwd: ROOT,
    command: 'npx',
    args: ['ts-node', '--transpile-only', 'servers/v2-stateless.ts'],
    port: 4001,
    endpoint: '/mcp',
  },
  {
    id: 'v2-stateful',
    label: '@rekog/mcp-nest v2 (stateful)',
    cwd: ROOT,
    command: 'npx',
    args: ['ts-node', '--transpile-only', 'servers/v2-stateful.ts'],
    port: 4002,
    endpoint: '/mcp',
  },
  {
    id: 'raw-sdk-stateless',
    label: 'raw @modelcontextprotocol/sdk (stateless)',
    cwd: ROOT,
    command: 'npx',
    args: ['ts-node', '--transpile-only', 'servers/raw-sdk-stateless.ts'],
    port: 4003,
    endpoint: '/mcp',
  },
  {
    id: 'raw-sdk-nest',
    label: 'raw @modelcontextprotocol/sdk hosted in NestJS/Express (no mcp-nest)',
    cwd: ROOT,
    command: 'npx',
    args: ['ts-node', '--transpile-only', 'servers/raw-sdk-nest.ts'],
    port: 4005,
    endpoint: '/mcp',
  },
  {
    id: 'v1-stateless',
    label: '@rekog/mcp-nest v1.9.10 (stateless)',
    cwd: path.join(ROOT, 'v1-baseline'),
    command: 'npx',
    args: ['ts-node', '--transpile-only', 'src/v1-stateless.ts'],
    port: 4004,
    endpoint: '/mcp',
  },
];

export function getServer(id: ServerSpec['id']): ServerSpec {
  const spec = SERVERS.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown server id: ${id}`);
  return spec;
}
