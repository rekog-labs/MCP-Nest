import {
  ArgumentsHost,
  Catch,
  INestApplication,
  RpcExceptionFilter,
  UseFilters,
} from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { Observable, of } from 'rxjs';
import { z } from 'zod';
import { McpController, Prompt, Resource, Tool } from '../src';
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
// handler's response. For tools, that value is the tool result object; for
// resources it must be a `{ contents: [...] }` payload and for prompts a
// `{ messages: [...] }` payload, so each capability type gets its own filter
// shaping the recovery response accordingly.

// --- Tool filters --------------------------------------------------------
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

// --- Resource filters ----------------------------------------------------
@Catch(CustomError)
class CustomErrorResourceFilter implements RpcExceptionFilter<CustomError> {
  catch(exception: CustomError, host: ArgumentsHost): Observable<any> {
    const { uri } = host.switchToRpc().getData<{ uri?: string }>() ?? {};
    return of({
      contents: [
        {
          uri: uri ?? '',
          mimeType: 'text/plain',
          text: `[CustomError] ${exception.code}: ${exception.message}`,
        },
      ],
    });
  }
}

@Catch()
class CatchAllResourceFilter implements RpcExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): Observable<any> {
    const { uri } = host.switchToRpc().getData<{ uri?: string }>() ?? {};
    const message = exception instanceof Error ? exception.message : 'unknown';
    return of({
      contents: [
        { uri: uri ?? '', mimeType: 'text/plain', text: `[CatchAll] ${message}` },
      ],
    });
  }
}

// --- Prompt filters ------------------------------------------------------
@Catch(CustomError)
class CustomErrorPromptFilter implements RpcExceptionFilter<CustomError> {
  catch(exception: CustomError, _host: ArgumentsHost): Observable<any> {
    return of({
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: `[CustomError] ${exception.code}: ${exception.message}`,
          },
        },
      ],
    });
  }
}

@Catch()
class CatchAllPromptFilter implements RpcExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): Observable<any> {
    const message = exception instanceof Error ? exception.message : 'unknown';
    return of({
      messages: [
        {
          role: 'assistant',
          content: { type: 'text', text: `[CatchAll] ${message}` },
        },
      ],
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

@McpController()
@UseFilters(CatchAllResourceFilter)
class TestResources {
  @Resource({
    name: 'method-filter-resource',
    description: 'Method-level filter overrides class-level',
    uri: 'mcp://method-filter-resource',
    mimeType: 'text/plain',
  })
  @UseFilters(CustomErrorResourceFilter)
  async methodFilterResource() {
    throw new CustomError('Method error', 'ERR_001');
  }

  @Resource({
    name: 'class-filter-resource',
    description: 'Falls through to class-level catch-all filter',
    uri: 'mcp://class-filter-resource',
    mimeType: 'text/plain',
  })
  async classFilterResource() {
    throw new Error('Generic error');
  }

  @Resource({
    name: 'success-resource',
    description: 'Resource that succeeds',
    uri: 'mcp://success-resource',
    mimeType: 'text/plain',
  })
  async successResource(@Payload() { uri }: { uri: string }) {
    return { contents: [{ uri, mimeType: 'text/plain', text: 'OK' }] };
  }
}

@McpController()
@UseFilters(CatchAllPromptFilter)
class TestPrompts {
  @Prompt({
    name: 'method-filter-prompt',
    description: 'Method-level filter overrides class-level',
  })
  @UseFilters(CustomErrorPromptFilter)
  async methodFilterPrompt() {
    throw new CustomError('Method error', 'ERR_001');
  }

  @Prompt({
    name: 'class-filter-prompt',
    description: 'Falls through to class-level catch-all filter',
  })
  async classFilterPrompt() {
    throw new Error('Generic error');
  }

  @Prompt({
    name: 'success-prompt',
    description: 'Prompt that succeeds',
  })
  async successPrompt() {
    return {
      messages: [
        { role: 'assistant', content: { type: 'text', text: 'OK' } },
      ],
    };
  }
}

describe('E2E: MCP UseFilters', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'test-filters-server',
      controllers: [TestTools, TestResources, TestPrompts],
    });
    app = bootstrap.app;
    port = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Tools', () => {
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

  describe('Resources', () => {
    describe('Method Level', () => {
      it('should use method-level filter over class-level filter', async () => {
        const client = await createSseClient(port);
        try {
          const result = await client.readResource({
            uri: 'mcp://method-filter-resource',
          });
          expect((result.contents[0] as { text: string }).text).toBe(
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
          const result = await client.readResource({
            uri: 'mcp://class-filter-resource',
          });
          expect((result.contents[0] as { text: string }).text).toBe(
            '[CatchAll] Generic error',
          );
        } finally {
          await client.close();
        }
      });

      it('should not affect successful calls', async () => {
        const client = await createSseClient(port);
        try {
          const result = await client.readResource({
            uri: 'mcp://success-resource',
          });

          expect((result.contents[0] as { text: string }).text).toBe('OK');
        } finally {
          await client.close();
        }
      });
    });
  });

  describe('Prompts', () => {
    describe('Method Level', () => {
      it('should use method-level filter over class-level filter', async () => {
        const client = await createSseClient(port);
        try {
          const result = await client.getPrompt({
            name: 'method-filter-prompt',
          });
          expect((result.messages[0].content as { text: string }).text).toBe(
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
          const result = await client.getPrompt({
            name: 'class-filter-prompt',
          });
          expect((result.messages[0].content as { text: string }).text).toBe(
            '[CatchAll] Generic error',
          );
        } finally {
          await client.close();
        }
      });

      it('should not affect successful calls', async () => {
        const client = await createSseClient(port);
        try {
          const result = await client.getPrompt({ name: 'success-prompt' });

          expect(result.messages[0].content).toEqual({
            type: 'text',
            text: 'OK',
          });
        } finally {
          await client.close();
        }
      });
    });
  });
});
