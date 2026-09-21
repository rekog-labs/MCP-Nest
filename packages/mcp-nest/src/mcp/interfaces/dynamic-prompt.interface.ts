import { ZodObject } from 'zod';
import type { McpContext } from '../transport/mcp-context';
import type { PromptArgsRawShape } from '../decorators/prompt.decorator';

export type DynamicPromptHandler = (
  args: Record<string, string> | undefined,
  context: McpContext,
  request: any,
) => any;

export interface DynamicPromptDefinition {
  /** Unique name for the prompt */
  name: string;
  /** Description shown to the LLM */
  description: string;
  /** Zod schema describing the prompt arguments */
  parameters?: ZodObject<PromptArgsRawShape>;
  /** Handler function that returns the prompt messages */
  handler: DynamicPromptHandler;
}
