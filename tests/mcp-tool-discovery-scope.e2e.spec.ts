import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { McpController, Tool } from '../src';
import {
  createStreamableClient,
  McpStrategy,
  StreamableHttpTransport,
} from './utils';

/**
 * Test Suite: Tool Discovery Scope
 *
 * Validates that tools are discovered only from the module that imports
 * McpModule.forRoot() and declares `@McpController` classes in its `controllers`
 * array — not from arbitrary imported dependencies.
 *
 * ADAPTATION NOTE (microservices migration):
 * The legacy version hosted three MCP servers in a single app, distinguished by
 * per-server HTTP endpoints. Under the microservice transport-strategy model an
 * app hosts exactly one `McpStrategy`, so each former server is now its own
 * hybrid app. The intent — discovery is scoped to the owning module's
 * controllers, shared-module providers are NOT auto-exposed, and explicitly
 * re-declared controllers ARE exposed — is preserved 1:1.
 */

@Injectable()
class SharedUtilityService {
  getValue(): string {
    return 'Shared utility service value';
  }
}

@McpController()
class SharedUtilityTools {
  constructor(private readonly sharedService: SharedUtilityService) {}

  @Tool({
    name: 'shared-utility-tool',
    description: 'A utility tool from the shared module',
  })
  sharedUtilityTool() {
    const value = this.sharedService.getValue();
    return { content: [{ type: 'text', text: value }] };
  }

  @Tool({
    name: 'shared-health-check',
    description: 'A health check tool from the shared module',
  })
  healthCheck() {
    return { content: [{ type: 'text', text: 'Health OK' }] };
  }
}

@McpController()
class PrimaryServerTools {
  @Tool({
    name: 'primary-tool',
    description: 'A tool from the primary MCP server',
  })
  primaryTool() {
    return { content: [{ type: 'text', text: 'Primary tool result' }] };
  }
}

@McpController()
class SecondaryServerTools {
  @Tool({
    name: 'secondary-tool',
    description: 'A tool from the secondary MCP server',
  })
  secondaryTool() {
    return { content: [{ type: 'text', text: 'Secondary tool result' }] };
  }
}

@McpController()
class ExplicitlyImportedTools {
  @Tool({
    name: 'explicitly-imported-tool',
    description: 'A tool that is explicitly imported',
  })
  explicitlyImportedTool() {
    return {
      content: [{ type: 'text', text: 'Explicitly imported tool result' }],
    };
  }
}

async function bootstrapServer(config: {
  name: string;
  controllers: any[];
  providers?: any[];
}): Promise<{ app: INestApplication; port: number }> {
  const strategy = new McpStrategy({
    name: config.name,
    version: '0.0.1',
    transports: [new StreamableHttpTransport({ statelessMode: false })],
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: config.controllers,
    providers: config.providers ?? [],
  }).compile();

  const app = moduleFixture.createNestApplication();
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(0);
  const port = (app.getHttpServer().address() as { port: number }).port;
  return { app, port };
}

describe('E2E: Tool Discovery Scope (Streamable HTTP)', () => {
  let primaryApp: INestApplication;
  let secondaryApp: INestApplication;
  let explicitApp: INestApplication;
  let primaryPort: number;
  let secondaryPort: number;
  let explicitPort: number;

  jest.setTimeout(15000);

  beforeAll(async () => {
    // Primary server: declares only PrimaryServerTools. The shared tools live in
    // a separate concern and must NOT leak in.
    const primary = await bootstrapServer({
      name: 'primary-server',
      controllers: [PrimaryServerTools],
    });
    primaryApp = primary.app;
    primaryPort = primary.port;

    // Secondary server: declares only SecondaryServerTools.
    const secondary = await bootstrapServer({
      name: 'secondary-server',
      controllers: [SecondaryServerTools],
    });
    secondaryApp = secondary.app;
    secondaryPort = secondary.port;

    // Explicit-import server: explicitly declares the shared controllers (and
    // provides their dependency) alongside its own tool, so all are exposed.
    const explicit = await bootstrapServer({
      name: 'explicit-import-server',
      controllers: [ExplicitlyImportedTools, SharedUtilityTools],
      providers: [SharedUtilityService],
    });
    explicitApp = explicit.app;
    explicitPort = explicit.port;
  });

  afterAll(async () => {
    await primaryApp.close();
    await secondaryApp.close();
    await explicitApp.close();
  });

  describe('Primary Server - Should NOT expose shared module tools', () => {
    it('should list only the primary tool', async () => {
      const client = await createStreamableClient(primaryPort);
      try {
        const tools = await client.listTools();

        expect(tools.tools.length).toBe(1);
        expect(
          tools.tools.find((t) => t.name === 'primary-tool'),
        ).toBeDefined();

        expect(
          tools.tools.find((t) => t.name === 'shared-utility-tool'),
        ).toBeUndefined();
        expect(
          tools.tools.find((t) => t.name === 'shared-health-check'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should call the primary tool successfully', async () => {
      const client = await createStreamableClient(primaryPort);
      try {
        const result: any = await client.callTool({
          name: 'primary-tool',
          arguments: {},
        });

        expect(result.content[0].text).toBe('Primary tool result');
      } finally {
        await client.close();
      }
    });

    it('should fail when calling a shared module tool', async () => {
      const client = await createStreamableClient(primaryPort);
      try {
        await expect(
          client.callTool({
            name: 'shared-utility-tool',
            arguments: {},
          }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
    });
  });

  describe('Secondary Server - Should NOT expose shared module tools', () => {
    it('should list only the secondary tool', async () => {
      const client = await createStreamableClient(secondaryPort);
      try {
        const tools = await client.listTools();

        expect(tools.tools.length).toBe(1);
        expect(
          tools.tools.find((t) => t.name === 'secondary-tool'),
        ).toBeDefined();

        expect(
          tools.tools.find((t) => t.name === 'shared-utility-tool'),
        ).toBeUndefined();
        expect(
          tools.tools.find((t) => t.name === 'shared-health-check'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should call the secondary tool successfully', async () => {
      const client = await createStreamableClient(secondaryPort);
      try {
        const result: any = await client.callTool({
          name: 'secondary-tool',
          arguments: {},
        });

        expect(result.content[0].text).toBe('Secondary tool result');
      } finally {
        await client.close();
      }
    });
  });

  describe('Explicit Import Server - SHOULD expose explicitly imported tools', () => {
    it('should list both explicitly imported and its own tools', async () => {
      const client = await createStreamableClient(explicitPort);
      try {
        const tools = await client.listTools();

        // Should have 3 tools (2 from shared + 1 from explicit)
        expect(tools.tools.length).toBe(3);

        expect(
          tools.tools.find((t) => t.name === 'explicitly-imported-tool'),
        ).toBeDefined();
        expect(
          tools.tools.find((t) => t.name === 'shared-utility-tool'),
        ).toBeDefined();
        expect(
          tools.tools.find((t) => t.name === 'shared-health-check'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should call the explicitly imported tool successfully', async () => {
      const client = await createStreamableClient(explicitPort);
      try {
        const result: any = await client.callTool({
          name: 'explicitly-imported-tool',
          arguments: {},
        });

        expect(result.content[0].text).toBe('Explicitly imported tool result');
      } finally {
        await client.close();
      }
    });

    it('should call a shared utility tool successfully', async () => {
      const client = await createStreamableClient(explicitPort);
      try {
        const result: any = await client.callTool({
          name: 'shared-utility-tool',
          arguments: {},
        });

        expect(result.content[0].text).toBe('Shared utility service value');
      } finally {
        await client.close();
      }
    });
  });

  describe('Dependency Validation - Tools without their dependencies should fail', () => {
    it('should fail to create the app when a controller dependency is missing', async () => {
      await expect(
        Test.createTestingModule({
          // SharedUtilityTools needs SharedUtilityService, which is NOT provided.
          controllers: [SharedUtilityTools],
        }).compile(),
      ).rejects.toThrow();
    });
  });
});
