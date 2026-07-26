/**
 * The NestJS pipeline on protocol revision `2026-07-28`.
 *
 * This is the load-bearing case for the per-request context bridge: the modern
 * serving entry hands the server factory a web `Request`, NOT the Express
 * request that NestJS guards decorate with `req.user`. If that bridge breaks,
 * per-tool authorization silently stops seeing the user on modern clients —
 * so it gets its own test.
 */
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  McpController,
  McpHttpControllerFor,
  Tool,
} from '@rekog/mcp-nest';
import type { Context } from '@rekog/mcp-nest';
import { bootstrapMcpApp, StreamableHttpTransport } from './utils';

const MODERN = '2026-07-28';

/** Stands in for a real auth guard: decorates the request with a user. */
@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers?.authorization as string | undefined;
    if (auth !== 'Bearer good-token') return false;
    req.user = { id: 'user-7', name: 'Ada', scopes: ['read'] };
    return true;
  }
}

@Injectable()
@Controller()
@McpController()
class WhoAmITool {
  @Tool({
    name: 'whoami',
    description: 'Echoes the authenticated user',
    parameters: z.object({}),
  })
  whoami(@Payload() _args: unknown, @Ctx() context: Context) {
    const raw = (context as any).getRawRequest();
    return {
      content: [
        { type: 'text', text: JSON.stringify(raw?.user ?? null) },
      ],
    };
  }
}

// A real Nest controller so the guard runs at the HTTP layer on every request.
const transport = new StreamableHttpTransport({ statefulMode: true });

@Controller('mcp')
@UseGuards(StubAuthGuard)
class GuardedMcpController extends McpHttpControllerFor(transport) {}

let app: any;
let port: number;

beforeAll(async () => {
  const boot = await bootstrapMcpApp({
    controllers: [WhoAmITool, GuardedMcpController],
    providers: [StubAuthGuard],
    transports: [transport],
  });
  app = boot.app;
  port = boot.port;
});

afterAll(async () => {
  await app?.close();
});

function modernClient(token: string): Promise<Client> {
  const client = new Client(
    { name: 'modern-auth-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MODERN } } },
  );
  return client
    .connect(
      new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
        requestInit: { headers: { Authorization: token } },
      }),
    )
    .then(() => client);
}

describe('modern era — NestJS guards and request context', () => {
  it('reaches the tool with req.user set by the guard', async () => {
    const client = await modernClient('Bearer good-token');

    const result: any = await client.callTool({ name: 'whoami', arguments: {} });
    const user = JSON.parse(result.content[0].text);

    expect(user).not.toBeNull();
    expect(user.id).toBe('user-7');
    expect(user.name).toBe('Ada');

    await client.close();
  });

  it('rejects a modern request that fails the guard', async () => {
    await expect(modernClient('Bearer wrong-token')).rejects.toThrow();
  });

  it('applies the same guard to legacy clients on the same endpoint', async () => {
    const legacy = new Client({ name: 'legacy-auth-client', version: '1.0.0' });
    await legacy.connect(
      new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
        requestInit: { headers: { Authorization: 'Bearer good-token' } },
      }),
    );

    const result: any = await legacy.callTool({ name: 'whoami', arguments: {} });
    expect(JSON.parse(result.content[0].text).id).toBe('user-7');

    await legacy.close();
  });
});
