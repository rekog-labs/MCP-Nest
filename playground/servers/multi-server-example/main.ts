import { NestFactory } from '@nestjs/core';
import { AppModule, weatherStrategy, travelStrategy } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Both strategies share the one HTTP adapter; each mounts its own transport
  // on its own distinct domain endpoint.
  const httpAdapter = app.getHttpAdapter();
  weatherStrategy.setHttpAdapter(httpAdapter);
  travelStrategy.setHttpAdapter(httpAdapter);
  app.connectMicroservice({ strategy: weatherStrategy });
  app.connectMicroservice({ strategy: travelStrategy });
  await app.startAllMicroservices();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log('');
  console.log('🚀 Multi-Domain MCP Example started successfully!');
  console.log('   Each domain is its own MCP server on its own endpoint.');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🌤️  WEATHER SERVER (weather)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   MCP Endpoint:        http://localhost:${port}/weather/mcp`);
  console.log('');
  console.log('   Tools (weather domain):');
  console.log('   • get-weather            - Get current weather for a city');
  console.log('   • list-cities            - List cities with weather data');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧭 TRAVEL SERVER (travel)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   MCP Endpoint:        http://localhost:${port}/travel/mcp`);
  console.log('');
  console.log('   Tools (travel domain):');
  console.log('   • recommend-destination  - Suggest a city for an interest');
  console.log('   • weather-at-destination - Suggest a city AND its weather');
  console.log('');
  console.log("   `weather-at-destination` reuses the weather server's");
  console.log('   WeatherService via DI — one service, shared across servers.');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('💡 Example Usage with MCP Inspector:');
  console.log('');
  console.log('   npx @modelcontextprotocol/inspector \\');
  console.log(`     http://localhost:${port}/weather/mcp`);
  console.log('');
  console.log('   Or the travel server:');
  console.log('');
  console.log('   npx @modelcontextprotocol/inspector \\');
  console.log(`     http://localhost:${port}/travel/mcp`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

void bootstrap();
