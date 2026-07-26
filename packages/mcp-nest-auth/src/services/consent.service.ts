import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ConsentRenderContext,
  OAuthModuleOptions,
} from '../providers/oauth-provider.interface';

/**
 * Hostnames that mean "this machine". A redirect URI pointing at one of these
 * cannot be attributed to the client the metadata document describes — any
 * process on the user's computer can bind the port.
 */
const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
]);

/**
 * Ceiling on remembered approvals, so a server facing many users/clients cannot
 * grow this map without bound. Evicted least-recently-recorded first; an evicted
 * user simply sees the screen again.
 */
const MAX_REMEMBERED_GRANTS = 5_000;

/**
 * The interactive consent step: rendering the screen, and remembering that a
 * user already approved a given client for a given scope.
 *
 * ### Why it sits between the IdP callback and the authorization code
 *
 * Two constraints pin it there. It needs an authenticated principal to record the
 * grant against, which only exists after the IdP round-trip; and the spec wants
 * the redirect-URI hostname shown *during authorization*, which stops being true
 * once the code has been minted and the browser is already on its way back to the
 * client. So `/authorize` still bounces straight to the IdP as before, and the
 * callback renders the screen instead of issuing the code.
 *
 * ### Storage
 *
 * Approvals are held **in process memory**, not in `IOAuthStore`. They are a UX
 * optimisation ("don't ask me again"), not authorization state: losing one costs
 * a prompt, and nothing is granted on the strength of a remembered approval that
 * would not also require a live authenticated session. Adding required methods to
 * `IOAuthStore` — public API with a documented custom-implementation contract —
 * for that would break every custom store.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);
  /** Insertion-ordered: the first key is the eviction victim. */
  private readonly grants = new Map<string, number>();

  constructor(
    @Inject('OAUTH_MODULE_OPTIONS')
    private readonly options: OAuthModuleOptions,
  ) {}

  isEnabled(): boolean {
    return this.options.consent.enabled;
  }

  /**
   * Has this user already approved this client for (at least) this scope set?
   *
   * Keyed on the *narrowed* scope string, order-normalised, so approving
   * `a b` also covers `b a` but not `a b c` — a client that later asks for more
   * has to ask the user for more.
   */
  hasConsent(
    userProfileId: string,
    clientId: string,
    scope: string | undefined,
  ): boolean {
    const key = grantKey(userProfileId, clientId, scope);
    const expiresAt = this.grants.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.grants.delete(key);
      return false;
    }
    return true;
  }

  recordConsent(
    userProfileId: string,
    clientId: string,
    scope: string | undefined,
  ): void {
    const ttl = this.options.consent.rememberForMs;
    if (ttl <= 0) return; // `rememberForMs: 0` means prompt every single time.

    const key = grantKey(userProfileId, clientId, scope);
    this.grants.delete(key);
    while (this.grants.size >= MAX_REMEMBERED_GRANTS) {
      const oldest = this.grants.keys().next();
      if (oldest.done) break;
      this.grants.delete(oldest.value);
    }
    this.grants.set(key, Date.now() + ttl);
  }

  /** Forget every remembered approval (e.g. from an admin endpoint). */
  clearConsents(): void {
    this.grants.clear();
  }

  /** Is this redirect URI pointing at the user's own machine? */
  isLoopbackRedirect(redirectUri: string): boolean {
    try {
      return LOOPBACK_HOSTS.has(new URL(redirectUri).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  async render(context: ConsentRenderContext): Promise<string> {
    const custom = this.options.consent.render;
    if (custom) {
      return await custom(context);
    }
    return renderDefaultConsentPage(context);
  }

  /**
   * Log the decision. Consent is a security-relevant user action, so a denial and
   * an approval should both be visible in the server's own record, not only in the
   * redirect the client sees.
   */
  logDecision(
    approved: boolean,
    userProfileId: string,
    clientId: string,
    redirectUri: string,
  ): void {
    this.logger.log(
      `Consent ${approved ? 'granted' : 'denied'} by user ${userProfileId} ` +
        `for client ${clientId} (redirect ${redirectUri})`,
    );
  }
}

function grantKey(
  userProfileId: string,
  clientId: string,
  scope: string | undefined,
): string {
  const normalizedScope = (scope ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
  // NUL separators: no scope, client_id or profile id can contain one, so the
  // key cannot be forged by a value that merely looks like a delimiter.
  return [userProfileId, clientId, normalizedScope].join('\u0000');
}

/**
 * Every interpolated value below is attacker-controlled in the CIMD case: the
 * `client_name`, `client_uri` and `logo_uri` come from a document hosted by
 * whoever chose the `client_id`. Escaping is therefore not a nicety — an
 * unescaped `client_name` is stored XSS on the authorization server's own origin,
 * where the browser session cookie lives.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The built-in consent screen. Deliberately one self-contained document with
 * inline styles and no scripts: it renders on an authorization server that may
 * have no asset pipeline at all, and a page whose whole job is to be trusted
 * should not be loading anything from elsewhere.
 *
 * The two normative elements are the **redirect-URI hostname** (a MUST for a
 * CIMD-capable server) and the **loopback warning** (a SHOULD). They are the two
 * most prominent things on the page for that reason, not for decoration.
 */
export function renderDefaultConsentPage(ctx: ConsentRenderContext): string {
  const clientName = escapeHtml(ctx.client.client_name);
  const userLabel = escapeHtml(
    ctx.user.displayName || ctx.user.username || ctx.user.email || 'your account',
  );

  const scopeList = ctx.scopes.length
    ? `<ul class="scopes">${ctx.scopes
        .map((s) => `<li><code>${escapeHtml(s)}</code></li>`)
        .join('')}</ul>`
    : `<p class="muted">No additional scopes requested.</p>`;

  const loopbackWarning = ctx.isLoopbackRedirect
    ? `<div class="warn" role="alert">
         <strong>This client receives the authorization code on this computer.</strong>
         <p>
           <code>${escapeHtml(ctx.redirectUriHost)}</code> is a loopback address, so any
           program running locally could have opened that port and be impersonating
           <strong>${clientName}</strong>${
             ctx.isMetadataDocumentClient
               ? ', whose name and logo come from a document that anyone may reference'
               : ''
           }. Approve only if you just started this application yourself.
         </p>
       </div>`
    : '';

  const clientLink = ctx.client.client_uri
    ? `<dd class="mono">${escapeHtml(ctx.client.client_uri)}</dd>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Authorize ${clientName}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 2rem 1rem; background: #f4f5f7; color: #14161a;
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main {
    width: 100%; max-width: 30rem; background: #fff; border-radius: 14px;
    padding: 1.75rem; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.08);
  }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.25rem; color: #4a5058; }
  .host {
    margin: 0 0 1.25rem; padding: .85rem 1rem; border-radius: 10px;
    background: #eef2ff; border: 1px solid #c7d2fe;
  }
  .host .label { display: block; font-size: .75rem; letter-spacing: .04em;
    text-transform: uppercase; color: #4b5563; margin-bottom: .2rem; }
  .host .value { font: 600 1.15rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all; }
  .host .full { display: block; margin-top: .3rem; font-size: .8rem; color: #4a5058;
    word-break: break-all; }
  dl { margin: 0 0 1.25rem; font-size: .875rem; }
  dt { color: #6b7280; margin-top: .6rem; }
  dd { margin: .1rem 0 0; }
  .mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all; }
  .scopes { margin: .25rem 0 0; padding-left: 1.1rem; }
  .muted { color: #6b7280; }
  .warn { margin: 0 0 1.25rem; padding: .85rem 1rem; border-radius: 10px;
    background: #fff7ed; border: 1px solid #fdba74; font-size: .875rem; }
  .warn p { margin: .35rem 0 0; }
  form { display: flex; gap: .6rem; margin: 0; }
  button { flex: 1; padding: .7rem 1rem; font: inherit; font-weight: 600;
    border-radius: 9px; cursor: pointer; border: 1px solid transparent; }
  .approve { background: #1f2937; color: #fff; }
  .deny { background: #fff; color: #14161a; border-color: #d1d5db; }
  @media (prefers-color-scheme: dark) {
    body { background: #0e1013; color: #e8eaed; }
    main { background: #171a1f; box-shadow: none; border: 1px solid #262b33; }
    .lead, .muted, dt, .host .full { color: #9aa2ad; }
    .host { background: #1b2233; border-color: #2f3d5c; }
    .host .label { color: #9aa2ad; }
    .warn { background: #2a1f12; border-color: #7c4a13; }
    .approve { background: #e8eaed; color: #14161a; }
    .deny { background: transparent; color: #e8eaed; border-color: #3a4048; }
  }
</style>
</head>
<body>
<main>
  <h1>Authorize ${clientName}</h1>
  <p class="lead">
    <strong>${clientName}</strong> is asking for access to this MCP server
    as <strong>${userLabel}</strong>.
  </p>

  <div class="host">
    <span class="label">Authorization code will be sent to</span>
    <span class="value">${escapeHtml(ctx.redirectUriHost)}</span>
    <span class="full">${escapeHtml(ctx.redirectUri)}</span>
  </div>

  ${loopbackWarning}

  <dl>
    <dt>Client identifier</dt>
    <dd class="mono">${escapeHtml(ctx.clientId)}</dd>
    ${clientLink ? `<dt>Client website</dt>${clientLink}` : ''}
    <dt>Requested access</dt>
    <dd>${scopeList}</dd>
  </dl>

  <form method="post" action="${escapeHtml(ctx.formAction)}">
    <input type="hidden" name="consent_token" value="${escapeHtml(ctx.csrfToken)}">
    <button class="deny" type="submit" name="approve" value="false">Deny</button>
    <button class="approve" type="submit" name="approve" value="true">Approve</button>
  </form>
</main>
</body>
</html>`;
}
