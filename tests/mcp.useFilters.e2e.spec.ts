import { INestApplication, Injectable, Catch, ExceptionFilter, UseFilters } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Tool } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createSseClient } from './utils';

class CustomError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'CustomError';
  }
}

@Catch(CustomError)
class CustomErrorFilter implements ExceptionFilter {
  catch(exception: CustomError) {
    return `[Filtered] ${exception.code}: ${exception.message}`
  }
}

@Injectable()
class TestTools {
  @Tool({
    name: 'filtered-tool',
    description: 'Tool with filter',
    parameters: z.object({}),
  })
  @UseFilters(CustomErrorFilter)
  async filteredTool() {
    throw new CustomError('Something broke', 'ERR_001');
  }

  @Tool({
    name: 'unfiltered-tool',
    description: 'Tool without filter',
    parameters: z.object({}),
  })
  async unfilteredTool() {
    throw new CustomError('No filter here', 'ERR_002');
  }

  @Tool({
    name: 'success-tool',
    description: 'Tool that succeeds',
    parameters: z.object({}),
  })
  @UseFilters(CustomErrorFilter)
  async successTool() {
    return { content: [{ type: 'text', text: 'OK' }] };
  }
}

describe('E2E: MCP UseFilters (Method Level)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-filters-server',
          version: '0.0.1',
        }),
      ],
      providers: [TestTools],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should catch error with method-level filter', async () => {
    const client = await createSseClient(port);
    try {
      const result: any = await client.callTool({ name: 'filtered-tool', arguments: {} });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('[Filtered] ERR_001: Something broke');
    } finally {
      await client.close();
    }
  });

  it('should use default error handling without filter', async () => {
    const client = await createSseClient(port);
    try {
      const result: any = await client.callTool({ name: 'unfiltered-tool', arguments: {} });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('No filter here');
    } finally {
      await client.close();
    }
  });

  it('should not affect successful calls', async () => {
    const client = await createSseClient(port);
    try {
      const result: any = await client.callTool({ name: 'success-tool', arguments: {} });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('OK');
    } finally {
      await client.close();
    }
  });
});
