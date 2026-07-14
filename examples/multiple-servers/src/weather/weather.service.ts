import { Injectable } from '@nestjs/common';

@Injectable()
export class WeatherService {
  private readonly data: Record<string, string> = {
    tokyo: 'cloudy, 18°C',
    london: 'rainy, 14°C',
  };
  getWeather(city: string): string {
    return this.data[city.toLowerCase()] ?? 'no data for that city';
  }
}
