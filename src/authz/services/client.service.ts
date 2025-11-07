import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import {
  ClientRegistrationDto,
  IOAuthStore,
  OAuthClient,
} from '../stores/oauth-store.interface';
import { randomBytes } from 'crypto';
import { OAuthModuleOptions } from '../providers/oauth-provider.interface';

@Injectable()
export class ClientService {
  constructor(
    @Inject('IOAuthStore') private readonly store: IOAuthStore,
    @Inject('OAUTH_MODULE_OPTIONS')
    private readonly options: OAuthModuleOptions,
  ) {}

  /**
   * Register a client application.
   * Always creates a new client record. client_name is not treated as unique.
   *
   * Note: Left open for future enhancements (e.g., software statements,
   * URL-based Client ID Metadata Documents) via preRegistrationChecks().
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
   * Hook for future registration policies (e.g., software statements per RFC 7591/7592,
   * or URL-based Client Registration using Client ID Metadata Documents).
   * Currently a no-op to keep behavior: always create a new client.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async preRegistrationChecks(
    _dto: ClientRegistrationDto,
  ): Promise<void> {
    // Intentionally left blank. Implement validations/attestations in the future.
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
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
