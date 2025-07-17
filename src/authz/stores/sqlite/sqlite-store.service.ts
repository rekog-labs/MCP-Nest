import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { OAuthSession } from '../../providers/oauth-provider.interface';
import {
  AuthorizationCode,
  IOAuthStore,
  OAuthClient,
} from '../oauth-store.interface';

@Injectable()
export class SQLiteStore implements IOAuthStore {
  private sqlite: any;

  constructor(databasePath: string = './oauth-sqlite.db') {
    this.sqlite = new Database(databasePath);
    this.initializeTables();
  }

  private initializeTables() {
    // Enable foreign keys
    this.sqlite.pragma('foreign_keys = ON');

    // Create tables if they don't exist
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        client_description TEXT,
        logo_uri TEXT,
        client_uri TEXT,
        developer_name TEXT,
        developer_email TEXT,
        redirect_uris TEXT NOT NULL,
        grant_types TEXT NOT NULL,
        response_types TEXT NOT NULL,
        token_endpoint_auth_method TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS authorization_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        github_access_token TEXT NOT NULL
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS oauth_sessions (
        session_id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL,
        state TEXT,
        resource TEXT,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  // Client management
  async storeClient(client: OAuthClient): Promise<OAuthClient> {
    const stmt = this.sqlite.prepare(`
      INSERT INTO oauth_clients (
        client_id, client_name, client_description, logo_uri, client_uri,
        developer_name, developer_email, redirect_uris, grant_types,
        response_types, token_endpoint_auth_method, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      client.client_id,
      client.client_name,
      client.client_description || null,
      client.logo_uri || null,
      client.client_uri || null,
      client.developer_name || null,
      client.developer_email || null,
      JSON.stringify(client.redirect_uris),
      JSON.stringify(client.grant_types),
      JSON.stringify(client.response_types),
      client.token_endpoint_auth_method,
      client.created_at.getTime(),
      client.updated_at.getTime(),
    );

    return client;
  }

  async getClient(client_id: string): Promise<OAuthClient | undefined> {
    const stmt = this.sqlite.prepare(
      'SELECT * FROM oauth_clients WHERE client_id = ?',
    );
    const result = stmt.get(client_id) as any;

    if (!result) {
      return undefined;
    }

    return {
      client_id: result.client_id,
      client_name: result.client_name,
      client_description: result.client_description || undefined,
      logo_uri: result.logo_uri || undefined,
      client_uri: result.client_uri || undefined,
      developer_name: result.developer_name || undefined,
      developer_email: result.developer_email || undefined,
      redirect_uris: JSON.parse(result.redirect_uris),
      grant_types: JSON.parse(result.grant_types),
      response_types: JSON.parse(result.response_types),
      token_endpoint_auth_method: result.token_endpoint_auth_method,
      created_at: new Date(result.created_at),
      updated_at: new Date(result.updated_at),
    };
  }

  async findClient(client_name: string): Promise<OAuthClient | undefined> {
    const stmt = this.sqlite.prepare(
      'SELECT * FROM oauth_clients WHERE client_name = ?',
    );
    const result = stmt.get(client_name) as any;

    if (!result) {
      return undefined;
    }

    return {
      client_id: result.client_id,
      client_name: result.client_name,
      client_description: result.client_description || undefined,
      logo_uri: result.logo_uri || undefined,
      client_uri: result.client_uri || undefined,
      developer_name: result.developer_name || undefined,
      developer_email: result.developer_email || undefined,
      redirect_uris: JSON.parse(result.redirect_uris),
      grant_types: JSON.parse(result.grant_types),
      response_types: JSON.parse(result.response_types),
      token_endpoint_auth_method: result.token_endpoint_auth_method,
      created_at: new Date(result.created_at),
      updated_at: new Date(result.updated_at),
    };
  }

  // Authorization code management
  async storeAuthCode(code: AuthorizationCode): Promise<void> {
    const stmt = this.sqlite.prepare(`
      INSERT INTO authorization_codes (
        code, user_id, client_id, redirect_uri, code_challenge,
        code_challenge_method, expires_at, used_at, github_access_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      code.code,
      code.user_id,
      code.client_id,
      code.redirect_uri,
      code.code_challenge,
      code.code_challenge_method,
      code.expires_at,
      code.used_at ? code.used_at.getTime() : null,
      code.github_access_token,
    );
  }

  async getAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    const stmt = this.sqlite.prepare(
      'SELECT * FROM authorization_codes WHERE code = ?',
    );
    const result = stmt.get(code) as any;

    if (!result) {
      return undefined;
    }

    // Check if expired
    if (result.expires_at < Date.now()) {
      await this.removeAuthCode(code);
      return undefined;
    }

    return {
      code: result.code,
      user_id: result.user_id,
      client_id: result.client_id,
      redirect_uri: result.redirect_uri,
      code_challenge: result.code_challenge,
      code_challenge_method: result.code_challenge_method,
      expires_at: result.expires_at,
      used_at: result.used_at ? new Date(result.used_at) : undefined,
      github_access_token: result.github_access_token,
    };
  }

  async removeAuthCode(code: string): Promise<void> {
    const stmt = this.sqlite.prepare(
      'DELETE FROM authorization_codes WHERE code = ?',
    );
    stmt.run(code);
  }

  // OAuth session management
  async storeOAuthSession(
    sessionId: string,
    session: OAuthSession,
  ): Promise<void> {
    const stmt = this.sqlite.prepare(`
      INSERT INTO oauth_sessions (
        session_id, client_id, redirect_uri, code_challenge,
        code_challenge_method, state, resource, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sessionId,
      session.clientId,
      session.redirectUri,
      session.codeChallenge,
      session.codeChallengeMethod,
      session.state || null,
      session.resource || null,
      session.expiresAt,
    );
  }

  async getOAuthSession(sessionId: string): Promise<OAuthSession | undefined> {
    const stmt = this.sqlite.prepare(
      'SELECT * FROM oauth_sessions WHERE session_id = ?',
    );
    const result = stmt.get(sessionId) as any;

    if (!result) {
      return undefined;
    }

    // Check if expired
    if (result.expires_at < Date.now()) {
      await this.removeOAuthSession(sessionId);
      return undefined;
    }

    return {
      sessionId: result.session_id,
      clientId: result.client_id,
      redirectUri: result.redirect_uri,
      codeChallenge: result.code_challenge,
      codeChallengeMethod: result.code_challenge_method,
      state: result.state || undefined,
      resource: result.resource || undefined,
      expiresAt: result.expires_at,
    };
  }

  async removeOAuthSession(sessionId: string): Promise<void> {
    const stmt = this.sqlite.prepare(
      'DELETE FROM oauth_sessions WHERE session_id = ?',
    );
    stmt.run(sessionId);
  }

  generateClientId(client: OAuthClient): string {
    // Create deterministic client ID based on name + random salt
    const normalizedName = client.client_name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const salt = randomBytes(4).toString('hex');
    return `${normalizedName}_${salt}`;
  }
}
