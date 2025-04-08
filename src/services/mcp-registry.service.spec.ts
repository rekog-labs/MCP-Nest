import { Test, TestingModule } from '@nestjs/testing';
import { McpRegistryService } from './mcp-registry.service';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';

describe('McpRegistryService', () => {
  let service: McpRegistryService;

  const mockResource = (name: string, uri: string) => ({
    type: 'resource',
    metadata: { name, uri },
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
    (service as any).discoveredTools = [
      mockResource('res0', '/posts/comments'),
      mockResource('res1', '/users/{id}'),
      mockResource('res2', '/posts/:postId/comments'),
      mockResource('res3', 'mcp://hello-world'),
    ];
  });

  it('should return the correct resource by URI', () => {
    const result = service.findResourceByUri('/users/123');
    expect(result?.resource.metadata.name).toBe('res1');
    expect(result?.params).toEqual({ id: '123' });
  });

  it('should return undefined for unknown URI', () => {
    const result = service.findResourceByUri('/unknown/path');
    expect(result).toBeUndefined();
  });

  it('should match complex URI template', () => {
    const result = service.findResourceByUri('/posts/456/comments');
    expect(result?.resource.metadata.name).toBe('res2');
    expect(result?.params).toEqual({ postId: '456' });
  });

  it('should match simple URI template', () => {
    const result = service.findResourceByUri('/posts/comments');
    expect(result?.resource.metadata.name).toBe('res0');
    expect(result?.params).toEqual({});
  });

  it('should match mcp URI', () => {
    const result = service.findResourceByUri('mcp://hello-world');
    expect(result?.resource.metadata.name).toBe('res3');
    expect(result?.params).toEqual({});
  });
});
