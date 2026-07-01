import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { AnalyticsService } from './analytics.service';

@McpController()
export class AnalyticsTools {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Tool({
    name: 'count-items',
    description: 'Counts the given items',
    parameters: z.object({ items: z.array(z.string()) }),
  })
  countItems(@Payload() { items }: { items: string[] }) {
    const count = this.analyticsService.count(items);
    return { content: [{ type: 'text', text: String(count) }] };
  }
}
