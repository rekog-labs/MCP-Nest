import { Controller, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  MCP_HTTP_HANDLER,
  McpController,
  McpStrategy,
  StreamableHttpController,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { createStreamableClient } from './utils';

/**
 * Multi-server + bring-your-own-controller.
 *
 * Two MCP servers in one app, each with its own transport AND its own guarded-
 * capable HTTP controller. The crux this pins: with a SINGLE shared
 * `MCP_HTTP_HANDLER` token, each feature module privately provides its OWN
 * transport's handlers, and NestJS resolves the token MODULE-LOCALLY — so each
 * controller delegates to the right transport. If that DI assumption were wrong,
 * the two endpoints would cross-wire (or collide) and the per-server tool lists
 * below would be identical/swapped.
 *
 * Two independent mappings are exercised:
 *  - capabilities → server: `@McpController({ server })` ↔ `McpStrategy({ server })`
 *  - HTTP route → transport: which `transport.httpHandlers` the module provides
 */

// --- Weather server ---
const weatherTransport = new StreamableHttpTransport({ statefulMode: true });
const weatherStrategy = new McpStrategy({
  name: 'weather',
  version: '1.0.0',
  server: 'weather',
  transports: [weatherTransport],
});

@McpController({ server: 'weather' })
class WeatherTool {
  @Tool({
    name: 'get-weather',
    description: 'weather',
    parameters: z.object({}),
  })
  get() {
    return { content: [{ type: 'text', text: 'sunny' }] };
  }
}

@Controller('weather/mcp')
class WeatherMcpController extends StreamableHttpController {}

@Module({
  controllers: [WeatherMcpController, WeatherTool],
  providers: [
    { provide: MCP_HTTP_HANDLER, useValue: weatherTransport.httpHandlers },
  ],
})
class WeatherModule {}

// --- Travel server ---
const travelTransport = new StreamableHttpTransport({ statefulMode: true });
const travelStrategy = new McpStrategy({
  name: 'travel',
  version: '1.0.0',
  server: 'travel',
  transports: [travelTransport],
});

@McpController({ server: 'travel' })
class TravelTool {
  @Tool({
    name: 'recommend-destination',
    description: 'travel',
    parameters: z.object({}),
  })
  recommend() {
    return { content: [{ type: 'text', text: 'Lisbon' }] };
  }
}

@Controller('travel/mcp')
class TravelMcpController extends StreamableHttpController {}

@Module({
  controllers: [TravelMcpController, TravelTool],
  providers: [
    { provide: MCP_HTTP_HANDLER, useValue: travelTransport.httpHandlers },
  ],
})
class TravelModule {}

@Module({ imports: [WeatherModule, TravelModule] })
class AppModule {}

describe('E2E: StreamableHttpController (multi-server)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const httpAdapter = app.getHttpAdapter();
    weatherStrategy.setHttpAdapter(httpAdapter);
    travelStrategy.setHttpAdapter(httpAdapter);
    app.connectMicroservice({ strategy: weatherStrategy });
    app.connectMicroservice({ strategy: travelStrategy });
    await app.startAllMicroservices();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('routes /weather/mcp to the weather server only', async () => {
    const client = await createStreamableClient(port, {
      endpoint: '/weather/mcp',
    });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['get-weather']);
    await client.close();
  });

  it('routes /travel/mcp to the travel server only', async () => {
    const client = await createStreamableClient(port, {
      endpoint: '/travel/mcp',
    });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['recommend-destination']);
    await client.close();
  });

  it('calls the right tool on each endpoint', async () => {
    const weather = await createStreamableClient(port, {
      endpoint: '/weather/mcp',
    });
    const w = (await weather.callTool({
      name: 'get-weather',
      arguments: {},
    })) as { content: Array<{ text: string }> };
    expect(w.content[0].text).toBe('sunny');
    await weather.close();

    const travel = await createStreamableClient(port, {
      endpoint: '/travel/mcp',
    });
    const t = (await travel.callTool({
      name: 'recommend-destination',
      arguments: {},
    })) as { content: Array<{ text: string }> };
    expect(t.content[0].text).toBe('Lisbon');
    await travel.close();
  });
});
