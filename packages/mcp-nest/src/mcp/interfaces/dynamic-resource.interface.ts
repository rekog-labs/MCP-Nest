import type { McpContext } from '../transport/mcp-context';

export type DynamicResourceHandler = (
  params: Record<string, unknown>,
  context: McpContext,
  request: any,
) => any;

export interface DynamicResourceDefinition {
  /** URI that uniquely identifies this resource */
  uri: string;
  /** Human-readable name (defaults to uri if omitted) */
  name?: string;
  /** Optional description shown to the LLM */
  description?: string;
  /** Optional MIME type of the resource content */
  mimeType?: string;
  /** Additional metadata */
  _meta?: Record<string, any>;
  /** Handler function that returns the resource content */
  handler: DynamicResourceHandler;
}
