import { Controller, Get, Header, Query } from '@nestjs/common';

/**
 * The *client* side of the Client ID Metadata Documents demo, hosted by this
 * example so the whole walkthrough runs on one machine with no network.
 *
 * Two routes, both registered only when `MCP_CIMD=1` (see `main.ts`):
 *
 * - `GET /client-metadata.json` — the metadata document itself. Its URL *is* the
 *   `client_id`; the document's own `client_id` field must string-match that URL
 *   exactly, which is the entire binding between "the URL the authorization
 *   server fetched" and "the client identity it is about to grant".
 * - `GET /demo-callback` — stands in for the MCP client's loopback redirect
 *   endpoint, so the authorization code is visible in a browser instead of
 *   landing on a refused connection.
 *
 * In a real deployment this document lives on the **client's** own HTTPS origin,
 * and nothing about it is the authorization server's business beyond fetching it.
 */
// Same derivation as `main.ts`, so the document's `client_id` matches the URL
// this example actually serves it from.
const PORT = Number(process.env.PORT ?? 3014);
const SERVER_URL = `http://localhost:${PORT}`;

@Controller()
export class DemoClientController {

  @Get('client-metadata.json')
  @Header('content-type', 'application/json')
  @Header('cache-control', 'public, max-age=300')
  clientMetadata() {
    return {
      // MUST match the URL this document is served from, byte for byte.
      client_id: `${SERVER_URL}/client-metadata.json`,
      client_name: 'CIMD Demo Client',
      client_uri: SERVER_URL,
      // Both loopback, which is the common MCP client case — and precisely the
      // case the spec wants the consent screen to warn about, because any local
      // process could have bound the port.
      redirect_uris: [
        `${SERVER_URL}/demo-callback`,
        'http://127.0.0.1:33418/callback',
      ],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // A CIMD client is a public client: no secret can be shared with an
      // identity that is just a URL. `client_secret*` and the
      // `client_secret_*` auth methods are forbidden in this document.
      token_endpoint_auth_method: 'none',
    };
  }

  @Get('demo-callback')
  @Header('content-type', 'text/html; charset=utf-8')
  demoCallback(@Query() query: Record<string, string>) {
    const rows = Object.entries(query)
      .map(
        ([key, value]) =>
          `<tr><th align="left">${escapeHtml(key)}</th><td><code>${escapeHtml(
            String(value),
          )}</code></td></tr>`,
      )
      .join('');

    return `<!doctype html><html><head><meta charset="utf-8">
<title>Demo client callback</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:44rem;padding:0 1rem}
code{word-break:break-all}table{border-collapse:collapse}th,td{padding:.35rem .75rem;border-bottom:1px solid #ddd}</style>
</head><body>
<h1>Authorization response received</h1>
<p>This page is standing in for the MCP client's loopback redirect endpoint.
A real client would now POST <code>code</code> to <code>/auth/token</code>
together with its PKCE <code>code_verifier</code>.</p>
<table>${rows}</table>
</body></html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
