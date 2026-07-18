/**
 * e2e for `examples/multiple-servers` — verifies the behaviors documented in
 * docs/multiple-servers.md against a real, spawned example server, driven by a
 * pinned old MCP client.
 *
 * Run:  bun test multiple-servers        (from the e2e/ directory)
 *
 * The example mounts TWO named MCP servers (`weather`, `travel`) on one Nest
 * app, at `/weather/mcp` and `/travel/mcp` on the same HTTP port. The whole
 * point of the example is isolation: each endpoint must advertise ONLY its
 * own tools, even though `TravelTools` reuses `WeatherService` via DI under
 * the hood. Green here = an old (1.10.0) client sees exactly the documented
 * per-server tool set on each endpoint.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 90_000;

let server: RunningExample;
let weather: Client;
let travel: Client;

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('multiple-servers', port, {
    endpoint: '/weather/mcp',
    readyTimeoutMs: BOOT_MS,
  });
  weather = await createLegacyClient(`http://127.0.0.1:${port}/weather/mcp`);
  travel = await createLegacyClient(`http://127.0.0.1:${port}/travel/mcp`);
}, BOOT_MS);

afterAll(async () => {
  await weather?.close?.();
  await travel?.close?.();
  await server?.stop();
});

describe('examples/multiple-servers e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('each server reports its own serverInfo name on the handshake', () => {
    expect(weather.getServerVersion()?.name).toBe('weather');
    expect(travel.getServerVersion()?.name).toBe('travel');
  });

  test('/weather/mcp advertises only its own tool', async () => {
    const { tools } = await weather.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['get-weather']);
  });

  test('/travel/mcp advertises only its own tool', async () => {
    const { tools } = await travel.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['weather-at-destination']);
  });

  test('weather server tool is callable and returns weather data', async () => {
    const res = await weather.callTool({
      name: 'get-weather',
      arguments: { city: 'Tokyo' },
    });
    expect(text(res)).toContain('Weather in Tokyo: cloudy, 18°C');
  });

  test('travel server tool is callable and reuses WeatherService via DI', async () => {
    const res = await travel.callTool({
      name: 'weather-at-destination',
      arguments: { interest: 'food' },
    });
    expect(text(res)).toContain('For food, visit tokyo — weather there: cloudy, 18°C.');

    const res2 = await travel.callTool({
      name: 'weather-at-destination',
      arguments: { interest: 'museums' },
    });
    expect(text(res2)).toContain('For museums, visit london — weather there: rainy, 14°C.');
  });

  test('weather server cannot call the travel tool (isolation)', async () => {
    await expect(
      weather.callTool({ name: 'weather-at-destination', arguments: { interest: 'food' } }),
    ).rejects.toThrow();
  });

  test('travel server cannot call the weather tool (isolation)', async () => {
    await expect(
      travel.callTool({ name: 'get-weather', arguments: { city: 'Tokyo' } }),
    ).rejects.toThrow();
  });
});
