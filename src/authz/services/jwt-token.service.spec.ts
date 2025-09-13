import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { JwtTokenService } from './jwt-token.service';

describe('JwtTokenService', () => {
  const baseOptions = {
    jwtSecret: 'a'.repeat(32),
    jwtIssuer: 'http://localhost',
    serverUrl: 'http://localhost',
    jwtAccessTokenExpiresIn: '2h',
    jwtRefreshTokenExpiresIn: '3d',
    enableRefreshTokens: true,
  } as any;

  let service: JwtTokenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtTokenService,
        {
          provide: 'OAUTH_MODULE_OPTIONS',
          useValue: baseOptions,
        },
      ],
    }).compile();

    service = module.get(JwtTokenService);
  });

  it('generates tokens with configured expirations', () => {
    const tokens = service.generateTokenPair('user1', 'client1', '', 'resource1');
    expect(tokens.refresh_token).toBeDefined();
    const decoded = jwt.decode(tokens.access_token) as jwt.JwtPayload;
    const decodedRefresh = jwt.decode(tokens.refresh_token!) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(2 * 60 * 60);
    expect(decodedRefresh.exp! - decodedRefresh.iat!).toBe(3 * 24 * 60 * 60);
    expect(tokens.expires_in).toBe(2 * 60 * 60);
  });

  it('can disable refresh tokens', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtTokenService,
        {
          provide: 'OAUTH_MODULE_OPTIONS',
          useValue: { ...baseOptions, enableRefreshTokens: false },
        },
      ],
    }).compile();

    const serviceNoRefresh = module.get(JwtTokenService);
    const tokens = serviceNoRefresh.generateTokenPair(
      'user1',
      'client1',
      '',
      'resource1',
    );
    expect(tokens.refresh_token).toBeUndefined();
    expect(tokens.expires_in).toBe(2 * 60 * 60);
  });
});

