/* eslint-disable @typescript-eslint/require-await */
import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { TravelService } from './travel.service';
import { WeatherService } from '../weather/weather.service';

/**
 * Travel tools - the travel domain.
 * Assigned to the "travel" MCP server, so these tools bind only to the travel
 * strategy and are served at /travel/mcp.
 *
 * Note the two injected services: `TravelService` is this server's own logic,
 * while `WeatherService` is the SAME service the weather server uses. The
 * `weather-at-destination` tool reuses it — that's how you share logic across
 * servers: put it in an `@Injectable()` and inject it wherever it's needed.
 */
@McpController({ server: 'travel' })
export class TravelTools {
  constructor(
    private readonly travelService: TravelService,
    private readonly weatherService: WeatherService,
  ) {}

  @Tool({
    name: 'recommend-destination',
    description: 'Recommend a destination city for an interest',
    parameters: z.object({
      interest: z
        .string()
        .describe('What you are into, e.g. "food", "history", "nightlife"'),
    }),
  })
  async recommendDestination(@Payload() { interest }: { interest: string }) {
    const city = this.travelService.recommend(interest);
    return {
      content: [
        {
          type: 'text' as const,
          text: `For ${interest}, visit ${city}.`,
        },
      ],
    };
  }

  @Tool({
    name: 'weather-at-destination',
    description: 'Recommend a destination for an interest and report its weather',
    parameters: z.object({
      interest: z
        .string()
        .describe('What you are into, e.g. "food", "history", "nightlife"'),
    }),
  })
  async weatherAtDestination(@Payload() { interest }: { interest: string }) {
    // Own-domain logic: pick a destination...
    const city = this.travelService.recommend(interest);
    // ...then reuse the SHARED weather service for the forecast.
    const weather = this.weatherService.getWeather(city);
    return {
      content: [
        {
          type: 'text' as const,
          text: `For ${interest}, visit ${city} — weather there: ${weather}.`,
        },
      ],
    };
  }
}
