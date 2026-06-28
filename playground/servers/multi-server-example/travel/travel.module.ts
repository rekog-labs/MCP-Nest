import { Module } from '@nestjs/common';
import { TravelTools } from './travel.tools';
import { TravelService } from './travel.service';
import { WeatherModule } from '../weather/weather.module';

/**
 * Travel feature - its service, its `@McpController` tools, and this module all
 * live in this folder.
 *
 * It imports the weather feature's `WeatherModule` (which exports
 * `WeatherService`) so `TravelTools` can inject the SAME `WeatherService` the
 * weather server uses — sharing logic across servers via ordinary NestJS DI.
 */
@Module({
  imports: [WeatherModule],
  controllers: [TravelTools],
  providers: [TravelService],
  exports: [TravelService],
})
export class TravelModule {}
