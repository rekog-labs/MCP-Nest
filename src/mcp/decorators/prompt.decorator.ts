import { SetMetadata } from '@nestjs/common';
import { MCP_PROMPT_METADATA_KEY } from './constants';
import { ZodObject, ZodType } from 'zod';

type PromptArgsRawShape = {
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
  return SetMetadata(MCP_PROMPT_METADATA_KEY, options);
};
