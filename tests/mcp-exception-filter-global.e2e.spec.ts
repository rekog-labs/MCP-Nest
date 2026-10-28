import {
  CanActivate,
  Catch,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  INestApplication,
  Injectable,
  RpcExceptionFilter,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { APP_FILTER, HttpAdapterHost } from '@nestjs/core';
import { ProtocolError } from '@modelcontextprotocol/client';
import {
  McpController,
  McpExceptionFilter,
  McpHttpControllerFor,
  Resource,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { Observable, of } from 'rxjs';
import { z } from 'zod';
import { bootstrapMcpApp, createEraClient, ERAS } from './utils';

/**
 * `McpExceptionFilter` is `@Catch()`-all, so registered globally it also sees
 * errors from plain HTTP controllers and from guards on the MCP route. Those
 * must get Nest's native HTTP response (#281) — before the fix the filter
 * returned an RPC `throwError` there and the request hung. Every HTTP call is
 * bounded so a regression fails fast instead of timing out the suite.
 */

const SECRET = 'MCP281_PRIVATE_DO_NOT_DISCLOSE';
const ALLOW = { 'x-allow': 'yes' };

@Controller('http')
class HttpControls {
  @Get('http-exception')
  httpException() {
    throw new HttpException({ message: 'http-visible', code: 281 }, 418);
  }

  @Get('unknown')
  unknown() {
    throw new Error(SECRET);
  }
}

@McpController()
class McpTools {
  @Tool({ name: 'boom', description: 'throws', parameters: z.object({}) })
  boom() {
    throw new Error('tool-visible');
  }

  @Resource({ name: 'broken', uri: 'mcp://broken' })
  broken() {
    throw new Error('resource-visible');
  }
}

const filterResult = (text: string): Observable<unknown> =>
  of({ content: [{ type: 'text', text }], isError: true });

@Catch()
class ClassFilter implements RpcExceptionFilter {
  catch() {
    return filterResult('class-filter');
  }
}

@Catch()
class MethodFilter implements RpcExceptionFilter {
  catch() {
    return filterResult('method-filter');
  }
}

@McpController()
@UseFilters(ClassFilter)
class SpecificTools {
  @Tool({ name: 'class-level', description: 'c', parameters: z.object({}) })
  classLevel() {
    throw new Error('class-original');
  }

  @Tool({ name: 'method-level', description: 'm', parameters: z.object({}) })
  @UseFilters(MethodFilter)
  methodLevel() {
    throw new Error('method-original');
  }
}

/** Rejects with an `HttpException` (not `false`) so the filter sees a 401. */
@Injectable()
class AllowHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.headers['x-allow'] !== 'yes') {
      throw new UnauthorizedException('mcp-route-denied');
    }
    return true;
  }
}

const transport = new StreamableHttpTransport({ statefulMode: true });

@Controller('mcp')
@UseGuards(AllowHeaderGuard)
class GuardedMcpController extends McpHttpControllerFor(transport) {}

async function request(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    ...init,
    signal: AbortSignal.timeout(2000),
  });
  return { status: res.status, body: await res.json() };
}

function expectNativeHttpErrors(port: () => number) {
  it('passes an HttpException through with its status and body', async () => {
    expect(await request(port(), '/http/http-exception')).toEqual({
      status: 418,
      body: { message: 'http-visible', code: 281 },
    });
  });

  it('masks an unknown HTTP error as a 500', async () => {
    const res = await request(port(), '/http/unknown');
    expect(res).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
}

describe('McpExceptionFilter registered via APP_FILTER', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [HttpControls, McpTools, SpecificTools, GuardedMcpController],
      providers: [
        AllowHeaderGuard,
        { provide: APP_FILTER, useClass: McpExceptionFilter },
      ],
      transports: [transport],
      inheritAppConfig: true,
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  expectNativeHttpErrors(() => port);

  it('answers a guard rejection on the MCP route with a 401', async () => {
    const res = await request(port, '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: 'mcp-route-denied' });
  });

  describe.each(ERAS)('MCP handlers (%s era)', (era) => {
    const connect = () =>
      createEraClient(era, port, { requestInit: { headers: ALLOW } });

    const call = async (name: string) => {
      const client = await connect();
      try {
        return await client.callTool({ name, arguments: {} });
      } finally {
        await client.close();
      }
    };

    it('surfaces a tool error message as an isError result', async () => {
      expect(await call('boom')).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'tool-visible' }],
      });
    });

    it('surfaces a resource error message as a JSON-RPC error', async () => {
      const client = await connect();
      try {
        const read = client.readResource({ uri: 'mcp://broken' });
        await expect(read).rejects.toBeInstanceOf(ProtocolError);
        await expect(read).rejects.toMatchObject({
          code: -32603,
          message: expect.stringContaining('resource-visible'),
        });
      } finally {
        await client.close();
      }
    });

    it.each([
      ['class-level', 'class-filter'],
      ['method-level', 'method-filter'],
    ])('lets @UseFilters on %s win over the global filter', async (name, text) => {
      expect(await call(name)).toMatchObject({
        isError: true,
        content: [{ type: 'text', text }],
      });
    });
  });
});

describe('McpExceptionFilter registered via useGlobalFilters', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [HttpControls],
      configure: (nestApp) => {
        nestApp.useGlobalFilters(
          new McpExceptionFilter(nestApp.get(HttpAdapterHost).httpAdapter),
        );
      },
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  expectNativeHttpErrors(() => port);
});
