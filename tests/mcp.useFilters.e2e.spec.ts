import {
  ArgumentsHost,
  Catch,
  INestApplication,
  RpcExceptionFilter,
  UseFilters,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { z } from 'zod';
import { McpController, Tool } from '../src';
import { bootstrapMcpApp, createSseClient } from './utils';

class CustomError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'CustomError';
  }
}

// Native RPC exception filters return an rxjs observable whose value becomes the
// handler's response. For tools, that value is the tool result object.
@Catch(CustomError)
class CustomErrorFilter implements RpcExceptionFilter<CustomError> {
  catch(exception: CustomError, _host: ArgumentsHost): Observable<any> {
    return of({
      content: [
        {
          type: 'text',
          text: `[CustomError] ${exception.code}: ${exception.message}`,
        },
      ],
      isError: true,
    });
  }
}

@Catch()
class CatchAllFilter implements RpcExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): Observable<any> {
    const message = exception instanceof Error ? exception.message : 'unknown';
    return of({
      content: [{ type: 'text', text: `[CatchAll] ${message}` }],
      isError: true,
    });
  }
}

@McpController()
@UseFilters(CatchAllFilter)
class TestTools {
  @Tool({
    name: 'method-filter-tool',
    description: 'Method-level filter overrides class-level',
    parameters: z.object({}),
  })
  @UseFilters(CustomErrorFilter)
  async methodFilterTool() {
    throw new CustomError('Method error', 'ERR_001');
  }

  @Tool({
    name: 'class-filter-tool',
    description: 'Falls through to class-level catch-all filter',
    parameters: z.object({}),
  })
  async classFilterTool() {
    throw new Error('Generic error');
  }

  @Tool({
    name: 'success-tool',
    description: 'Tool that succeeds',
    parameters: z.object({}),
  })
  async successTool() {
    return { content: [{ type: 'text', text: 'OK' }] };
  }
}

describe('E2E: MCP UseFilters', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'test-filters-server',
      controllers: [TestTools],
    });
    app = bootstrap.app;
    port = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Method Level', () => {
    it('should use method-level filter over class-level filter', async () => {
      const client = await createSseClient(port);
      try {
        const result: any = await client.callTool({
          name: 'method-filter-tool',
          arguments: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          '[CustomError] ERR_001: Method error',
        );
      } finally {
        await client.close();
      }
    });
  });

  describe('Class Level', () => {
    it('should catch any error with catch-all filter', async () => {
      const client = await createSseClient(port);
      try {
        const result: any = await client.callTool({
          name: 'class-filter-tool',
          arguments: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe('[CatchAll] Generic error');
      } finally {
        await client.close();
      }
    });

    it('should not affect successful calls', async () => {
      const client = await createSseClient(port);
      try {
        const result: any = await client.callTool({
          name: 'success-tool',
          arguments: {},
        });

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toBe('OK');
      } finally {
        await client.close();
      }
    });
  });
});
