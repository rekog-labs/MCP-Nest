/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DeleteResult } from 'typeorm';
import { TypeOrmStore } from './typeorm-store.service';
import {
  OAuthClientEntity,
  AuthorizationCodeEntity,
  OAuthSessionEntity,
  OAuthUserProfileEntity,
} from './entities';
import { OAuthClient, AuthorizationCode } from '../oauth-store.interface';
import { OAuthSession } from '../../providers/oauth-provider.interface';
import { OAUTH_TYPEORM_CONNECTION_NAME } from './constants';

describe('TypeOrmStore', () => {
  let service: TypeOrmStore;
  let clientRepository: jest.Mocked<Repository<OAuthClientEntity>>;
  let authCodeRepository: jest.Mocked<Repository<AuthorizationCodeEntity>>;
  let sessionRepository: jest.Mocked<Repository<OAuthSessionEntity>>;

  beforeEach(async () => {
    // Create mocked repositories
    const mockClientRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const mockAuthCodeRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const mockSessionRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const mockUserProfileRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TypeOrmStore,
        {
          provide: getRepositoryToken(
            OAuthClientEntity,
            OAUTH_TYPEORM_CONNECTION_NAME,
          ),
          useValue: mockClientRepository,
        },
        {
          provide: getRepositoryToken(
            AuthorizationCodeEntity,
            OAUTH_TYPEORM_CONNECTION_NAME,
          ),
          useValue: mockAuthCodeRepository,
        },
        {
          provide: getRepositoryToken(
            OAuthSessionEntity,
            OAUTH_TYPEORM_CONNECTION_NAME,
          ),
          useValue: mockSessionRepository,
        },
        {
          provide: getRepositoryToken(
            OAuthUserProfileEntity,
            OAUTH_TYPEORM_CONNECTION_NAME,
          ),
          useValue: mockUserProfileRepository,
        },
      ],
    }).compile();

    service = module.get<TypeOrmStore>(TypeOrmStore);
    clientRepository = module.get(
      getRepositoryToken(OAuthClientEntity, OAUTH_TYPEORM_CONNECTION_NAME),
    );
    authCodeRepository = module.get(
      getRepositoryToken(
        AuthorizationCodeEntity,
        OAUTH_TYPEORM_CONNECTION_NAME,
      ),
    );
    sessionRepository = module.get(
      getRepositoryToken(OAuthSessionEntity, OAUTH_TYPEORM_CONNECTION_NAME),
    );
    // Note: userProfileRepository is not directly used in tests below; it's provided for completeness
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateClientId', () => {
    const mockClient: OAuthClient = {
      client_id: '',
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

    it('should generate client IDs with correct format', () => {
      const clientId = service.generateClientId(mockClient);

      // Should match pattern: normalizedname_8hexchars
      expect(clientId).toMatch(/^[a-z0-9]+_[a-f0-9]{8}$/);
    });

    it('should include normalized client name in the generated ID', () => {
      const clientWithSpecialChars = {
        ...mockClient,
        client_name: 'Test Client!@#',
      };

      const clientId = service.generateClientId(clientWithSpecialChars);
      expect(clientId).toMatch(/^testclient_[a-f0-9]{8}$/);
    });

    it('should generate different IDs for different clients', () => {
      const client1 = { ...mockClient, client_name: 'Client One' };
      const client2 = { ...mockClient, client_name: 'Client Two' };

      const id1 = service.generateClientId(client1);
      const id2 = service.generateClientId(client2);

      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs on each call (non-deterministic)', () => {
      const id1 = service.generateClientId(mockClient);
      const id2 = service.generateClientId(mockClient);

      // TypeORM store uses random bytes, so IDs should be different
      expect(id1).not.toBe(id2);
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
      it('should store a client and return the saved result', async () => {
        clientRepository.save.mockResolvedValue(
          mockClient as OAuthClientEntity,
        );

        const result = await service.storeClient(mockClient);

        expect(clientRepository.save).toHaveBeenCalledWith(mockClient);
        expect(result).toEqual(mockClient);
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        clientRepository.save.mockRejectedValue(error);

        await expect(service.storeClient(mockClient)).rejects.toThrow(
          'Database error',
        );
      });
    });

    describe('getClient', () => {
      it('should return client when found', async () => {
        clientRepository.findOne.mockResolvedValue(
          mockClient as OAuthClientEntity,
        );

        const result = await service.getClient('test-client-id');

        expect(clientRepository.findOne).toHaveBeenCalledWith({
          where: { client_id: 'test-client-id' },
        });
        expect(result).toEqual(mockClient);
      });

      it('should return undefined when client not found', async () => {
        clientRepository.findOne.mockResolvedValue(null);

        const result = await service.getClient('non-existent-id');

        expect(result).toBeUndefined();
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        clientRepository.findOne.mockRejectedValue(error);

        await expect(service.getClient('test-client-id')).rejects.toThrow(
          'Database error',
        );
      });
    });

    describe('findClient', () => {
      it('should find client by name when found', async () => {
        clientRepository.findOne.mockResolvedValue(
          mockClient as OAuthClientEntity,
        );

        const result = await service.findClient('Test Client');

        expect(clientRepository.findOne).toHaveBeenCalledWith({
          where: { client_name: 'Test Client' },
        });
        expect(result).toEqual(mockClient);
      });

      it('should return undefined when client name not found', async () => {
        clientRepository.findOne.mockResolvedValue(null);

        const result = await service.findClient('Non-existent Client');

        expect(result).toBeUndefined();
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        clientRepository.findOne.mockRejectedValue(error);

        await expect(service.findClient('Test Client')).rejects.toThrow(
          'Database error',
        );
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

    const expiredAuthCode: AuthorizationCode = {
      ...mockAuthCode,
      expires_at: Date.now() - 1000, // 1 second ago
    };

    describe('storeAuthCode', () => {
      it('should store an authorization code', async () => {
        authCodeRepository.save.mockResolvedValue(
          mockAuthCode as AuthorizationCodeEntity,
        );

        await service.storeAuthCode(mockAuthCode);

        expect(authCodeRepository.save).toHaveBeenCalledWith(mockAuthCode);
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        authCodeRepository.save.mockRejectedValue(error);

        await expect(service.storeAuthCode(mockAuthCode)).rejects.toThrow(
          'Database error',
        );
      });
    });

    describe('getAuthCode', () => {
      it('should return authorization code when found and not expired', async () => {
        authCodeRepository.findOne.mockResolvedValue(
          mockAuthCode as AuthorizationCodeEntity,
        );

        const result = await service.getAuthCode('test-auth-code');

        expect(authCodeRepository.findOne).toHaveBeenCalledWith({
          where: { code: 'test-auth-code' },
        });
        expect(result).toEqual(mockAuthCode);
      });

      it('should return undefined and delete expired authorization code', async () => {
        authCodeRepository.findOne.mockResolvedValue(
          expiredAuthCode as AuthorizationCodeEntity,
        );
        authCodeRepository.delete.mockResolvedValue({
          raw: {},
          affected: 1,
        } as DeleteResult);

        const result = await service.getAuthCode('expired-code');

        expect(authCodeRepository.findOne).toHaveBeenCalledWith({
          where: { code: 'expired-code' },
        });
        expect(authCodeRepository.delete).toHaveBeenCalledWith({
          code: 'expired-code',
        });
        expect(result).toBeUndefined();
      });

      it('should return undefined when authorization code not found', async () => {
        authCodeRepository.findOne.mockResolvedValue(null);

        const result = await service.getAuthCode('non-existent-code');

        expect(result).toBeUndefined();
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        authCodeRepository.findOne.mockRejectedValue(error);

        await expect(service.getAuthCode('test-auth-code')).rejects.toThrow(
          'Database error',
        );
      });
    });

    describe('removeAuthCode', () => {
      it('should remove an authorization code', async () => {
        authCodeRepository.delete.mockResolvedValue({
          raw: {},
          affected: 1,
        } as DeleteResult);

        await service.removeAuthCode('test-auth-code');

        expect(authCodeRepository.delete).toHaveBeenCalledWith({
          code: 'test-auth-code',
        });
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        authCodeRepository.delete.mockRejectedValue(error);

        await expect(service.removeAuthCode('test-auth-code')).rejects.toThrow(
          'Database error',
        );
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
        const expectedEntity = { ...mockSession, sessionId: 'session-123' };
        sessionRepository.save.mockResolvedValue(
          expectedEntity as OAuthSessionEntity,
        );

        await service.storeOAuthSession('session-123', mockSession);

        expect(sessionRepository.save).toHaveBeenCalledWith(expectedEntity);
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        sessionRepository.save.mockRejectedValue(error);

        await expect(
          service.storeOAuthSession('session-123', mockSession),
        ).rejects.toThrow('Database error');
      });
    });

    describe('getOAuthSession', () => {
      it('should return OAuth session when found and not expired', async () => {
        sessionRepository.findOne.mockResolvedValue(
          mockSession as OAuthSessionEntity,
        );

        const result = await service.getOAuthSession('session-123');

        expect(sessionRepository.findOne).toHaveBeenCalledWith({
          where: { sessionId: 'session-123' },
        });
        expect(result).toEqual(mockSession);
      });

      it('should return undefined and delete expired OAuth session', async () => {
        sessionRepository.findOne.mockResolvedValue(
          expiredSession as OAuthSessionEntity,
        );
        sessionRepository.delete.mockResolvedValue({
          raw: {},
          affected: 1,
        } as DeleteResult);

        const result = await service.getOAuthSession('expired-session');

        expect(sessionRepository.findOne).toHaveBeenCalledWith({
          where: { sessionId: 'expired-session' },
        });
        expect(sessionRepository.delete).toHaveBeenCalledWith({
          sessionId: 'expired-session',
        });
        expect(result).toBeUndefined();
      });

      it('should return undefined when OAuth session not found', async () => {
        sessionRepository.findOne.mockResolvedValue(null);

        const result = await service.getOAuthSession('non-existent-session');

        expect(result).toBeUndefined();
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        sessionRepository.findOne.mockRejectedValue(error);

        await expect(service.getOAuthSession('session-123')).rejects.toThrow(
          'Database error',
        );
      });
    });

    describe('removeOAuthSession', () => {
      it('should remove an OAuth session', async () => {
        sessionRepository.delete.mockResolvedValue({
          raw: {},
          affected: 1,
        } as DeleteResult);

        await service.removeOAuthSession('session-123');

        expect(sessionRepository.delete).toHaveBeenCalledWith({
          sessionId: 'session-123',
        });
      });

      it('should handle database errors', async () => {
        const error = new Error('Database error');
        sessionRepository.delete.mockRejectedValue(error);

        await expect(service.removeOAuthSession('session-123')).rejects.toThrow(
          'Database error',
        );
      });
    });
  });
});
