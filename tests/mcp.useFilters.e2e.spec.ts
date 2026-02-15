import { INestApplication, Injectable, Catch, ExceptionFilter, UseFilters } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Tool, Resource, Prompt } from '../src';
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
    return `[CustomError] ${exception.code}: ${exception.message}`;
  }
}

@Catch()
class CatchAllFilter implements ExceptionFilter {
  catch(exception: Error) {
    return `[CatchAll] ${exception.message}`;
  }
}

@Injectable()
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

@Injectable()
@UseFilters(CatchAllFilter)
class TestResources {
  @Resource({
    name: 'method-filter-resource',
    description: 'Method-level filter overrides class-level',
    uri: 'mcp://method-filter-resource',
    mimeType: 'text/plain',
  })
  @UseFilters(CustomErrorFilter)
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
  async successResource({ uri }: { uri: string }) {
    return { contents: [{ uri, mimeType: 'text/plain', text: 'OK' }] };
  }
}

@Injectable()
@UseFilters(CatchAllFilter)
class TestPrompts {
  @Prompt({
    name: 'method-filter-prompt',
    description: 'Method-level filter overrides class-level',
  })
  @UseFilters(CustomErrorFilter)
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
    return { messages: [{ role: 'assistant', content: { type: 'text', text: 'OK' } }] };
  }
}

describe('E2E: MCP UseFilters', () => {
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
      providers: [TestTools, TestResources, TestPrompts],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Tools', () => {
    describe('Method Level', () => {
      it('should use method-level filter over class-level filter', async () => {
        const client = await createSseClient(port);
        try {
          const result: any = await client.callTool({ name: 'method-filter-tool', arguments: {} });

          expect(result.isError).toBe(true);
          expect(result.content[0].text).toBe('[CustomError] ERR_001: Method error');
        } finally {
          await client.close();
        }
      });
    });

    describe('Class Level', () => {
      it('should catch any error with catch-all filter', async () => {
        const client = await createSseClient(port);
        try {
          const result: any = await client.callTool({ name: 'class-filter-tool', arguments: {} });

          expect(result.isError).toBe(true);
          expect(result.content[0].text).toBe('[CatchAll] Generic error');
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
  });

  describe('Resources', () => {
    describe('Method Level', () => {
      it('should use method-level filter over class-level filter', async () => {
        const client = await createSseClient(port);

        try {
          await expect(
            client.readResource({ uri: 'mcp://method-filter-resource' }),
          ).rejects.toMatchObject({
            code: -32603,
            message: expect.stringContaining('[CustomError] ERR_001: Method error'),
          });
        } finally {
          await client.close();
        }
      });
    });

    describe('Class Level', () => {
      it('should catch any error with catch-all filter', async () => {
        const client = await createSseClient(port);
        try {
          await expect(
            client.readResource({ uri: 'mcp://class-filter-resource' }),
          ).rejects.toMatchObject({
            code: -32603,
            message: expect.stringContaining('[CatchAll] Generic error'),
          });
        } finally {
          await client.close();
        }
      });

      it('should not affect successful calls', async () => {
        const client = await createSseClient(port);
        try {
          const result = await client.readResource({ uri: 'mcp://success-resource' });

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
          await expect(
            client.getPrompt({ name: 'method-filter-prompt' }),
          ).rejects.toMatchObject({
            code: -32603,
            message: expect.stringContaining('[CustomError] ERR_001: Method error'),
          });
        } finally {
          await client.close();
        }
      });
    });

    describe('Class Level', () => {
      it('should catch any error with catch-all filter', async () => {
        const client = await createSseClient(port);
        try {
          await expect(
            client.getPrompt({ name: 'class-filter-prompt' }),
          ).rejects.toMatchObject({
            code: -32603,
            message: expect.stringContaining('[CatchAll] Generic error'),
          });
        } finally {
          await client.close();
        }
      });

      it('should not affect successful calls', async () => {
        const client = await createSseClient(port);
        try {
          const result = await client.getPrompt({ name: 'success-prompt' });

          expect(result.messages[0].content).toEqual({ type: 'text', text: 'OK' });
        } finally {
          await client.close();
        }
      });
    });
  });
});
