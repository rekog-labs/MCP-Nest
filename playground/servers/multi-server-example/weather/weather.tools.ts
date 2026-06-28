/* eslint-disable @typescript-eslint/require-await */
import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { WeatherService } from './weather.service';

/**
 * Weather tools - the weather domain.
 * Assigned to the "weather" MCP server, so these tools bind only to the weather
 * strategy and are served at /weather/mcp.
 */
@McpController({ server: 'weather' })
export class WeatherTools {
  constructor(private readonly weatherService: WeatherService) {}

  @Tool({
    name: 'get-weather',
    description: 'Get current weather for a city',
    parameters: z.object({
      city: z.string().describe('Name of the city (e.g., "Tokyo", "London")'),
    }),
  })
  async getWeather(@Payload() { city }: { city: string }) {
    const weather = this.weatherService.getWeather(city);
    return {
      content: [{ type: 'text' as const, text: `Weather in ${city}: ${weather}` }],
    };
  }

  @Tool({
    name: 'list-cities',
    description: 'List all cities with weather data',
  })
  async listCities() {
    const cities = this.weatherService.listCities();
    return {
      content: [
        { type: 'text' as const, text: `Available cities: ${cities.join(', ')}` },
      ],
    };
  }
}
