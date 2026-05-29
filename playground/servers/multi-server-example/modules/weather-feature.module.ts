import { Module } from '@nestjs/common';
import { WeatherTools } from '../tools/weather.tools';
import { WeatherService } from '../services/weather.service';

/**
 * Weather Feature Module
 *
 * The capability class is a `@McpController` (declared in `controllers`); its
 * dependency is a normal provider. There is no `McpModule.forFeature` anymore —
 * controllers are bound to the connected `McpStrategy` automatically.
 */
@Module({
  controllers: [WeatherTools],
  providers: [WeatherService],
  exports: [WeatherService],
})
export class WeatherFeatureModule {}
