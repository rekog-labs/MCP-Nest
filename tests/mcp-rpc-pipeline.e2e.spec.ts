import {
  ArgumentsHost,
  Catch,
  CallHandler,
  ExecutionContext,
  Injectable,
  INestApplication,
  NestInterceptor,
  PipeTransform,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RpcExceptionFilter } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { Observable, of, map } from 'rxjs';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { createStreamableClient } from './utils';

@Injectable()
class UpperCaseNamePipe implements PipeTransform {
  transform(value: any) {
    if (value && typeof value.name === 'string') {
      value.name = value.name.toUpperCase();
    }
    return value;
  }
}

@Injectable()
class SuffixInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((result: any) => {
        if (result?.content?.[0]?.text) {
          result.content[0].text += ' [intercepted]';
        }
        return result;
      }),
    );
  }
}

@Catch()
class ToResultFilter implements RpcExceptionFilter {
  catch(_exception: unknown, _host: ArgumentsHost): Observable<any> {
    return of({
      content: [{ type: 'text', text: 'filtered-error' }],
      isError: true,
    });
  }
}

@McpController()
class PipelineController {
  @Tool({
    name: 'pipe-tool',
    description: 'Uses a transform pipe on its payload',
    parameters: z.object({ name: z.string() }),
  })
  pipeTool(@Payload(UpperCaseNamePipe) { name }: { name: string }) {
    return { content: [{ type: 'text', text: name }] };
  }

  @Tool({
    name: 'interceptor-tool',
    description: 'Has its result rewritten by an interceptor',
    parameters: z.object({}),
  })
  @UseInterceptors(SuffixInterceptor)
  interceptorTool() {
    return { content: [{ type: 'text', text: 'original' }] };
  }

  @Tool({
    name: 'filter-tool',
    description: 'Throws, but an exception filter rewrites the response',
    parameters: z.object({}),
  })
  @UseFilters(ToResultFilter)
  filterTool() {
    throw new Error('boom');
  }
}

describe('E2E: McpStrategy RPC pipeline', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const strategy = new McpStrategy({
      name: 'pipeline-server',
      version: '0.0.1',
      transports: [new StreamableHttpTransport({ statefulMode: true })],
    });

    const moduleFixture = await Test.createTestingModule({
      controllers: [PipelineController],
    }).compile();

    app = moduleFixture.createNestApplication();
    strategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy });
    await app.startAllMicroservices();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs pipes on the payload', async () => {
    const client = await createStreamableClient(port);
    const res = (await client.callTool({
      name: 'pipe-tool',
      arguments: { name: 'alice' },
    })) as { content: Array<{ text: string }> };
    expect(res.content[0].text).toBe('ALICE');
    await client.close();
  });

  it('runs interceptors around the handler', async () => {
    const client = await createStreamableClient(port);
    const res = (await client.callTool({
      name: 'interceptor-tool',
      arguments: {},
    })) as { content: Array<{ text: string }> };
    expect(res.content[0].text).toBe('original [intercepted]');
    await client.close();
  });

  it('applies exception filters', async () => {
    const client = await createStreamableClient(port);
    const res = (await client.callTool({
      name: 'filter-tool',
      arguments: {},
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.content[0].text).toBe('filtered-error');
    await client.close();
  });
});
