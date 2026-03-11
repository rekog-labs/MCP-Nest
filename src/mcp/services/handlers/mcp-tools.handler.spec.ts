import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { McpToolsHandler } from './mcp-tools.handler';

const formatToolResult = McpToolsHandler.prototype['formatToolResult'].bind({
  buildDefaultContentBlock: McpToolsHandler.prototype['buildDefaultContentBlock'],
});

const schema = z.object({ name: z.string(), age: z.number() });

describe('formatToolResult', () => {
  it('strips extra keys from structuredContent when outputSchema is set', () => {
    const result = formatToolResult({ name: 'Alice', age: 30, extra: true }, schema);

    expect(result.structuredContent).toEqual({ name: 'Alice', age: 30 });
    expect(result.structuredContent).not.toHaveProperty('extra');
  });

  it('keeps the original result (with extra keys) in the content text block', () => {
    const result = formatToolResult({ name: 'Alice', age: 30, extra: true }, schema);
    const text = JSON.parse(result.content[0].text);

    expect(text).toHaveProperty('extra', true);
  });

  it('throws McpError when result does not match outputSchema', () => {
    expect(() => formatToolResult({ name: 'Alice' }, schema)).toThrow(McpError);
  });

  it('wraps result in content block when no outputSchema is provided', () => {
    const result = formatToolResult({ anything: 42 });

    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toBe('{"anything":42}');
  });

  it('returns as-is when result already has a content array', () => {
    const existing = { content: [{ type: 'text', text: 'hi' }] };
    expect(formatToolResult(existing, schema)).toBe(existing);
  });
});
