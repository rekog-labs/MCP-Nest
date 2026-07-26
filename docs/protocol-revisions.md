# Protocol revisions and dual-era serving

MCP shipped a revision — **`2026-07-28`** — that removes the `initialize`
handshake and protocol sessions entirely. Every request now carries its own
`_meta` envelope (protocol version, client capabilities, optional client info)
and is served statelessly.

This is a clean break with no deprecation period: a 2025-era client talking to a
modern-only server fails outright, and vice versa. The spec's escape hatch is
**dual-era serving**, and that is what MCP-Nest does by default:

> A dual-era server **MAY** serve both eras concurrently on the same endpoint or
> process.
> — [`draft/basic/versioning`](https://modelcontextprotocol.io/specification/draft/basic/versioning)

So one `/mcp` endpoint answers an old client and a new client at the same time,
from the same `@Tool` methods.

## The two eras

| | **legacy** | **modern** |
| --- | --- | --- |
| Revisions | `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07` | `2026-07-28` |
| Opens with | `initialize` handshake | nothing — every request stands alone |
| Where capabilities live | negotiated once, on the connection | in each request's `_meta` envelope |
| Sessions | `Mcp-Session-Id` header, `GET`/`DELETE /mcp` | removed |
| Discovery | `initialize` result | `server/discover` |
| Progress / logging | over the session's SSE stream (session-aware transports only) | on the request's own response stream — always available |

"Era" is a **per-request** fact, not a server-wide one — the same process serves
both.

---

## What changes for tool authors

Nothing. `@Tool`, `@Resource`, `@ResourceTemplate`, and `@Prompt` are unchanged,
`@Payload()`/`@Ctx()`/`@McpRawRequest()` are unchanged, and guards, pipes,
interceptors, and filters still apply on both eras. This handler is served
identically to a 2025 client and a 2026 client:

```typescript
@McpController()
export class GreetingController {
  @Tool({
    name: 'greet',
    description: 'Greets someone',
    parameters: z.object({ name: z.string() }),
  })
  greet(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }
}
```

Everything around the handler is unchanged too:

- **Guards, pipes, interceptors, and filters** run the same way on both eras — a
  guard on the HTTP controller sets `req.user`, and it reaches the tool on a
  modern request exactly as it does on a legacy one.
- **`@McpRawRequest()` / `ctx.getRawRequest()`** still hand you the
  Express/Fastify request, so headers, cookies, and `req.user` are all there.
- **Both HTTP adapters** (Express and Fastify) serve both eras.
- **Named servers, dynamic registration, and `@PublicTool`/`@ToolScopes`/
  `@ToolRoles`** are unaffected.

The rest of this page is for the cases where you *do* want to know which era you
are on.

---

## How the routing works

`StreamableHttpTransport` classifies every `POST` with the SDK's own
`isLegacyRequest` predicate — the same code the SDK's serving entry runs — so the
transport's decision can never disagree with it:

```
POST /mcp
    │
    ├─ carries a per-request `_meta` envelope claim  ──►  modern leg (2026-07-28)
    │
    └─ claim-less (an `initialize`, a 2025 call, …)  ──►  legacy leg
                                                          (stateless, or
                                                           statefulMode sessions)
```

`GET` and `DELETE` are body-less session operations, so they are **legacy-only**
by construction — see [Custom Request Handling](custom-controllers.md). In
`statefulMode` they keep serving the standing SSE stream and session teardown; in
the default stateless mode they answer `405` with a JSON-RPC error body, which is
also what the modern spec requires.

Both legs are fed by the same capability set, so there is exactly one place your
tools are defined.

---

## Choosing which eras an endpoint serves

```typescript
// Dual-era — the default. Both revisions on one endpoint.
new StreamableHttpTransport();

// Modern only. 2025-era traffic is answered with the
// unsupported-protocol-version error naming the revisions this endpoint speaks.
new StreamableHttpTransport({ protocol: 'modern-only' });

// Legacy only. The pre-2026-07-28 behaviour, unchanged. Modern clients are rejected.
new StreamableHttpTransport({ protocol: 'legacy-only' });
```

On `modern-only`, a 2025-era `initialize` comes back as `400` /
`-32022`, with the revisions the endpoint does serve listed in
`error.data.supported`. Legacy clients cannot "fall forward" to a newer
revision, so that error is the only diagnostic an old client will surface —
prefer the default `dual` unless you have a reason not to.

On stdio the era is picked by the **opening exchange**: a `server/discover` probe
selects modern, an `initialize` selects legacy, and one server instance is pinned
for the connection's lifetime.

```typescript
new StdioTransport();                     // legacy: 'serve' — dual-era (default)
new StdioTransport({ legacy: 'reject' }); // modern openings only
```

---

## Response shaping on the modern era

`enableJsonResponse` is **legacy-only** (as is `sessionIdGenerator`, and sessions
in general). Its modern-era counterpart is `responseMode`:

```typescript
new StreamableHttpTransport({
  responseMode: 'auto', // the default
});
```

| `responseMode` | Behaviour |
| --- | --- |
| `'auto'` (default) | A single JSON body, upgraded to an SSE stream only if the handler emits something before its result (progress, logging). |
| `'sse'` | Always stream. |
| `'json'` | Never stream — mid-call progress/log notifications are dropped. |

---

## Progress and logging are no longer a session privilege

On the legacy era, `ctx.reportProgress()` and `ctx.log.*` need a session to push
over: in the per-request stateless mode they are no-ops that emit a local NestJS
warning.

On the modern era **every request is sessionless and both still work**. They are
emitted as messages *related to the request being served*, so they land on that
request's own response stream, which auto-upgrades from a JSON body to SSE on the
first one. No configuration needed:

```typescript
@Tool({ name: 'work', description: 'Reports progress then finishes', parameters: z.object({}) })
async work(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
  await ctx.reportProgress({ progress: 1, total: 2 });
  await ctx.reportProgress({ progress: 2, total: 2 });
  return { content: [{ type: 'text', text: 'done' }] };
}
```

### The `logLevel` opt-in (read this before filing a bug)

`logging/setLevel` is gone on the modern era. Instead the **client opts in per
request** via `io.modelcontextprotocol/logLevel` in the request's `_meta`. The
spec says the server *MUST NOT* emit `notifications/message` for a request that
did not include that field, and the SDK enforces it.

So `ctx.log.info(...)` inside a tool produces **no client-visible output** unless
the caller asked for it on that call. This is correct behaviour, not a dropped
message. A request that does opt in gets an SSE response carrying the log frames:

```bash
curl -N -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' \
  -H 'Mcp-Name: talk' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {
      "name": "talk", "arguments": {},
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/logLevel": "info"
      }
    }
  }'
```

Drop the `logLevel` line and the same call returns a plain JSON body with no
notification stream at all.

---

## Reading the era from a handler

`ctx.getSession()` gained an `era`, and `sessionId` is now legacy-only:

```typescript
ctx.getSession();
// { transport: 'streamable-http', stateless: true, era: 'modern', sessionId: undefined }
// { transport: 'streamable-http', stateless: false, era: 'legacy', sessionId: 'a1b2…' }
```

- **`era`** — `'legacy' | 'modern'`. Check this when you care about capability.
- **`sessionId`** — only ever set on the legacy era with a session-aware
  transport. Protocol sessions were removed in `2026-07-28`, so it is always
  `undefined` on modern.
- **`stateless`** — still means "no session backs this request", but it no longer
  implies "cannot talk back to the client" (see above). Every modern request is
  `stateless: true`.

### Per-request client identity

There is no `initialize` result to read the client's identity, capabilities, or
negotiated version from anymore — they ride every request instead. `McpContext`
exposes them directly:

```typescript
@Tool({ name: 'whoami', description: 'Echoes the caller', parameters: z.object({}) })
whoami(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        era: ctx.getSession().era,               // 'modern'
        protocolVersion: ctx.getProtocolVersion(), // '2026-07-28'
        client: ctx.getClientInfo()?.name,         // e.g. 'my-client' (SHOULD, not MUST)
        capabilities: ctx.getClientCapabilities(), // this request's declared capabilities
      }),
    }],
  };
}
```

All three return `undefined` on the **legacy** era — there they were negotiated
once on the connection, not carried per request. And `clientInfo` is
self-reported and unverified in either case: never make a security decision on
it.

> The spec demotes `clientInfo` to a SHOULD, so a modern request may legitimately
> omit it. `getClientCapabilities()` must also not be inferred from an earlier
> request — read it fresh each time, which is exactly what this accessor does.

---

## What breaks

### Elicitation and sampling on the modern era

The 2025 push-style server→client request model is gone in `2026-07-28`. Calls
that push a request *down* to the client throw before any wire traffic:

- `ctx.mcpServer.server.elicitInput(...)`
- `ctx.mcpServer.server.createMessage(...)` (sampling)
- `listRoots(...)`, `ping(...)`

The error is a typed `MethodNotSupportedByProtocolVersion` whose message steers
to the replacement, **Multi Round-Trip Requests**: the handler returns an
`input_required` result (built with the SDK's `inputRequired({ ... })` helper),
the client fulfils the embedded requests and retries the original call.

On a dual-era server these calls still work on the legacy leg, so a tool that
uses them keeps working for old clients and fails for new ones. If you have such
a tool — including anything reached through a
[`serverMutator`](server-mutation.md) — either gate it on
`ctx.getSession().era === 'legacy'`, or serve that endpoint with
`protocol: 'legacy-only'` until it is migrated.

### Deprecated, but still working

Roots, Sampling, and Logging are deprecated in `2026-07-28` with a ≥12-month
window. They remain functional; plan the migration, don't rush it.

---

## Testing each era

The modern era is exercised end to end in the repo's `tests/mcp-modern-era*.e2e.spec.ts`
and `tests/mcp-protocol-posture.e2e.spec.ts` suites, which drive the same servers
the legacy suites drive — the legacy suites passing unmodified is the
backward-compatibility proof.

**A modern client** pins the revision, so it never probes or falls back:

```typescript
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client(
  { name: 'my-client', version: '1.0.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')),
);
```

**A legacy client** is the plain constructor — the default negotiation mode is
`'legacy'`, i.e. the 2025 handshake path:

```typescript
const legacy = new Client({ name: 'old-client', version: '1.0.0' });
await legacy.connect(
  new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')),
);
```

**Auto-negotiation** (`mode: 'auto'`) probes with `server/discover` first and
falls back to `initialize`, which is the useful check on stdio: reaching the
modern era proves the probe was answered rather than fallen back on.

**On the wire**, a modern request is a plain POST carrying the envelope:

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

The `Mcp-Method` header is **required** and must agree with the body's `method`;
for `tools/call` an `Mcp-Name` header naming the tool is required too. A missing
or disagreeing header is a `400` / `-32020`, not a silent fallback. (Client SDKs
set these for you — this only bites hand-rolled requests.)

`server/discover` replaces `initialize` for discovery, and its result carries the
supported revisions plus cache hints:

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "server/discover",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

The result contains `supportedVersions`, `capabilities`, `resultType`, `ttlMs`,
`cacheScope`, and the server identity under
`_meta["io.modelcontextprotocol/serverInfo"]` — note that identity lives in
`_meta`, not in the result body.

Envelope problems come back as well-formed JSON-RPC errors, never an empty body
(an empty body would make a conforming client misclassify the server as legacy):

| Situation | HTTP | Code |
| --- | --- | --- |
| Missing/malformed `_meta` envelope | `400` | `-32602` |
| Unsupported protocol version | `400` | `-32022` |
| Headers and body disagree (protocol version, or a missing `Mcp-Method`/`Mcp-Name`) | `400` | `-32020` |

---

## Requirements

The modern era needs MCP SDK **`2.0.0-beta.5`** or newer — the first release
matching the final `2026-07-28` wire. `beta.4` ships the pre-final shape and is
interop-broken against conforming peers.

```bash
npm install @modelcontextprotocol/server@^2.0.0-beta.5 \
            @modelcontextprotocol/core@^2.0.0-beta.5 \
            @modelcontextprotocol/node@^2.0.0-beta.5
```

## Related

- [Server Examples](server-examples.md) — transport setups and the full option list.
- [Tools](tools.md) — `reportProgress` and `ctx.log` semantics per era.
- [Custom Request Handling](custom-controllers.md) — why `GET`/`DELETE` are legacy-only.
- [Migration to v2](migration-to-v2.md) — the strategy API itself.
- [Server Mutation](server-mutation.md) — the hook most affected by the
  elicitation/sampling break.
