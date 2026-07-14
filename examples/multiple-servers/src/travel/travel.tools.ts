import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { TravelService } from './travel.service';
import { WeatherService } from '../weather/weather.service';

@McpController({ server: 'travel' })
export class TravelTools {
  constructor(
    private readonly travelService: TravelService,
    private readonly weatherService: WeatherService,
  ) {}

  @Tool({
    name: 'weather-at-destination',
    description: 'Recommend a destination for an interest and report its weather',
    parameters: z.object({ interest: z.string() }),
  })
  async weatherAtDestination(@Payload() { interest }: { interest: string }) {
    const city = this.travelService.recommend(interest);
    const weather = this.weatherService.getWeather(city);
    return {
      content: [
        {
          type: 'text',
          text: `For ${interest}, visit ${city} — weather there: ${weather}.`,
        },
      ],
    };
  }
}
