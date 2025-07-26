import {
  DynamicModule,
  Injectable,
  Module,
  ValueProvider,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { McpRegistryService } from './mcp-registry.service';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Tool } from '../decorators/tool.decorator';
import { McpModule } from '../mcp.module';

describe('McpRegistryService', () => {
  let service: McpRegistryService;
  const mockMcpModuleId = 'test-mcp-module-id';

  const mockResource = (name: string, uri: string) => ({
    type: 'resource',
    metadata: { name, uri },
    providerClass: Symbol(name),
    methodName: 'someMethod',
  });

  const mockResourceTemplate = (name: string, uriTemplate: string) => ({
    type: 'resource-template',
    metadata: { name, uriTemplate },
    providerClass: Symbol(name),
    methodName: 'someMethod',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpRegistryService,
        {
          provide: DiscoveryService,
          useValue: {
            getProviders: jest.fn(() => []),
            getControllers: jest.fn(() => []),
          },
        },
        MetadataScanner,
      ],
    }).compile();

    service = module.get<McpRegistryService>(McpRegistryService);

    const mockResources = [
      mockResource('res0', '/posts/comments'),
      mockResource('res1', '/users/{id}'),
      mockResource('res2', '/posts/:postId/comments'),
      mockResource('res3', 'mcp://hello-world'),
    ];

    const mockResourceTemplates = [
      mockResourceTemplate('resTemplate1', '/templates/{id}'),
      mockResourceTemplate('resTemplate2', '/templates/{type}/{id}'),
    ];

    (service as any).discoveredToolsByMcpModuleId = new Map([
      [mockMcpModuleId, [...mockResources, ...mockResourceTemplates]],
    ]);
  });

  it('should return the correct resource by URI', () => {
    const result = service.findResourceByUri(mockMcpModuleId, '/users/123');
    expect(result?.resource.metadata.name).toBe('res1');
    expect(result?.params).toEqual({ id: '123' });
  });

  it('should return the correct resource by URI', () => {
    const result = service.findResourceByUri(mockMcpModuleId, '/users/123');
    expect(result?.resource.metadata.name).toBe('res1');
    expect(result?.params).toEqual({ id: '123' });
  });

  it('should return undefined for unknown URI', () => {
    const result = service.findResourceByUri(mockMcpModuleId, '/unknown/path');
    expect(result).toBeUndefined();
  });

  it('should match complex URI template', () => {
    const result = service.findResourceByUri(
      mockMcpModuleId,
      '/posts/456/comments',
    );
    expect(result?.resource.metadata.name).toBe('res2');
    expect(result?.params).toEqual({ postId: '456' });
  });

  it('should match simple URI template', () => {
    const result = service.findResourceByUri(
      mockMcpModuleId,
      '/posts/comments',
    );
    expect(result?.resource.metadata.name).toBe('res0');
    expect(result?.params).toEqual({});
  });

  it('should match mcp URI', () => {
    const result = service.findResourceByUri(
      mockMcpModuleId,
      'mcp://hello-world',
    );
    expect(result?.resource.metadata.name).toBe('res3');
    expect(result?.params).toEqual({});
  });

  it('should return the correct resource template by URI', () => {
    const result = service.findResourceTemplateByUri(
      mockMcpModuleId,
      '/templates/123',
    );
    expect(result?.resourceTemplate.metadata.name).toBe('resTemplate1');
    expect(result?.params).toEqual({ id: '123' });
  });
});

/**
 * In the case of multiple MCP servers in different modules, the discovery should be scoped to each MCP root.
 * The structure of test modules is the following:
 *
 *                        TestModule
 *                     /              \
 *                   /                 \
 *                 /                    \
 *         ModuleA (server-a)     ModuleB (server-b)
 *               |                      |
 *               |                      |
 *             ToolsA                 ToolsB
 */
describe('McpRegistryService - Multiple discovery roots', () => {
  const mcpModuleA = McpModule.forRoot({ name: 'server-a', version: '0.0.1' });
  const mcpModuleB = McpModule.forRoot({ name: 'server-b', version: '0.0.1' });

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

  let service: McpRegistryService;
  const idModuleA = getMcpModuleId(mcpModuleA);
  const idModuleB = getMcpModuleId(mcpModuleB);

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ModuleA, ModuleB],
    }).compile();

    service = module.get<McpRegistryService>(McpRegistryService);
    service.onApplicationBootstrap();
  });

  it('server-a discovered toolA only', () => {
    const tools = service.getTools(idModuleA);

    expect(tools.length).toBe(1);

    const tool = tools.find((tool) => tool.metadata.name === 'toolA');
    expect(tool).toBeDefined();
  });

  it('server-b discovered toolB only', () => {
    const tools = service.getTools(idModuleB);

    expect(tools.length).toBe(1);

    const tool = tools.find((tool) => tool.metadata.name === 'toolB');
    expect(tool).toBeDefined();
  });
});

/**
 * In the case of multiple MCP servers in a single module, the discovery should discover the same tools for all MCP servers.
 * The structure of test modules is the following:
 *
 *      TestModule
 *          |
 *          |
 *       AppModule (server-a, server-b)
 *          |
 *          |
 *        Tools
 */
describe('McpRegistryService - Single discovery root with multiple MCP servers', () => {
  const mcpModuleA = McpModule.forRoot({ name: 'server-a', version: '0.0.1' });
  const mcpModuleB = McpModule.forRoot({ name: 'server-b', version: '0.0.1' });

  const idModuleA = getMcpModuleId(mcpModuleA);
  const idModuleB = getMcpModuleId(mcpModuleB);

  @Injectable()
  class Tools {
    @Tool({
      name: 'tool',
      description: 'Tool from AppModule',
    })
    tool() {
      return 'Tool result';
    }
  }

  @Module({
    imports: [mcpModuleA, mcpModuleB],
    providers: [Tools],
  })
  class AppModule {}

  let service: McpRegistryService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    service = module.get<McpRegistryService>(McpRegistryService);
    service.onApplicationBootstrap();
  });

  it('server-a discovered the tool', () => {
    const tools = service.getTools(idModuleA);

    expect(tools.length).toBe(1);

    const tool = tools.find((tool) => tool.metadata.name === 'tool');
    expect(tool).toBeDefined();
  });

  it('server-b discovered the tool', () => {
    const tools = service.getTools(idModuleB);

    expect(tools.length).toBe(1);

    const tool = tools.find((tool) => tool.metadata.name === 'tool');
    expect(tool).toBeDefined();
  });
});

/**
 * Helper function to get the MCP module ID from a DynamicModule.
 * Pulling the IDs from the compiled TestingModule doesn't work as expected.
 * It returns the same ID for both modules, which is the ID of the module registered last.
 */
function getMcpModuleId(module: DynamicModule): string {
  const valueProvider = module?.providers?.find(
    (provider) =>
      typeof provider === 'object' &&
      (provider as ValueProvider).provide === 'MCP_MODULE_ID',
  ) as ValueProvider<string> | undefined;

  if (!valueProvider) {
    throw new Error(
      'MCP_MODULE_ID provider not found in module. This should not happen.',
    );
  }

  return valueProvider.useValue;
}
