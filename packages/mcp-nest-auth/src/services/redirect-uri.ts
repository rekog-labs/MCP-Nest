/**
 * Hosts that name the user's own machine. Only these get the loopback port
 * exception below; every other host is matched byte for byte.
 *
 * OAuth 2.1 §8.4.2 (from RFC 8252 §7.3) names the IP literals. `localhost` is
 * included although that section calls it NOT RECOMMENDED, because the MCP
 * authorization spec allows it ("MUST be either `localhost` or use HTTPS") and
 * real clients use it — Claude Code's Client ID Metadata Document declares
 * `http://localhost/callback`.
 *
 * Deliberately narrower than the consent screen's loopback set: `0.0.0.0` is
 * "every interface", not loopback, so it gets no port leniency.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Parse `uri` and return it with the port removed, if it is a loopback URI.
 * `null` for anything unparseable or non-loopback.
 *
 * WHATWG `URL` lowercases the host and writes IPv6 hosts bracketed, so
 * `hostname` can be looked up as-is.
 */
function loopbackWithoutPort(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  url.port = '';
  return url.href;
}

/**
 * Does `candidate` match one of the client's registered redirect URIs?
 *
 * Exact string match, with the one exception OAuth 2.1 §2.3.1 makes: for a
 * loopback redirect "an exact match is required except for the port URI
 * component" — and §8.4.2: "The authorization server MUST allow any port to be
 * specified at the time of the request for loopback IP redirect URIs, to
 * accommodate clients that obtain an available ephemeral port from the
 * operating system at the time of the request."
 *
 * The exception is deliberately narrow. Both URIs must point at a loopback
 * host, and after the port is dropped they must be the same URL: scheme,
 * userinfo, host, path, query and fragment all identical. `localhost` does not
 * match `127.0.0.1`; a client that wants both declares both. Nothing else
 * (prefix, wildcard, trailing slash, path case, non-canonical spellings such as
 * an explicit default port) is tolerated, because for a
 * non-loopback host this comparison is the whole open-redirect defence.
 *
 * This matters most for Client ID Metadata Document clients: their document is
 * static, so it cannot list the ephemeral port the client will bind. A Dynamic
 * Client Registration client registers the port it has at registration time,
 * and the spec lets it come back on another one.
 *
 * The token endpoint does not use this: there the `redirect_uri` (when a client
 * sends one) must equal the one the code was issued for, byte for byte.
 */
export function matchesRegisteredRedirectUri(
  registered: readonly string[] | undefined,
  candidate: string | undefined,
): boolean {
  if (!candidate || !registered?.length) return false;
  if (registered.includes(candidate)) return true;

  // The candidate must already be in canonical form, so the string that was
  // checked is the string the browser is sent to. Otherwise `URL` would quietly
  // fold `/a/../callback`, `LOCALHOST` or `127.1` into a match.
  if (!isCanonical(candidate)) return false;
  const requested = loopbackWithoutPort(candidate);
  if (requested === null) return false;
  return registered.some((entry) => loopbackWithoutPort(entry) === requested);
}

function isCanonical(uri: string): boolean {
  try {
    return new URL(uri).href === uri;
  } catch {
    return false;
  }
}
