import { createRequestStateCodec } from '@rekog/mcp-nest';

/**
 * What the `deploy` tool needs to remember between rounds. It never touches
 * server memory: the codec seals it into the `requestState` string, the client
 * echoes that string back, and the codec verifies + decodes it on re-entry.
 */
export type DeployState = { step: 'confirm' | 'reason'; env: string };

/**
 * HMAC-SHA256 codec for `requestState` (SDK-provided, re-exported by mcp-nest).
 *
 * The key must be shared by every instance that may receive an echoed state,
 * so a real deployment loads it from configuration. A random per-process key
 * is fine for one local process — restart the server and any in-flight round
 * trip is rejected as `Invalid or expired requestState`, which is exactly the
 * behavior you want from tampered or stale state.
 */
export const stateCodec = createRequestStateCodec<DeployState>({
  key: process.env.MRTR_STATE_KEY ?? crypto.getRandomValues(new Uint8Array(32)),
  ttlSeconds: 600,
});
