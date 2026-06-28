import { applyDecorators, SetMetadata } from '@nestjs/common';
import { MCP_PROMPT_METADATA_KEY } from './constants';
import { ZodObject, ZodType } from 'zod';
import { mcpMessagePattern } from './mcp-message-pattern';

export type PromptArgsRawShape = {
  [k: string]: ZodType;
};

export interface PromptMetadata {
  name: string;
  description: string;
  parameters?: ZodObject<PromptArgsRawShape>;
}

export interface PromptOptions {
  name?: string;
  description: string;
  parameters?: ZodObject<PromptArgsRawShape>;
}

export const Prompt = (options: PromptOptions) => {
  return applyDecorators(
    SetMetadata(MCP_PROMPT_METADATA_KEY, options),
    mcpMessagePattern('prompt', options.name),
  );
};
