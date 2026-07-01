import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';

export const mcpServerA = new McpStrategy({
  name: 'server-a',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ endpoint: '/server-a/mcp' })],
});
export const mcpServerB = new McpStrategy({
  name: 'server-b',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ endpoint: '/server-b/mcp' })],
});

export const MCP_STRATEGY_A = Symbol('MCP_STRATEGY_A');
export const MCP_STRATEGY_B = Symbol('MCP_STRATEGY_B');

@Injectable()
export class ServerAExternalTools implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY_A) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'server-a-tool',
      description: 'Only visible on server A',
      handler: async () => ({ content: [{ type: 'text', text: 'server-a' }] }),
    });
  }
}

@Module({
  providers: [
    { provide: MCP_STRATEGY_A, useValue: mcpServerA },
    { provide: MCP_STRATEGY_B, useValue: mcpServerB },
    ServerAExternalTools,
  ],
})
export class MultiServerModule {}
