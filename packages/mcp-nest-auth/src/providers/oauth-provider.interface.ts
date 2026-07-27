import type { IOAuthStore, OAuthClient } from '../stores/oauth-store.interface';
import type {
  OAuthSession,
  OAuthUserProfile,
} from '../interfaces/oauth-common.interface';

// Re-export common interfaces
export type { OAuthSession, OAuthUserProfile };

// Define a minimal placeholder for TypeORM options so the type remains
// available without requiring the optional `@nestjs/typeorm` package.
// Consumers who use the TypeORM store should install the package to get
// the full type definitions.
type TypeOrmModuleOptions = Record<string, unknown>;

export interface OAuthProviderConfig {
  name: string;
  displayName?: string;
  strategy: any; // Passport Strategy constructor
  strategyOptions: (options: {
    serverUrl: string;
    clientId: string;
    clientSecret: string;
    callbackPath?: string; // Optional custom callback path
  }) => any;
  scope?: string[];
  profileMapper: (profile: any) => OAuthUserProfile;
}

// Store configuration union type
export type StoreConfiguration =
  | { type: 'typeorm'; options: TypeOrmModuleOptions }
  | { type: 'custom'; store: IOAuthStore }
  | { type: 'memory' }
  | undefined; // Default to memory store

export interface OAuthEndpointConfiguration {
  wellKnownAuthorizationServerMetadata?: string; // Default: '/.well-known/oauth-authorization-server'
  wellKnownProtectedResourceMetadata?: string | string[]; // Default: '/.well-known/oauth-protected-resource'
  register?: string; // Default: '/register'
  authorize?: string; // Default: '/authorize'
  callback?: string; // Default: '/callback'
  token?: string; // Default: '/token'
  /**
   * Where the consent form POSTs its decision. Default: `'/consent'`. The route
   * only exists when {@link ConsentOptions.enabled} resolves to `true`.
   */
  consent?: string;
}

export interface OAuthEndpointDisableOptions {
  wellKnownAuthorizationServerMetadata?: boolean;
  wellKnownProtectedResourceMetadata?: boolean;
  /**
   * Disable `POST /register` (RFC 7591 Dynamic Client Registration).
   *
   * DCR is *deprecated* as of protocol revision `2026-07-28` (spec PR #2858) in
   * favour of Client ID Metadata Documents, but stays a `MAY` and is fully
   * supported here — this flag exists for deployments that only ever talk to
   * pre-registered clients (or to CIMD clients) and do not want an open
   * registration endpoint. When set, `registration_endpoint` is also omitted
   * from the authorization-server metadata, because advertising an endpoint
   * that answers `404` is worse than advertising nothing.
   */
  register?: boolean;
}

/**
 * How the `scope` a client requests at `/authorize` is treated.
 *
 * - `'strict'` (default) — the grant is narrowed to scopes this server actually
 *   knows about: the configured `scopesSupported` lists plus every scope
 *   declared with `@ToolScopes()`. Unknown scopes are dropped, not rejected.
 * - `'passthrough'` — mint whatever was requested. This is the pre-2.0.0
 *   behaviour and lets any client grant itself the scopes a `@ToolScopes()`
 *   tool requires; use it only as a migration window.
 */
export type ScopeValidationMode = 'strict' | 'passthrough';

/**
 * The OIDC Dynamic Client Registration `application_type`. MCP clients **MUST**
 * send one as of revision `2026-07-28`, but the spec is explicit that
 * "non-OIDC servers safely ignore the parameter" — so this server stores it for
 * auditing and rejects values outside the RFC-defined pair, and derives nothing
 * from it. In particular the OIDC redirect-URI constraints tied to
 * `application_type` (localhost-only for `native`, https-only for `web`) are
 * deliberately **not** enforced: they would reject legitimate MCP clients and
 * are not required of a plain OAuth 2.1 authorization server.
 */
export type ClientApplicationType = 'native' | 'web';

/**
 * Everything the consent screen is allowed to know. Handed to
 * {@link ConsentOptions.render}; also what the built-in renderer works from.
 *
 * `redirectUriHost` and `isLoopbackRedirect` are not conveniences — they are the
 * two facts the spec makes normative for a CIMD-capable authorization server
 * ("**MUST** clearly display the redirect URI hostname during authorization",
 * "**SHOULD** display additional warnings for `localhost`-only redirect URIs",
 * draft `basic/authorization/security-considerations`). A custom renderer that
 * drops them puts the deployment out of conformance.
 */
export interface ConsentRenderContext {
  /** The resolved client — a DCR registration or a Client ID Metadata Document. */
  client: OAuthClient;
  /** The `client_id` exactly as the client sent it (a URL for a CIMD client). */
  clientId: string;
  /** `true` when `clientId` is a Client ID Metadata Document URL. */
  isMetadataDocumentClient: boolean;
  /** The redirect URI this authorization request will send the code to. */
  redirectUri: string;
  /** Hostname of {@link redirectUri}. MUST be displayed. */
  redirectUriHost: string;
  /** `true` when {@link redirectUri} points at a loopback address. */
  isLoopbackRedirect: boolean;
  /** `true` when *every* redirect URI the client declares is loopback. */
  isLoopbackOnlyClient: boolean;
  /** The already-narrowed scopes that will be granted. May be empty. */
  scopes: string[];
  /** The authenticated end user the grant would be recorded against. */
  user: OAuthUserProfile;
  /** Absolute-path URL the decision form must POST to. */
  formAction: string;
  /**
   * Unguessable per-session value that the POST must echo back as
   * `consent_token`. Without it in the form a cross-site POST could approve the
   * grant on the user's behalf.
   */
  csrfToken: string;
}

/**
 * Interactive consent between the IdP login and the authorization code.
 *
 * **Off by default.** Turning it on inserts a page into an otherwise fully
 * automatic redirect chain, so no existing deployment gains a flow hop without
 * asking for it. It is forced **on** when
 * {@link ClientIdMetadataDocumentOptions.enabled} is set, because CIMD carries a
 * "**MUST** clearly display the redirect URI hostname during authorization" that
 * cannot be met without a screen; explicitly setting `enabled: false` together
 * with CIMD is a bootstrap error rather than a silently ignored opt-out.
 */
export interface ConsentOptions {
  /** Default `false`, except `true` when CIMD is enabled. */
  enabled?: boolean;
  /**
   * Replace the built-in page. Return a complete HTML document; it is sent with
   * `Content-Type: text/html`. Everything needed is on the context, including
   * {@link ConsentRenderContext.formAction} and
   * {@link ConsentRenderContext.csrfToken} — a renderer that omits the hidden
   * `consent_token` field cannot be approved.
   */
  render?: (context: ConsentRenderContext) => string | Promise<string>;
  /**
   * How long an approval is remembered for the same (user, client, scope) triple,
   * so a reconnect does not re-prompt. Default 30 days; `0` prompts every time.
   *
   * Remembered **in process memory only** — see the note on the consent section
   * of `docs/built-in-authorization-server.md`. A restart or a second replica
   * re-prompts, which is annoying but never unsafe.
   */
  rememberForMs?: number;
}

/**
 * Client ID Metadata Documents (CIMD) —
 * [draft-ietf-oauth-client-id-metadata-document-00](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00),
 * which MCP revision `2026-07-28` makes the preferred registration mechanism and
 * the reason Dynamic Client Registration is deprecated.
 *
 * A client identifies itself with an `https` URL that serves its own metadata
 * document; the authorization server fetches it on demand. There is no
 * registration record and nothing is written to the `IOAuthStore`.
 *
 * **Off by default**: enabling it makes the authorization server fetch a URL
 * chosen by an unauthenticated caller, which is an SSRF surface that a
 * deployment should opt into knowingly (see {@link allowInsecureClientIdScheme}
 * and the guard described in the docs).
 */
export interface ClientIdMetadataDocumentOptions {
  /** Default `false`. Also advertises `client_id_metadata_document_supported`. */
  enabled?: boolean;
  /**
   * ⚠️ **DEVELOPMENT ONLY — never set this in production.**
   *
   * Accepts `http://` client-id URLs *and* stops refusing loopback/private
   * destinations, so `client_id=http://localhost:3014/client-metadata.json`
   * resolves. It exists so the shipped example (and this repo's tests) can serve
   * a metadata document from the same machine without TLS.
   *
   * The IETF draft requires the `https` scheme, and §6.5 tells authorization
   * servers to "avoid fetching any URLs using private or loopback addresses" —
   * this option disables exactly those two protections, i.e. the entire SSRF
   * guard. Default `false`, and enabling it logs a warning at bootstrap.
   */
  allowInsecureClientIdScheme?: boolean;
  /**
   * Freshness applied when the document carries no usable HTTP cache headers.
   * Default 5 minutes. `Cache-Control: max-age`/`s-maxage` and `Expires` win
   * over it; `no-store`/`no-cache` suppress caching altogether.
   */
  cacheTtlMs?: number;
  /** Bound on the in-process document cache (LRU). Default 256. */
  maxCacheEntries?: number;
  /** Hard deadline for the whole fetch, in ms. Default 5000. */
  timeoutMs?: number;
  /**
   * Response body cap. Default 5120 — "the recommended maximum response size for
   * client metadata documents is 5 kilobytes".
   */
  maxDocumentBytes?: number;
}

/** {@link ConsentOptions} after defaults are applied. */
export interface ResolvedConsentOptions extends ConsentOptions {
  enabled: boolean;
  rememberForMs: number;
}

/** {@link ClientIdMetadataDocumentOptions} after defaults are applied. */
export interface ResolvedClientIdMetadataDocumentOptions
  extends ClientIdMetadataDocumentOptions {
  enabled: boolean;
  allowInsecureClientIdScheme: boolean;
  cacheTtlMs: number;
  maxCacheEntries: number;
  timeoutMs: number;
  maxDocumentBytes: number;
}

export interface OAuthUserModuleOptions {
  provider: OAuthProviderConfig;

  // Required OAuth Provider Credentials
  clientId: string;
  clientSecret: string;

  // Required JWT Configuration
  jwtSecret: string;

  // Server Configuration
  serverUrl?: string;
  resource?: string; // should be the endpoint clients connect to, e.g.: 'https://localhost:3000/mcp'
  // JWT Configuration
  /**
   * The canonical issuer identifier. Defaults to `serverUrl` and MUST name the
   * same identifier: the authorization-server metadata document is served from
   * `serverUrl` and advertises this value as its `issuer`, and clients MUST NOT
   * use a metadata document whose `issuer` differs from the URL they built it
   * from. A divergence is rejected at bootstrap.
   */
  jwtIssuer?: string;
  jwtAudience?: string;
  jwtAccessTokenExpiresIn?: string;
  jwtRefreshTokenExpiresIn?: string;
  enableRefreshTokens?: boolean;

  // Cookie Configuration
  cookieSecure?: boolean;
  cookieMaxAge?: number;

  // OAuth Session Configuration
  oauthSessionExpiresIn?: number; // in milliseconds
  authCodeExpiresIn?: number; // in milliseconds

  // Protected Resource Metadata Configuration
  protectedResourceMetadata?: {
    scopesSupported?: string[];
    bearerMethodsSupported?: string[];
    mcpVersionsSupported?: string[];
  };

  // Authorization Server Metadata Configuration
  authorizationServerMetadata?: {
    responseTypesSupported?: string[];
    responseModesSupported?: string[];
    grantTypesSupported?: string[];
    tokenEndpointAuthMethodsSupported?: string[];
    scopesSupported?: string[];
    codeChallengeMethodsSupported?: string[];
  };

  /** See {@link ScopeValidationMode}. Defaults to `'strict'`. */
  scopeValidation?: ScopeValidationMode;

  /**
   * Require PKCE with `S256` on the authorization code flow. Defaults to `true`.
   *
   * OAuth 2.1 §4.1.1 (which the MCP authorization spec builds on) makes
   * `code_challenge` mandatory and `plain` is only permitted where S256 is
   * unavailable — which is never the case for an MCP client. With the default,
   * `/authorize` rejects a request that omits `code_challenge` or asks for
   * `plain`, and the token endpoint refuses to redeem any code that is not
   * bound to an S256 challenge.
   *
   * Set to `false` **only** as a migration window for a non-conforming client:
   * it restores the pre-2.0.0 behaviour where a missing challenge means no PKCE
   * verification at all, which leaves the flow open to authorization-code
   * interception. `plain` is not re-advertised in the authorization-server
   * metadata even then (advertising it invites a downgrade from clients that
   * would otherwise use S256); add it explicitly via
   * `authorizationServerMetadata.codeChallengeMethodsSupported` if you need to.
   */
  requirePkce?: boolean;

  /** Interactive consent screen. See {@link ConsentOptions}. */
  consent?: ConsentOptions;

  /**
   * Client ID Metadata Documents. See
   * {@link ClientIdMetadataDocumentOptions}. Enabling this also forces
   * {@link ConsentOptions.enabled} on.
   */
  clientIdMetadataDocuments?: ClientIdMetadataDocumentOptions;

  // Storage Configuration - single property for all storage options
  storeConfiguration?: StoreConfiguration;
  apiPrefix?: string;

  // Endpoint Configuration
  endpoints?: OAuthEndpointConfiguration;
  disableEndpoints?: OAuthEndpointDisableOptions;
}

export interface OAuthModuleDefaults {
  serverUrl: string;
  resource: string; // Default resource URL
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessTokenExpiresIn: string;
  jwtRefreshTokenExpiresIn: string;
  enableRefreshTokens: boolean;
  cookieMaxAge: number;
  oauthSessionExpiresIn: number;
  authCodeExpiresIn: number;
  nodeEnv: string;
  apiPrefix: string;
  scopeValidation: ScopeValidationMode;
  requirePkce: boolean;
  consent: ResolvedConsentOptions;
  clientIdMetadataDocuments: ResolvedClientIdMetadataDocumentOptions;
  endpoints: OAuthEndpointConfiguration;
  disableEndpoints: OAuthEndpointDisableOptions;
  protectedResourceMetadata: {
    scopesSupported: string[];
    bearerMethodsSupported: string[];
    mcpVersionsSupported: string[];
  };
  authorizationServerMetadata: {
    responseTypesSupported: string[];
    responseModesSupported: string[];
    grantTypesSupported: string[];
    tokenEndpointAuthMethodsSupported: string[];
    scopesSupported: string[];
    codeChallengeMethodsSupported: string[];
  };
}

// Resolved options after merging with defaults
export type OAuthModuleOptions = Required<
  Pick<
    OAuthUserModuleOptions,
    'provider' | 'clientId' | 'clientSecret' | 'jwtSecret'
  >
> &
  Required<OAuthModuleDefaults> & {
    // Optional fields that may remain undefined
    cookieSecure: boolean;
    storeConfiguration?: StoreConfiguration;
  };
