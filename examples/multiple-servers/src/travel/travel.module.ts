import { Module } from '@nestjs/common';
import { TravelTools } from './travel.tools';
import { TravelService } from './travel.service';
import { WeatherModule } from '../weather/weather.module';

@Module({
  imports: [WeatherModule],
  controllers: [TravelTools],
  providers: [TravelService],
})
export class TravelModule {}
