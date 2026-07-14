import 'reflect-metadata';
import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import {
  GitHubOAuthProvider,
  McpAuthJwtGuard,
  McpAuthModule,
} from '@rekog/mcp-nest-auth';
import { MyTools } from './my-tools';
import { FAKE_USERS, mintFakeToken } from './fake-auth';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// serverUrl/resource are required by McpAuthModule (must be valid URLs). Default
// them from PORT so the offline demo runs with no extra env.
process.env.SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const SERVER_URL = process.env.SERVER_URL;
const RESOURCE = SERVER_URL + '/mcp';

// jwtSecret must be >= 32 chars.
const JWT_SECRET =
  process.env.JWT_SECRET || 'fake_local_dev_secret_at_least_32_chars_long';

const allowUnauthenticatedAccess =
  process.env.ALLOW_UNAUTHENTICATED_ACCESS === 'true';

// --- Mode selection --------------------------------------------------------
// REAL: real GitHub credentials present -> full OAuth handshake possible.
// FAKE: MCP_FAKE_AUTH=1 -> dummy provider creds; identity comes from locally
//       minted HS256 JWTs (printed below) so the whole matrix runs offline.
const hasRealGitHub = !!(
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
);
const fakeAuth = process.env.MCP_FAKE_AUTH === '1' && !hasRealGitHub;

if (!hasRealGitHub && !fakeAuth) {
  throw new Error(
    'No auth configured. Set GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET for REAL mode, ' +
      'or MCP_FAKE_AUTH=1 for offline FAKE mode.',
  );
}

const CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'fake-client-id';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'fake-client-secret';

const mcpTransport = new StreamableHttpTransport();

const strategy = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [mcpTransport],
  allowUnauthenticatedAccess,
});

@Controller('mcp')
@UseGuards(McpAuthJwtGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      jwtSecret: JWT_SECRET,
      serverUrl: SERVER_URL,
      resource: RESOURCE,
      apiPrefix: 'auth',
    }),
  ],
  controllers: [McpHttpController, MyTools],
  providers: [
    McpAuthJwtGuard,
    { provide: 'MCP_OPTIONS', useValue: { allowUnauthenticatedAccess } },
  ],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(PORT);

  console.log(`MCP OAuth server started on port ${PORT}`);
  console.log(`mode=${fakeAuth ? 'FAKE' : 'REAL(github)'}`);
  console.log(`allowUnauthenticatedAccess=${allowUnauthenticatedAccess}`);

  if (fakeAuth) {
    console.log('--- FAKE tokens (Bearer) ---');
    for (const [label, user] of Object.entries(FAKE_USERS)) {
      console.log(`${label}=${mintFakeToken(user, JWT_SECRET, RESOURCE)}`);
    }
    console.log('--- end tokens ---');
  }
}
void bootstrap();
