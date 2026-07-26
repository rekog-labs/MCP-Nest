/**
 * e2e for `examples/multiple-servers` — verifies the behaviors documented in
 * docs/multiple-servers.md against a real, spawned example server, driven by
 * both a pinned old (1.10.0) and a modern (2026-07-28) client.
 *
 * Run:  bun test multiple-servers        (from the e2e/ directory)
 *
 * The example mounts TWO named MCP servers (`weather`, `travel`) on one Nest
 * app, at `/weather/mcp` and `/travel/mcp` on the same HTTP port. The whole
 * point of the example is isolation: each endpoint must advertise ONLY its
 * own tools, even though `TravelTools` reuses `WeatherService` via DI under
 * the hood. Green = each era sees exactly the documented per-server tool set
 * on each endpoint — isolation holds per-endpoint AND per-era.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  createEraClient,
  ERAS,
  getFreePort,
  startExample,
  type Era,
  type EraClient,
  type RunningExample,
} from './harness';

const BOOT_MS = 90_000;

let server: RunningExample;
const weatherClients: Partial<Record<Era, EraClient>> = {};
const travelClients: Partial<Record<Era, EraClient>> = {};

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('multiple-servers', port, {
    endpoint: '/weather/mcp',
    readyTimeoutMs: BOOT_MS,
  });
  for (const era of ERAS) {
    weatherClients[era] = await createEraClient(
      era,
      `http://127.0.0.1:${port}/weather/mcp`,
    );
    travelClients[era] = await createEraClient(
      era,
      `http://127.0.0.1:${port}/travel/mcp`,
    );
  }
}, BOOT_MS);

afterAll(async () => {
  for (const era of ERAS) {
    await weatherClients[era]?.close();
    await travelClients[era]?.close();
  }
  await server?.stop();
});

describe.each(ERAS)('examples/multiple-servers e2e (%s era)', (era) => {
  const weather = () => weatherClients[era]!;
  const travel = () => travelClients[era]!;
  // Legacy reads this off the `initialize` result; modern off `server/discover`.
  test('each server reports its own serverInfo name', () => {
    expect(weather().getServerVersion()?.name).toBe('weather');
    expect(travel().getServerVersion()?.name).toBe('travel');
  });

  test('/weather/mcp advertises only its own tool', async () => {
    const { tools } = await weather().listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['get-weather']);
  });

  test('/travel/mcp advertises only its own tool', async () => {
    const { tools } = await travel().listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['weather-at-destination']);
  });

  test('weather server tool is callable and returns weather data', async () => {
    const res = await weather().callTool({
      name: 'get-weather',
      arguments: { city: 'Tokyo' },
    });
    expect(text(res)).toContain('Weather in Tokyo: cloudy, 18°C');
  });

  test('travel server tool is callable and reuses WeatherService via DI', async () => {
    const res = await travel().callTool({
      name: 'weather-at-destination',
      arguments: { interest: 'food' },
    });
    expect(text(res)).toContain('For food, visit tokyo — weather there: cloudy, 18°C.');

    const res2 = await travel().callTool({
      name: 'weather-at-destination',
      arguments: { interest: 'museums' },
    });
    expect(text(res2)).toContain('For museums, visit london — weather there: rainy, 14°C.');
  });

  test('weather server cannot call the travel tool (isolation)', async () => {
    await expect(
      weather().callTool({ name: 'weather-at-destination', arguments: { interest: 'food' } }),
    ).rejects.toThrow();
  });

  test('travel server cannot call the weather tool (isolation)', async () => {
    await expect(
      travel().callTool({ name: 'get-weather', arguments: { city: 'Tokyo' } }),
    ).rejects.toThrow();
  });
});
