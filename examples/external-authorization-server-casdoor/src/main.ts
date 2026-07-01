import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { mcpStrategy } from './mcp.runtime';

const PORT = Number(process.env.PORT ?? 3030);
const SERVER_URL = process.env.SERVER_URL ?? `http://localhost:${PORT}`;
const CASDOOR_URL = process.env.CASDOOR_URL ?? 'http://localhost:8000';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
    // MCP clients need to read these from the browser.
    exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
  });

  // The MCP route is owned by McpHttpController (self-mount auto-disabled),
  // and CasdoorAuthGuard authenticates it — so there is NO auth middleware to
  // register here. Just attach the adapter, connect + start the microservice.
  mcpStrategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcpStrategy });
  await app.startAllMicroservices();
  await app.listen(PORT);

  console.log('');
  console.log('🔐 External-Auth MCP server (resource server) is up');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   MCP endpoint:            ${SERVER_URL}/mcp  (Bearer required)`);
  console.log(
    `   Protected-resource meta: ${SERVER_URL}/.well-known/oauth-protected-resource/mcp`,
  );
  console.log(`   Authorization server:    ${CASDOOR_URL}  (Casdoor / docker compose)`);
  console.log(
    `   AS metadata:             ${CASDOOR_URL}/.well-known/openid-configuration`,
  );
  console.log(`   JWKS:                    ${CASDOOR_URL}/.well-known/jwks`);
  console.log('   Auth:                    CasdoorAuthGuard on McpHttpController (guard, not middleware)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Mint a token + call a tool (non-interactive):');
  console.log('     ./scripts/get-token.sh        # client_credentials -> JWT');
  console.log(
    '     ACCESS_TOKEN=$(./scripts/get-token.sh) npm run call',
  );
  console.log('');
}

void bootstrap();
