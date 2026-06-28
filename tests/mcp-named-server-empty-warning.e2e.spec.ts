import { INestApplication, Logger, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';

/**
 * A named server whose name no `@McpController({ server })` targets binds zero
 * capabilities and would serve an empty endpoint silently. The strategy should
 * warn at startup. A named server WITH a matching controller must not warn.
 */
@McpController({ server: 'weather' })
class WeatherTools {
  @Tool({
    name: 'weather-only',
    description: 'Only on the weather server',
    parameters: z.object({}),
  })
  weatherOnly(@Payload() _args: unknown) {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
}

@Module({ controllers: [WeatherTools] })
class AppModule {}

describe('E2E: named MCP server with no matching controller warns at startup', () => {
  let app: INestApplication;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Spy BEFORE bootstrap — the warning fires during startAllMicroservices().
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const weatherStrategy = new McpStrategy({
      name: 'weather',
      version: '0.0.1',
      server: 'weather', // matches WeatherTools
      transports: [
        new StreamableHttpTransport({
          endpoint: '/weather/mcp',
          statefulMode: true,
        }),
      ],
    });

    const ghostStrategy = new McpStrategy({
      name: 'ghost',
      version: '0.0.1',
      server: 'ghost', // NO @McpController({ server: 'ghost' }) exists
      transports: [
        new StreamableHttpTransport({
          endpoint: '/ghost/mcp',
          statefulMode: true,
        }),
      ],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    weatherStrategy.setHttpAdapter(app.getHttpAdapter());
    ghostStrategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy: weatherStrategy });
    app.connectMicroservice({ strategy: ghostStrategy });
    await app.startAllMicroservices();
    await app.listen(0);
  });

  afterAll(async () => {
    await app?.close();
    warnSpy?.mockRestore();
  });

  function warnMessages(): string[] {
    return warnSpy.mock.calls.map((c) => String(c[0]));
  }

  it('warns for the orphan named server', () => {
    expect(warnMessages().some((m) => m.includes("MCP server 'ghost'"))).toBe(
      true,
    );
  });

  it('does not warn for the named server that has a controller', () => {
    expect(warnMessages().some((m) => m.includes("MCP server 'weather'"))).toBe(
      false,
    );
  });
});
