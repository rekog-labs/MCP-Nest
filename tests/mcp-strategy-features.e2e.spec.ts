import { Injectable, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  McpContext,
  McpController,
  McpStrategy,
  Prompt,
  Resource,
  ResourceTemplate,
  SseTransport,
  StreamableHttpTransport,
  Tool,
} from '../src';
import { createSseClient, createStreamableClient } from './utils';

@Injectable()
class Repo {
  greet(name: string) {
    return `Hello ${name}`;
  }
}

@McpController()
class Capabilities {
  constructor(private readonly repo: Repo) {}

  @Tool({
    name: 'greet',
    description: 'Greets using an injected provider',
    parameters: z.object({ name: z.string() }),
  })
  greet(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: this.repo.greet(name) }] };
  }

  @Tool({
    name: 'context-probe',
    description: 'Returns details derived from the @Ctx() context',
    parameters: z.object({}),
  })
  probe(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
    const session = ctx.getSession();
    ctx.log.info('probe called');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            transport: session.transport,
            hasMcpServer: !!ctx.mcpServer,
            hasRawRequest: !!ctx.getRawRequest(),
          }),
        },
      ],
    };
  }

  @Resource({
    name: 'greeting-resource',
    description: 'A static greeting resource',
    mimeType: 'text/plain',
    uri: 'mcp://greeting',
  })
  greetingResource(@Payload() { uri }: { uri: string }) {
    return { contents: [{ uri, mimeType: 'text/plain', text: 'Hello World' }] };
  }

  @ResourceTemplate({
    name: 'greeting-template',
    description: 'A dynamic greeting resource',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://greeting/{userName}',
  })
  greetingTemplate(@Payload() { uri, userName }: { uri: string; userName: string }) {
    return {
      contents: [{ uri, mimeType: 'text/plain', text: `Hello ${userName}` }],
    };
  }

  @Prompt({
    name: 'greeting-prompt',
    description: 'A greeting prompt',
    parameters: z.object({ name: z.string().describe('who to greet') }),
  })
  greetingPrompt(@Payload() { name }: { name: string }) {
    return {
      description: 'greeting',
      messages: [
        { role: 'user', content: { type: 'text', text: `Hello ${name}` } },
      ],
    };
  }
}

describe('E2E: McpStrategy capabilities', () => {
  let app: INestApplication;
  let strategy: McpStrategy;
  let port: number;

  beforeAll(async () => {
    strategy = new McpStrategy({
      name: 'features-server',
      version: '0.0.1',
      transports: [
        new StreamableHttpTransport({ statelessMode: false }),
        new SseTransport(),
      ],
    });

    const moduleFixture = await Test.createTestingModule({
      controllers: [Capabilities],
      providers: [Repo],
    }).compile();

    app = moduleFixture.createNestApplication();
    strategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy });
    await app.startAllMicroservices();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;

    // Dynamic registration through the strategy (replaces the old global registry).
    strategy.registerTool({
      name: 'dynamic-echo',
      description: 'Echoes its input',
      parameters: z.object({ value: z.string() }),
      handler: (args) => ({
        content: [{ type: 'text', text: `echo:${args.value as string}` }],
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('invokes a tool with an injected dependency (DI works)', async () => {
    const client = await createStreamableClient(port);
    const res = (await client.callTool({
      name: 'greet',
      arguments: { name: 'Bob' },
    })) as { content: Array<{ text: string }> };
    expect(res.content[0].text).toBe('Hello Bob');
    await client.close();
  });

  it('exposes the full @Ctx() surface', async () => {
    const client = await createStreamableClient(port);
    const res = (await client.callTool({
      name: 'context-probe',
      arguments: {},
    })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.transport).toBe('streamable-http');
    expect(parsed.hasMcpServer).toBe(true);
    expect(parsed.hasRawRequest).toBe(true);
    await client.close();
  });

  it('reads a static resource', async () => {
    const client = await createStreamableClient(port);
    const res = await client.readResource({ uri: 'mcp://greeting' });
    expect((res.contents[0] as { text: string }).text).toBe('Hello World');
    await client.close();
  });

  it('reads a resource template with extracted params', async () => {
    const client = await createStreamableClient(port);
    const res = await client.readResource({ uri: 'mcp://greeting/Alice' });
    expect((res.contents[0] as { text: string }).text).toBe('Hello Alice');
    await client.close();
  });

  it('gets a prompt', async () => {
    const client = await createStreamableClient(port);
    const res = await client.getPrompt({
      name: 'greeting-prompt',
      arguments: { name: 'Carol' },
    });
    expect((res.messages[0].content as { text: string }).text).toBe(
      'Hello Carol',
    );
    await client.close();
  });

  it('invokes a dynamically registered tool', async () => {
    const client = await createStreamableClient(port);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'dynamic-echo')).toBeDefined();
    const res = (await client.callTool({
      name: 'dynamic-echo',
      arguments: { value: 'hi' },
    })) as { content: Array<{ text: string }> };
    expect(res.content[0].text).toBe('echo:hi');
    await client.close();
  });

  it('works over the SSE transport too', async () => {
    const client = await createSseClient(port);
    const res = (await client.callTool({
      name: 'greet',
      arguments: { name: 'Sse' },
    })) as { content: Array<{ text: string }> };
    expect(res.content[0].text).toBe('Hello Sse');
    await client.close();
  });
});
