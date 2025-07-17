import { Test, TestingModule } from '@nestjs/testing';
import { MemoryStore } from './memory-store.service';
import { OAuthClient } from './oauth-store.interface';

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
});
