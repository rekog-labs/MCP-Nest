import { Module } from '@nestjs/common';
import { McpModule } from '../../../../src';
import { WeatherTools } from '../tools/weather.tools';
import { WeatherService } from '../services/weather.service';

/**
 * Weather Feature Module
 * Registers weather tools to the "public-server"
 */
@Module({
  imports: [
    // Register WeatherTools to the "public-server"
    McpModule.forFeature([WeatherTools], 'public-server'),
  ],
  providers: [
    WeatherTools,
    WeatherService, // WeatherTools depends on WeatherService
  ],
  exports: [WeatherTools, WeatherService],
})
export class WeatherFeatureModule {}
