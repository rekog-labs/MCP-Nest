import { Test, TestingModule } from '@nestjs/testing';
import { MemoryStore } from './memory-store.service';
import { OAuthClient, AuthorizationCode } from './oauth-store.interface';
import { OAuthSession } from '../providers/oauth-provider.interface';

describe('MemoryStore', () => {
  let service: MemoryStore;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MemoryStore],
    }).compile();

    service = module.get<MemoryStore>(MemoryStore);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateClientId', () => {
    it('should generate consistent client IDs for identical objects', () => {
      const client1: Partial<OAuthClient> = {
        client_name: 'MCP Inspector',
        client_uri: 'https://github.com/modelcontextprotocol/inspector',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };

      const client2: Partial<OAuthClient> = {
        client_name: 'MCP Inspector',
        client_uri: 'https://github.com/modelcontextprotocol/inspector',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };

      const id1 = service.generateClientId(client1 as OAuthClient);
      const id2 = service.generateClientId(client2 as OAuthClient);

      expect(id1).toBe(id2);
    });

    it('should generate consistent client IDs regardless of property order', () => {
      // First object with properties in one order
      const clientJson1 = `{
        "client_name": "MCP Inspector",
        "client_uri": "https://github.com/modelcontextprotocol/inspector",
        "redirect_uris": ["http://localhost:6274/oauth/callback"],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"]
      }`;

      // Second object with properties in different order
      const clientJson2 = `{
        "response_types": ["code"],
        "grant_types": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_method": "none",
        "redirect_uris": ["http://localhost:6274/oauth/callback"],
        "client_uri": "https://github.com/modelcontextprotocol/inspector",
        "client_name": "MCP Inspector"
      }`;

      const client1 = JSON.parse(clientJson1) as OAuthClient;
      const client2 = JSON.parse(clientJson2) as OAuthClient;

      const id1 = service.generateClientId(client1);
      const id2 = service.generateClientId(client2);

      expect(id1).toBe(id2);
    });

    it('should generate consistent client IDs regardless of array order', () => {
      // First object with arrays in one order
      const clientJson1 = `{
        "client_name": "MCP Inspector",
        "client_uri": "https://github.com/modelcontextprotocol/inspector",
        "redirect_uris": [
          "http://localhost:6274/oauth/callback",
          "http://localhost:8080/callback",
          "http://127.0.0.1:3000/auth"
        ],
        "token_endpoint_auth_method": "none",
        "grant_types": [
          "authorization_code",
          "refresh_token",
          "client_credentials"
        ],
        "response_types": ["code", "token"]
      }`;

      // Second object with arrays in different order
      const clientJson2 = `{
        "client_name": "MCP Inspector",
        "client_uri": "https://github.com/modelcontextprotocol/inspector",
        "redirect_uris": [
          "http://127.0.0.1:3000/auth",
          "http://localhost:6274/oauth/callback",
          "http://localhost:8080/callback"
        ],
        "token_endpoint_auth_method": "none",
        "grant_types": ["client_credentials", "authorization_code", "refresh_token"],
        "response_types": ["token", "code"]
      }`;

      const client1 = JSON.parse(clientJson1) as OAuthClient;
      const client2 = JSON.parse(clientJson2) as OAuthClient;

      const id1 = service.generateClientId(client1);
      const id2 = service.generateClientId(client2);

      expect(id1).toBe(id2);
    });

    it('should generate consistent client IDs regardless of both property and array order', () => {
      // First object with mixed ordering
      const clientJson1 = `{
        "grant_types": ["refresh_token", "authorization_code"],
        "client_name": "MCP Inspector",
        "response_types": ["code"],
        "redirect_uris": [
          "http://localhost:8080/callback",
          "http://localhost:6274/oauth/callback"
        ],
        "token_endpoint_auth_method": "none",
        "client_uri": "https://github.com/modelcontextprotocol/inspector"
      }`;

      // Second object with different mixed ordering
      const clientJson2 = `{
        "client_uri": "https://github.com/modelcontextprotocol/inspector",
        "token_endpoint_auth_method": "none",
        "redirect_uris": [
          "http://localhost:6274/oauth/callback",
          "http://localhost:8080/callback"
        ],
        "response_types": ["code"],
        "client_name": "MCP Inspector",
        "grant_types": ["authorization_code", "refresh_token"]
      }`;

      const client1 = JSON.parse(clientJson1) as OAuthClient;
      const client2 = JSON.parse(clientJson2) as OAuthClient;

      const id1 = service.generateClientId(client1);
      const id2 = service.generateClientId(client2);

      expect(id1).toBe(id2);
    });

    it('should generate different client IDs for different objects', () => {
      const client1: Partial<OAuthClient> = {
        client_name: 'MCP Inspector',
        client_uri: 'https://github.com/modelcontextprotocol/inspector',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };

      const client2: Partial<OAuthClient> = {
        client_name: 'Different App', // Changed client name
        client_uri: 'https://github.com/modelcontextprotocol/inspector',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };

      const id1 = service.generateClientId(client1 as OAuthClient);
      const id2 = service.generateClientId(client2 as OAuthClient);

      expect(id1).not.toBe(id2);
    });

    it('should generate different client IDs when array contents differ', () => {
      const client1: Partial<OAuthClient> = {
        client_name: 'MCP Inspector',
        client_uri: 'https://github.com/modelcontextprotocol/inspector',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };

      const client2: Partial<OAuthClient> = {
        client_name: 'MCP Inspector',
        client_uri: 'https://github.com/modelcontextprotocol/inspector',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'], // Removed 'refresh_token'
        response_types: ['code'],
      };

      const id1 = service.generateClientId(client1 as OAuthClient);
      const id2 = service.generateClientId(client2 as OAuthClient);

      expect(id1).not.toBe(id2);
    });

    it('should include normalized client name in the generated ID', () => {
      const client: Partial<OAuthClient> = {
        client_name: 'MCP Inspector!@#', // Special characters
        client_uri: 'https://github.com/modelcontextprotocol/inspector',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };

      const clientId = service.generateClientId(client as OAuthClient);

      // Should start with normalized name (lowercase, alphanumeric only)
      expect(clientId).toMatch(/^mcpinspector_[a-f0-9]{16}$/);
    });

    it('should generate IDs with consistent format', () => {
      const client: Partial<OAuthClient> = {
        client_name: 'Test App',
        client_uri: 'https://example.com',
        redirect_uris: ['http://localhost:3000/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      const clientId = service.generateClientId(client as OAuthClient);

      // Should match pattern: normalizedname_16hexchars
      expect(clientId).toMatch(/^[a-z0-9]+_[a-f0-9]{16}$/);

      // Should be consistent across multiple calls
      const clientId2 = service.generateClientId(client as OAuthClient);
      expect(clientId).toBe(clientId2);
    });
  });

  describe('Client Management', () => {
    const mockClient: OAuthClient = {
      client_id: 'test-client-id',
      client_name: 'Test Client',
      client_description: 'A test OAuth client',
      logo_uri: 'https://example.com/logo.png',
      client_uri: 'https://example.com',
      developer_name: 'Test Developer',
      developer_email: 'test@example.com',
      redirect_uris: ['http://localhost:3000/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      created_at: new Date(),
      updated_at: new Date(),
    };

    describe('storeClient', () => {
      it('should store a client and return it', async () => {
        const result = await service.storeClient(mockClient);
        expect(result).toEqual(mockClient);
      });

      it('should allow retrieving the stored client', async () => {
        await service.storeClient(mockClient);
        const retrieved = await service.getClient(mockClient.client_id);
        expect(retrieved).toEqual(mockClient);
      });

      it('should overwrite existing client with same ID', async () => {
        await service.storeClient(mockClient);

        const updatedClient = { ...mockClient, client_name: 'Updated Client' };
        await service.storeClient(updatedClient);

        const retrieved = await service.getClient(mockClient.client_id);
        expect(retrieved?.client_name).toBe('Updated Client');
      });
    });

    describe('getClient', () => {
      it('should return undefined for non-existent client', async () => {
        const result = await service.getClient('non-existent-id');
        expect(result).toBeUndefined();
      });

      it('should return the correct client when it exists', async () => {
        await service.storeClient(mockClient);
        const result = await service.getClient(mockClient.client_id);
        expect(result).toEqual(mockClient);
      });
    });

    describe('findClient', () => {
      it('should return undefined for non-existent client name', async () => {
        const result = await service.findClient('Non-existent Client');
        expect(result).toBeUndefined();
      });

      it('should find client by exact name match', async () => {
        await service.storeClient(mockClient);
        const result = await service.findClient(mockClient.client_name);
        expect(result).toEqual(mockClient);
      });

      it('should be case sensitive', async () => {
        await service.storeClient(mockClient);
        const result = await service.findClient(
          mockClient.client_name.toUpperCase(),
        );
        expect(result).toBeUndefined();
      });

      it('should return first match when multiple clients exist', async () => {
        const client1 = { ...mockClient, client_id: 'client-1' };
        const client2 = {
          ...mockClient,
          client_id: 'client-2',
          client_name: 'Different Client',
        };

        await service.storeClient(client1);
        await service.storeClient(client2);

        const result = await service.findClient(client1.client_name);
        expect(result).toEqual(client1);
      });
    });
  });

  describe('Authorization Code Management', () => {
    const mockAuthCode: AuthorizationCode = {
      code: 'test-auth-code',
      user_id: 'user-123',
      client_id: 'client-123',
      redirect_uri: 'http://localhost:3000/callback',
      code_challenge: 'test-challenge',
      code_challenge_method: 'S256',
      expires_at: Date.now() + 600000, // 10 minutes from now
    };

    describe('storeAuthCode', () => {
      it('should store an authorization code', async () => {
        await service.storeAuthCode(mockAuthCode);
        const retrieved = await service.getAuthCode(mockAuthCode.code);
        expect(retrieved).toEqual(mockAuthCode);
      });

      it('should overwrite existing code with same value', async () => {
        await service.storeAuthCode(mockAuthCode);

        const updatedCode = { ...mockAuthCode, user_id: 'updated-user' };
        await service.storeAuthCode(updatedCode);

        const retrieved = await service.getAuthCode(mockAuthCode.code);
        expect(retrieved?.user_id).toBe('updated-user');
      });
    });

    describe('getAuthCode', () => {
      it('should return undefined for non-existent code', async () => {
        const result = await service.getAuthCode('non-existent-code');
        expect(result).toBeUndefined();
      });

      it('should return the correct authorization code when it exists', async () => {
        await service.storeAuthCode(mockAuthCode);
        const result = await service.getAuthCode(mockAuthCode.code);
        expect(result).toEqual(mockAuthCode);
      });
    });

    describe('removeAuthCode', () => {
      it('should remove an authorization code', async () => {
        await service.storeAuthCode(mockAuthCode);
        await service.removeAuthCode(mockAuthCode.code);

        const retrieved = await service.getAuthCode(mockAuthCode.code);
        expect(retrieved).toBeUndefined();
      });

      it('should not throw when removing non-existent code', async () => {
        await expect(
          service.removeAuthCode('non-existent-code'),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('OAuth Session Management', () => {
    const mockSession: OAuthSession = {
      sessionId: 'session-123',
      state: 'test-state',
      clientId: 'client-123',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: 'test-challenge',
      codeChallengeMethod: 'S256',
      oauthState: 'oauth-state-123',
      resource: 'test-resource',
      expiresAt: Date.now() + 3600000, // 1 hour from now
    };

    const expiredSession: OAuthSession = {
      ...mockSession,
      sessionId: 'expired-session',
      expiresAt: Date.now() - 1000, // 1 second ago
    };

    describe('storeOAuthSession', () => {
      it('should store an OAuth session', async () => {
        const sessionId = 'session-123';
        await service.storeOAuthSession(sessionId, mockSession);

        const retrieved = await service.getOAuthSession(sessionId);
        expect(retrieved).toEqual(mockSession);
      });

      it('should overwrite existing session with same ID', async () => {
        const sessionId = 'session-123';
        await service.storeOAuthSession(sessionId, mockSession);

        const updatedSession = { ...mockSession, state: 'updated-state' };
        await service.storeOAuthSession(sessionId, updatedSession);

        const retrieved = await service.getOAuthSession(sessionId);
        expect(retrieved?.state).toBe('updated-state');
      });
    });

    describe('getOAuthSession', () => {
      it('should return undefined for non-existent session', async () => {
        const result = await service.getOAuthSession('non-existent-session');
        expect(result).toBeUndefined();
      });

      it('should return the correct OAuth session when it exists', async () => {
        const sessionId = 'session-123';
        await service.storeOAuthSession(sessionId, mockSession);

        const result = await service.getOAuthSession(sessionId);
        expect(result).toEqual(mockSession);
      });

      it('should return undefined and auto-remove expired sessions', async () => {
        const sessionId = 'expired-session';
        await service.storeOAuthSession(sessionId, expiredSession);

        const result = await service.getOAuthSession(sessionId);
        expect(result).toBeUndefined();

        // Verify it was actually removed
        const result2 = await service.getOAuthSession(sessionId);
        expect(result2).toBeUndefined();
      });
    });

    describe('removeOAuthSession', () => {
      it('should remove an OAuth session', async () => {
        const sessionId = 'session-123';
        await service.storeOAuthSession(sessionId, mockSession);
        await service.removeOAuthSession(sessionId);

        const retrieved = await service.getOAuthSession(sessionId);
        expect(retrieved).toBeUndefined();
      });

      it('should not throw when removing non-existent session', async () => {
        await expect(
          service.removeOAuthSession('non-existent-session'),
        ).resolves.toBeUndefined();
      });
    });
  });
});
