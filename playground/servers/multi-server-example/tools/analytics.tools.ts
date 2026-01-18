import { Injectable } from '@nestjs/common';
import { Tool } from '../../../../src';
import { z } from 'zod';
import { AnalyticsService } from '../services/analytics.service';

/**
 * Analytics tools - provides analytics and metrics
 * This will be registered to the "admin-server"
 */
@Injectable()
export class AnalyticsTools {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Tool({
    name: 'get-metrics',
    description: 'Get overall system metrics including request counts and user statistics',
  })
  async getMetrics() {
    const metrics = this.analyticsService.getMetrics();

    const metricsText = `
System Metrics:
- Total Requests: ${metrics.totalRequests}
- Unique Users: ${metrics.uniqueUsers}
- Top Endpoints: ${metrics.topEndpoints.map((e) => `${e.endpoint} (${e.count})`).join(', ')}
    `.trim();

    return {
      content: [
        {
          type: 'text' as const,
          text: metricsText,
        },
      ],
    };
  }

  @Tool({
    name: 'track-request',
    description: 'Manually track a request for analytics purposes',
    parameters: z.object({
      endpoint: z.string().describe('The endpoint being accessed'),
      userId: z.string().optional().describe('Optional user ID'),
    }),
  })
  async trackRequest({ endpoint, userId }: { endpoint: string; userId?: string }) {
    this.analyticsService.trackRequest(endpoint, userId);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Request tracked for endpoint: ${endpoint}${userId ? ` (user: ${userId})` : ''}`,
        },
      ],
    };
  }
}
