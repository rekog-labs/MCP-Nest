import {
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  INestApplication,
  Module,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  McpController,
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { createStreamableClient } from './utils';

/**
 * `McpHttpControllerFor(transport)` — the legible binding: the controller names
 * its transport directly (no DI token, no module-local provider resolution).
 *
 * Pins the novel mechanics this introduces, in the hardest setup (two servers,
 * one guarded):
 *  - method decorators on a function-scoped base class register as routes on the
 *    concrete subclass;
 *  - the closed-over transport handlers reach the right server (isolation);
 *  - reading `transport.httpHandlers` in the factory auto-disables self-mount;
 *  - a class-level guard on the subclass runs on the inherited route.
 */

@Injectable()
class HeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    return req.headers['x-allow'] === 'yes';
  }
}

// --- weather (guarded) ---
const weatherTransport = new StreamableHttpTransport({ statefulMode: true });
const weatherStrategy = new McpStrategy({
  name: 'weather',
  version: '1.0.0',
  server: 'weather',
  transports: [weatherTransport],
});

@McpController({ server: 'weather' })
class WeatherTool {
  @Tool({ name: 'get-weather', description: 'w', parameters: z.object({}) })
  get() {
    return { content: [{ type: 'text', text: 'sunny' }] };
  }
}

@Controller('weather/mcp')
@UseGuards(HeaderGuard)
class WeatherMcpController extends McpHttpControllerFor(weatherTransport) {}

@Module({
  controllers: [WeatherMcpController, WeatherTool],
  providers: [HeaderGuard],
})
class WeatherModule {}

// --- travel (open) ---
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
    description: 't',
    parameters: z.object({}),
  })
  recommend() {
    return { content: [{ type: 'text', text: 'Lisbon' }] };
  }
}

@Controller('travel/mcp')
class TravelMcpController extends McpHttpControllerFor(travelTransport) {}

@Module({ controllers: [TravelMcpController, TravelTool] })
class TravelModule {}

@Module({ imports: [WeatherModule, TravelModule] })
class AppModule {}

describe('E2E: McpHttpControllerFor (direct transport binding)', () => {
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

  it('binds each controller to its own transport (isolation)', async () => {
    const travel = await createStreamableClient(port, {
      endpoint: '/travel/mcp',
    });
    expect((await travel.listTools()).tools.map((t) => t.name)).toEqual([
      'recommend-destination',
    ]);
    await travel.close();

    const weather = await createStreamableClient(port, {
      endpoint: '/weather/mcp',
      requestInit: { headers: { 'x-allow': 'yes' } },
    });
    expect((await weather.listTools()).tools.map((t) => t.name)).toEqual([
      'get-weather',
    ]);
    await weather.close();
  });

  it('runs the guard on the guarded server only', async () => {
    // weather requires the header → denied without it
    await expect(
      createStreamableClient(port, { endpoint: '/weather/mcp' }),
    ).rejects.toThrow();

    // travel is open → connects fine with no header
    const travel = await createStreamableClient(port, {
      endpoint: '/travel/mcp',
    });
    const r = (await travel.callTool({
      name: 'recommend-destination',
      arguments: {},
    })) as { content: Array<{ text: string }> };
    expect(r.content[0].text).toBe('Lisbon');
    await travel.close();
  });
});
