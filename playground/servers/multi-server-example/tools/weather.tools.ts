/* eslint-disable @typescript-eslint/require-await */
import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { WeatherService } from '../services/weather.service';

/**
 * Weather tools - provides weather information.
 * Exposed on the "public" MCP server.
 */
@McpController()
export class WeatherTools {
  constructor(private readonly weatherService: WeatherService) {}

  @Tool({
    name: 'get-weather',
    description: 'Get current weather for a city',
    parameters: z.object({
      city: z
        .string()
        .describe('Name of the city (e.g., "New York", "London")'),
    }),
  })
  async getWeather(@Payload() { city }: { city: string }) {
    const weather = this.weatherService.getWeather(city);
    const weatherText = `Weather in ${city}: ${weather.temp}°F, ${weather.condition}, ${weather.humidity}% humidity`;

    return {
      content: [
        {
          type: 'text' as const,
          text: weatherText,
        },
      ],
    };
  }

  @Tool({
    name: 'list-cities',
    description: 'List all available cities with weather data',
  })
  async listCities() {
    const cities = this.weatherService.getAllCities();
    const citiesText = `Available cities: ${cities.join(', ')}`;

    return {
      content: [
        {
          type: 'text' as const,
          text: citiesText,
        },
      ],
    };
  }
}
