import { INestApplication, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Tool } from '../src';
import { McpModule } from '../src/mcp.module';
import { createStreamableClient } from './utils';

@Injectable()
class ToolsA {
  @Tool({
    name: 'toolA',
    description: 'Tool A from ModuleA',
  })
  toolA() {
    return 'Tool A result';
  }
}

@Injectable()
class ToolsB {
  @Tool({
    name: 'toolB',
    description: 'Tool B from ModuleB',
  })
  toolB() {
    return 'Tool B result';
  }
}

const mcpModuleA = McpModule.forRoot({
  name: 'server-a',
  mcpEndpoint: '/servers/a/mcp',
  sseEndpoint: '/servers/a/sse',
  messagesEndpoint: '/servers/a/messages',
  capabilities: { tools: {} },
  version: '0.0.1',
});
const mcpModuleB = McpModule.forRoot({
  name: 'server-b',
  mcpEndpoint: '/servers/b/mcp',
  sseEndpoint: '/servers/b/sse',
  messagesEndpoint: '/servers/b/messages',
  version: '0.0.1',
});

@Module({
  imports: [mcpModuleA],
  providers: [ToolsA],
  exports: [ToolsA],
})
class ModuleA {}

@Module({
  imports: [mcpModuleB],
  providers: [ToolsB],
  exports: [ToolsB],
})
class ModuleB {}

describe('E2E: Multiple MCP servers (Streamable HTTP)', () => {
  let app: INestApplication;
  let statelessApp: INestApplication;
  let statefulServerPort: number;
  let statelessServerPort: number;

  // Set timeout for all tests in this describe block to 15000ms
  jest.setTimeout(15000);

  beforeAll(async () => {
    // Create stateful server (original)
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ModuleA, ModuleB],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    if (!server.address()) {
      throw new Error('Server address not found after listen');
    }
    statefulServerPort = (server.address() as import('net').AddressInfo).port;

    // Create stateless server
    const statelessModuleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [ModuleA, ModuleB],
      }).compile();

    statelessApp = statelessModuleFixture.createNestApplication();
    await statelessApp.listen(0);

    const statelessServer = statelessApp.getHttpServer();
    if (!statelessServer.address()) {
      throw new Error('Stateless server address not found after listen');
    }
    statelessServerPort = (
      statelessServer.address() as import('net').AddressInfo
    ).port;
  });

  afterAll(async () => {
    await app.close();
    await statelessApp.close();
  });

  const runClientTests = (stateless: boolean) => {
    describe(`${stateless ? 'stateless' : 'stateful'} client`, () => {
      let port: number;

      beforeAll(async () => {
        port = stateless ? statelessServerPort : statefulServerPort;
      });

      it('should list tools for server A', async () => {
        const client = await createStreamableClient(port, {
          endpoint: '/servers/a/mcp',
        });
        try {
          const tools = await client.listTools();
          console.log(tools);
          expect(tools.tools.length).toBe(1);
          expect(tools.tools.find((t) => t.name === 'toolA')).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should list tools for server B', async () => {
        const client = await createStreamableClient(port, {
          endpoint: '/servers/b/mcp',
        });
        try {
          const tools = await client.listTools();
          console.log(tools);
          expect(tools.tools.length).toBe(1);
          expect(tools.tools.find((t) => t.name === 'toolB')).toBeDefined();
        } finally {
          await client.close();
        }
      });
    });
  };

  // Run tests using the [Stateful] Streamable HTTP MCP client
  runClientTests(false);

  // Run tests using the [Stateless] Streamable HTTP MCP client
  runClientTests(true);
});
