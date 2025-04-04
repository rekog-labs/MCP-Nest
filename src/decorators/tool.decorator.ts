import { SetMetadata } from '@nestjs/common';
import { MCP_TOOL_METADATA_KEY } from './constants';
import { z } from 'zod';

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
}

export const Tool = ({
  name,
  description,
  parameters,
}: {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
}) => {
  return SetMetadata(MCP_TOOL_METADATA_KEY, {
    name,
    description,
    parameters,
  });
};
