import { FAKE_USERS, mintFakeToken } from '../src/fake-auth';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const RESOURCE = SERVER_URL + '/mcp';
const JWT_SECRET =
  process.env.JWT_SECRET || 'fake_local_dev_secret_at_least_32_chars_long';

for (const [label, user] of Object.entries(FAKE_USERS)) {
  console.log(`export ${label}='${mintFakeToken(user, JWT_SECRET, RESOURCE)}'`);
}
