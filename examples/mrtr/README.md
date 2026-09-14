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

## Play with it

The interactive client in `src/client.ts` shows each round as it happens and
asks you to type the answers:

```bash
npm run client -- --era modern            # 2026-07-28, the SDK retries for you
npm run client -- --era modern --manual   # 2026-07-28, YOU do the retries; prints the wire
npm run client -- --era legacy            # 2025-era client; the server-side shim does the rounds
```

Try: confirm with `y`, then give a reason. Then run it again and press Enter on
the confirmation — the server asks again instead of failing (the spec's
"re-request, don't error"). Press Enter on the reason and it aborts.

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

## MCP Inspector

`bunx @modelcontextprotocol/inspector --cli … --method tools/list` works as
usual. The Inspector CLI cannot answer elicitation, so `tools/call deploy` from
it ends in an error after `inputRequired.maxRounds` (legacy) — use the client
above or the Inspector UI.
