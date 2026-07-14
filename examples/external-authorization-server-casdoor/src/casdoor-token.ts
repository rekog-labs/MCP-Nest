/**
 * Shared Casdoor access-token verification, used by `casdoor-auth.guard.ts` —
 * the NestJS guard on the real MCP controller.
 *
 * Casdoor signs access tokens with RS256 and publishes the matching public keys
 * at its JWKS endpoint. We fetch that JWKS and verify the token's signature,
 * issuer, and expiry. No shared secret — the resource server and the AS share
 * nothing private.
 *
 * On RFC 8707 (resource indicators): Casdoor sets the token `aud` to the OAuth
 * *client_id*, NOT the MCP resource URL the spec would prefer. So `audience` is
 * off by default — we trust any validly-signed, unexpired token from our issuer.
 * To tighten in production, configure Casdoor to emit the resource URL as the
 * audience and pass `audience` here so jose enforces it.
 */

export interface CasdoorVerifyOptions {
  /** Expected `iss` — the Casdoor issuer, e.g. http://localhost:8000 */
  issuer: string;
  /** Casdoor JWKS URL, e.g. http://localhost:8000/.well-known/jwks */
  jwksUri: string;
  /** Optional expected `aud`. Off by default — see the RFC 8707 note above. */
  audience?: string;
}

/** Pull a Bearer token out of an `Authorization` header value. */
export function extractBearer(authorization?: string): string | undefined {
  const [type, token] = authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}

// `jose` is ESM-only; import it lazily so this file works regardless of the
// host module system, and cache the remote JWKS (it refreshes itself and
// rate-limits fetches internally).
type Verifier = {
  jwks: (
    protectedHeader?: unknown,
    token?: unknown,
  ) => Promise<CryptoKey | Uint8Array>;
  jwtVerify: (
    token: string,
    key: unknown,
    options?: { issuer?: string; audience?: string },
  ) => Promise<{ payload: Record<string, unknown> }>;
};
let verifierPromise: Promise<Verifier> | null = null;
function getVerifier(jwksUri: string): Promise<Verifier> {
  if (!verifierPromise) {
    verifierPromise = (async () => {
      const jose = (await import('jose')) as unknown as {
        createRemoteJWKSet: (url: URL) => Verifier['jwks'];
        jwtVerify: Verifier['jwtVerify'];
      };
      return {
        jwks: jose.createRemoteJWKSet(new URL(jwksUri)),
        jwtVerify: jose.jwtVerify,
      };
    })();
  }
  return verifierPromise;
}

/**
 * Verify a Casdoor RS256 access token. Resolves to the JWT payload (use it as
 * `req.user`) or throws if the token is missing-from-JWKS / tampered / expired /
 * from the wrong issuer.
 */
export async function verifyCasdoorToken(
  token: string,
  options: CasdoorVerifyOptions,
): Promise<Record<string, unknown>> {
  const { jwks, jwtVerify } = await getVerifier(options.jwksUri);
  const { payload } = await jwtVerify(token, jwks, {
    issuer: options.issuer,
    audience: options.audience,
  });
  return payload;
}
