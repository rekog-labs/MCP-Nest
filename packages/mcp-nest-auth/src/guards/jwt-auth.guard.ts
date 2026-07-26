import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Request, Response } from 'express';
import { JwtPayload, JwtTokenService } from '../services/jwt-token.service';
import type { IOAuthStore } from '../stores/oauth-store.interface';
import { MCP_RESOURCE_METADATA_URL } from '@rekog/mcp-nest';
import type { McpServerOptions } from '@rekog/mcp-nest';

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * The subset of the resolved OAuth module options the guard needs: the RFC 9728
 * `WWW-Authenticate` challenge, plus the `resource` an access token has to be
 * audienced for. Read from the `OAUTH_MODULE_OPTIONS` token the module already
 * exposes — no extra configuration required.
 */
interface ResolvedOAuthOptions {
  serverUrl?: string;
  resource?: string;
  endpoints?: { wellKnownProtectedResourceMetadata?: string };
  disableEndpoints?: { wellKnownProtectedResourceMetadata?: boolean };
  /** Advertised in the challenge's `scope` parameter. Read at request time — the resolved list is not a constant. */
  protectedResourceMetadata?: { scopesSupported?: string[] };
}

@Injectable()
export class McpAuthJwtGuard implements CanActivate {
  private readonly logger = new Logger(McpAuthJwtGuard.name);
  /** Guards against repeating the "cannot verify audience" warning per request. */
  private warnedMissingResource = false;

  constructor(
    @Optional() private readonly jwtTokenService: JwtTokenService | null,
    @Optional()
    @Inject('IOAuthStore')
    private readonly store: IOAuthStore | null,
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject('MCP_OPTIONS')
    private readonly options?: Pick<
      McpServerOptions,
      'allowUnauthenticatedAccess'
    >,
    @Optional()
    @Inject('OAUTH_MODULE_OPTIONS')
    private readonly oauthOptions?: ResolvedOAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Set on every admitted request, before any early return: a later
    // `403 insufficient_scope` challenge needs it and cannot derive it itself.
    this.publishResourceMetadataUrl(request);
    const token = this.extractTokenFromHeader(request);

    // Check if unauthenticated access is allowed
    const allowUnauthenticated =
      this.options?.allowUnauthenticatedAccess ?? false;

    if (!token) {
      if (allowUnauthenticated) {
        // Allow unauthenticated sessions
        // Per-tool authorization will decide what's accessible (@PublicTool() tools only)
        return true;
      } else {
        // Standard OAuth flow: Reject and trigger authorization
        this.attachResourceMetadataChallenge(context);
        throw new UnauthorizedException('Access token required');
      }
    }

    // Resolve services dynamically if not injected directly
    const jwtTokenService =
      this.jwtTokenService ||
      this.moduleRef.get(JwtTokenService, { strict: false });
    const store =
      this.store ||
      this.moduleRef.get<IOAuthStore>('IOAuthStore', { strict: false });

    if (!jwtTokenService || !store) {
      throw new UnauthorizedException('Authentication service not available');
    }

    // If a token is provided, it must be valid *for this resource*. RFC 8707 §2
    // makes the audience check a MUST, and pinning `type` keeps the `type: 'user'`
    // browser-cookie token — signed with the same secret, audienced at the client
    // app — from being replayed here as a bearer credential.
    const expectedAudience = this.resolveOAuthOptions()?.resource;
    if (!expectedAudience && !this.warnedMissingResource) {
      this.warnedMissingResource = true;
      this.logger.warn(
        'OAUTH_MODULE_OPTIONS is not reachable, so the access token audience ' +
          'cannot be verified. Provide McpAuthJwtGuard from a module that ' +
          'imports McpAuthModule.forRoot(...).',
      );
    }

    const payload = jwtTokenService.validateToken(token, {
      type: 'access',
      audience: expectedAudience,
    });

    if (!payload) {
      this.attachResourceMetadataChallenge(context);
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Enrich request.user with friendly fields for tools
    const enriched: any = { ...payload };
    try {
      if (!enriched.user_data && enriched.user_profile_id) {
        const profile = await store.getUserProfileById(
          enriched.user_profile_id,
        );
        if (profile) {
          enriched.user_data = profile;
        }
      }
      const ud = enriched.user_data || {};
      // Provide convenient top-level fields commonly used by tools
      enriched.username =
        enriched.username || ud.username || ud.id || enriched.sub;
      enriched.email = enriched.email || ud.email;
      enriched.displayName = enriched.displayName || ud.displayName;
      enriched.avatarUrl = enriched.avatarUrl || ud.avatarUrl;
      enriched.name =
        enriched.name ||
        ud.displayName ||
        ud.username ||
        ud.email ||
        enriched.sub;

      // Parse scopes: OAuth 2.0 standard is space-delimited string in 'scope' field
      if (enriched.scope && typeof enriched.scope === 'string') {
        enriched.scopes = enriched.scope
          .split(' ')
          .filter((s: string) => s.length > 0);
      } else if (!enriched.scopes) {
        enriched.scopes = [];
      }

      // Extract roles from user_data if present
      if (!enriched.roles && ud.roles && Array.isArray(ud.roles)) {
        enriched.roles = ud.roles;
      } else if (!enriched.roles) {
        enriched.roles = [];
      }
    } catch {
      // Non-fatal; proceed with raw payload
    }

    request.user = enriched as JwtPayload;
    return true;
  }

  /**
   * The resolved module options, whether the guard was instantiated inside
   * `McpAuthModule` (direct injection) or provided by the host module that
   * imports it (container lookup). Returns `undefined` rather than throwing so
   * neither the audience check nor the challenge header can break the response.
   */
  private resolveOAuthOptions(): ResolvedOAuthOptions | undefined {
    if (this.oauthOptions) return this.oauthOptions;
    try {
      return this.moduleRef.get<ResolvedOAuthOptions>('OAUTH_MODULE_OPTIONS', {
        strict: false,
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Set the RFC 9728 `WWW-Authenticate: Bearer resource_metadata="…"` challenge
   * on a 401 so MCP clients can discover the authorization server from the
   * response itself (instead of having to probe `.well-known` blindly).
   *
   * The metadata URL is derived from the module's already-configured
   * `serverUrl` + protected-resource-metadata path — no extra option to set.
   * Best-effort: never throws, and is skipped if the options or the
   * protected-resource metadata endpoint aren't available.
   *
   * The challenge also carries `scope`, per the spec's
   *
   * > MCP servers SHOULD include a `scope` parameter in the `WWW-Authenticate`
   * > header … to indicate the scopes required for accessing the resource
   *
   * taken from the resolved `protectedResourceMetadata.scopesSupported` — the same
   * list the metadata document advertises, so a client that acts on the header
   * alone requests exactly what a client that fetched the document would. Read
   * per request rather than captured: the resolved list depends on configuration
   * the module normalizes (e.g. `offline_access` is dropped when refresh tokens
   * are disabled), and an empty list emits no `scope` at all rather than `scope=""`.
   *
   * A *scope-deficient* call is a different response — `403` with
   * `error="insufficient_scope"` and the scopes that specific tool needs, written
   * by the transport (`stepUpAuthorization`), which this guard feeds by publishing
   * the same metadata URL on the request under {@link MCP_RESOURCE_METADATA_URL}.
   */
  private attachResourceMetadataChallenge(context: ExecutionContext): void {
    try {
      const opts = this.resolveOAuthOptions();

      if (!opts?.serverUrl) return;

      const scopes = opts.protectedResourceMetadata?.scopesSupported ?? [];
      const params: string[] = [];

      if (!opts.disableEndpoints?.wellKnownProtectedResourceMetadata) {
        params.push(`resource_metadata="${this.resourceMetadataUrl(opts)}"`);
      }
      if (scopes.length > 0) {
        params.push(`scope="${scopes.join(' ')}"`);
      }
      if (params.length === 0) return;

      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('WWW-Authenticate', `Bearer ${params.join(', ')}`);
    } catch {
      // Never let discovery-header wiring break the 401 itself.
    }
  }

  /** `serverUrl` + the protected-resource-metadata path. */
  private resourceMetadataUrl(opts: ResolvedOAuthOptions): string {
    const path =
      opts.endpoints?.wellKnownProtectedResourceMetadata ??
      '/.well-known/oauth-protected-resource';
    return `${opts.serverUrl!.replace(/\/$/, '')}${path}`;
  }

  /**
   * Publish this resource's protected-resource-metadata URL on the request, for
   * whoever builds a challenge *after* the guard has admitted the caller — namely
   * the transport's `403 insufficient_scope` step-up path, which knows the tool's
   * required scopes but not this module's configuration.
   *
   * Best-effort and inert by itself: nothing reads the slot unless
   * `stepUpAuthorization` is enabled on the transport.
   */
  private publishResourceMetadataUrl(request: AuthenticatedRequest): void {
    try {
      const opts = this.resolveOAuthOptions();
      if (!opts?.serverUrl) return;
      if (opts.disableEndpoints?.wellKnownProtectedResourceMetadata) return;
      (request as unknown as Record<symbol, unknown>)[
        MCP_RESOURCE_METADATA_URL
      ] = this.resourceMetadataUrl(opts);
    } catch {
      // Never let discovery wiring break an otherwise successful request.
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
