import { INestApplication } from '@nestjs/common';
import { McpController, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { bootstrapMcpApp, createEraClient, ERAS, type Era } from './utils';

/**
 * Issue #296. From zod 4.5, `z.toJSONSchema()` turns a root schema that has an
 * `id` (`.meta({ id })`, common when the same schemas also generate OpenAPI
 * components) into `{ $ref: '#/$defs/<id>', $defs }`. Advertised as is, the
 * tool's `inputSchema` has no root `type: "object"`, the SDK client rejects
 * the whole `tools/list` result, and every tool disappears — not only the one
 * with the named schema.
 */

const GetThingInput = z.object({ id: z.string() }).meta({ id: 'GetThingInput' });
const GetThingOutput = z
  .object({ id: z.string(), label: z.string() })
  .meta({ id: 'GetThingOutput' });

type TreeNode = { name: string; children: TreeNode[] };
const TreeNodeSchema: z.ZodType<TreeNode> = z
  .object({
    name: z.string(),
    get children() {
      return z.array(TreeNodeSchema);
    },
  })
  .meta({ id: 'TreeNode' });

@McpController()
class NamedSchemaTools {
  @Tool({
    name: 'get-thing',
    description: 'Input and output schemas carry a Zod id',
    parameters: GetThingInput,
    outputSchema: GetThingOutput,
  })
  getThing({ id }: z.infer<typeof GetThingInput>) {
    return { id, label: `thing ${id}` };
  }

  @Tool({
    name: 'echo-tree',
    description: 'A recursive schema with an id, as input and output',
    parameters: TreeNodeSchema,
    outputSchema: TreeNodeSchema,
  })
  echoTree(tree: TreeNode) {
    return tree;
  }

  @Tool({
    name: 'plain',
    description: 'A tool without a named schema',
    parameters: z.object({ q: z.string() }),
  })
  plain({ q }: { q: string }) {
    return { content: [{ type: 'text', text: q }] };
  }
}

describe.each(ERAS)('Tool schemas with a Zod id — %s era', (era: Era) => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const boot = await bootstrapMcpApp({ controllers: [NamedSchemaTools] });
    app = boot.app;
    port = boot.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists every tool (the SDK client validates the result)', async () => {
    const client = await createEraClient(era, port);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'echo-tree',
        'get-thing',
        'plain',
      ]);
    } finally {
      await client.close();
    }
  });

  it('advertises the named object at the root of inputSchema and outputSchema', async () => {
    const client = await createEraClient(era, port);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === 'get-thing')!;
      expect(tool.inputSchema).toEqual({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      });
      expect(tool.outputSchema).toMatchObject({
        type: 'object',
        properties: { id: { type: 'string' }, label: { type: 'string' } },
        required: ['id', 'label'],
      });
      expect(tool.outputSchema).not.toHaveProperty('$ref');
    } finally {
      await client.close();
    }
  });

  it('points a recursive schema at the root', async () => {
    const client = await createEraClient(era, port);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === 'echo-tree')!;
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema).not.toHaveProperty('$ref');
      expect(tool.inputSchema.properties?.children).toEqual({
        type: 'array',
        items: { $ref: '#' },
      });
    } finally {
      await client.close();
    }
  });

  it('calls the tools; the client checks structuredContent against outputSchema', async () => {
    const client = await createEraClient(era, port);
    try {
      // `callTool` validates `structuredContent` against the advertised
      // `outputSchema`, so this also checks the inlined schema still resolves.
      await client.listTools();
      const thing = await client.callTool({
        name: 'get-thing',
        arguments: { id: '42' },
      });
      expect(thing.isError).toBeFalsy();
      expect(thing.structuredContent).toEqual({ id: '42', label: 'thing 42' });

      const tree = {
        name: 'root',
        children: [{ name: 'leaf', children: [] }],
      };
      const echoed = await client.callTool({
        name: 'echo-tree',
        arguments: tree,
      });
      expect(echoed.isError).toBeFalsy();
      expect(echoed.structuredContent).toEqual(tree);

      const bad = await client.callTool({
        name: 'get-thing',
        arguments: { id: 1 },
      });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
