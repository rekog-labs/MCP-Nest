import { Injectable, INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { createStreamableClient } from './utils';

jest.setTimeout(15000);

/**
 * Shared business logic. A single `@Injectable()` instance is reused by BOTH
 * per-server controllers via DI — this is the NestJS-native way to "share a
 * tool" across servers: logic lives in the service, each server gets a thin
 * `@Tool` that delegates to it.
 */
@Injectable()
class StatusService {
  status(server: string): string {
    return `ok from ${server}`;
  }
}

@McpController({ server: 'weather' })
class WeatherTools {
  constructor(private readonly statusService: StatusService) {}

  @Tool({
    name: 'weather-only',
    description: 'Only on the weather server',
    parameters: z.object({}),
  })
  weatherOnly(@Payload() _args: unknown) {
    return { content: [{ type: 'text', text: 'weather-only result' }] };
  }

  // Same tool NAME as on the travel server — must resolve to THIS handler when
  // called on the weather endpoint (proves no cross-server collision).
  @Tool({
    name: 'server-status',
    description: 'Identify the server',
    parameters: z.object({}),
  })
  serverStatus(@Payload() _args: unknown) {
    return {
      content: [{ type: 'text', text: this.statusService.status('weather') }],
    };
  }
}

@McpController({ server: 'travel' })
class TravelTools {
  constructor(private readonly statusService: StatusService) {}

  @Tool({
    name: 'travel-only',
    description: 'Only on the travel server',
    parameters: z.object({}),
  })
  travelOnly(@Payload() _args: unknown) {
    return { content: [{ type: 'text', text: 'travel-only result' }] };
  }

  @Tool({
    name: 'server-status',
    description: 'Identify the server',
    parameters: z.object({}),
  })
  serverStatus(@Payload() _args: unknown) {
    return {
      content: [{ type: 'text', text: this.statusService.status('travel') }],
    };
  }
}

@Module({
  // Both controllers + the single shared service live in one module, so the
  // SAME StatusService instance is injected into both.
  controllers: [WeatherTools, TravelTools],
  providers: [StatusService],
})
class MultiServerModule {}

function textOf(result: any): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

describe('E2E: Multiple isolated MCP servers (domains) in one app', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const weatherStrategy = new McpStrategy({
      name: 'weather',
      version: '0.0.1',
      server: 'weather',
      transports: [
        new StreamableHttpTransport({
          endpoint: '/weather/mcp',
          statefulMode: true,
        }),
      ],
    });

    const travelStrategy = new McpStrategy({
      name: 'travel',
      version: '0.0.1',
      server: 'travel',
      transports: [
        new StreamableHttpTransport({
          endpoint: '/travel/mcp',
          statefulMode: true,
        }),
      ],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MultiServerModule],
    }).compile();

    // One HTTP adapter shared by both strategies; each mounts its own endpoint.
    app = moduleFixture.createNestApplication();
    weatherStrategy.setHttpAdapter(app.getHttpAdapter());
    travelStrategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy: weatherStrategy });
    app.connectMicroservice({ strategy: travelStrategy });
    await app.startAllMicroservices();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes only the weather domain tools on the weather endpoint', async () => {
    const client = await createStreamableClient(port, {
      endpoint: '/weather/mcp',
    });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(['server-status', 'weather-only']);
      expect(names).not.toContain('travel-only');
    } finally {
      await client.close();
    }
  });

  it('exposes only the travel domain tools on the travel endpoint', async () => {
    const client = await createStreamableClient(port, {
      endpoint: '/travel/mcp',
    });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(['server-status', 'travel-only']);
      expect(names).not.toContain('weather-only');
    } finally {
      await client.close();
    }
  });

  it('maps the shared tool NAME to the correct per-server handler', async () => {
    const weatherClient = await createStreamableClient(port, {
      endpoint: '/weather/mcp',
    });
    const travelClient = await createStreamableClient(port, {
      endpoint: '/travel/mcp',
    });
    try {
      const weatherResult = await weatherClient.callTool({
        name: 'server-status',
        arguments: {},
      });
      const travelResult = await travelClient.callTool({
        name: 'server-status',
        arguments: {},
      });
      // Each `server-status` runs its own server's handler, which delegates to
      // the shared StatusService — proving both routing isolation and DI reuse.
      expect(textOf(weatherResult)).toBe('ok from weather');
      expect(textOf(travelResult)).toBe('ok from travel');
    } finally {
      await weatherClient.close();
      await travelClient.close();
    }
  });
});
