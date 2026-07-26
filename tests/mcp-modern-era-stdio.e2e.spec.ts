/**
 * Protocol revision `2026-07-28` over stdio.
 *
 * On stdio the era is chosen by the opening exchange: a `server/discover` probe
 * selects modern, an `initialize` selects legacy. One server instance is then
 * pinned for the connection's lifetime. This drives the SAME fixture the legacy
 * stdio spec drives — see `mcp-strategy-stdio.e2e.spec.ts`, which is unchanged.
 */
import { join } from 'path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'bun:test';

const MODERN = '2026-07-28';
const SERVER = join(__dirname, 'fixtures', 'stdio-server.ts');

function stdioTransport(): StdioClientTransport {
  const isBun = !!process.versions.bun;
  return new StdioClientTransport({
    command: isBun ? 'bun' : 'ts-node-dev',
    args: isBun ? ['run', SERVER] : ['--respawn', SERVER],
  });
}

describe('E2E: stdio on protocol revision 2026-07-28', () => {
  it('negotiates the modern era when the client pins it', async () => {
    const client = new Client(
      { name: 'modern-stdio-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: MODERN } } },
    );
    await client.connect(stdioTransport());

    const tools = await client.listTools();
    expect(tools.tools.map((t: any) => t.name).sort()).toEqual([
      'goodbye',
      'hello',
    ]);

    const res: any = await client.callTool({
      name: 'hello',
      arguments: { name: 'Modern' },
    });
    expect(res.content[0].text).toBe('Hello Modern');

    await client.close();
  }, 30000);

  it('picks the modern era on its own when the client auto-negotiates', async () => {
    // 'auto' probes with server/discover first and falls back to initialize.
    // Reaching the modern era proves the probe was answered, not fallen back on.
    const client = new Client(
      { name: 'auto-stdio-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(stdioTransport());

    const res: any = await client.callTool({
      name: 'hello',
      arguments: { name: 'Auto' },
    });
    expect(res.content[0].text).toBe('Hello Auto');

    await client.close();
  }, 30000);
});
