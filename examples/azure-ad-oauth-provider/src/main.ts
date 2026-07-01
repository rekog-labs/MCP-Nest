import { NestFactory } from '@nestjs/core';
import { Controller, Module, UseGuards } from '@nestjs/common';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { McpAuthModule, AzureADOAuthProvider } from '@rekog/mcp-nest-auth';
import { MyTools } from './my-tools';
import { McpAuthGuard } from './mcp-auth.guard';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// FAKE_AUTH lets the server boot with dummy Azure creds so every
// offline-reachable feature (discovery endpoints, guarded MCP calls with a
// locally minted JWT) works with zero external network. The interactive Azure
// authorize -> callback leg still needs a live tenant.
const FAKE_AUTH = process.env.MCP_FAKE_AUTH === '1';

export const FAKE_JWT_SECRET = 'fake-azure-ad-jwt-secret-0123456789abcdef';

const clientId = process.env.AZURE_AD_CLIENT_ID || (FAKE_AUTH ? 'fake-azure-client-id' : undefined);
const clientSecret =
  process.env.AZURE_AD_CLIENT_SECRET || (FAKE_AUTH ? 'fake-azure-client-secret' : undefined);
const jwtSecret =
  process.env.JWT_SECRET || (FAKE_AUTH ? FAKE_JWT_SECRET : undefined);

if (!clientId || !clientSecret || !jwtSecret) {
  throw new Error(
    'Missing Azure AD credentials. Set AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET / JWT_SECRET, or run with MCP_FAKE_AUTH=1.',
  );
}

const mcpTransport = new StreamableHttpTransport();

const mcp = new McpStrategy({
  name: 'Azure AD MCP Server',
  version: '1.0.0',
  transports: [mcpTransport],
});

// Mount the MCP route as a real Nest controller so `McpAuthGuard` validates the
// Bearer JWT and sets `req.user` on every transport request. The OAuth
// endpoints (/auth/*, /.well-known/*) stay open because only this controller is
// guarded.
@Controller('mcp')
@UseGuards(McpAuthGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: AzureADOAuthProvider,
      clientId,
      clientSecret,
      jwtSecret,
      serverUrl: SERVER_URL,
      resource: process.env.RESOURCE_URL || `${SERVER_URL}/mcp`,
      storeConfiguration: {
        type: 'typeorm',
        options: {
          type: 'sqlite',
          database: 'oauth-azure-ad.db',
          synchronize: true,
        },
      },
      apiPrefix: 'auth',
    }),
  ],
  controllers: [McpHttpController, MyTools],
  providers: [McpAuthGuard],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });

  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });

  await app.startAllMicroservices();
  await app.listen(PORT);
  console.log(`started on port ${PORT}`);
}

void bootstrap();
