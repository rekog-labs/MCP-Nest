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
import { DemoClientController } from './demo-client.controller';
import { LocalFakeIdpProvider } from './fake-idp.provider';
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
//
// Three additive, opt-in switches for the Tier 4 walkthrough in README.md. All
// default OFF: with none of them set this file behaves exactly as it did before
// they existed.
//  - MCP_CONSENT=1   -> show the interactive consent screen.
//  - MCP_CIMD=1      -> accept Client ID Metadata Document client_ids, and host
//                       a document + a stand-in client callback (implies consent,
//                       which McpAuthModule enforces).
//  - MCP_FAKE_IDP=1  -> swap GitHub for an offline auto-approving IdP so the
//                       browser leg (/authorize -> IdP -> /callback -> consent)
//                       can be walked through with no GitHub App. Implies
//                       MCP_FAKE_AUTH.
const fakeIdp = process.env.MCP_FAKE_IDP === '1';
const fakeAuth = process.env.MCP_FAKE_AUTH === '1' || fakeIdp;
const consentEnabled = process.env.MCP_CONSENT === '1';
const cimdEnabled = process.env.MCP_CIMD === '1';

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
      provider: fakeIdp ? LocalFakeIdpProvider : GitHubOAuthProvider,
      clientId,
      clientSecret,
      jwtSecret: JWT_SECRET,
      resource: `${SERVER_URL}/mcp`,
      serverUrl: SERVER_URL,
      apiPrefix: 'auth',

      // Interactive consent. Off unless asked for, and forced on by CIMD below —
      // a Client ID Metadata Document client is identified only by a URL it
      // controls, so the spec requires the authorization server to clearly
      // display the redirect URI hostname during authorization, which needs a
      // screen. Pass `render` here to substitute your own page.
      ...(consentEnabled ? { consent: { enabled: true } } : {}),

      ...(cimdEnabled
        ? {
            clientIdMetadataDocuments: {
              enabled: true,
              // ⚠️ DEVELOPMENT ONLY. Permits `http://` client_id URLs and stops
              // the SSRF guard refusing loopback destinations — which is the
              // only reason `http://localhost:3014/client-metadata.json` can be
              // used as a client_id here. In production the document must live
              // on an https origin that is not a private address, and this
              // option must stay false.
              allowInsecureClientIdScheme: true,
            },
          }
        : {}),
    }),
  ],
  controllers: [
    McpHttpController,
    GreetingTool,
    // The client-side half of the CIMD demo. Not registered otherwise, so the
    // default route table is untouched.
    ...(cimdEnabled ? [DemoClientController] : []),
  ],
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

  if (fakeIdp) {
    console.log(
      'MCP_FAKE_IDP=1: the IdP is a local stub that authenticates everyone as ' +
        '"Ada Lovelace". Never use this outside a demo.',
    );
  }
  if (cimdEnabled) {
    console.log(
      `MCP_CIMD=1: metadata document at ${SERVER_URL}/client-metadata.json ` +
        '(use that URL as client_id)',
    );
  }
  if (consentEnabled || cimdEnabled) {
    console.log('Consent screen: ON (rendered by /auth/callback)');
  }
}
void bootstrap();
