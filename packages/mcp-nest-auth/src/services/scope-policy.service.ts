import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
  MCP_CONTROLLER_METADATA_KEY,
  MCP_SCOPES_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
} from '@rekog/mcp-nest';
import type { ToolMetadata } from '@rekog/mcp-nest';
import type { OAuthModuleOptions } from '../providers/oauth-provider.interface';

/**
 * `offline_access` is the module's *default* `scopesSupported` entry and is a
 * refresh-token marker rather than a permission, so an allowed set containing
 * nothing else means no scope registry was ever configured.
 */
const PLACEHOLDER_SCOPE = 'offline_access';

/**
 * Decides which of a client's requested scopes actually get granted.
 *
 * Without this the authorization endpoint mints whatever `scope` the client
 * asks for, so any client can hand itself the scopes a `@ToolScopes()` guard
 * checks for — the token claim is the only thing
 * `ToolAuthorizationService.hasRequiredScopes` consults. Narrowing the grant is
 * the standard authorization-server behaviour (RFC 6749 §3.3: the AS MAY issue
 * a token with a narrower scope than requested).
 *
 * The allowed set is the union of two sources, so that neither the advertised
 * metadata nor the tools alone has to be exhaustive:
 *
 * 1. the configured `authorizationServerMetadata.scopesSupported` and
 *    `protectedResourceMetadata.scopesSupported`, and
 * 2. every scope declared by a `@ToolScopes()`-decorated `@Tool` in the app.
 *
 * Source 2 is what makes strict mode usable by default: filtering against the
 * advertised metadata alone would strip every legitimate scope in the common
 * case where the user configured tools but left `scopesSupported` at its
 * `['offline_access']` placeholder, and `@ToolScopes()` would then deny
 * everything.
 */
@Injectable()
export class ScopePolicyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScopePolicyService.name);
  private allowed?: Set<string>;

  constructor(
    @Inject('OAUTH_MODULE_OPTIONS')
    private readonly options: OAuthModuleOptions,
    @Optional() private readonly discovery?: DiscoveryService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.scopeValidation === 'passthrough') {
      this.logger.warn(
        "scopeValidation: 'passthrough' is set — requested OAuth scopes are " +
          'minted into access tokens unchecked, so a client can grant itself ' +
          'any scope a @ToolScopes() tool requires. Intended only as a ' +
          "migration window; switch to 'strict'.",
      );
      return;
    }

    const allowed = this.getAllowedScopes();
    const meaningful = [...allowed].filter((s) => s !== PLACEHOLDER_SCOPE);
    if (meaningful.length === 0) {
      this.logger.warn(
        "scopeValidation is 'strict' but this server declares no scopes, so " +
          'every requested scope will be dropped from issued tokens. Declare ' +
          'them with @ToolScopes([...]) on your tools, or list them in ' +
          'authorizationServerMetadata.scopesSupported.',
      );
    }
  }

  /**
   * Narrow a requested `scope` string to what this server actually grants.
   * Returns `undefined` when nothing survives, so no empty `scope` claim is
   * carried through the authorization code into the token.
   */
  narrow(requested: string | undefined): string | undefined {
    if (!requested || this.options.scopeValidation === 'passthrough') {
      return requested;
    }

    const allowed = this.getAllowedScopes();
    const requestedScopes = requested.split(/\s+/).filter((s) => s.length > 0);
    const granted = requestedScopes.filter((s) => allowed.has(s));
    const dropped = requestedScopes.filter((s) => !allowed.has(s));

    if (dropped.length > 0) {
      this.logger.warn(
        `Dropped unrecognized requested scope(s): ${dropped.join(', ')}. ` +
          'Only scopes declared by a @ToolScopes() tool or listed in ' +
          'authorizationServerMetadata.scopesSupported are granted (set ' +
          "scopeValidation: 'passthrough' to disable this narrowing).",
      );
    }

    return granted.length > 0 ? granted.join(' ') : undefined;
  }

  /**
   * The union described in the class doc. Computed once: `@ToolScopes()` lives
   * in class metadata, so it cannot change after bootstrap. Scopes attached to
   * tools registered at runtime via `strategy.registerTool()` are therefore not
   * seen — declare those in `authorizationServerMetadata.scopesSupported`.
   */
  getAllowedScopes(): Set<string> {
    if (this.allowed) return this.allowed;

    this.allowed = new Set([
      ...this.options.authorizationServerMetadata.scopesSupported,
      ...this.options.protectedResourceMetadata.scopesSupported,
      ...this.discoverToolScopes(),
    ]);
    return this.allowed;
  }

  /**
   * Read `@ToolScopes()` straight off the `@McpController` prototypes in the
   * container. Core keeps its discovered tool list private, but the metadata
   * keys are public API, so this reads the same `Reflect` metadata
   * `McpStrategy.readToolMetadata` does without reaching into it.
   *
   * Scoped to the whole application rather than one MCP server: an app running
   * several `McpStrategy` instances gets one combined allowed set. That
   * over-approximates for a multi-server app, which is the safe direction —
   * per-tool `@ToolScopes()` still enforces the actual requirement.
   */
  private discoverToolScopes(): string[] {
    if (!this.discovery) return [];

    const scopes: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const metatype = wrapper.metatype as
        | (Function & { prototype?: Record<string, unknown> })
        | undefined;
      if (typeof metatype !== 'function' || !metatype.prototype) continue;
      if (!Reflect.getMetadata(MCP_CONTROLLER_METADATA_KEY, metatype)) continue;

      const proto = metatype.prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        const method = proto[key];
        if (typeof method !== 'function') continue;
        if (!Reflect.getMetadata(MCP_TOOL_METADATA_KEY, method)) continue;

        const declared =
          (Reflect.getMetadata(MCP_SCOPES_METADATA_KEY, method) as
            | string[]
            | undefined) ??
          (
            Reflect.getMetadata(MCP_TOOL_METADATA_KEY, method) as
              | ToolMetadata
              | undefined
          )?.requiredScopes;
        if (Array.isArray(declared)) scopes.push(...declared);
      }
    }
    return scopes;
  }
}
