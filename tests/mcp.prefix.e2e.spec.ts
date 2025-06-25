import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { McpModule } from '../src/mcp.module';
import { createStreamableClient } from './utils';
import { Tool } from '../src/decorators/tool.decorator';

@Injectable()
class Tools {
  @Tool({
    name: 'tool',
    description: 'Tool from Module',
  })
  toolA() {
    return 'Tool result';
  }
}

const globalPrefix = 'api';
const apiPrefix = 'service/custom';

describe('MCP with global API Prefix (e2e)', () => {
  let app: INestApplication;
  let port: number;

  // Set timeout for all tests in this describe block to 15000ms
  jest.setTimeout(15000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'prefix-mcp-server',
          version: '0.0.1',
        }),
      ],
      providers: [Tools],
      exports: [Tools],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(globalPrefix);
    await app.listen(0);

    const server = app.getHttpServer();
    port = (server.address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should connect to server with global prefix', async () => {
    const client = await createStreamableClient(port, {
      endpoint: `/${globalPrefix}/mcp`,
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('should return 404 if globalPrefix is not used', async () => {
    let client;
    try {
      client = await createStreamableClient(port, {
        endpoint: '/mcp',
      });

      fail('Expected 404 error');
    } catch (error) {
      expect(error.message).toContain('404');
    }
  });
});

describe('MCP with global API Prefix and local api prefix (e2e)', () => {
  let app: INestApplication;
  let port: number;

  // Set timeout for all tests in this describe block to 15000ms
  jest.setTimeout(15000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'prefix-mcp-server',
          version: '0.0.1',
          apiPrefix,
        }),
      ],
      providers: [Tools],
      exports: [Tools],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(globalPrefix);
    await app.listen(0);

    const server = app.getHttpServer();
    port = (server.address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should connect to server with global prefix amd apiPrefix', async () => {
    const client = await createStreamableClient(port, {
      endpoint: `/${globalPrefix}/${apiPrefix}/mcp`,
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('should return 404 if apiPrefix is not used', async () => {
    let client;
    try {
      client = await createStreamableClient(port, {
        endpoint: `/${globalPrefix}/mcp`,
      });

      fail('Expected 404 error');
    } catch (error) {
      expect(error.message).toContain('404');
    }
  });
});
