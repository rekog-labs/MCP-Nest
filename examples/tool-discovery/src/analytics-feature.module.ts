import { Module } from '@nestjs/common';
import { AnalyticsTools } from './analytics.tools';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsTools],
  providers: [AnalyticsService],
})
export class AnalyticsFeatureModule {}
