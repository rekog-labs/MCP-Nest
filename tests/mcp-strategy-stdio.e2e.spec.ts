import { join } from 'path';
import { createStdioClient } from './utils';

describe('E2E: McpStrategy stdio transport', () => {
  it('lists and calls a tool over stdio', async () => {
    const client = await createStdioClient({
      serverScriptPath: join(__dirname, 'fixtures', 'stdio-server.ts'),
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'goodbye',
      'hello',
    ]);

    const res = (await client.callTool({
      name: 'hello',
      arguments: { name: 'Stdio' },
    })) as { content: Array<{ text: string }> };
    expect(res.content[0].text).toBe('Hello Stdio');

    await client.close();
  });
});
