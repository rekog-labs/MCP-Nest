#!/usr/bin/env bash
#
# get-token.sh — mint a Casdoor access token (RS256 JWT) via the OAuth 2.1
# `client_credentials` grant, for the non-interactive resource-server demo.
#
# It prints ONLY the access token to stdout, so it can be captured with $(...):
#
#   ACCESS_TOKEN=$(./scripts/get-token.sh)
#
# All diagnostics go to stderr. Exits non-zero (and dumps the raw response to
# stderr) if Casdoor doesn't return a token.
#
# Defaults match casdoor/init_data.json (app-built-in). Override via env if you
# changed the seed: CASDOOR_URL, CLIENT_ID, CLIENT_SECRET.
#
# NOTE: these are throwaway dev credentials baked into the example seed.
# Do NOT use these values anywhere real.
set -euo pipefail

CASDOOR_URL="${CASDOOR_URL:-http://localhost:8000}"
CLIENT_ID="${CLIENT_ID:-mcp-example-client}"
CLIENT_SECRET="${CLIENT_SECRET:-mcp-example-secret-dev-only}"

TOKEN_ENDPOINT="${CASDOOR_URL%/}/api/login/oauth/access_token"

echo "Requesting client_credentials token from ${TOKEN_ENDPOINT} ..." >&2

response="$(curl -sS -X POST "${TOKEN_ENDPOINT}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}")"

# Casdoor pretty-prints JSON (e.g. `"access_token": "..."` with a space), so a
# naive sed/grep regex is brittle. Parse it properly with node instead.
access_token="$(printf '%s' "$response" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s);
      if (j.access_token) {
        process.stdout.write(j.access_token);
      } else {
        process.exit(1);
      }
    } catch (e) {
      process.exit(1);
    }
  });
')" || {
  echo "Failed to obtain an access token. Casdoor responded:" >&2
  echo "$response" >&2
  exit 1
}

printf '%s\n' "$access_token"
