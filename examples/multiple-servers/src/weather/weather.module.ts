import { Module } from '@nestjs/common';
import { WeatherTools } from './weather.tools';
import { WeatherService } from './weather.service';

@Module({
  controllers: [WeatherTools],
  providers: [WeatherService],
  exports: [WeatherService],
})
export class WeatherModule {}
