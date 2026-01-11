import { INestApplication, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Tool } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';

/**
 * Test Suite: Tool Discovery Scope
 *
 * Validates that tools are discovered only from the root module that imports McpModule.forRoot(),
 * and not from imported dependencies, unless explicitly imported as providers.
 *
 * Also validates that when tools have dependencies, those dependencies must be properly
 * declared through module imports, otherwise the application fails to initialize.
 */

// ============================================================================
// Test Setup: Create test tools and modules
// ============================================================================

@Injectable()
class SharedUtilityService {
  getValue(): string {
    return 'Shared utility service value';
  }
}

@Injectable()
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

@Injectable()
class PrimaryServerTools {
  @Tool({
    name: 'primary-tool',
    description: 'A tool from the primary MCP server',
  })
  primaryTool() {
    return { content: [{ type: 'text', text: 'Primary tool result' }] };
  }
}

@Injectable()
class SecondaryServerTools {
  @Tool({
    name: 'secondary-tool',
    description: 'A tool from the secondary MCP server',
  })
  secondaryTool() {
    return { content: [{ type: 'text', text: 'Secondary tool result' }] };
  }
}

@Injectable()
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

// ============================================================================
// Shared Module - provides shared utilities and their dependencies
// ============================================================================
@Module({
  providers: [SharedUtilityService, SharedUtilityTools],
  exports: [SharedUtilityService, SharedUtilityTools],
})
class SharedModule {}

// ============================================================================
// Dependency validation: Tools without their dependencies should fail
// ============================================================================
const mcpModuleNoDeps = McpModule.forRoot({
  name: 'no-deps-server',
  mcpEndpoint: '/nodeps/mcp',
  sseEndpoint: '/nodeps/sse',
  messagesEndpoint: '/nodeps/messages',
  version: '0.0.1',
});

@Module({
  imports: [mcpModuleNoDeps],
  providers: [SharedUtilityTools], // Importing the tool but NOT the module, thus dependencies are missing
})
class NoDepsMcpModule {}

// ============================================================================
// Test Scenario 1: Primary server imports shared module but shouldn't expose its tools
// ============================================================================
const mcpModulePrimary = McpModule.forRoot({
  name: 'primary-server',
  mcpEndpoint: '/primary/mcp',
  sseEndpoint: '/primary/sse',
  messagesEndpoint: '/primary/messages',
  version: '0.0.1',
});

@Module({
  imports: [mcpModulePrimary, SharedModule],
  providers: [PrimaryServerTools],
})
class PrimaryMcpModule {}

// ============================================================================
// Test Scenario 2: Secondary server imports shared module but shouldn't expose its tools
// ============================================================================
const mcpModuleSecondary = McpModule.forRoot({
  name: 'secondary-server',
  mcpEndpoint: '/secondary/mcp',
  sseEndpoint: '/secondary/sse',
  messagesEndpoint: '/secondary/messages',
  version: '0.0.1',
});

@Module({
  imports: [mcpModuleSecondary, SharedModule],
  providers: [SecondaryServerTools],
})
class SecondaryMcpModule {}

// ============================================================================
// Test Scenario 3: Server that explicitly imports tools as providers
// ============================================================================
const mcpModuleExplicitImport = McpModule.forRoot({
  name: 'explicit-import-server',
  mcpEndpoint: '/explicit/mcp',
  sseEndpoint: '/explicit/sse',
  messagesEndpoint: '/explicit/messages',
  version: '0.0.1',
});

@Module({
  imports: [mcpModuleExplicitImport, SharedModule],
  providers: [ExplicitlyImportedTools, SharedUtilityTools], // Explicitly importing SharedUtilityTools
})
class ExplicitImportMcpModule {}

describe('E2E: Tool Discovery Scope (Streamable HTTP)', () => {
  let app: INestApplication;
  let statelessApp: INestApplication;
  let statefulServerPort: number;
  let statelessServerPort: number;

  jest.setTimeout(15000);

  beforeAll(async () => {
    // Create stateful server
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PrimaryMcpModule, SecondaryMcpModule, ExplicitImportMcpModule],
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
        imports: [
          PrimaryMcpModule,
          SecondaryMcpModule,
          ExplicitImportMcpModule,
        ],
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

      beforeAll(() => {
        port = stateless ? statelessServerPort : statefulServerPort;
      });

      describe('Primary Server - Should NOT expose shared module tools', () => {
        it('should list only the primary tool', async () => {
          const client = await createStreamableClient(port, {
            endpoint: '/primary/mcp',
          });
          try {
            const tools = await client.listTools();

            // Should have exactly 1 tool (primary-tool)
            expect(tools.tools.length).toBe(1);
            expect(
              tools.tools.find((t) => t.name === 'primary-tool'),
            ).toBeDefined();

            // Should NOT have shared module tools
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
          const client = await createStreamableClient(port, {
            endpoint: '/primary/mcp',
          });
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
          const client = await createStreamableClient(port, {
            endpoint: '/primary/mcp',
          });
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
          const client = await createStreamableClient(port, {
            endpoint: '/secondary/mcp',
          });
          try {
            const tools = await client.listTools();

            // Should have exactly 1 tool (secondary-tool)
            expect(tools.tools.length).toBe(1);
            expect(
              tools.tools.find((t) => t.name === 'secondary-tool'),
            ).toBeDefined();

            // Should NOT have shared module tools
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
          const client = await createStreamableClient(port, {
            endpoint: '/secondary/mcp',
          });
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
          const client = await createStreamableClient(port, {
            endpoint: '/explicit/mcp',
          });
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
          const client = await createStreamableClient(port, {
            endpoint: '/explicit/mcp',
          });
          try {
            const result: any = await client.callTool({
              name: 'explicitly-imported-tool',
              arguments: {},
            });

            expect(result.content[0].text).toBe(
              'Explicitly imported tool result',
            );
          } finally {
            await client.close();
          }
        });

        it('should call a shared utility tool successfully', async () => {
          const client = await createStreamableClient(port, {
            endpoint: '/explicit/mcp',
          });
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
    });
  };

  describe('Dependency Validation - Tools without their dependencies should fail', () => {
    it('should fail to create module when tool dependencies are missing', async () => {
      await expect(
        Test.createTestingModule({
          imports: [NoDepsMcpModule],
        }).compile(),
      ).rejects.toThrow();
    });
  });

  // Run tests using the [Stateful] Streamable HTTP MCP client
  runClientTests(false);

  // Run tests using the [Stateless] Streamable HTTP MCP client
  runClientTests(true);
});
