# Multi Round-Trip Requests (MRTR)

Protocol revision `2026-07-28` removed push-style server→client requests. A
server no longer sends `elicitation/create`, `sampling/createMessage` or
`roots/list` *down* to the client. Instead it answers the client's own request
with an **`input_required` result**, and the client **retries the same call**
with the answers attached. That pattern is Multi Round-Trip Requests
([spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)).

```
client                                  server
  │  tools/call (id 1)                    │
  │ ─────────────────────────────────────▶│  needs input
  │  input_required { inputRequests,      │
  │                   requestState }      │
  │ ◀─────────────────────────────────────│
  │  (asks the user / the model)          │
  │  tools/call (id 2) + inputResponses   │
  │             + requestState (echoed)   │
  │ ─────────────────────────────────────▶│  reads answers + state
  │  final result                         │
  │ ◀─────────────────────────────────────│
```

The two requests are independent. The server keeps **nothing** in memory
between them: whatever it needs to resume is sealed into `requestState`, which
the client echoes back byte-exact. No sticky sessions, no shared store.

mcp-nest wires the whole loop for `@Tool`, `@Resource`/`@ResourceTemplate` and
`@Prompt` handlers, on **both** protocol eras (see [Both eras](#both-eras-one-handler)).
Runnable project: [`examples/mrtr`](../examples/mrtr/).

## A write-once tool

```typescript
import { Ctx, Payload } from '@nestjs/microservices';
import {
  createRequestStateCodec,
  inputRequired,
  McpContext,
  McpController,
  Tool,
} from '@rekog/mcp-nest';
import { z } from 'zod';

type DeployState = { step: 'confirm'; env: string };

// HMAC codec for requestState — see "requestState is untrusted input" below.
export const stateCodec = createRequestStateCodec<DeployState>({
  key: process.env.MRTR_STATE_KEY!, // ≥ 32 bytes, shared by every instance
  ttlSeconds: 600,
});

const CONFIRM = z.object({ confirm: z.boolean() });

@McpController()
export class DeployTool {
  @Tool({
    name: 'deploy',
    description: 'Deploys after the user confirms',
    parameters: z.object({ env: z.string() }),
  })
  async deploy(@Payload() { env }: { env: string }, @Ctx() ctx: McpContext) {
    // Verified + decoded by the codec before this ran; undefined on round 1.
    const state = ctx.getRequestState<DeployState>();

    // The client's answer, validated against the schema; undefined when
    // missing, declined, cancelled, or invalid.
    const confirmed = ctx.getAcceptedContent('confirm', CONFIRM);
    if (!confirmed?.confirm) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `Deploy to ${env}?`,
            requestedSchema: CONFIRM,
          }),
        },
        requestState: await stateCodec.mint({ step: 'confirm', env }),
      });
    }

    return `deployed to ${state?.env ?? env}`;
  }
}
```

And the strategy:

```typescript
const mcp = new McpStrategy({
  name: 'my-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ statefulMode: true })],
  requestState: { verify: stateCodec.verify },
});
```

The handler is entered **once per round** and reads the same context fields
every time. What changes between rounds is which answers have arrived and what
state was echoed back. A handler that returns `input_required` again on a
re-entry simply causes another round — that is how you re-ask after a decline
(the spec says a server *should* ask again for missing input rather than fail).

## Building the request

`inputRequired(spec)` builds the result. It throws a `TypeError` unless at least
one of `inputRequests` or `requestState` is present (the spec requires one).
Each entry of `inputRequests` is keyed by an identifier **you** choose and is
built with one of:

| Builder | Wire method | Client capability required |
| --- | --- | --- |
| `inputRequired.elicit({ message, requestedSchema })` | `elicitation/create` (form) | `elicitation` |
| `inputRequired.elicitUrl({ message, url })` | `elicitation/create` (url) | `elicitation` |
| `inputRequired.createMessage({ messages, maxTokens, … })` | `sampling/createMessage` | `sampling` |
| `inputRequired.listRoots()` | `roots/list` | `roots` |

`requestedSchema` accepts the wire JSON shape or any Standard Schema (a Zod
object, for example). A form-mode elicitation is limited to flat objects of
primitives — a shape the wire format cannot express throws before anything is
sent.

You may put several entries in one result; the client answers them all before
retrying.

**Capability rule.** The SDK refuses (JSON-RPC `-32021`) any `inputRequests`
entry whose kind the client did not declare in its capabilities. You do not
have to check `ctx.getClientCapabilities()` yourself, but a tool that has a
fallback (e.g. proceed without confirmation) can read it to choose a path.

## Reading the answers

On re-entry `McpContext` exposes what the retry carried:

| Accessor | Returns |
| --- | --- |
| `getAcceptedContent(key)` | The `content` of an *accepted* form elicitation, or `undefined`. |
| `getAcceptedContent(key, schema)` | Same, but validated against a Standard Schema first — an invalid value also reads `undefined`. **Use this one.** |
| `getInputResponse(key)` | Discriminated view: `{ kind: 'missing' }`, `{ kind: 'elicit', action, content? }`, `{ kind: 'sampling', result }`, `{ kind: 'roots', roots }`. Use it to tell a decline from a missing answer, and for sampling/roots. |
| `getInputResponses()` | The raw map, keyed by your identifiers. `undefined` on a first round. |
| `getDroppedInputResponseKeys()` | Keys the SDK dropped because the entry was not a bare response object. Re-issue those requests. |
| `getRequestState<T>()` | The verified, decoded state (with a verify hook) or the raw wire string (without). `undefined` on a first round. |

The values in `inputResponses` come from the client and are **not** validated by
the SDK. Treat them as untrusted input: prefer `getAcceptedContent(key, schema)`.

Sampling and roots:

```typescript
const answer = ctx.getInputResponse('answer');
if (answer.kind !== 'sampling') {
  return inputRequired({
    inputRequests: {
      answer: inputRequired.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: 'Capital of France?' } }],
        maxTokens: 20,
      }),
    },
  });
}
const content = answer.result.content as { type: string; text?: string };
return `The model says: ${content.text}`;
```

## `requestState` is untrusted input

`requestState` goes out to the client and comes back. A malicious or buggy
client can change it. The spec:

- Servers **MUST** treat an inbound `requestState` as attacker-controlled.
- If it influences authorization, resource access or business logic, servers
  **MUST** integrity-protect it (HMAC or AEAD) and **MUST** reject state that
  fails verification.
- Servers **SHOULD** bind it to the authenticated principal, give it a short
  TTL, and tie it to the originating request, so it cannot be replayed by
  another user or on another call.

The SDK applies **no protection by default** — without a verify hook,
`getRequestState()` hands your handler the raw string as the client sent it.

The SDK ships an HMAC-SHA256 codec, re-exported by mcp-nest, and mcp-nest wires
its `verify` into the seam so every echoed state is checked **before** the
handler runs:

```typescript
const stateCodec = createRequestStateCodec<DeployState>({
  key: process.env.MRTR_STATE_KEY!,   // ≥ 32 bytes; shared across instances
  ttlSeconds: 600,                    // default 600
  // Optional: bind to the principal and method. A state minted for one user
  // (or one method) is rejected when echoed by another.
  bind: (sdkCtx) => `${sdkCtx.mcpReq.method}\0${sdkCtx.http?.authInfo?.clientId ?? ''}`,
});

new McpStrategy({ ..., requestState: { verify: stateCodec.verify } });
```

- `mint(payload)` seals the payload. With `bind` set, `mint` needs the SDK
  context as its second argument — mcp-nest does not expose that object on
  `McpContext` today, so bind-style codecs need a `serverMutator`-level setup;
  the unbound codec (TTL + HMAC) is the supported path from a handler.
- A tampered, expired or mis-bound state is answered with JSON-RPC `-32602`,
  message frozen to `Invalid or expired requestState`, `data.reason:
  'invalid_request_state'`. The reason (`mac`, `expired`, `bind`, `malformed`)
  reaches your server's `onerror` only, never the wire.
- The codec is **signed, not encrypted**: the client can base64-decode and read
  the payload. Do not put secrets in it.
- The hook runs on both eras, including the legacy shim's in-process rounds.

If you bring your own verifier, resolve with the decoded payload (that is what
`getRequestState()` then returns) or with `undefined` to keep the raw string.

**Single use is on you.** TTL + binding bound the replay window; they do not
make a state single-use. A one-time action (a redemption, a payment) must be
deduplicated server-side.

## Resources and prompts

`resources/read` and `prompts/get` may answer `input_required` too; everything
else (`tools/list`, `initialize`, …) must not — and cannot from mcp-nest, since
only the three handler kinds run through the seam.

```typescript
@Resource({ uri: 'mcp://vault', name: 'vault', mimeType: 'text/plain' })
async vault(@Payload() _a: unknown, @Ctx() ctx: McpContext) {
  const unlock = ctx.getAcceptedContent('unlock', z.object({ passphrase: z.string() }));
  if (!unlock) {
    return inputRequired({
      inputRequests: {
        unlock: inputRequired.elicit({
          message: 'Passphrase?',
          requestedSchema: { type: 'object', properties: { passphrase: { type: 'string' } }, required: ['passphrase'] },
        }),
      },
    });
  }
  return { contents: [{ uri: 'mcp://vault', mimeType: 'text/plain', text: '…' }] };
}
```

## Both eras, one handler

| Era | What happens on an `input_required` return |
| --- | --- |
| `2026-07-28` | Sent to the client as-is. The client fulfils the requests and retries. The SDK client does this automatically through the same `setRequestHandler('elicitation/create', …)` handlers a 2025 client registers. |
| 2025-era, **stateful** session | The SDK's **legacy shim** turns each embedded request into a real server→client request over the session, collects the answers, and re-enters your handler with `inputResponses`/`requestState` populated. The old client sees ordinary elicitation. |
| 2025-era, **stateless** (`statefulMode: false`) | There is no connection to push over. The call fails with a clear error (`Cannot request input 'x' …`), as `isError` for tools and a JSON-RPC error for resources/prompts. |

So one `inputRequired(...)` handler replaces the legacy
`ctx.mcpServer.server.elicitInput(...)` call and works for every client. The
shim is tuned on the strategy:

```typescript
new McpStrategy({
  ...,
  inputRequired: {
    maxRounds: 8,          // re-entries per originating request before giving up
    roundTimeoutMs: 600_000, // per server→client leg, human-paced
    legacyShim: true,      // false: input_required on a 2025 request fails loudly
  },
});
```

When the shim hits `maxRounds` a tool call returns `isError: true` with
`…still required input after N rounds (inputRequired.maxRounds)`; resources and
prompts get a JSON-RPC error.

## What the SDK enforces for you

| Situation | Answer on the wire |
| --- | --- |
| `inputRequests` asks for a capability the client did not declare | `-32021`, `Cannot request input '<key>' (<method>): …` |
| `input_required` with neither `inputRequests` nor `requestState` (hand-built) | `-32603` |
| `requestState` fails the verify hook | `-32602`, `Invalid or expired requestState` |
| An `inputResponses` entry is not a bare response object | dropped; key surfaced via `getDroppedInputResponseKeys()` |
| A tool declares `outputSchema` and returns `input_required` | passed through unvalidated — it is not the final result |

## Driving it from a client

**MCP Inspector** (≥ 2.6, built on the SDK 2.0 client) drives MRTR on both
eras: add the server, call the tool, and answer the elicitation dialogs. Its
per-server *Settings → Protocol Era* switches between the legacy handshake
(default) and `Modern (2026-07-28, sessionless)`; on the modern era the dialog
carries an `INPUT_REQUIRED` badge and the answer is sent as a retry. The
Inspector CLI cannot answer elicitation. `examples/mrtr/README.md` has the
click-by-click steps.

**The SDK client** (`@modelcontextprotocol/client` ≥ 2.0) auto-fulfils by default:

```typescript
const client = new Client(
  { name: 'c', version: '1' },
  { capabilities: { elicitation: {} }, versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
client.setRequestHandler('elicitation/create', () => ({ action: 'accept', content: { confirm: true } }));
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const result = await client.callTool({ name: 'deploy', arguments: { env: 'prod' } }); // rounds happen inside
```

For the raw wire, set `inputRequired: { autoFulfill: false }` and call
`client.request(..., { allowInputRequired: true })` in a loop — echo
`requestState` unchanged and use a fresh id on every retry.
[`examples/mrtr/src/client.ts`](../examples/mrtr/src/client.ts) does both,
interactively.

## Migrating from `elicitInput`

| Before (2025 push style) | After (MRTR) |
| --- | --- |
| `await ctx.mcpServer.server.elicitInput({ message, requestedSchema })` | `return inputRequired({ inputRequests: { key: inputRequired.elicit({ message, requestedSchema }) }, requestState })` |
| `response.action === 'accept' ? response.content : …` | `ctx.getAcceptedContent('key', schema)` / `ctx.getInputResponse('key')` on re-entry |
| `await ctx.mcpServer.server.createMessage(...)` | `inputRequired.createMessage(...)` + `getInputResponse('key').result` |
| local variables across the `await` | `requestState` (signed) |
| `ctx.mcpServer.server.getClientCapabilities()` | not needed — the SDK enforces the capability rule; `ctx.getClientCapabilities()` if you want a fallback path |

The old calls still work for 2025-era clients and throw on `2026-07-28`
requests; the MRTR form works for both.
