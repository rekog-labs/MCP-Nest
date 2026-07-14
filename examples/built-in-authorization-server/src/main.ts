import 'reflect-metadata';
import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import {
  McpAuthModule,
  McpAuthJwtGuard,
  GitHubOAuthProvider,
} from '@rekog/mcp-nest-auth';
import { GreetingTool } from './greeting.tool';

const PORT = Number(process.env.PORT ?? 3014);
const SERVER_URL = `http://localhost:${PORT}`;
const JWT_SECRET =
  process.env.JWT_SECRET ?? 'dev-super-secure-jwt-secret-at-least-32-chars';

// Two modes:
//  - REAL: real GitHub credentials present -> wire the real provider.
//  - FAKE: MCP_FAKE_AUTH=1 and no real creds -> dummy creds so the module
//    constructs and every offline feature (discovery, DCR, JWT validation,
//    guarded MCP calls with a locally-minted JWT) works without any IdP call.
const fakeAuth = process.env.MCP_FAKE_AUTH === '1';
const clientId =
  process.env.GITHUB_CLIENT_ID ?? (fakeAuth ? 'fake-client-id' : '');
const clientSecret =
  process.env.GITHUB_CLIENT_SECRET ?? (fakeAuth ? 'fake-client-secret' : '');

const mcpTransport = new StreamableHttpTransport();

const mcp = new McpStrategy({
  name: 'secure-mcp-server',
  version: '1.0.0',
  transports: [mcpTransport],
});

// Mount the MCP route as a real Nest controller and protect it with the
// built-in `McpAuthJwtGuard`. The guard validates the Bearer JWT (via the
// module's JwtTokenService), rejects missing/invalid tokens with 401, and sets
// `req.user`. The OAuth endpoints (/auth/*, /.well-known/*) stay open — only
// this controller is guarded — so the handshake can still run.
@Controller('mcp')
@UseGuards(McpAuthJwtGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId,
      clientSecret,
      jwtSecret: JWT_SECRET,
      resource: `${SERVER_URL}/mcp`,
      serverUrl: SERVER_URL,
      apiPrefix: 'auth',
    }),
  ],
  controllers: [McpHttpController, GreetingTool],
  providers: [McpAuthJwtGuard],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Required for OAuth session management (this is NOT authentication).
  app.use(cookieParser());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp } as any);

  await app.startAllMicroservices();
  await app.listen(PORT);
  console.log(`started on port ${PORT}`);
}
void bootstrap();
