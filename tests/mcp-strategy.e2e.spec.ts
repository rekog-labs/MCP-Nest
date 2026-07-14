import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  INestApplication,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Ctx, MessagePattern, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import type { Progress } from '@modelcontextprotocol/sdk/types.js';
import {
  McpContext,
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { createStreamableClient } from './utils';

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new ForbiddenException('nope');
  }
}

@McpController()
class GreetingController {
  @Tool({
    name: 'hello-world',
    description: 'Greets the user',
    parameters: z.object({ name: z.string().default('World') }),
  })
  async sayHello(
    @Payload() { name }: { name: string },
    @Ctx() ctx: McpContext,
  ) {
    await ctx.reportProgress({ progress: 50, total: 100 } as Progress);
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }

  @Tool({
    name: 'guarded',
    description: 'Always denied by a guard',
    parameters: z.object({}),
  })
  @UseGuards(DenyGuard)
  guarded() {
    return { content: [{ type: 'text', text: 'should never run' }] };
  }

  // A plain RPC handler that must NOT be exposed as an MCP capability.
  @MessagePattern('plain-rpc')
  plainRpc() {
    return 'not-mcp';
  }
}

describe('E2E: McpStrategy (streamable-http)', () => {
  let app: INestApplication;
  let strategy: McpStrategy;
  let port: number;

  beforeAll(async () => {
    strategy = new McpStrategy({
      name: 'test-strategy-server',
      version: '0.0.1',
      transports: [new StreamableHttpTransport({ statefulMode: true })],
    });

    const moduleFixture = await Test.createTestingModule({
      controllers: [GreetingController],
      providers: [DenyGuard],
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

  it('lists the decorated tools', async () => {
    const client = await createStreamableClient(port);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(['guarded', 'hello-world']);
    await client.close();
  });

  it('does not expose plain @MessagePattern handlers', async () => {
    const client = await createStreamableClient(port);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'plain-rpc')).toBeUndefined();
    await client.close();
  });

  it('calls a tool through the RPC pipeline (@Payload + @Ctx)', async () => {
    const client = await createStreamableClient(port);
    const result = (await client.callTool({
      name: 'hello-world',
      arguments: { name: 'Alice' },
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('Hello, Alice!');
    await client.close();
  });

  it('runs NestJS guards on tool calls', async () => {
    const client = await createStreamableClient(port);
    const result = (await client.callTool({
      name: 'guarded',
      arguments: {},
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('should never run');
    await client.close();
  });
});
