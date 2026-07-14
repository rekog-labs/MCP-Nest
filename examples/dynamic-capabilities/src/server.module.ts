import { Module } from '@nestjs/common';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';

export const mcp = new McpStrategy({
  name: 'dynamic-capabilities',
  version: '0.0.1',
  transports: [new StreamableHttpTransport({ statefulMode: true })],
});

@Module({
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
  exports: [MCP_STRATEGY],
})
export class ServerModule {}
