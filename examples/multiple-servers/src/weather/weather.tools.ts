import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { WeatherService } from './weather.service';

@McpController({ server: 'weather' })
export class WeatherTools {
  constructor(private readonly weatherService: WeatherService) {}

  @Tool({
    name: 'get-weather',
    description: 'Get current weather for a city',
    parameters: z.object({ city: z.string() }),
  })
  async getWeather(@Payload() { city }: { city: string }) {
    return {
      content: [
        {
          type: 'text',
          text: `Weather in ${city}: ${this.weatherService.getWeather(city)}`,
        },
      ],
    };
  }
}
