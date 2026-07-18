import { INestApplication } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { ProtocolError } from "@modelcontextprotocol/server";
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { McpController, Resource, ResourceTemplate } from '@rekog/mcp-nest';

@McpController()
export class GreetingToolResource {
  constructor() {}

  @Resource({
    name: 'hello-world',
    description: 'A simple greeting resource',
    mimeType: 'text/plain',
    uri: 'mcp://hello-world-world',
  })
  async sayHello(@Payload() { uri }: { uri: string }) {
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
  async sayHelloWithMeta(@Payload() { uri }: { uri: string }) {
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
  async sayHelloDynamic(
    @Payload() { uri, userName }: { uri: string; userName: string },
  ) {
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
  async sayHelloTemplateWithMeta(
    @Payload() { uri, id }: { uri: string; id: string },
  ) {
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
  async sayHelloMultiplePathsDynamic(
    @Payload()
    {
      uri,
      userId,
      userName,
    }: {
      uri: string;
      userId: string;
      userName: string;
    },
  ) {
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

  @ResourceTemplate({
    name: 'hello-world-not-found',
    description: 'A resource that throws not found',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://hello-world-not-found/{id}',
  })
  async sayHelloNotFound(@Payload() { uri }: { uri: string }) {
    // https://modelcontextprotocol.io/specification/2025-06-18/server/resources#error-handling
    throw new ProtocolError(-32002, 'Resource not found', { uri });
  }
}

describe('E2E: MCP Resource Server', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'test-mcp-server',
      controllers: [GreetingToolResource],
    });
    app = bootstrap.app;
    testPort = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list resources', async () => {
    const client = await createStreamableClient(testPort);
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
    const client = await createStreamableClient(testPort);

    const result = await client.readResource({
      uri: 'mcp://hello-world-world',
    });

    expect(result.contents[0].uri).toBe('mcp://hello-world-world');
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect((result.contents[0] as any).text).toBe('Hello World');

    await client.close();
  });

  it('should call the dynamic resource', async () => {
    const client = await createStreamableClient(testPort);

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
    const client = await createStreamableClient(testPort);

    const result = await client.readResource({
      uri: 'mcp://hello-world-dynamic-multiple-paths/123/Raphael_John',
    });

    expect(result.contents[0].uri).toBe(
      'mcp://hello-world-dynamic-multiple-paths/123/Raphael_John',
    );
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect((result.contents[0] as any).text).toBe(
      'Hello Raphael_John from 123',
    );

    await client.close();
  });

  it('should throw internal error when resource throws generic error', async () => {
    const client = await createStreamableClient(testPort);

    try {
      // Unknown errors are masked by the NestJS RPC exception handler.
      await expect(
        client.readResource({
          uri: 'mcp://hello-world-dynamic-multiple-paths-error/123/Raphael_John',
        }),
      ).rejects.toThrow('Internal server error');
    } finally {
      await client.close();
    }
  });

  it('should throw resource not found error', async () => {
    const client = await createStreamableClient(testPort);
    const uri = 'mcp://hello-world-not-found/123';

    try {
      // Errors thrown from a resource handler are surfaced through the NestJS
      // RPC exception handler, which masks them to a generic internal error.
      await expect(client.readResource({ uri })).rejects.toMatchObject({
        code: -32603,
      });
    } finally {
      await client.close();
    }
  });
});
