import { Catch, RpcExceptionFilter, UseFilters } from '@nestjs/common';
import { McpController, Tool, Resource, Prompt } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { z } from 'zod';

export class CustomError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

@Catch(CustomError)
export class CustomErrorFilter implements RpcExceptionFilter {
  catch(exception: CustomError): Observable<never> {
    // Throw (don't return) so the message is surfaced as an `isError` result.
    return throwError(() => ({
      status: 'error',
      message: `[${exception.code}] ${exception.message}`,
    }));
  }
}

@Catch()
export class CatchAllFilter implements RpcExceptionFilter {
  catch(exception: Error): Observable<never> {
    return throwError(() => ({
      status: 'error',
      message: `Unexpected error: ${exception.message}`,
    }));
  }
}

@McpController()
@UseFilters(CatchAllFilter)
export class FilteredService {
  @Tool({
    name: 'my-tool',
    description: 'A tool with custom error handling',
    parameters: z.object({ input: z.string() }),
  })
  @UseFilters(CustomErrorFilter)
  async myTool(@Payload() { input }: { input: string }) {
    if (!input) {
      throw new CustomError('Input is required', 'VALIDATION_ERROR');
    }
    return `Processed: ${input}`;
  }

  // Always throws — reliably exercises the method-level CustomErrorFilter.
  @Tool({
    name: 'boom',
    description: 'Always throws a CustomError',
    parameters: z.object({}),
  })
  @UseFilters(CustomErrorFilter)
  async boom(@Payload() _a: {}) {
    throw new CustomError('kaboom', 'BOOM');
  }

  @Resource({
    name: 'my-resource',
    description: 'A resource with error handling',
    uri: 'mcp://my-resource',
    mimeType: 'text/plain',
  })
  async myResource(@Payload() { uri }: { uri: string }) {
    throw new Error('Resource unavailable');
  }

  @Prompt({
    name: 'my-prompt',
    description: 'A prompt with error handling',
  })
  async myPrompt() {
    throw new CustomError('Prompt failed', 'PROMPT_ERROR');
  }
}
