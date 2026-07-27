import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, isIPv4, isIPv6 } from 'node:net';
import type { OAuthModuleOptions } from '../providers/oauth-provider.interface';
import type { OAuthClient } from '../stores/oauth-store.interface';

/**
 * Client authentication methods a Client ID Metadata Document is forbidden from
 * declaring: "Client metadata documents MUST NOT use the `client_secret_post`,
 * `client_secret_basic`, `client_secret_jwt` ... authentication methods"
 * (draft-ietf-oauth-client-id-metadata-document-00). A shared secret cannot be
 * established with a client whose identity is a public URL, so seeing one means
 * the document is not a CIMD document at all.
 */
const FORBIDDEN_AUTH_METHODS = [
  'client_secret_post',
  'client_secret_basic',
  'client_secret_jwt',
];

/**
 * Upper bound on any cache lifetime we honour, however generous the origin's
 * `Cache-Control` is. A document is the client's *current* identity; letting an
 * origin pin a week-old copy in our memory would keep serving a revoked client.
 */
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  client: OAuthClient;
  expiresAt: number;
}

/** A DNS answer we have already vetted and will connect to directly. */
interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolves URL-shaped `client_id`s into client records by fetching the client's
 * own **Client ID Metadata Document** —
 * [draft-ietf-oauth-client-id-metadata-document-00](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00),
 * the mechanism MCP revision `2026-07-28` prefers over Dynamic Client
 * Registration.
 *
 * ### Why this is not an `IOAuthStore` concern
 *
 * A resolved document is an **HTTP cache entry with mandated invalidation**, not
 * a registration: the client owns it, it can change under us, and the draft
 * forbids caching error or malformed responses at all. `IOAuthStore` is public
 * API with a documented "implement this for Redis/DB" contract, so adding
 * required methods to it would break every custom store for something that is
 * not durable state. The cache therefore lives here, bounded and in-process.
 *
 * ⚠️ In-process means **per-replica**: N replicas fetch a given document up to N
 * times and expire it independently. Correctness is unaffected (every entry is
 * revalidated on expiry and every fetch is fully re-validated), only fetch
 * volume.
 *
 * ### SSRF
 *
 * The authorization server takes a URL from an unauthenticated caller and
 * fetches it — "a malicious client could use this to trigger the authorization
 * server to make requests to arbitrary URLs, such as requests to private
 * administration endpoints the authorization server has access to". The guard
 * here is not advisory: DNS is resolved first, **every** returned address must be
 * publicly routable, and the connection is then pinned to the vetted address so a
 * rebind between check and connect cannot redirect it. Redirects are never
 * followed, the body is capped, and the whole fetch is deadlined.
 */
@Injectable()
export class ClientIdMetadataService {
  private readonly logger = new Logger(ClientIdMetadataService.name);
  /** Insertion-ordered, so the oldest key is the LRU eviction victim. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject('OAUTH_MODULE_OPTIONS')
    private readonly options: OAuthModuleOptions,
  ) {}

  private get config() {
    return this.options.clientIdMetadataDocuments;
  }

  /**
   * Is this `client_id` a metadata document URL rather than a locally
   * registered id?
   *
   * There is no keyspace to disambiguate: both store implementations generate ids
   * as `${normalizedName}_${suffix}` with `normalizedName` stripped to
   * `[a-z0-9]`, so a registered id can never contain `://`. Note this returns
   * `true` for an `http://` URL even when the insecure hatch is off — so
   * {@link resolve} can say "must use https" instead of the flow dead-ending in a
   * generic "Invalid client_id".
   */
  isMetadataDocumentClientId(clientId: string): boolean {
    return this.config.enabled && /^https?:\/\//i.test(clientId);
  }

  /**
   * Fetch, validate and cache the document for `clientId`.
   *
   * Throws {@link BadRequestException} for *every* failure, including a network
   * one: "if the authorization server fails to retrieve the client metadata
   * document, it SHOULD abort the authorization request". Never returns a
   * partially validated client.
   */
  async resolve(clientId: string): Promise<OAuthClient> {
    const cached = this.readCache(clientId);
    if (cached) return cached;

    const url = this.parseClientIdUrl(clientId);
    const pinned = await this.resolvePublicAddress(url);
    const response = await this.fetchDocument(url, pinned);
    const client = this.validateDocument(clientId, response.body);

    // Only a document that survived every check above is cached — "The
    // authorization server MUST NOT cache error responses. The authorization
    // server also MUST NOT cache documents which are invalid or malformed."
    // Failures throw before this line, so there is no negative caching at all.
    this.writeCache(clientId, client, response.headers);
    return client;
  }

  /** Entries currently held. Exposed for tests and operational visibility. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Drop every cached document (e.g. from an admin endpoint). */
  clearCache(): void {
    this.cache.clear();
  }

  // ---------------------------------------------------------------- client_id

  /**
   * Validate the `client_id` URL itself, before anything is fetched.
   *
   * All of these are draft requirements on the identifier: `https` scheme, a path
   * component, no `.`/`..` segments, no fragment, no userinfo. A port is allowed.
   *
   * The dot-segment check runs on the **raw string**, not on the parsed URL:
   * WHATWG parsing silently collapses `/a/../b` to `/b`, so by the time there is
   * a `URL` object the evidence is gone.
   */
  private parseClientIdUrl(clientId: string): URL {
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      throw this.reject(clientId, 'client_id is not a valid absolute URL');
    }

    const insecure = this.config.allowInsecureClientIdScheme;
    if (url.protocol !== 'https:' && !(insecure && url.protocol === 'http:')) {
      throw this.reject(
        clientId,
        'a Client ID Metadata Document URL must use the https scheme',
      );
    }
    if (url.username || url.password) {
      throw this.reject(clientId, 'client_id must not contain userinfo');
    }
    if (url.hash || clientId.includes('#')) {
      throw this.reject(clientId, 'client_id must not contain a fragment');
    }

    const authorityEnd = clientId.indexOf('/', clientId.indexOf('://') + 3);
    const rawPath =
      authorityEnd === -1 ? '' : clientId.slice(authorityEnd).split(/[?#]/)[0];
    if (rawPath === '' || rawPath === '/') {
      throw this.reject(
        clientId,
        'client_id must contain a path component, e.g. https://example.com/client.json',
      );
    }
    if (rawPath.split('/').some((s) => s === '.' || s === '..')) {
      throw this.reject(
        clientId,
        'client_id must not contain single-dot or double-dot path segments',
      );
    }

    if (url.search) {
      // A client-side SHOULD NOT, not a server-side MUST — and harmless here,
      // because the document's own `client_id` still has to string-match the
      // whole URL query included. Warn rather than lock the client out.
      this.logger.warn(
        `Client ID Metadata Document URL carries a query string, which the ` +
          `specification says clients SHOULD NOT do: ${clientId}`,
      );
    }

    return url;
  }

  // -------------------------------------------------------------- SSRF guard

  /**
   * Resolve the host and refuse anything not publicly routable, returning the
   * address the connection will be **pinned** to.
   *
   * Two properties matter and both are easy to get wrong:
   *
   * 1. **Names, not just literals.** `https://evil.example/c.json` where
   *    `evil.example` has an `A` record of `127.0.0.1` is the interesting attack;
   *    rejecting only IP literals catches none of it. So DNS is resolved here and
   *    *every* answer is checked — if any address in the answer set is private,
   *    the whole request is refused rather than cherry-picking a public one.
   * 2. **Pinning.** Checking a name and then handing the same name to the HTTP
   *    client re-resolves it, leaving a DNS-rebinding window between the check
   *    and the connect. The vetted address is therefore fed back through the
   *    agent's `lookup` hook (see {@link fetchDocument}).
   *
   * Unparseable input fails closed. The whole guard is bypassed by
   * `allowInsecureClientIdScheme`, which is what makes the loopback-served
   * example and this repo's tests possible — and why that option is documented as
   * development-only.
   */
  private async resolvePublicAddress(url: URL): Promise<PinnedAddress> {
    const host = url.hostname.replace(/^\[|\]$/g, '');

    if (this.config.allowInsecureClientIdScheme) {
      // Dev hatch: still pin an address if the host is already a literal, so the
      // normal code path is exercised; otherwise let the agent resolve normally.
      if (isIP(host)) {
        return { address: host, family: isIPv6(host) ? 6 : 4 };
      }
      const answers = await this.lookupAll(url, host);
      return answers[0];
    }

    if (isIP(host)) {
      if (!this.isPubliclyRoutable(host)) {
        throw this.reject(
          url.href,
          `refusing to fetch a client metadata document from a private, ` +
            `loopback or otherwise non-routable address (${host})`,
        );
      }
      return { address: host, family: isIPv6(host) ? 6 : 4 };
    }

    const answers = await this.lookupAll(url, host);
    for (const answer of answers) {
      if (!this.isPubliclyRoutable(answer.address)) {
        throw this.reject(
          url.href,
          `refusing to fetch a client metadata document: ${host} resolves to ` +
            `the private, loopback or otherwise non-routable address ` +
            `${answer.address}`,
        );
      }
    }
    return answers[0];
  }

  private lookupAll(url: URL, host: string): Promise<PinnedAddress[]> {
    return new Promise((resolve, reject) => {
      dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => {
        if (err || !addresses?.length) {
          reject(
            this.reject(
              url.href,
              `could not resolve the client metadata document host (${host})`,
            ),
          );
          return;
        }
        resolve(
          addresses.map((a) => ({
            address: a.address,
            family: a.family === 6 ? 6 : 4,
          })),
        );
      });
    });
  }

  /**
   * Reject loopback, private, link-local, CGNAT, unspecified, multicast and
   * reserved space, in both address families, including the IPv4-mapped IPv6
   * spellings of all of them (`::ffff:127.0.0.1` is a loopback address). Anything
   * that fails to parse is treated as non-routable — the guard fails closed.
   */
  private isPubliclyRoutable(ip: string): boolean {
    const bytes = ipToBytes(ip);
    if (!bytes) return false;

    if (bytes.length === 4) {
      const [a, b] = bytes;
      if (a === 0) return false; // 0.0.0.0/8 "this host on this network"
      if (a === 10) return false; // RFC 1918
      if (a === 127) return false; // loopback
      if (a === 169 && b === 254) return false; // link-local
      if (a === 172 && b >= 16 && b <= 31) return false; // RFC 1918
      if (a === 100 && b >= 64 && b <= 127) return false; // RFC 6598 CGNAT
      // Whole 192.0/16, which over-blocks slightly to cover both 192.0.0/24
      // (IETF protocol assignments) and 192.0.2/24 (TEST-NET-1). Over-blocking
      // is the safe direction: nothing in there hosts a real client document.
      if (a === 192 && b === 0) return false;
      if (a === 192 && b === 168) return false; // RFC 1918
      if (a === 198 && (b === 18 || b === 19)) return false; // RFC 2544 benchmarking
      if (a >= 224) return false; // multicast, reserved, broadcast
      return true;
    }

    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) forms carry a v4
    // address in the low 4 bytes — classify that, or a loopback slips through
    // spelled as IPv6.
    const leadingZero = bytes.slice(0, 10).every((b) => b === 0);
    if (leadingZero && bytes[10] === 0xff && bytes[11] === 0xff) {
      return this.isPubliclyRoutable(bytes.slice(12).join('.'));
    }
    if (leadingZero && bytes[10] === 0 && bytes[11] === 0) {
      // Covers `::` (unspecified) and `::1` (loopback) as well as ::a.b.c.d.
      return false;
    }

    const first = bytes[0];
    if ((first & 0xfe) === 0xfc) return false; // fc00::/7 unique-local
    if (first === 0xfe && (bytes[1] & 0xc0) === 0x80) return false; // fe80::/10
    if (first === 0xff) return false; // ff00::/8 multicast
    return true;
  }

  // ------------------------------------------------------------------- fetch

  /**
   * `GET` the document over a connection pinned to the vetted address.
   *
   * Uses `node:http`/`node:https` rather than `fetch` for three reasons that all
   * matter here: `lookup` can be overridden (so the address is pinned),
   * redirects are never followed (nothing to opt out of), and the body can be
   * capped as it streams instead of after it has already been buffered.
   *
   * Unspecified by the draft, decided here: method `GET`, `Accept:
   * application/json`, redirects **not** followed (a 3xx is a failure), one hard
   * deadline covering connect *and* read, and only `200` accepted.
   */
  private fetchDocument(
    url: URL,
    pinned: PinnedAddress,
  ): Promise<{ body: string; headers: http.IncomingHttpHeaders }> {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const maxBytes = this.config.maxDocumentBytes;

    return new Promise((resolve, reject) => {
      let settled = false;
      let request: http.ClientRequest | undefined;

      // One deadline for the whole exchange, armed before the request exists.
      // `request.setTimeout` only covers socket *inactivity*, so a response that
      // trickles a byte at a time would otherwise outlive any per-socket timeout.
      const deadline = setTimeout(
        () => fail('client metadata document request timed out'),
        this.config.timeoutMs,
      );

      function settle(): boolean {
        if (settled) return false;
        settled = true;
        clearTimeout(deadline);
        return true;
      }

      const fail = (reason: string) => {
        if (!settle()) return;
        request?.destroy();
        reject(this.reject(url.href, reason));
      };

      const onResponse = (response: http.IncomingMessage) => {
        if (response.statusCode !== 200) {
          // Includes 3xx: redirects are not followed, because each hop would need
          // the SSRF guard re-run against a target the client gets to choose
          // after its URL was already vetted.
          response.resume();
          fail(
            `client metadata document request returned HTTP ${response.statusCode}`,
          );
          return;
        }

        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          response.resume();
          fail(
            `client metadata document is larger than the ${maxBytes}-byte limit`,
          );
          return;
        }

        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            fail(
              `client metadata document is larger than the ${maxBytes}-byte limit`,
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (!settle()) return;
          resolve({
            body: Buffer.concat(chunks).toString('utf-8'),
            headers: response.headers,
          });
        });
        response.on('error', (err) => fail(`read failed: ${err.message}`));
      };

      try {
        request = transport.request(
          {
            protocol: url.protocol,
            // `hostname` still drives the `Host` header and the TLS SNI/cert
            // check; only address resolution is overridden below.
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method: 'GET',
            headers: {
              accept: 'application/json',
              // No compression: a gzip bomb would sail past a byte cap applied
              // to the wire bytes.
              'accept-encoding': 'identity',
              'user-agent': 'mcp-nest-auth/client-id-metadata',
            },
            // The pin: answer with the address already vetted above, so no second
            // resolution — and therefore no DNS-rebinding window — exists.
            //
            // Both `dns.lookup` callback shapes have to be served. Node's `net`
            // layer passes `all: true` since v20 and reads `addresses[0]`, while
            // older Node (and Bun) call it with `(err, address, family)`. Getting
            // this wrong fails as `Invalid IP address: undefined` at connect time,
            // and only on whichever runtime you did not test on.
            lookup: (_hostname, opts, callback) => {
              const answer = {
                address: pinned.address,
                family: pinned.family,
              };
              if ((opts as { all?: boolean } | undefined)?.all) {
                (
                  callback as unknown as (e: null, a: (typeof answer)[]) => void
                )(null, [answer]);
                return;
              }
              (callback as unknown as (e: null, a: string, f: number) => void)(
                null,
                answer.address,
                answer.family,
              );
            },
          },
          onResponse,
        );
      } catch (err) {
        fail(`request could not be started: ${(err as Error).message}`);
        return;
      }

      request.on('error', (err) => fail(`request failed: ${err.message}`));
      request.end();
    });
  }

  // ---------------------------------------------------------------- validate

  /**
   * Structural and policy validation of the fetched body.
   *
   * The `client_id` comparison is a **simple string comparison** against the
   * `client_id` the client sent (RFC 3986 §6.2.1, as the draft requires) — no
   * normalization, no case folding. A document whose `client_id` differs only by
   * a default port or host case therefore fails, which is the intended
   * fail-closed direction: this equality is the entire binding between "the URL
   * we fetched" and "the identity we are about to grant".
   */
  private validateDocument(clientId: string, body: string): OAuthClient {
    let document: unknown;
    try {
      document = JSON.parse(body);
    } catch {
      throw this.reject(clientId, 'client metadata document is not valid JSON');
    }
    if (
      typeof document !== 'object' ||
      document === null ||
      Array.isArray(document)
    ) {
      throw this.reject(
        clientId,
        'client metadata document must be a JSON object',
      );
    }

    const doc = document as Record<string, unknown>;

    if (doc.client_id !== clientId) {
      throw this.reject(
        clientId,
        `client metadata document declares client_id ` +
          `${JSON.stringify(doc.client_id)}, which does not match the URL it ` +
          `was fetched from`,
      );
    }
    if (typeof doc.client_name !== 'string' || doc.client_name.length === 0) {
      throw this.reject(
        clientId,
        'client metadata document must contain a non-empty client_name',
      );
    }
    if (
      !Array.isArray(doc.redirect_uris) ||
      doc.redirect_uris.length === 0 ||
      !doc.redirect_uris.every((u) => typeof u === 'string' && u.length > 0)
    ) {
      throw this.reject(
        clientId,
        'client metadata document must contain a non-empty redirect_uris array of strings',
      );
    }

    if ('client_secret' in doc || 'client_secret_expires_at' in doc) {
      throw this.reject(
        clientId,
        'client metadata documents MUST NOT contain client_secret or client_secret_expires_at',
      );
    }

    const authMethod =
      typeof doc.token_endpoint_auth_method === 'string'
        ? doc.token_endpoint_auth_method
        : 'none';
    if (FORBIDDEN_AUTH_METHODS.includes(authMethod)) {
      throw this.reject(
        clientId,
        `client metadata documents MUST NOT use token_endpoint_auth_method=${authMethod}`,
      );
    }
    if (authMethod !== 'none') {
      // `private_key_jwt` (and the mTLS methods) are legal in a CIMD document but
      // unimplemented here. Refusing at /authorize is deliberate: accepting the
      // document and then failing at /token would hand the client an
      // authorization code it can never redeem, after the user has already
      // consented — a worse failure than a clear one before any of that.
      throw this.reject(
        clientId,
        `token_endpoint_auth_method=${authMethod} is not supported by this ` +
          `authorization server; a Client ID Metadata Document client must use ` +
          `"none" (public client with PKCE)`,
      );
    }

    const now = new Date();
    return {
      client_id: clientId,
      client_name: doc.client_name,
      client_uri: asOptionalString(doc.client_uri),
      logo_uri: asOptionalString(doc.logo_uri),
      redirect_uris: doc.redirect_uris as string[],
      // Nothing in this server enforces `grant_types`/`response_types` today;
      // they are mirrored so a CIMD client record looks like a DCR one, and
      // defaulted to the same values `ClientService.registerClient` uses.
      grant_types: asStringArray(doc.grant_types) ?? [
        'authorization_code',
        'refresh_token',
      ],
      response_types: asStringArray(doc.response_types) ?? ['code'],
      token_endpoint_auth_method: 'none',
      created_at: now,
      updated_at: now,
    };
  }

  // ------------------------------------------------------------------- cache

  private readCache(clientId: string): OAuthClient | undefined {
    const entry = this.cache.get(clientId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(clientId);
      return undefined;
    }
    // Re-insert so `cache` stays ordered least- to most-recently-used.
    this.cache.delete(clientId);
    this.cache.set(clientId, entry);
    return entry.client;
  }

  private writeCache(
    clientId: string,
    client: OAuthClient,
    headers: http.IncomingHttpHeaders,
  ): void {
    const ttl = this.cacheTtlFrom(headers);
    if (ttl <= 0) return;

    while (this.cache.size >= this.config.maxCacheEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
    this.cache.set(clientId, { client, expiresAt: Date.now() + ttl });
  }

  /**
   * "The authorization server MAY cache the metadata, respecting HTTP cache
   * headers." A deliberately small subset of RFC 9111 is honoured, because this
   * is a private cache of one document type, not a general-purpose HTTP cache:
   * `no-store`/`no-cache` suppress caching, `s-maxage` then `max-age` set the
   * lifetime, `Expires` is the fallback, and the configured `cacheTtlMs` applies
   * when the origin says nothing. Everything is clamped to
   * {@link MAX_CACHE_TTL_MS}.
   */
  private cacheTtlFrom(headers: http.IncomingHttpHeaders): number {
    const cacheControl = String(headers['cache-control'] ?? '').toLowerCase();
    if (
      /\bno-store\b/.test(cacheControl) ||
      /\bno-cache\b/.test(cacheControl)
    ) {
      return 0;
    }

    const directive =
      /\bs-maxage\s*=\s*"?(\d+)"?/.exec(cacheControl) ??
      /\bmax-age\s*=\s*"?(\d+)"?/.exec(cacheControl);
    if (directive) {
      return Math.min(Number(directive[1]) * 1000, MAX_CACHE_TTL_MS);
    }

    const expires = headers['expires'];
    if (typeof expires === 'string') {
      const at = Date.parse(expires);
      if (!Number.isNaN(at)) {
        return Math.min(Math.max(at - Date.now(), 0), MAX_CACHE_TTL_MS);
      }
    }

    return Math.min(this.config.cacheTtlMs, MAX_CACHE_TTL_MS);
  }

  /**
   * One error shape for every failure. `invalid_client` details are logged rather
   * than fully echoed in some cases, but the message is kept actionable — a
   * client debugging its own document is the overwhelmingly common caller.
   */
  private reject(clientId: string, reason: string): BadRequestException {
    this.logger.warn(`Rejected client_id ${clientId}: ${reason}`);
    return new BadRequestException(`Invalid client_id: ${reason}`);
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : undefined;
}

function ipv4ToBytes(ip: string): number[] | null {
  if (!isIPv4(ip)) return null;
  return ip.split('.').map(Number);
}

/**
 * Address → bytes, for both families, so range checks can be written once
 * against numbers instead of against string prefixes (where `fe80::` and
 * `0:0:0:0:0:0:0:1` are the same address spelled two ways). Returns `null` for
 * anything unparseable, and callers treat `null` as non-routable.
 */
function ipToBytes(ip: string): number[] | null {
  if (isIPv4(ip)) return ipv4ToBytes(ip);
  if (!isIPv6(ip)) return null;

  let text = ip.split('%')[0];

  // Rewrite a trailing dotted-quad (`::ffff:127.0.0.1`) into two hextets so the
  // group expansion below sees a uniform 8-group address.
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const v4 = ipv4ToBytes(text.slice(lastColon + 1));
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups =
    halves.length === 2
      ? [
          ...head,
          ...new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'),
          ...tail,
        ]
      : head;
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}
