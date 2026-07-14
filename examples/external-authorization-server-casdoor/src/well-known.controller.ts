import { Controller, Get } from '@nestjs/common';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3030';
const CASDOOR_URL = process.env.CASDOOR_URL ?? 'http://localhost:8000';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * This is the ONLY OAuth-related thing the MCP resource server exposes. It tells
 * an MCP client "I'm a resource server, and the authorization server that
 * protects me is Casdoor." The client fetches this document, reads
 * `authorization_servers`, then fetches
 * `<Casdoor>/.well-known/openid-configuration` to discover the authorize /
 * token / registration (DCR) endpoints — all of which live in Casdoor, not here.
 *
 * Per RFC 9728 the metadata for resource `http://localhost:3030/mcp` lives at
 * `/.well-known/oauth-protected-resource/mcp`; we also serve the bare
 * `/.well-known/oauth-protected-resource` for clients that probe the root.
 */
@Controller('.well-known')
export class WellKnownController {
  private metadata() {
    return {
      resource: `${SERVER_URL}/mcp`,
      authorization_servers: [CASDOOR_URL],
      // Casdoor signs access tokens with RS256; the resource server verifies
      // them against these published public keys (no shared secret).
      jwks_uri: `${CASDOOR_URL}/.well-known/jwks`,
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'profile', 'email'],
      resource_documentation: `${SERVER_URL}/docs`,
    };
  }

  @Get('oauth-protected-resource/mcp')
  getProtectedResourceForMcp() {
    return this.metadata();
  }

  @Get('oauth-protected-resource')
  getProtectedResource() {
    return this.metadata();
  }
}
