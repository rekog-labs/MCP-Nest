import { Injectable } from '@nestjs/common';

/**
 * Analytics service - tracks and reports usage metrics
 */
@Injectable()
export class AnalyticsService {
  private metrics = {
    totalRequests: 0,
    uniqueUsers: new Set<string>(),
    requestsByEndpoint: new Map<string, number>(),
  };

  trackRequest(endpoint: string, userId?: string) {
    this.metrics.totalRequests++;
    if (userId) {
      this.metrics.uniqueUsers.add(userId);
    }
    const count = this.metrics.requestsByEndpoint.get(endpoint) || 0;
    this.metrics.requestsByEndpoint.set(endpoint, count + 1);
  }

  getMetrics() {
    return {
      totalRequests: this.metrics.totalRequests,
      uniqueUsers: this.metrics.uniqueUsers.size,
      topEndpoints: Array.from(this.metrics.requestsByEndpoint.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([endpoint, count]) => ({ endpoint, count })),
    };
  }

  getRequestCount(endpoint: string): number {
    return this.metrics.requestsByEndpoint.get(endpoint) || 0;
  }
}
