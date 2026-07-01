import * as jwt from 'jsonwebtoken';

// Locally mint a JWT signed with the same jwtSecret the server uses, so the
// /mcp middleware's JwtTokenService.validateToken() (HS256 verify) accepts it
// without ever contacting an external IdP. FAKE-mode offline path only.
const PORT = Number(process.env.PORT ?? 3014);
const SERVER_URL = `http://localhost:${PORT}`;
const JWT_SECRET =
  process.env.JWT_SECRET ?? 'dev-super-secure-jwt-secret-at-least-32-chars';

const token = jwt.sign(
  {
    sub: 'local-test-user',
    type: 'access',
    displayName: 'Ada Lovelace',
    scope: '',
    resource: `${SERVER_URL}/mcp`,
    iss: SERVER_URL,
    aud: `${SERVER_URL}/mcp`,
  },
  JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' },
);

process.stdout.write(token + '\n');
