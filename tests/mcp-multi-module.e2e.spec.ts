import { INestApplication } from '@nestjs/common';
import { McpController, Tool } from '../src';
import {
  bootstrapMcpApp,
  createStreamableClient,
  StreamableHttpTransport,
} from './utils';

/**
 * ADAPTATION NOTE (microservices migration):
 * The legacy suite hosted two MCP servers ("server-a", "server-b") inside a
 * single app, separated by per-server HTTP endpoints. Under the microservice
 * transport-strategy model an app hosts exactly one `McpStrategy`, so each
 * server is now its own hybrid app on its own port. The intent — each server
 * exposes only its own tool — is preserved, and is exercised for both the
 * stateful and stateless streamable-HTTP transports.
 */

@McpController()
class ToolsA {
  @Tool({
    name: 'toolA',
    description: 'Tool A from ModuleA',
  })
  toolA() {
    return 'Tool A result';
  }
}

@McpController()
class ToolsB {
  @Tool({
    name: 'toolB',
    description: 'Tool B from ModuleB',
  })
  toolB() {
    return 'Tool B result';
  }
}

describe('E2E: Multiple MCP servers (Streamable HTTP)', () => {
  const apps: INestApplication[] = [];
  let statefulPortA: number;
  let statefulPortB: number;
  let statelessPortA: number;
  let statelessPortB: number;

  jest.setTimeout(15000);

  beforeAll(async () => {
    const statefulA = await bootstrapMcpApp({
      name: 'server-a',
      controllers: [ToolsA],
      transports: [new StreamableHttpTransport({ statelessMode: false })],
    });
    const statefulB = await bootstrapMcpApp({
      name: 'server-b',
      controllers: [ToolsB],
      transports: [new StreamableHttpTransport({ statelessMode: false })],
    });
    const statelessA = await bootstrapMcpApp({
      name: 'server-a',
      controllers: [ToolsA],
      transports: [new StreamableHttpTransport({ statelessMode: true })],
    });
    const statelessB = await bootstrapMcpApp({
      name: 'server-b',
      controllers: [ToolsB],
      transports: [new StreamableHttpTransport({ statelessMode: true })],
    });

    apps.push(statefulA.app, statefulB.app, statelessA.app, statelessB.app);
    statefulPortA = statefulA.port;
    statefulPortB = statefulB.port;
    statelessPortA = statelessA.port;
    statelessPortB = statelessB.port;
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  const runClientTests = (stateless: boolean) => {
    describe(`${stateless ? 'stateless' : 'stateful'} client`, () => {
      let portA: number;
      let portB: number;

      beforeAll(() => {
        portA = stateless ? statelessPortA : statefulPortA;
        portB = stateless ? statelessPortB : statefulPortB;
      });

      it('should list tools for server A', async () => {
        const client = await createStreamableClient(portA);
        try {
          const tools = await client.listTools();
          expect(tools.tools.length).toBe(1);
          expect(tools.tools.find((t) => t.name === 'toolA')).toBeDefined();
          expect(tools.tools.find((t) => t.name === 'toolB')).toBeUndefined();
        } finally {
          await client.close();
        }
      });

      it('should list tools for server B', async () => {
        const client = await createStreamableClient(portB);
        try {
          const tools = await client.listTools();
          expect(tools.tools.length).toBe(1);
          expect(tools.tools.find((t) => t.name === 'toolB')).toBeDefined();
          expect(tools.tools.find((t) => t.name === 'toolA')).toBeUndefined();
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
