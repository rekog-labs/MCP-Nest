import { Module } from '@nestjs/common';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { WeatherModule } from './weather/weather.module';
import { TravelModule } from './travel/travel.module';

export const weatherStrategy = new McpStrategy({
  name: 'weather',
  version: '1.0.0',
  server: 'weather',
  transports: [new StreamableHttpTransport({ endpoint: '/weather/mcp' })],
});

export const travelStrategy = new McpStrategy({
  name: 'travel',
  version: '1.0.0',
  server: 'travel',
  transports: [new StreamableHttpTransport({ endpoint: '/travel/mcp' })],
});

@Module({
  imports: [WeatherModule, TravelModule],
})
export class AppModule {}
