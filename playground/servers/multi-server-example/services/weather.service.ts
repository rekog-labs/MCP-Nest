import { Injectable } from '@nestjs/common';

/**
 * Weather service - provides weather data
 */
@Injectable()
export class WeatherService {
  private weatherData = {
    'new-york': { temp: 72, condition: 'sunny', humidity: 65 },
    london: { temp: 58, condition: 'rainy', humidity: 85 },
    tokyo: { temp: 68, condition: 'cloudy', humidity: 70 },
  };

  getWeather(city: string) {
    const normalizedCity = city.toLowerCase().replace(/\s+/g, '-');
    return (
      this.weatherData[normalizedCity] || {
        temp: 65,
        condition: 'unknown',
        humidity: 50,
      }
    );
  }

  getAllCities() {
    return Object.keys(this.weatherData).map((city) =>
      city.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
    );
  }
}
