import { Context } from './mcp-tool.interface';

export type DynamicResourceHandler = (
  params: Record<string, unknown>,
  context: Context,
  request: any,
) => Promise<any> | any;

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