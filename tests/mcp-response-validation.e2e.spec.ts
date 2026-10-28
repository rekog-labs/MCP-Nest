import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { MCP_STRATEGY, McpController, McpStrategy, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { bootstrapMcpApp, createEraClient, ERAS, type Era } from './utils';

/**
 * Advertised as `{ value: string }` in JSON Schema, so `{ value: 'x' }` is
 * valid for the client — but the refinement is a server-only check that
 * always fails. Only the server's own validation can reject this result, which
 * is exactly what `disableResponseValidation` turns off.
 */
const serverOnlyCheck = () =>
  z.object({
    value: z.string().refine(() => false, 'server-only check'),
  });

const RAW_JSON_SCHEMA = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
  additionalProperties: false,
} as const;

@McpController()
class ValidationTools {
  @Tool({
    name: 'default-validation',
    description: 'No flag: the server validates the result',
    outputSchema: serverOnlyCheck(),
  })
  defaultValidation() {
    return { value: 'x' };
  }

  @Tool({
    name: 'opt-out',
    description: 'Per-tool opt-out',
    outputSchema: serverOnlyCheck(),
    disableResponseValidation: true,
  })
  optOut() {
    return { value: 'x' };
  }

  @Tool({
    name: 'opt-in',
    description: 'Per-tool opt-in, overriding a global opt-out',
    outputSchema: serverOnlyCheck(),
    disableResponseValidation: false,
  })
  optIn() {
    return { value: 'x' };
  }

  @Tool({
    name: 'raw-json-schema',
    description: 'Raw JSON Schema output',
    outputSchema: RAW_JSON_SCHEMA,
  })
  rawJsonSchema() {
    return { value: 'x' };
  }

  @Tool({
    name: 'zod-default',
    description: 'Opt-out skips Zod defaults and key stripping',
    outputSchema: z.object({ value: z.string(), n: z.number().default(1) }),
    disableResponseValidation: true,
  })
  zodDefault() {
    return { value: 'x', extra: true };
  }
}

@Injectable()
class DynamicValidationTools implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'dynamic-default-validation',
      description: 'No flag: the server validates the result',
      outputSchema: serverOnlyCheck(),
      handler: async () => ({ value: 'x' }),
    });
    this.strategy.registerTool({
      name: 'dynamic-opt-out',
      description: 'Per-tool opt-out',
      outputSchema: serverOnlyCheck(),
      disableResponseValidation: true,
      handler: async () => ({ value: 'x' }),
    });
  }
}

type CallToolOptions = Parameters<
  Awaited<ReturnType<typeof createEraClient>>['callTool']
>[1];

async function callTool(
  port: number,
  era: Era,
  name: string,
  options?: CallToolOptions,
) {
  const client = await createEraClient(era, port);
  try {
    // List first so the SDK client caches the advertised outputSchema and
    // validates structuredContent against it, as a real client does.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === name)?.outputSchema).toBeDefined();
    return (await client.callTool({ name, arguments: {} }, options)) as {
      structuredContent?: unknown;
    };
  } finally {
    await client.close();
  }
}

async function expectServerRejects(port: number, era: Era, name: string) {
  let error: any;
  try {
    await callTool(port, era, name);
  } catch (e) {
    error = e;
  }
  expect(error?.message).toContain('Tool result does not match outputSchema');
  expect(error?.message).toContain('server-only check');
  expect(error?.code).toBe(-32603);
}

describe.each(ERAS)('tool response validation (%s era)', (era) => {
  let defaultApp: Awaited<ReturnType<typeof bootstrapMcpApp>>['app'];
  let defaultPort: number;
  let globalApp: Awaited<ReturnType<typeof bootstrapMcpApp>>['app'];
  let globalPort: number;

  beforeAll(async () => {
    ({ app: defaultApp, port: defaultPort } = await bootstrapMcpApp({
      controllers: [ValidationTools],
      providers: [DynamicValidationTools],
    }));
    ({ app: globalApp, port: globalPort } = await bootstrapMcpApp({
      controllers: [ValidationTools],
      providers: [DynamicValidationTools],
      disableResponseValidation: true,
    }));
  });

  afterAll(async () => {
    await defaultApp.close();
    await globalApp.close();
  });

  describe('without the global option', () => {
    it('validates results by default (decorated and dynamic tools)', async () => {
      await expectServerRejects(defaultPort, era, 'default-validation');
      await expectServerRejects(defaultPort, era, 'dynamic-default-validation');
    });

    it('skips validation for a per-tool opt-out (decorated and dynamic tools)', async () => {
      for (const name of ['opt-out', 'dynamic-opt-out']) {
        const result = await callTool(defaultPort, era, name);
        expect(result.structuredContent).toEqual({ value: 'x' });
      }
    });
  });

  describe('with disableResponseValidation: true on the server', () => {
    it('skips validation for decorated and dynamic tools without their own flag', async () => {
      for (const name of ['default-validation', 'dynamic-default-validation']) {
        const result = await callTool(globalPort, era, name);
        expect(result.structuredContent).toEqual({ value: 'x' });
      }
    });

    it('lets a per-tool disableResponseValidation: false turn validation back on', async () => {
      await expectServerRejects(globalPort, era, 'opt-in');
    });

    it('passes a conforming result through for a raw JSON Schema outputSchema', async () => {
      const result = await callTool(globalPort, era, 'raw-json-schema');
      expect(result.structuredContent).toEqual({ value: 'x' });
    });
  });

  it('sends the raw result: no Zod defaults, no unknown-key stripping', async () => {
    // Bypass the client's own check (a tool definition without outputSchema)
    // to observe exactly what the server put on the wire.
    const result = await callTool(defaultPort, era, 'zod-default', {
      toolDefinition: {
        name: 'zod-default',
        inputSchema: { type: 'object' },
      },
    });
    expect(result.structuredContent).toEqual({ value: 'x', extra: true });
  });
});
