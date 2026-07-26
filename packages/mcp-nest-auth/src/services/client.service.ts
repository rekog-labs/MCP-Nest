import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import type {
  ClientRegistrationDto,
  IOAuthStore,
  OAuthClient,
} from '../stores/oauth-store.interface';
import { randomBytes } from 'crypto';
import type { OAuthModuleOptions } from '../providers/oauth-provider.interface';
import { ClientIdMetadataService } from './client-id-metadata.service';

@Injectable()
export class ClientService {
  constructor(
    @Inject('IOAuthStore') private readonly store: IOAuthStore,
    @Inject('OAUTH_MODULE_OPTIONS')
    private readonly options: OAuthModuleOptions,
    private readonly clientIdMetadata: ClientIdMetadataService,
  ) {}

  /**
   * Register a client application.
   * Always creates a new client record. client_name is not treated as unique.
   *
   * Note: Left open for future enhancements (e.g., software statements) via
   * preRegistrationChecks(). URL-based registration is no longer a "future
   * enhancement" — see {@link ClientIdMetadataService}, which resolves
   * URL-shaped client_ids without any registration record at all.
   */
  async registerClient(
    registrationDto: ClientRegistrationDto,
  ): Promise<OAuthClient> {
    // Validate required fields
    if (
      !registrationDto.redirect_uris ||
      !Array.isArray(registrationDto.redirect_uris)
    ) {
      throw new BadRequestException(
        'redirect_uris is required and must be an array',
      );
    }

    // Validate token_endpoint_auth_method if provided
    const supportedAuthMethods = [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ];
    if (
      registrationDto.token_endpoint_auth_method &&
      !supportedAuthMethods.includes(registrationDto.token_endpoint_auth_method)
    ) {
      throw new BadRequestException(
        `Unsupported token_endpoint_auth_method. Supported methods: ${supportedAuthMethods.join(', ')}`,
      );
    }

    // `application_type` became a client-side MUST in protocol revision
    // `2026-07-28`, with the explicit carve-out that "non-OIDC servers safely
    // ignore the parameter". This server is not an OIDC provider (no id_token,
    // no `openid` scope, no userinfo), so it stores the value and refuses
    // nonsense — mirroring how token_endpoint_auth_method is handled above —
    // but derives no behaviour from it. Absence is NOT an error: requiring it
    // would lock out every conforming pre-2026 client for no security gain.
    const supportedApplicationTypes = ['native', 'web'];
    if (
      registrationDto.application_type !== undefined &&
      !supportedApplicationTypes.includes(registrationDto.application_type)
    ) {
      throw new BadRequestException(
        `Unsupported application_type. Supported values: ${supportedApplicationTypes.join(', ')}`,
      );
    }

    // Default values for new clients
    const defaultClientValues = {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method:
        registrationDto.token_endpoint_auth_method || 'none',
    };

    // Future-proofing: hook for software statements / metadata URL validations
    await this.preRegistrationChecks(registrationDto);

    const now = new Date();

    // Create new client - merge defaults with registration data
    const client_id = this.store.generateClientId(
      registrationDto as OAuthClient,
    );

    // Only generate client_secret for methods that require it
    const authMethod = registrationDto.token_endpoint_auth_method || 'none';
    const client_secret =
      authMethod !== 'none' ? randomBytes(32).toString('hex') : undefined;

    const newClient: OAuthClient = {
      ...defaultClientValues,
      ...registrationDto,
      client_id,
      client_secret,
      created_at: now,
      updated_at: now,
    };
    const client = await this.store.storeClient(newClient);
    const filteredClient = Object.fromEntries(
      Object.entries(client).filter(([, value]) => value !== null),
    ) as OAuthClient;

    return filteredClient;
  }

  /**
   * Hook for future registration policies (e.g., software statements per RFC
   * 7591/7592). Currently a no-op to keep behavior: always create a new client.
   */

  protected async preRegistrationChecks(
    _dto: ClientRegistrationDto,
  ): Promise<void> {
    // Intentionally left blank. Implement validations/attestations in the future.
  }

  /**
   * Resolve a `client_id` to a client record, from whichever registration
   * mechanism produced it.
   *
   * Both keyspaces share one namespace safely: every `IOAuthStore` generates ids
   * as `${normalizedName}_${suffix}` with `normalizedName` reduced to `[a-z0-9]`,
   * so a registered id can never contain `://` and can never be mistaken for a
   * Client ID Metadata Document URL. The DCR store therefore stays DCR-only and
   * knows nothing about CIMD.
   *
   * Unlike the store path, the CIMD path **throws** (`BadRequestException`)
   * instead of returning `null` — a document that fails to fetch or fails
   * validation is a specific, reportable condition, and the draft says the
   * authorization request SHOULD be aborted rather than silently retried as an
   * unknown client.
   */
  async getClient(clientId: string): Promise<OAuthClient | null> {
    if (this.clientIdMetadata.isMetadataDocumentClientId(clientId)) {
      return await this.clientIdMetadata.resolve(clientId);
    }

    const client = await this.store.getClient(clientId);
    if (!client) {
      return null;
    }

    // Remove null fields from the client object
    const filteredClient = Object.fromEntries(
      Object.entries(client).filter(([, value]) => value !== null),
    ) as OAuthClient;

    return filteredClient;
  }

  async validateRedirectUri(
    clientId: string,
    redirectUri: string,
  ): Promise<boolean> {
    const client = await this.getClient(clientId);
    return client ? client.redirect_uris.includes(redirectUri) : false;
  }
}
