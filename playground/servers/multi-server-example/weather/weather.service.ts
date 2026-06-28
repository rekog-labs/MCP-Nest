import { Injectable } from '@nestjs/common';

/**
 * Weather service - the SHARED business logic in this example.
 *
 * It powers the weather server's `get-weather` tool AND the travel server's
 * `weather-at-destination` tool. Both servers inject this same `@Injectable()`
 * instance via DI, so the weather lookup lives in exactly one place.
 */
@Injectable()
export class WeatherService {
  private readonly data: Record<string, string> = {
    tokyo: 'cloudy, 18°C',
    london: 'rainy, 14°C',
    'new york': 'sunny, 24°C',
  };

  getWeather(city: string): string {
    return this.data[city.toLowerCase()] ?? 'no data for that city';
  }

  listCities(): string[] {
    return Object.keys(this.data);
  }
}
