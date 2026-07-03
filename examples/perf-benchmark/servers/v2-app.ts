/**
 * Shared bootstrap helper for the two `@rekog/mcp-nest` v2 benchmark servers
 * (`v2-stateless.ts` / `v2-stateful.ts`). They only differ in the
 * `StreamableHttpTransport` mode, so the Nest module/controller wiring and
 * the tool set are factored out here to keep the two entrypoints identical
 * apart from that one option.
 *
 * Tool set:
 *  - `echo` is a genuine decorator-based `@McpController` / `@Tool` handler
 *    (see `EchoTool` below), so the benchmark measures the real Nest
 *    MessagePattern/RPC pipeline (param binding, discovery, etc.) rather than
 *    a shortcut.
 *  - The (TOOL_COUNT - 1) synthetic tools are generated at boot from
 *    `generateSyntheticTools()` and registered through the SAME mechanism:
 *    the `@Tool` decorator is applied programmatically, in a loop, to
 *    methods added to a second controller's prototype. This keeps every
 *    tool — echo and synthetic — on the identical decorator/pipeline code
 *    path, so `tools/list` and `tools/call` benchmarks reflect the same
 *    dispatch cost a real multi-tool server would have.
 */
import 'reflect-metadata';
import { Module, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Payload } from '@nestjs/microservices';
import {
  MCP_STRATEGY,
  McpController,
  McpStrategy,
  Tool,
} from '@rekog/mcp-nest';
import {
  ECHO_TOOL_DESCRIPTION,
  ECHO_TOOL_NAME,
  echoParameters,
  generateSyntheticTools,
  getToolCount,
  textResult,
} from '../tools/shared-tools';

@McpController()
class EchoTool {
  @Tool({
    name: ECHO_TOOL_NAME,
    description: ECHO_TOOL_DESCRIPTION,
    parameters: echoParameters,
  })
  async echo(@Payload() { text }: { text: string }) {
    return textResult(text);
  }
}

/**
 * Empty shell class — synthetic tool methods are attached to its prototype
 * at boot time by `installSyntheticTools()` below, before Nest scans the
 * module for `@MessagePattern` handlers.
 */
@McpController()
class SyntheticTools {}

/**
 * Applies the `@Tool` decorator programmatically to (TOOL_COUNT - 1)
 * generated methods on `SyntheticTools.prototype`. This must run BEFORE
 * `NestFactory.create()` so Nest's controller/method discovery (which reads
 * prototype methods + their decorator-written metadata) sees the full set.
 */
function installSyntheticTools(toolCount: number): void {
  const defs = generateSyntheticTools(toolCount);
  const proto = SyntheticTools.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  for (const def of defs) {
    const methodName = def.name.replace(/-/g, '_');

    proto[methodName] = async function syntheticToolHandler() {
      return textResult('ok');
    };

    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName)!;
    Tool({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    })(proto, methodName, descriptor);
  }
}

export function buildAppModule(mcp: McpStrategy): Type<unknown> {
  installSyntheticTools(getToolCount());

  @Module({
    controllers: [EchoTool, SyntheticTools],
    providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
  })
  class AppModule {}

  return AppModule;
}

export async function bootstrap(mcp: McpStrategy): Promise<void> {
  const AppModule = buildAppModule(mcp);
  const port = process.env.PORT ? Number(process.env.PORT) : 3030;

  const app = await NestFactory.create(AppModule, { logger: false });
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(port, '127.0.0.1');
  console.log(`MCP server started on port ${port}`);
}
