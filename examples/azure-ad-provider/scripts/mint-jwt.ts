import * as jwt from 'jsonwebtoken';

// Mint a token the server's JwtTokenService.validateToken() accepts offline:
// HS256, signed with the same jwtSecret. validateToken only checks the HS256
// signature (no issuer/audience/type constraints), so this passes the middleware.
const JWT_SECRET =
  process.env.JWT_SECRET || 'fake-jwt-secret-at-least-32-characters-long';

const token = jwt.sign(
  { sub: 'fake-user-123', type: 'access', scope: '' },
  JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' },
);

console.log(token);
