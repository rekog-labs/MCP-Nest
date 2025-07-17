import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { OAuthSession } from '../providers/oauth-provider.interface';
import {
  AuthorizationCode,
  IOAuthStore,
  OAuthClient,
} from './oauth-store.interface';

// In-memory storage (in production, use a database)
@Injectable()
export class MemoryStore implements IOAuthStore {
  private clients = new Map<string, OAuthClient>();
  private authCodes = new Map<string, AuthorizationCode>();
  private oauthSessions = new Map<string, OAuthSession>();

  async storeClient(client: OAuthClient): Promise<OAuthClient> {
    this.clients.set(client.client_id, client);
    return client;
  }

  async getClient(client_id: string): Promise<OAuthClient | undefined> {
    return this.clients.get(client_id);
  }

  async findClient(client_name: string): Promise<OAuthClient | undefined> {
    for (const client of this.clients.values()) {
      if (client.client_name === client_name) {
        return client;
      }
    }
    return undefined;
  }

  async storeAuthCode(code: AuthorizationCode): Promise<void> {
    this.authCodes.set(code.code, code);
  }

  async getAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    return this.authCodes.get(code);
  }

  async removeAuthCode(code: string): Promise<void> {
    this.authCodes.delete(code);
  }

  // New OAuth session methods for provider-agnostic flow
  async storeOAuthSession(
    sessionId: string,
    session: OAuthSession,
  ): Promise<void> {
    this.oauthSessions.set(sessionId, session);
  }

  async getOAuthSession(sessionId: string): Promise<OAuthSession | undefined> {
    const session = this.oauthSessions.get(sessionId);
    if (session && session.expiresAt < Date.now()) {
      this.oauthSessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  async removeOAuthSession(sessionId: string): Promise<void> {
    this.oauthSessions.delete(sessionId);
  }

  generateClientId(client: OAuthClient): string {
    // Create deterministic client ID based on entire client object
    const normalizedClient = this.normalizeClientObject(client);
    const clientString = JSON.stringify(normalizedClient);
    const hash = createHash('sha256').update(clientString).digest('hex');

    // Use first 16 characters of hash with client name prefix for readability
    const normalizedName = client.client_name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return `${normalizedName}_${hash.substring(0, 16)}`;
  }

  private normalizeClientObject(client: OAuthClient): any {
    // Create a normalized version of the client object for consistent hashing
    const normalized: any = {};

    // Sort object keys to ensure consistent ordering
    const sortedKeys = Object.keys(client).sort();

    for (const key of sortedKeys) {
      const value = (client as any)[key];
      if (Array.isArray(value)) {
        // Sort arrays to ensure consistent ordering
        normalized[key] = [...value].sort();
      } else {
        normalized[key] = value;
      }
    }

    return normalized;
  }
}
