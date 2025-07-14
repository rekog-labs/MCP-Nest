import {
  Controller,
  Get,
  INestApplication,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { McpModule } from '../src/mcp.module';
import { SimpleTool } from './sample/simple.tool';
import { createSseClient } from './utils';

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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-mcp-server',
          version: '0.0.1',
          guards: [],
        }),
      ],
      controllers: [TestController],
      providers: [SimpleTool],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Enable versioning to test that our endpoints remain version neutral
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should access SSE endpoint without version prefix', async () => {
    const client = await createSseClient(testPort);
    const tools = await client.listTools();

    expect(tools.tools.length).toBe(1);
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
