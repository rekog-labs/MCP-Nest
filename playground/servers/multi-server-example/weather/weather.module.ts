import { Module } from '@nestjs/common';
import { WeatherTools } from './weather.tools';
import { WeatherService } from './weather.service';

/**
 * Weather feature - everything the weather domain needs lives in this folder:
 * its service, its `@McpController` tools, and this module.
 *
 * `WeatherService` is exported so other servers (e.g. travel) can reuse it.
 */
@Module({
  controllers: [WeatherTools],
  providers: [WeatherService],
  exports: [WeatherService],
})
export class WeatherModule {}
