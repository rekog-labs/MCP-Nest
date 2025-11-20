import { SetMetadata } from '@nestjs/common';
import { MCP_PROMPT_METADATA_KEY } from './constants';
import { z } from 'zod';

export interface PromptMetadata {
  name: string;
  description: string;
  parameters?: z.ZodObject<any>;
}

export interface PromptOptions {
  name?: string;
  description: string;
  parameters?: z.ZodObject<any>;
}

export const Prompt = (options: PromptOptions) => {
  return SetMetadata(MCP_PROMPT_METADATA_KEY, options);
};
