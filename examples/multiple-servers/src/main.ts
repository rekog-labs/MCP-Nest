import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, weatherStrategy, travelStrategy } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const httpAdapter = app.getHttpAdapter();
  weatherStrategy.setHttpAdapter(httpAdapter);
  travelStrategy.setHttpAdapter(httpAdapter);
  app.connectMicroservice({ strategy: weatherStrategy } as any);
  app.connectMicroservice({ strategy: travelStrategy } as any);

  await app.startAllMicroservices();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`started on port ${port}`);
}
bootstrap();
