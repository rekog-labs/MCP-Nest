import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { MCP_STRATEGY, McpStrategy } from '@rekog/mcp-nest';
import { ServerModule } from './server.module';

@Injectable()
export class ExternalCapabilitiesService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'external-tool',
      description: 'A tool registered from an external module',
      handler: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
  }
}

@Module({
  imports: [ServerModule],
  providers: [ExternalCapabilitiesService],
})
export class ExternalModule {}
