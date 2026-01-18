import { Module } from '@nestjs/common';
import { McpModule } from '../../../../src';
import { AnalyticsTools } from '../tools/analytics.tools';
import { AnalyticsService } from '../services/analytics.service';

/**
 * Analytics Feature Module
 * Registers analytics tools to the "admin-server"
 */
@Module({
  imports: [
    // Register AnalyticsTools to the "admin-server"
    McpModule.forFeature([AnalyticsTools], 'admin-server'),
  ],
  providers: [
    AnalyticsTools,
    AnalyticsService, // AnalyticsTools depends on AnalyticsService
  ],
  exports: [AnalyticsTools, AnalyticsService],
})
export class AnalyticsFeatureModule {}
