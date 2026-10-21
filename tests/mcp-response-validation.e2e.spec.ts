import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { MCP_STRATEGY, McpController, McpStrategy, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { bootstrapMcpApp, createEraClient, ERAS, type Era } from './utils';

@McpController()
class PerToolValidationOptOut {
  @Tool({
    name: 'per-tool-validation-opt-out',
    description: 'Returns a response without server-side schema validation',
    outputSchema: z.object({ value: z.string() }),
    disableResponseValidation: true,
  })
  run() {
    return { value: 42 };
  }
}

@McpController()
class GlobalValidationOptOut {
  @Tool({
    name: 'global-validation-opt-out',
    description: 'Returns a response validated by the global server option',
    outputSchema: z.object({ value: z.string() }),
  })
  run() {
    return { value: 42 };
  }
}

@Injectable()
class DynamicValidationOptOut implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'dynamic-validation-opt-out',
      description: 'Returns a response without server-side schema validation',
      outputSchema: z.object({ value: z.string() }),
      disableResponseValidation: true,
      handler: async () => ({ value: 42 }),
    });
  }
}

@Injectable()
class DynamicGlobalValidationOptOut implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'dynamic-global-validation-opt-out',
      description: 'Returns a response validated by the global server option',
      outputSchema: z.object({ value: z.string() }),
      handler: async () => ({ value: 42 }),
    });
  }
}

async function expectUnvalidatedResponse(
  port: number,
  era: Era,
  toolName: string,
) {
  const client = await createEraClient(era, port);
  try {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === toolName);
    expect(tool?.outputSchema).toBeDefined();

    const result = (await client.callTool({
      name: toolName,
      arguments: {},
    })) as { structuredContent?: unknown };
    expect(result.structuredContent).toEqual({ value: 42 });
  } finally {
    await client.close();
  }
}

describe.each(ERAS)('tool response validation (%s era)', (era) => {
  let perToolPort: number;
  let perToolApp: Awaited<ReturnType<typeof bootstrapMcpApp>>['app'];
  let globalPort: number;
  let globalApp: Awaited<ReturnType<typeof bootstrapMcpApp>>['app'];

  beforeAll(async () => {
    const perTool = await bootstrapMcpApp({
      controllers: [PerToolValidationOptOut],
      providers: [DynamicValidationOptOut],
    });
    perToolApp = perTool.app;
    perToolPort = perTool.port;

    const global = await bootstrapMcpApp({
      controllers: [GlobalValidationOptOut],
      providers: [DynamicGlobalValidationOptOut],
      disableResponseValidation: true,
    });
    globalApp = global.app;
    globalPort = global.port;
  });

  afterAll(async () => {
    await perToolApp.close();
    await globalApp.close();
  });

  it('disables validation for decorated and dynamic tools individually', async () => {
    await expectUnvalidatedResponse(
      perToolPort,
      era,
      'per-tool-validation-opt-out',
    );
    await expectUnvalidatedResponse(
      perToolPort,
      era,
      'dynamic-validation-opt-out',
    );
  });

  it('disables validation globally for decorated and dynamic tools', async () => {
    await expectUnvalidatedResponse(
      globalPort,
      era,
      'global-validation-opt-out',
    );
    await expectUnvalidatedResponse(
      globalPort,
      era,
      'dynamic-global-validation-opt-out',
    );
  });
});
