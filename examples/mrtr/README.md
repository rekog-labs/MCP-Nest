# try-docs / mrtr

Greenfield project for [`docs/mrtr.md`](../../docs/mrtr.md) — **Multi Round-Trip
Requests** (MRTR), the `2026-07-28` replacement for push-style elicitation,
sampling and roots. One set of handlers serves both protocol eras.

What it exposes:

| Capability | Name | What it asks for |
| --- | --- | --- |
| tool | `deploy` | confirmation, then a reason — two rounds, state in a signed `requestState` |
| tool | `capital` | a sampling request answered by the client's model |
| tool | `list-roots` | the client's roots |
| resource | `mcp://vault` | a passphrase (`open sesame`) |
| prompt | `interview` | a topic |

## Run

```bash
npm install
npm start                  # http://localhost:3000/mcp
```

`MRTR_STATE_KEY` (≥ 32 chars) pins the HMAC key; unset, a random per-process key
is used and a restart invalidates in-flight rounds (you get
`Invalid or expired requestState`).

## Play with it in the MCP Inspector (recommended)

The Inspector (2.6.0, SDK 2.0 client) drives MRTR natively on both eras — this
is the real-client check.

```bash
bunx @modelcontextprotocol/inspector
```

1. **Add Servers → Add manually**: transport `streamable-http`, URL
   `http://localhost:3000/mcp`. Toggle it on. The card shows the negotiated
   revision — `MCP 2025-11-25` by default (legacy era).
2. **Tools → deploy**, set `env`, **Execute Tool**. An *Elicitation Request*
   dialog asks "Deploy to …?"; tick `confirm`, Submit. A second dialog asks for
   the reason. The result reads `deployed to … — reason: …`. Every dialog you
   saw was the server-side shim turning `inputRequired(...)` into a 2025-style
   push request — one handler, old client.
3. Now the `2026-07-28` leg: on the server card, **Settings → Protocol Era →
   Modern (2026-07-28, sessionless)**, close, toggle the connection off and on.
   The card shows `MCP 2026-07-28`. Run `deploy` again. The dialog now carries
   an `INPUT_REQUIRED` badge: "the server returned input_required; your answer
   is sent back as a retry of the original request (MRTR)". Same two questions,
   same final result — but this time the Inspector retried `tools/call` with
   `inputResponses` + the echoed `requestState`, and the server kept no state.

Try **Decline** on the reason: the deploy aborts. Try **Decline** on the
confirmation: the server asks again instead of failing.

`capital` needs a client that answers sampling and `list-roots` needs roots;
the Inspector serves both (Roots under the server Settings).

The CLI (`--cli`) cannot answer elicitation, so `tools/call deploy` from it
fails; use the UI or the scripted client below.

## Scripted client (prints the wire)

`src/client.ts` drives the same server from code and shows each round, which
is useful to *see* the JSON:

```bash
npm run client -- --era modern            # 2026-07-28, the SDK retries for you
npm run client -- --era modern --manual   # 2026-07-28, YOU do the retries; prints the wire
npm run client -- --era legacy            # 2025-era client; the server-side shim does the rounds
```

It reads answers interactively, or from stdin when piped
(`printf 'deploy\ny\nship it\n' | npm run client -- --era modern`).

## Raw wire (2026-07-28)

Round 1 — the server answers `input_required`:

```bash
URL=http://localhost:3000/mcp
META='{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1"},"io.modelcontextprotocol/clientCapabilities":{"elicitation":{}}}'

R1=$(curl -s $URL -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: deploy' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"deploy\",\"arguments\":{\"env\":\"prod\"},\"_meta\":$META}}")
echo "$R1" | jq .result
STATE=$(echo "$R1" | jq -r .result.requestState)
```

Round 2 — retry with `inputResponses` and the echoed `requestState` (new id):

```bash
curl -s $URL -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: deploy' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"deploy\",\"arguments\":{\"env\":\"prod\"},\"_meta\":$META,\"requestState\":\"$STATE\",\"inputResponses\":{\"confirm\":{\"action\":\"accept\",\"content\":{\"confirm\":true}}}}}" | jq .result
```

That answers with the *second* question (the reason) and a new state. Tamper with
`$STATE` (append a character) and the server answers `-32602 Invalid or expired
requestState` without running the tool. Drop `elicitation` from the capabilities
and it answers `-32021` — the SDK refuses to ask for what the client did not
declare.
