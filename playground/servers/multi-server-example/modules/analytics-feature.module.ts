import { Module } from '@nestjs/common';
import { AnalyticsTools } from '../tools/analytics.tools';
import { AnalyticsService } from '../services/analytics.service';

/**
 * Analytics Feature Module
 *
 * The capability class is a `@McpController` (declared in `controllers`); its
 * dependency is a normal provider.
 */
@Module({
  controllers: [AnalyticsTools],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsFeatureModule {}
