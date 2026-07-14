import * as jwt from 'jsonwebtoken';

// Must match the FAKE-mode jwtSecret in src/main.ts so
// JwtTokenService.validateToken() accepts it (HS256 signature check).
const secret = process.env.JWT_SECRET || 'fake-azure-ad-jwt-secret-0123456789abcdef';

const token = jwt.sign(
  {
    sub: 'azure-user-123',
    type: 'access',
    scope: 'openid profile email User.Read',
    resource: `http://localhost:${process.env.PORT || 3016}/mcp`,
    displayName: 'John Doe',
    username: 'user@example.com',
    email: 'john@company.com',
  },
  secret,
  { algorithm: 'HS256', expiresIn: '1h' },
);

process.stdout.write(token + '\n');
