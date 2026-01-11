import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { McpModule } from '../src/mcp/mcp.module';
import { createSseClient } from './utils';
import { Resource, ResourceTemplate } from '../src';

@Injectable()
export class GreetingToolResource {
  constructor() {}

  @Resource({
    name: 'hello-world',
    description: 'A simple greeting resource',
    mimeType: 'text/plain',
    uri: 'mcp://hello-world-world',
  })
  async sayHello({ uri }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: 'Hello World',
        },
      ],
    };
  }

  @Resource({
    name: 'hello-world-with-meta',
    description: 'A simple greeting resource with meta',
    mimeType: 'text/plain',
    uri: 'mcp://hello-world-with-meta',
    _meta: {
      title: 'Say Hello Resource',
    },
  })
  async sayHelloWithMeta({ uri }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: 'Hello World With Meta',
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'hello-world-dynamic',
    description: 'A simple greeting dynamic resource',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://hello-world-dynamic/{userName}',
  })
  async sayHelloDynamic({ uri, userName }) {
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'text/plain',
          text: `Hello ${userName}`,
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'hello-world-template-with-meta',
    description: 'A simple greeting dynamic resource with meta',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://hello-world-template-with-meta/{id}',
    _meta: {
      title: 'Template With Meta',
    },
  })
  async sayHelloTemplateWithMeta({ uri, id }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: `Hello ${id}`,
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'hello-world-dynamic-multiple-paths',
    description: 'A simple greeting dynamic resource with multiple paths',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://hello-world-dynamic-multiple-paths/{userId}/{userName}',
  })
  async sayHelloMultiplePathsDynamic({ uri, userId, userName }) {
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'text/plain',
          text: `Hello ${userName} from ${userId}`,
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'hello-world-dynamic-multiple-paths-error',
    description: 'A simple greeting dynamic resource with multiple paths',
    mimeType: 'text/plain',
    uriTemplate:
      'mcp://hello-world-dynamic-multiple-paths-error/{userId}/{userName}',
  })
  async sayHelloMultiplePathsDynamicError() {
    throw new Error('any error');
  }
}

describe('E2E: MCP Resource Server', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-mcp-server',
          version: '0.0.1',
          guards: [],
        }),
      ],
      providers: [GreetingToolResource],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list resources', async () => {
    const client = await createSseClient(testPort);
    const resources = await client.listResources();
    const resourceTemplates = await client.listResourceTemplates();

    expect(resources.resources.find((r) => r.name === 'hello-world')).toEqual({
      name: 'hello-world',
      uri: 'mcp://hello-world-world',
      description: 'A simple greeting resource',
      mimeType: 'text/plain',
    });

    const metaResource = resources.resources.find(
      (r) => r.name === 'hello-world-with-meta',
    );
    expect(metaResource).toBeDefined();
    expect(metaResource!._meta).toBeDefined();
    expect(metaResource!._meta?.title).toBe('Say Hello Resource');

    expect(
      resourceTemplates.resourceTemplates.find(
        (r) => r.name === 'hello-world-dynamic',
      ),
    ).toEqual({
      name: 'hello-world-dynamic',
      uriTemplate: 'mcp://hello-world-dynamic/{userName}',
      description: 'A simple greeting dynamic resource',
      mimeType: 'text/plain',
    });

    const metaTemplate = resourceTemplates.resourceTemplates.find(
      (r) => r.name === 'hello-world-template-with-meta',
    );
    expect(metaTemplate).toBeDefined();
    expect(metaTemplate!._meta).toBeDefined();
    expect(metaTemplate!._meta?.title).toBe('Template With Meta');

    await client.close();
  });

  it('should call the static resource', async () => {
    const client = await createSseClient(testPort);

    const result = await client.readResource({
      uri: 'mcp://hello-world-world',
    });

    expect(result.contents[0].uri).toBe('mcp://hello-world-world');
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect((result.contents[0] as any).text).toBe('Hello World');

    await client.close();
  });

  it('should call the dynamic resource', async () => {
    const client = await createSseClient(testPort);

    const result = await client.readResource({
      uri: 'mcp://hello-world-dynamic/Raphael_John',
    });

    expect(result.contents[0].uri).toBe(
      'mcp://hello-world-dynamic/Raphael_John',
    );
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect((result.contents[0] as any).text).toBe('Hello Raphael_John');

    await client.close();
  });

  it('should call the dynamic resource with multiple paths', async () => {
    const client = await createSseClient(testPort);

    const result = await client.readResource({
      uri: 'mcp://hello-world-dynamic-multiple-paths/123/Raphael_John',
    });

    expect(result.contents[0].uri).toBe(
      'mcp://hello-world-dynamic-multiple-paths/123/Raphael_John',
    );
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect((result.contents[0] as any).text).toBe('Hello Raphael_John from 123');

    await client.close();
  });

  it('should return an error when the resource is not found', async () => {
    const client = await createSseClient(testPort);

    const result = await client.readResource({
      uri: 'mcp://hello-world-dynamic-multiple-paths-error/123/Raphael_John',
    });

    expect(result).toEqual({
      contents: [
        {
          uri: 'mcp://hello-world-dynamic-multiple-paths-error/123/Raphael_John',
          mimeType: 'text/plain',
          text: 'any error',
        },
      ],
      isError: true,
    });

    await client.close();
  });
});
