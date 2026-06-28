import { INestApplication } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { McpController, ResourceTemplate } from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';

/**
 * Regression coverage for the `{path*}` catch-all wildcard in resource template
 * URIs. The old repo documented `mcp://files/{path*}` matching a multi-segment
 * path and handing the handler a single joined string (`docs/readme.md`). The
 * matcher's `convertTemplate` must turn `{path*}` into a path-to-regexp v8
 * wildcard (`*path`) and re-join the resulting segment array into that string.
 */
@McpController()
export class WildcardResource {
  @ResourceTemplate({
    name: 'file-content',
    description: 'Read a file at an arbitrary nested path',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://files/{path*}',
  })
  async getFile(@Payload() { uri, path }: { uri: string; path: string }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          // Echo the extracted path so the test can assert its exact value/type.
          text: JSON.stringify({ path }),
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'repo-file',
    description: 'A named segment followed by a catch-all path',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://repo/{owner}/{path*}',
  })
  async getRepoFile(
    @Payload() { uri, owner, path }: { uri: string; owner: string; path: string },
  ) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: JSON.stringify({ owner, path }),
        },
      ],
    };
  }
}

function parse(resource: { contents: unknown[] }): any {
  return JSON.parse((resource.contents[0] as { text: string }).text);
}

describe('E2E: MCP Resource Template `{path*}` catch-all wildcard', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'wildcard-server',
      version: '1.0.0',
      controllers: [WildcardResource],
    });
    app = bootstrap.app;
    testPort = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('advertises the raw `{path*}` template unchanged', async () => {
    const client = await createStreamableClient(testPort);
    try {
      const { resourceTemplates } = await client.listResourceTemplates();
      const tpl = resourceTemplates.find((r) => r.name === 'file-content');
      expect(tpl?.uriTemplate).toBe('mcp://files/{path*}');
    } finally {
      await client.close();
    }
  });

  it('matches a multi-segment path and joins it into one string', async () => {
    const client = await createStreamableClient(testPort);
    try {
      const resource = await client.readResource({
        uri: 'mcp://files/docs/readme.md',
      });
      expect(parse(resource).path).toBe('docs/readme.md');
    } finally {
      await client.close();
    }
  });

  it('matches a single-segment path', async () => {
    const client = await createStreamableClient(testPort);
    try {
      const resource = await client.readResource({
        uri: 'mcp://files/readme.md',
      });
      expect(parse(resource).path).toBe('readme.md');
    } finally {
      await client.close();
    }
  });

  it('matches a named segment followed by a catch-all', async () => {
    const client = await createStreamableClient(testPort);
    try {
      const resource = await client.readResource({
        uri: 'mcp://repo/acme/src/deep/index.ts',
      });
      const body = parse(resource);
      expect(body.owner).toBe('acme');
      expect(body.path).toBe('src/deep/index.ts');
    } finally {
      await client.close();
    }
  });
});
