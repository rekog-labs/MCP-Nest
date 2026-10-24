import {
  ArgumentsHost,
  Catch,
  Controller,
  Get,
  HttpException,
  INestApplication,
  RpcExceptionFilter,
  UseFilters,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import {
  Client,
  ProtocolError,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  McpController,
  McpExceptionFilter,
  McpStrategy,
  Prompt,
  Resource,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { Observable, of } from 'rxjs';
import { z } from 'zod';
import { ERAS, MODERN_PROTOCOL_VERSION } from './utils';

const REQUEST_MS = 1500;
const TEST_MS = 8000;
const PRIVATE_SENTINEL = 'MCP281_PRIVATE_HTTP_ERROR_DO_NOT_DISCLOSE';
const entered = new Set<string>();
const thrown = new Map<unknown, string>();
const caught = new Map<string, string>();
const specific = new Map<string, string>();

const HTTP_CASES = [
  {
    id: 'HTTP_418_STRING',
    path: 'string',
    status: 418,
    body: { statusCode: 418, message: 'http-visible' },
  },
  {
    id: 'HTTP_418_OBJECT',
    path: 'object',
    status: 418,
    body: { message: 'http-object-visible', detail: 'preserved', code: 281 },
  },
  {
    id: 'HTTP_500_MASKED',
    path: 'unknown',
    status: 500,
    body: { statusCode: 500, message: 'Internal server error' },
  },
] as const;

const TOOL_CASES = [
  ['MCP_RPC_STRING', 'global-rpc-string', 'rpc-string-visible'],
  ['MCP_RPC_OBJECT', 'global-rpc-object', 'rpc-object-visible'],
  ['MCP_ERROR', 'global-error', 'mcp-error-visible'],
  ['MCP_NON_ERROR', 'global-non-error', 'Internal server error'],
] as const;

function fail(id: string, exception: unknown): never {
  entered.add(id);
  thrown.set(exception, id);
  throw exception;
}

function observeGlobalCatch(
  this: McpExceptionFilter,
  exception: unknown,
  host: ArgumentsHost,
) {
  const id = thrown.get(exception);
  if (id) caught.set(id, host.getType());
  return originalCatch.call(this, exception, host);
}

const originalCatch = McpExceptionFilter.prototype.catch;

@Controller('global-filter')
class HttpControls {
  @Get('string')
  stringException() {
    return fail('HTTP_418_STRING', new HttpException('http-visible', 418));
  }

  @Get('object')
  objectException() {
    return fail(
      'HTTP_418_OBJECT',
      new HttpException(
        { message: 'http-object-visible', detail: 'preserved', code: 281 },
        418,
      ),
    );
  }

  @Get('unknown')
  unknownException() {
    return fail('HTTP_500_MASKED', new Error(PRIVATE_SENTINEL));
  }

  @Get('success')
  success() {
    entered.add('HTTP_SUCCESS');
    return { ok: true };
  }
}

@McpController()
class McpControls {
  @Tool({ name: 'global-rpc-string', parameters: z.object({}) })
  rpcString() {
    return fail('MCP_RPC_STRING', new RpcException('rpc-string-visible'));
  }

  @Tool({ name: 'global-rpc-object', parameters: z.object({}) })
  rpcObject() {
    return fail(
      'MCP_RPC_OBJECT',
      new RpcException({ status: 'explicit', message: 'rpc-object-visible' }),
    );
  }

  @Tool({ name: 'global-error', parameters: z.object({}) })
  error() {
    return fail('MCP_ERROR', new Error('mcp-error-visible'));
  }

  @Tool({ name: 'global-non-error', parameters: z.object({}) })
  nonError() {
    return fail('MCP_NON_ERROR', { private: 'non-error-private' });
  }

  @Tool({ name: 'global-success', parameters: z.object({}) })
  success() {
    entered.add('MCP_TOOL_SUCCESS');
    return { content: [{ type: 'text', text: 'tool-ok' }] };
  }

  @Resource({ name: 'global-error-resource', uri: 'mcp://global-error' })
  resourceError() {
    return fail('MCP_RESOURCE_ERROR', new Error('resource-error-visible'));
  }

  @Resource({ name: 'global-success-resource', uri: 'mcp://global-success' })
  resourceSuccess() {
    entered.add('MCP_RESOURCE_SUCCESS');
    return {
      contents: [{ uri: 'mcp://global-success', text: 'resource-ok' }],
    };
  }

  @Prompt({
    name: 'global-error-prompt',
    description: 'Global exception prompt control',
  })
  promptError() {
    return fail(
      'MCP_PROMPT_ERROR',
      new RpcException({ message: 'prompt-error-visible', status: 'explicit' }),
    );
  }

  @Prompt({
    name: 'global-success-prompt',
    description: 'Successful prompt control',
  })
  promptSuccess() {
    entered.add('MCP_PROMPT_SUCCESS');
    return {
      messages: [
        { role: 'assistant', content: { type: 'text', text: 'prompt-ok' } },
      ],
    };
  }
}

@Catch()
class ClassFilter implements RpcExceptionFilter {
  catch(exception: unknown): Observable<unknown> {
    specific.set(thrown.get(exception)!, 'class');
    return of({
      content: [{ type: 'text', text: 'class-filter-visible' }],
      isError: true,
    });
  }
}

@Catch()
class MethodFilter implements RpcExceptionFilter {
  catch(exception: unknown): Observable<unknown> {
    specific.set(thrown.get(exception)!, 'method');
    return of({
      content: [{ type: 'text', text: 'method-filter-visible' }],
      isError: true,
    });
  }
}

@McpController()
@UseFilters(ClassFilter)
class SpecificControls {
  @Tool({ name: 'global-class-precedence', parameters: z.object({}) })
  classPrecedence() {
    return fail('MCP_CLASS_PRECEDENCE', new Error('class-original'));
  }

  @Tool({ name: 'global-method-precedence', parameters: z.object({}) })
  @UseFilters(MethodFilter)
  methodPrecedence() {
    return fail('MCP_METHOD_PRECEDENCE', new Error('method-original'));
  }
}

async function bounded<T>(
  id: string,
  operation: Promise<T>,
  ms: number,
  closeLate?: (value: T) => Promise<unknown>,
) {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error(`[${id}] INFRASTRUCTURE_DEADLINE ${ms}ms`));
    }, ms);
  });
  const observed = operation.then(async (value) => {
    if (expired && closeLate) {
      await bounded(`${id}_LATE_CLEANUP`, closeLate(value), 3000);
    }
    return value;
  });
  try {
    return await Promise.race([observed, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function httpRequest(port: number, path: string, id: string) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_MS);
  try {
    const response = await fetch(
      `http://localhost:${port}/global-filter/${path}`,
      { signal: abort.signal },
    );
    const body: unknown = await response.json();
    return { status: response.status, body };
  } catch (cause) {
    const attributable =
      abort.signal.aborted && entered.has(id) && caught.get(id) === 'http';
    if (attributable) {
      expect({
        controlId: id,
        entered: entered.has(id),
        globalCaught: caught.get(id),
        nativeResponseCompleted: false,
      }).toEqual({
        controlId: id,
        entered: true,
        globalCaught: 'http',
        nativeResponseCompleted: true,
      });
    }
    const reason = attributable
      ? 'HTTP_RESPONSE_DEADLINE_AFTER_HANDLER_AND_GLOBAL_FILTER'
      : 'HTTP_INFRASTRUCTURE_FAILURE';
    const failure = new Error(
      `[${id}] ${reason}; entered=${entered.has(id)}; globalCaught=${caught.get(id)}`,
    );
    Object.assign(failure, { cause });
    throw failure;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

function requestOptions() {
  return {
    timeout: REQUEST_MS,
    maxTotalTimeout: REQUEST_MS,
    resetTimeoutOnProgress: false,
    signal: AbortSignal.timeout(REQUEST_MS),
  };
}

function expectObserved(id: string, host: string) {
  expect(entered.has(id)).toBe(true);
  expect(caught.get(id)).toBe(host);
}

function expectToolError(result: unknown, message: string) {
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: message }],
  });
}

describe('E2E: APP_FILTER HTTP and MCP global exception contract', () => {
  let app: INestApplication | undefined;
  let nativeApp: INestApplication | undefined;
  let port: number;
  let nativePort: number;

  beforeAll(async () => {
    McpExceptionFilter.prototype.catch = observeGlobalCatch;
    const nativeModule = await bounded(
      'SETUP_NATIVE_COMPILE',
      Test.createTestingModule({ controllers: [HttpControls] }).compile(),
      5000,
      (module) => module.close(),
    );
    nativeApp = nativeModule.createNestApplication({ logger: false });
    await bounded('SETUP_NATIVE_LISTEN', nativeApp.listen(0), 5000, () =>
      nativeApp!.close(),
    );
    nativePort = (nativeApp.getHttpServer().address() as { port: number }).port;

    const strategy = new McpStrategy({
      name: 'global-exception-contract',
      version: '0.0.1',
      transports: [new StreamableHttpTransport({ statefulMode: true })],
    });
    const moduleFixture = await bounded(
      'SETUP_HYBRID_COMPILE',
      Test.createTestingModule({
        controllers: [HttpControls, McpControls, SpecificControls],
        providers: [{ provide: APP_FILTER, useClass: McpExceptionFilter }],
      }).compile(),
      5000,
      (module) => module.close(),
    );
    app = moduleFixture.createNestApplication({ logger: false });
    strategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy }, { inheritAppConfig: true });
    await bounded(
      'SETUP_HYBRID_MICROSERVICES',
      app.startAllMicroservices(),
      5000,
      () => app!.close(),
    );
    await bounded('SETUP_HYBRID_LISTEN', app.listen(0), 5000, () =>
      app!.close(),
    );
    port = (app.getHttpServer().address() as { port: number }).port;
    expect(app.getHttpAdapter()).toBeDefined();
  }, 30000);

  beforeEach(() => {
    entered.clear();
    thrown.clear();
    caught.clear();
    specific.clear();
  });

  afterAll(async () => {
    try {
      if (app) {
        app.getHttpServer().closeAllConnections();
        await bounded('TEARDOWN_HYBRID', app.close(), 3000);
      }
    } finally {
      try {
        if (nativeApp) {
          nativeApp.getHttpServer().closeAllConnections();
          await bounded('TEARDOWN_NATIVE', nativeApp.close(), 3000);
        }
      } finally {
        McpExceptionFilter.prototype.catch = originalCatch;
      }
    }
  }, 8000);

  it.each(HTTP_CASES)(
    'NATIVE_HTTP counterpart $id completes without the global filter',
    async ({ id, path, status, body }) => {
      const result = await httpRequest(nativePort, path, id);
      expect(result).toEqual({ status, body });
      expect(entered.has(id)).toBe(true);
      expect(caught.has(id)).toBe(false);
      expect(JSON.stringify(result.body)).not.toContain(PRIVATE_SENTINEL);
    },
    TEST_MS,
  );

  it(
    'HTTP_SUCCESS completes on the hybrid application',
    async () => {
      const result = await httpRequest(port, 'success', 'HTTP_SUCCESS');
      expect(result).toEqual({ status: 200, body: { ok: true } });
      expect(entered.has('HTTP_SUCCESS')).toBe(true);
      expect(caught.has('HTTP_SUCCESS')).toBe(false);
    },
    TEST_MS,
  );

  describe.each(ERAS)('MCP controls (%s era)', (era) => {
    let client: Client | undefined;
    const abort = new AbortController();

    beforeAll(async () => {
      client = new Client(
        { name: 'global-exception-client', version: '0.0.1' },
        {
          capabilities: {},
          ...(era === 'modern'
            ? {
                versionNegotiation: {
                  mode: { pin: MODERN_PROTOCOL_VERSION },
                } as const,
              }
            : {}),
        },
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
        { requestInit: { signal: abort.signal } },
      );
      await bounded(
        `SETUP_CLIENT_${era}`,
        client.connect(transport, { timeout: 3000 }),
        4000,
        () => client!.close(),
      );
    }, TEST_MS);

    afterAll(async () => {
      abort.abort();
      if (client) {
        await bounded(`TEARDOWN_CLIENT_${era}`, client.close(), 1500);
      }
    }, TEST_MS);

    it.each(TOOL_CASES)(
      '%s preserves the global filter tool envelope',
      async (id, name, message) => {
        const result = await client!.callTool(
          { name, arguments: {} },
          requestOptions(),
        );
        expectToolError(result, message);
        expectObserved(id, 'rpc');
      },
      TEST_MS,
    );

    it(
      'MCP_TOOL_SUCCESS preserves successful tool results',
      async () => {
        const result = await client!.callTool(
          { name: 'global-success', arguments: {} },
          requestOptions(),
        );
        expect(result).toMatchObject({
          content: [{ type: 'text', text: 'tool-ok' }],
        });
        expect(result.isError).not.toBe(true);
        expect(entered.has('MCP_TOOL_SUCCESS')).toBe(true);
        expect(caught.has('MCP_TOOL_SUCCESS')).toBe(false);
      },
      TEST_MS,
    );

    it(
      'MCP_RESOURCE_ERROR preserves JSON-RPC error conversion',
      async () => {
        const result = client!.readResource(
          { uri: 'mcp://global-error' },
          requestOptions(),
        );
        await expect(result).rejects.toBeInstanceOf(ProtocolError);
        await expect(result).rejects.toMatchObject({
          code: -32603,
          message: expect.stringContaining('resource-error-visible'),
        });
        expectObserved('MCP_RESOURCE_ERROR', 'rpc');
      },
      TEST_MS,
    );

    it(
      'MCP_RESOURCE_SUCCESS preserves successful resource results',
      async () => {
        const result = await client!.readResource(
          { uri: 'mcp://global-success' },
          requestOptions(),
        );
        expect(result).toMatchObject({
          contents: [{ uri: 'mcp://global-success', text: 'resource-ok' }],
        });
        expect(entered.has('MCP_RESOURCE_SUCCESS')).toBe(true);
        expect(caught.has('MCP_RESOURCE_SUCCESS')).toBe(false);
      },
      TEST_MS,
    );

    it(
      'MCP_PROMPT_ERROR preserves JSON-RPC error conversion',
      async () => {
        const result = client!.getPrompt(
          { name: 'global-error-prompt' },
          requestOptions(),
        );
        await expect(result).rejects.toBeInstanceOf(ProtocolError);
        await expect(result).rejects.toMatchObject({
          code: -32603,
          message: expect.stringContaining('prompt-error-visible'),
        });
        expectObserved('MCP_PROMPT_ERROR', 'rpc');
      },
      TEST_MS,
    );

    it(
      'MCP_PROMPT_SUCCESS preserves successful prompt results',
      async () => {
        const result = await client!.getPrompt(
          { name: 'global-success-prompt' },
          requestOptions(),
        );
        expect(result).toMatchObject({
          messages: [
            { role: 'assistant', content: { type: 'text', text: 'prompt-ok' } },
          ],
        });
        expect(entered.has('MCP_PROMPT_SUCCESS')).toBe(true);
        expect(caught.has('MCP_PROMPT_SUCCESS')).toBe(false);
      },
      TEST_MS,
    );

    it.each(['class', 'method'] as const)(
      'MCP_%s_PRECEDENCE preserves more-specific filter precedence',
      async (level) => {
        const id = `MCP_${level.toUpperCase()}_PRECEDENCE`;
        const result = await client!.callTool(
          { name: `global-${level}-precedence`, arguments: {} },
          requestOptions(),
        );
        expectToolError(result, `${level}-filter-visible`);
        expect(entered.has(id)).toBe(true);
        expect(specific.get(id)).toBe(level);
        expect(caught.has(id)).toBe(false);
      },
      TEST_MS,
    );
  });

  it.each(HTTP_CASES)(
    'HYBRID_HTTP $id must complete with native Nest status and body',
    async ({ id, path, status, body }) => {
      const result = await httpRequest(port, path, id);
      expectObserved(id, 'http');
      expect(result).toEqual({ status, body });
      expect(JSON.stringify(result.body)).not.toContain(PRIVATE_SENTINEL);
      expect(JSON.stringify(result.body)).not.toContain('stack');
    },
    TEST_MS,
  );
});
