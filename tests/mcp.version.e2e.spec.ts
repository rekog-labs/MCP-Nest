import {
  Controller,
  Get,
  INestApplication,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { McpController, Tool } from '../src';
import {
  createStreamableClient,
  McpStrategy,
  StreamableHttpTransport,
} from './utils';

@McpController()
class SimpleToolController {
  @Tool({
    name: 'simple-tool',
    description: 'A simple tool that gets the user by name',
  })
  async sayHello() {
    return {
      content: [
        {
          type: 'text',
          text: `Hello, from simple tool!`,
        },
      ],
    };
  }
}

@Controller({
  version: VERSION_NEUTRAL,
})
class TestController {
  @Get()
  get() {
    return 'Hello World';
  }
}

describe('E2E: MCP Version', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const strategy = new McpStrategy({
      name: 'test-mcp-server',
      version: '0.0.1',
      transports: [new StreamableHttpTransport({ statelessMode: false })],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestController, SimpleToolController],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Enable versioning to test that our endpoints remain version neutral
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    strategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy });
    await app.startAllMicroservices();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should access the MCP endpoint without version prefix', async () => {
    const client = await createStreamableClient(testPort);
    const tools = await client.listTools();

    expect(tools.tools.length).toBe(1);
    await client.close();
  });

  it('should report the configured server name and version', async () => {
    const client = await createStreamableClient(testPort);
    const serverInfo = client.getServerVersion();
    expect(serverInfo?.name).toBe('test-mcp-server');
    expect(serverInfo?.version).toBe('0.0.1');
    await client.close();
  });

  it('should access test controller endpoint without version prefix', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World');
  });

  it('should not access test controller endpoint with version prefix', async () => {
    await request(app.getHttpServer()).get('/v1').expect(404);
  });
});
