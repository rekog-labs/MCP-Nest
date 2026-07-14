import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

// REAL mode when Azure creds are present; otherwise FAKE mode (MCP_FAKE_AUTH=1)
// boots with dummy creds so discovery + guarded MCP work fully offline.
const FAKE = process.env.MCP_FAKE_AUTH === '1';

const clientId =
  process.env.AZURE_AD_CLIENT_ID || (FAKE ? 'fake-azure-client-id' : undefined);
const clientSecret =
  process.env.AZURE_AD_CLIENT_SECRET ||
  (FAKE ? 'fake-azure-client-secret' : undefined);
// jwtSecret must be >= 32 chars (validated by McpAuthModule).
export const JWT_SECRET =
  process.env.JWT_SECRET ||
  (FAKE ? 'fake-jwt-secret-at-least-32-characters-long' : undefined);

if (!clientId || !clientSecret || !JWT_SECRET) {
  throw new Error(
    'Missing Azure AD creds. Provide AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET / JWT_SECRET, or set MCP_FAKE_AUTH=1 for offline mode.',
  );
}

const mcpTransport = new StreamableHttpTransport();

export const mcp = new McpStrategy({
  name: 'My MCP Server with Azure AD',
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
      jwtSecret: JWT_SECRET,
      serverUrl: SERVER_URL,
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
  console.log(`started on port ${PORT} (mode=${FAKE ? 'FAKE' : 'REAL'})`);
}
void bootstrap();
