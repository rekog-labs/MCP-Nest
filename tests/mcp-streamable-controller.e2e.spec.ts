import {
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  INestApplication,
  UseGuards,
} from '@nestjs/common';
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
 * Pins the "bring your own controller" contract for the streamable-HTTP
 * transport (`mount: false` + extend `StreamableHttpController`). It guards two
 * NestJS behaviors this pattern depends on — both version-sensitive enough to
 * deserve a regression test:
 *
 *  1. Inherited route registration — `@Post()/@Get()/@Delete()` declared on the
 *     abstract base register as routes on the concrete `@Controller()` subclass.
 *  2. Inherited property injection — `@Inject(MCP_HTTP_HANDLER)` on the base is
 *     satisfied on the subclass with no constructor / `super()`.
 *
 * It also proves a class-level guard on the subclass actually runs on that
 * inherited route (the whole point of doing this instead of self-mounting), and
 * that mount auto-detection works: the transport is created with NO `mount`
 * option, so it must skip its own self-mount purely because the
 * `MCP_HTTP_HANDLER` provider read `transport.httpHandlers`. If auto-detection
 * failed, the transport would also self-mount an UNGUARDED `/mcp`, and the
 * "denied" test below would fail (the unguarded route would let it through).
 */

// Allows the request only when `x-allow: yes` is present — lets us prove the
// guard runs on the inherited route without standing up a real token issuer.
@Injectable()
class HeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    return req.headers['x-allow'] === 'yes';
  }
}

@McpController()
class GreetingTool {
  @Tool({
    name: 'hello',
    description: 'Greets the user',
    parameters: z.object({ name: z.string().default('World') }),
  })
  hello(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }
}

// The whole feature under test: a real controller that owns /mcp, guards it,
// and inherits the verb wiring from the library base.
@Controller('mcp')
@UseGuards(HeaderGuard)
class MyMcpController extends StreamableHttpController {}

describe('E2E: StreamableHttpController (bring-your-own-controller)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const transport = new StreamableHttpTransport({
      statefulMode: true,
      // No `mount` option: auto-detection must skip self-mount because the
      // MCP_HTTP_HANDLER provider below reads `transport.httpHandlers`.
    });
    const strategy = new McpStrategy({
      name: 'byo-controller-server',
      version: '0.0.1',
      transports: [transport],
    });

    const moduleFixture = await Test.createTestingModule({
      controllers: [MyMcpController, GreetingTool],
      providers: [
        HeaderGuard,
        { provide: MCP_HTTP_HANDLER, useValue: transport.httpHandlers },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    strategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy });
    await app.startAllMicroservices();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers inherited routes + injects the handler, and serves MCP when the guard allows', async () => {
    const client = await createStreamableClient(port, {
      requestInit: { headers: { 'x-allow': 'yes' } },
    });

    // listTools reaching the RPC pipeline proves the inherited POST route is
    // registered AND the injected handler delegated to the transport (an
    // unresolved @Inject would have thrown before any MCP response).
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('hello');

    const result = (await client.callTool({
      name: 'hello',
      arguments: { name: 'Alice' },
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('Hello, Alice!');

    await client.close();
  });

  it('runs the class-level guard on the inherited route (denied → connect fails)', async () => {
    // No `x-allow` header → guard denies the initialize POST → 401, so the
    // client cannot connect.
    await expect(createStreamableClient(port)).rejects.toThrow();
  });
});
