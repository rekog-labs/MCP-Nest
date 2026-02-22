import { ZodObject } from 'zod';
import { Context } from './mcp-tool.interface';
import type { PromptArgsRawShape } from '../decorators/prompt.decorator';

export type DynamicPromptHandler = (
  args: Record<string, string> | undefined,
  context: Context,
  request: any,
) => Promise<any> | any;

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
