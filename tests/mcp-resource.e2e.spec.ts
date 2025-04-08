import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { McpModule } from '../src/mcp.module';
import { createMCPClient } from './utils';
import { Resource } from '../src';

@Injectable()
export class GreetingToolResource {
  constructor() {}

  @Resource({
    name: 'hello-world',
    uri: 'mcp://hello-world',
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
    const client = await createMCPClient(testPort);
    const resources = await client.listResources();

    // Verify that the authenticated resource is available
    expect(resources.resources.length).toBeGreaterThan(0);
    expect(
      resources.resources.find((r) => r.name === 'hello-world'),
    ).toBeDefined();

    await client.close();
  });

  it('should call the resource', async () => {
    const client = await createMCPClient(testPort);

    const result: any = await client.readResource({
      uri: 'mcp://hello-world',
    });

    expect(result.contents[0].text).toBe('Hello World');

    await client.close();
  });
});
