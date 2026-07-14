import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, McpTransportType, Tool, Context } from '@rekog/mcp-nest';
import {
  ECHO_TOOL_NAME,
  ECHO_TOOL_DESCRIPTION,
  echoParameters,
  generateSyntheticTools,
  getToolCount,
  textResult,
} from './shared-tools';

@Injectable()
class EchoToolService {
  @Tool({
    name: ECHO_TOOL_NAME,
    description: ECHO_TOOL_DESCRIPTION,
    parameters: echoParameters,
  })
  async echo(args: { text: string }, context: Context, request: unknown) {
    return textResult(args.text);
  }
}

// Synthetic tools are registered programmatically since their count/shape is
// driven by TOOL_COUNT at runtime. We apply the v1 `Tool()` decorator by hand
// to each generated prototype method, mirroring exactly what TypeScript emits
// for `@Tool(...)` on a class method (SetMetadata attaches metadata to the
// function referenced by the property descriptor's `value`).
@Injectable()
class SyntheticToolsService {}

const toolCount = getToolCount();
const syntheticDefs = generateSyntheticTools(toolCount);

for (const def of syntheticDefs) {
  Object.defineProperty(SyntheticToolsService.prototype, def.name, {
    value: async function syntheticHandler(args: unknown) {
      return textResult(JSON.stringify(args));
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });

  const descriptor = Object.getOwnPropertyDescriptor(
    SyntheticToolsService.prototype,
    def.name,
  )!;

  Tool({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  })(SyntheticToolsService.prototype, def.name, descriptor);
}

@Module({
  imports: [
    McpModule.forRoot({
      name: 'perf-bench-v1',
      version: '1.0.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        statelessMode: true,
        enableJsonResponse: true,
      },
    }),
  ],
  providers: [EchoToolService, SyntheticToolsService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const port = Number(process.env.PORT) || 4004;
  await app.listen(port, '127.0.0.1');
  console.log(`MCP server started on port ${port}`);
}

bootstrap();
