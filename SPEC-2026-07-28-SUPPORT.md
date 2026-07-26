# Supporting MCP protocol revision `2026-07-28` in MCP-Nest

Working checklist for making `@rekog/mcp-nest` a **dual-era** MCP server: serving both the
2025-era protocol (`initialize` handshake, sessions) and the new stateless `2026-07-28`
revision, concurrently, on one endpoint.

Status legend: `[ ]` todo · `[x]` done · `[~]` in progress · `[?]` open question

---

## 0. Why this is needed

The new revision removes the `initialize` handshake and protocol sessions entirely. It is a
**clean break with no deprecation period** — a legacy client talking to a modern-only server
fails outright, and vice versa. The spec's escape hatch is dual-era serving:

> "A server that wishes to support both **legacy** clients (which expect an `initialize`
> handshake) and **modern** clients (which use per-request metadata) **MAY** implement both
> behaviors. […] A dual-era server **MAY** serve both eras concurrently on the same endpoint
> or process."
> — [`draft/basic/versioning`](https://modelcontextprotocol.io/specification/draft/basic/versioning)

A dual-era server picks its behavior from how the client opens: a request carrying modern
per-request `_meta` is served statelessly; an `initialize` request selects legacy semantics.

### The blocker (verified, not assumed)

The MCP SDK v2 already implements `2026-07-28` — but the modern era is **instance state that
only a "serving entry" can set**. `createMcpHandler()` (HTTP) and `serveStdio()` (stdio) mark an
instance modern at construction; a 2025 `initialize` handshake pins it legacy. MCP-Nest
hand-wires `new NodeStreamableHTTPServerTransport(...)` / `new StdioServerTransport()` +
`server.connect(...)`, which is exactly the path that can never reach modern.

Reproduced against a real MCP-Nest app before any changes:

```
POST /mcp  {_meta: {"io.modelcontextprotocol/protocolVersion": "2026-07-28", …}}
→ 400  "Unsupported protocol version: 2026-07-28
        (supported: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)"
```

So this is a re-plumbing job, not a dependency bump.

---

## 1. Baseline contract — must not regress

These are the numbers to hold. Any drop is a backward-compatibility break.

| Suite | Command | Baseline |
|---|---|---|
| Unit + integration | `npm test` | **357 pass / 0 fail**, 42 files |
| Old-client e2e (`@modelcontextprotocol/sdk@1.10.0`) | `npm run e2e:local` | **168 pass / 0 fail**, 15 files |

- [x] Baseline captured on `main` @ beta.4
- [x] Baseline re-verified after the beta.5 bump — **unchanged, zero code edits**
- [x] **Held through the entire implementation.** Final state: `npm test` **637 pass**
      (246 legacy + 246 modern parameterised, §6.2) and `npm run e2e:local` **309 pass**
      (141 legacy + 141 modern + 27 legacy-only OAuth). The 168 original legacy e2e
      assertions still pass untouched — that is the backward-compatibility proof.
- [x] Exactly **one** pre-existing spec *assertion* was edited, deliberately and
      called out: `tool-schema.spec.ts` asserted the draft-7 dialect, which the
      spec no longer defaults to (see §5, JSON Schema dialect).
- [x] The `tests/` and `e2e/` specs were later parameterised over both eras (§6.1, §6.2).
      That edits the files but not what they assert on the legacy leg — with the two
      documented exceptions in §6.2, where the eras genuinely behave differently and each
      is now asserted separately instead of being loosened to a predicate both satisfy.

> ⚠️ **`e2e:local` was not testing the local build.** Every `examples/*/package-lock.json`
> recorded a *registry* resolution for `@rekog/mcp-nest`, and npm honours that over the
> `file:` spec `examples:local` writes — so the suite drove the published `2.0.0-alpha.6`
> while reporting green. Compounding it, `reconcileInstall` detected local mode by
> `lstat`-ing for a symlink, but npm 9 defaults `install-links=true`, which *copies* a
> `file:` dep. Fixed in `e2e/harness.ts` (drop the lockfile, install with
> `--install-links=false`) and in `scripts/use-examples.sh` (drop the lockfile on retarget).
> The numbers above are from after the fix. Re-verified: examples now resolve as
> `SYMLINK -> ../../../../packages/mcp-nest`.

The `e2e/` suite drives examples with a deliberately old pinned client and is the real proof
that 2025-era clients keep working. It now runs on **both sides of a release** — as a
pre-publish gate and again against the published artifact — but still not on push/PR
(see §8).

---

## 2. SDK upgrade — `2.0.0-beta.4` → `2.0.0-beta.5` ✅

beta.4 ships the **pre-#3002** wire and is interop-broken against conforming peers.
beta.5 matches the final revision.

- [x] Bump `@modelcontextprotocol/{core,client,server,node}` in root `package.json` devDeps
- [x] Bump `@modelcontextprotocol/{core,node,server}` peerDeps in `packages/mcp-nest/package.json`
- [x] `bun update` + lockfile
- [x] `npm test` → 357 pass · `npm run e2e:local` → 168 pass
- [x] Bump the same ranges in `examples/*/package.json` (perf-benchmark, server-mutation,
      server-examples, custom-controllers, external-authorization-server-casdoor)
- [ ] Decide the published peer range: `^2.0.0-beta.5` only matches `2.0.0-beta.x` — a move to
      `2.0.0-rc`/`2.0.0` needs an explicit range edit, not just an install

What changed in beta.5 (spec PR #3002, the final revision):
- `serverInfo` moves **out of** the `DiscoverResult` body **into** result `_meta` under
  `io.modelcontextprotocol/serverInfo` (new export `SERVER_INFO_META_KEY`); servers stamp it on
  every 2026-era response.
- Per-request envelope `clientInfo` demotes **REQUIRED → SHOULD** (optional).
- Breaking types: `DiscoverResult` no longer declares `serverInfo`;
  `RequestMetaEnvelope.clientInfo` optional.

Verified empirically post-upgrade — a modern request omitting `clientInfo` now succeeds and the
response carries `_meta: {"io.modelcontextprotocol/serverInfo": {...}}`. On beta.4 the same
request was rejected `-32602`.

---

## 3. Architecture

```
                    POST /mcp
                        │
              ┌─────────┴──────────┐
              │  isLegacyRequest() │   ← the SDK's own classifier, so our routing
              └─────────┬──────────┘      can never disagree with the entry
                 legacy │ modern
        ┌───────────────┘        └────────────────┐
        ▼                                          ▼
  existing wiring                        createMcpHandler(factory, {legacy:'reject'})
  (stateless OR sessionful               • server/discover
   statefulMode, unchanged)              • subscriptions/listen
        │                                • per-request _meta envelope
        │                                • MRTR, resultType, ttlMs/cacheScope
        └──────────────┬─────────────────────────┘
                       ▼
             one McpServerFactory
        (same @Tool/@Resource/@Prompt set)
```

GET and DELETE are inherently legacy operations (body-less, session-scoped) and
`isLegacyRequest` classifies them as such — so **only POST needs era routing**. GET/DELETE
handlers stay exactly as they are: 405 in stateless mode (which is also what the modern spec
requires), session handling in `statefulMode`.

Key decision: we keep our **own** legacy leg rather than using `createMcpHandler`'s built-in
`legacy: 'stateless'` fallback, because that fallback constructs its transport with only
`sessionIdGenerator: undefined` — it ignores `enableJsonResponse` (flipping today's stateless
JSON replies to SSE) and cannot do sessions at all (killing `statefulMode`). Routing with
`isLegacyRequest` in front of `legacy: 'reject'` is the SDK's documented pattern for exactly
this.

### Per-request context — solved

`McpRequestContext` gives the factory `era`, `authInfo`, and a **web** `Request` — but not the
Express/Fastify `req`, which is what NestJS guards decorate with `req.user` and what
`@RawRequest()` hands to users. Two mechanisms verified working:

- **WeakMap keyed on the web `Request`** — `ctx.requestInfo` is object-identical to the
  `Request` passed to `handler.fetch()`. Deterministic, no async-context assumptions. **Chosen.**
- AsyncLocalStorage around the handler call — also works; fallback.

`toNodeHandler` accepts any structural `{fetch}` ("keeps the adapter usable with hand-wired
compositions that route over `isLegacyRequest`"), so we wrap our router in it and inherit its
battle-tested Node response writing, including SSE backpressure.

### Not adopting

`@modelcontextprotocol/express` and `@modelcontextprotocol/fastify` (new in the v2 line) export
`createMcpExpressApp` / `createMcpFastifyApp` plus security middleware — they **build an app**.
MCP-Nest embeds into the user's existing NestJS app, so they are the wrong shape. Our
`HttpAdapterFactory` stays. `@modelcontextprotocol/server-legacy` is the frozen 2024 HTTP+SSE
transport — irrelevant to us.

---

## 4. Core implementation

### 4.1 `McpStrategy` — factory model ✅
- [x] Add a factory-shaped entry (`createBoundServer(session, rawRequest)`) collapsing
      `createServer()` + `bindRequestHandlers()`, so it can be handed to `createMcpHandler` /
      `serveStdio` directly
- [x] Keep `createServer` / `bindRequestHandlers` on `McpTransportContext` — both are **public
      API** (`McpTransportContext` is exported). Purely additive.
- [x] Capture the SDK handler context (2nd arg of `setRequestHandler`) and thread it into
      `buildContext` at the three sites that build an `McpContext`
- [x] `buildContext`: no longer reads `server.server.transport.sessionId` on the modern era
- [x] Declare the `logging` server capability by default (spec requires it of servers that
      emit log notifications); opt out with `capabilities: { logging: undefined }`

### 4.2 `StreamableHttpTransport` — dual-era POST ✅
- [x] Build the modern handler once in `start()`; tear down in `close()` — **before** the
      legacy sessions, so long-lived `subscriptions/listen` streams can't stall shutdown
- [x] Route POST via `isLegacyRequest`. Only POST needed era routing: GET/DELETE are
      body-less legacy session ops and classify legacy by construction, so they were left
      untouched
- [x] WeakMap on `ctx.requestInfo` (+ AsyncLocalStorage fallback) recovers the Node request
- [x] New option `responseMode?: 'auto' | 'sse' | 'json'`
- [x] New option `protocol?: 'dual' | 'modern-only' | 'legacy-only'` (default `'dual'`)
- [x] `endpoint`, `mount`, `httpHandlers`, BYO-controller semantics unchanged
- [x] Both HTTP adapters still work (`mcp-fastify-adapter.e2e.spec.ts` passes unmodified)

### 4.3 `StdioTransport` ✅
- [x] `serveStdio(factory, { legacy })` instead of `connect(new StdioServerTransport())`
- [x] New option `legacy?: 'serve' | 'reject'` (default `'serve'`)
- [x] Bootstrap keep-alive interval kept
- [x] The `server/discover` probe calls the factory a second time and discards the probe
      instance; our factory is side-effect free, so this is safe. Verified by a test that
      connects with `mode: 'auto'` and lands on the modern era.

### 4.4 `McpContext` — era-aware ✅
- [x] `reportProgress` → `ctx.mcpReq.notify(...)` on the modern era
- [x] `log` → `ctx.mcpReq.log(level, data)` on the modern era
- [x] Retired the `stateless ⇒ no progress/logging` rule for modern requests
- [x] `McpSessionInfo`: `sessionId` legacy-only; new `era: 'legacy' | 'modern'`; `stateless`
      kept with corrected semantics and a doc comment
- [x] New accessors `getProtocolVersion()` / `getClientCapabilities()` / `getClientInfo()`
- [x] **The legacy era keeps its original code path byte-for-byte** — this is deliberate.
      Unifying both eras onto the per-request seam is possible but was not worth the
      regression risk; revisit later if desired.

---

## 5. Spec-compliance gaps found during research

Independent of the era work — these are places we don't currently meet the spec.

- [ ] **`Origin` validation.** "Servers **MUST** validate the `Origin` header on all incoming
      connections… **MUST** respond with HTTP 403 Forbidden." We do not. The SDK entry is
      deliberately validation-free and expects the host to do it. Decide: enforce by default
      (breaking-ish) or opt-in option, defaulting on for localhost binds.
- [x] **Resource-not-found error code.** Was `MethodNotFound` (`-32601`) for an unknown
      resource URI; now `InvalidParams` (`-32602`) per the spec's MUST.
- [x] **Never return an empty error body.** A conforming client that gets a `400` with an empty
      or unrecognized body concludes the server is legacy and falls back to `initialize`. All
      our 400/404/405 paths must carry a well-formed JSON-RPC error. (Current handlers do —
      keep it that way, and add a test.)
- [x] **`listChanged` is advertised but never emitted.** Now wired: `registerTool`/
      `removeTool`/`registerResource`/`removeResource`/`registerPrompt`/`removePrompt` publish
      through a new optional `McpTransport.notifyListChanged(kind)`, which the HTTP transport
      forwards to the SDK's `notify` facade. `subscriptions/listen` itself is served by the SDK
      entry with no work from us — ack-first, `subscriptionId`-tagged, opt-in filtered. All
      three behaviours are covered by tests.
- [x] **JSON Schema dialect: draft-07 → 2020-12.** `tool-schema.ts` advertised tool schemas as
      draft-07 (inherited from the v1 SDK's `toJsonSchemaCompat` defaults). 2020-12 is the
      spec's **default and RECOMMENDED** dialect, and SDK v2 clients enforce it: their default validator compiles
      `outputSchema` as 2020-12 and **rejects any other declared `$schema`**, client-side,
      before the request is sent. So *every* mcp-nest tool with an `outputSchema` was
      uncallable by a conforming modern client — Zod and ArkType alike. Legacy clients never
      validated, which is why this went unseen. Found by the new dual-era e2e tier on its
      first run. For ordinary object schemas the only difference is the `$schema` URI.
      ⚠️ This required editing one existing spec assertion (`tool-schema.spec.ts`), the only
      such edit in this workstream.
- [ ] **`subscriptions/listen` in multi-process deployments** still needs a user-suppliable
      `ServerEventBus` (the default is in-process only). Surface it as a transport option.
- [x] `mcp-nest-auth`: the default `mcpVersionsSupported` is now
      `['2026-07-28', '2025-06-18']`, matching the default dual-era transport posture. Users
      who pin an endpoint with `protocol: 'legacy-only'` / `'modern-only'` narrow it via
      `protectedResourceMetadata`.
      ✅ **No test edit was needed** — the earlier warning here was wrong.
      `tests/mcp-multi-auth.e2e.spec.ts:107,123` *passes* `['2025-06-18']` in as an explicit
      user override and never asserts on it (its only assertions are on `scopes_supported`),
      and `e2e/built-in-authorization-server.test.ts:151` asserts
      `toContain('2025-06-18')`, which the widened default still satisfies. "Tests pass
      unchanged" holds — 637 unit + 309 e2e, no assertion touched. One assertion was
      *added* alongside it (`toContain('2026-07-28')`) to lock in the new default.

Deliberately **not** doing now (deprecated ≥12 months, or out of scope):
- MRTR migration for elicitation/sampling (`ctx.elicitInput` / `requestSampling` throw on the
  modern era). Core doesn't expose them; only `serverMutator` users are affected → document.
- Roots / Sampling / Logging deprecations — still normative for at least a year.
- Tasks extension (`io.modelcontextprotocol/tasks`).

---

## 6. Testing ✅

The whole point: **existing tests prove backward compatibility by passing unmodified.**

> **Amended by §6.2.** That claim was true for the whole implementation phase and is what
> established backward compatibility. The specs have since been *parameterised* over both
> eras (§6.2). No assertion was weakened to make that work: the legacy leg asserts exactly
> what it asserted before, and the two places where the eras genuinely differ are asserted
> per era rather than loosened to something both satisfy.

- [x] `npm test` → 357 original pass, **no edits to existing specs**; 379 total
      *(at the time; now 637 — see §6.2)*
- [x] `npm run e2e:local` → still 168 pass, **no edits** *(now 309 — see §6.1)*
- [x] New modern-era suites, all new files:
      `tests/mcp-modern-era.e2e.spec.ts` (20 tests),
      `tests/mcp-modern-era-stdio.e2e.spec.ts` (2 tests),
      `tests/mcp-protocol-posture.e2e.spec.ts` (4 tests),
      `tests/mcp-modern-era-auth.e2e.spec.ts` (3 tests) and
      `tests/mcp-modern-era-fastify.e2e.spec.ts` (3 tests) — 33 new tests, 390 total
  - [x] `server/discover` — shape, `supportedVersions`, capabilities, `_meta.serverInfo`,
        `ttlMs`/`cacheScope`
  - [x] envelope handling: missing `_meta` → `-32602`/400; unsupported version → `-32022`/400;
        header/body mismatch → `-32020`/400; absent `clientInfo` accepted
  - [x] tools / resources / resource templates / prompts round-trip on the modern era
  - [x] progress on a sessionless request (SSE upgrade)
  - [x] logging gated by `io.modelcontextprotocol/logLevel` (absent ⇒ no `notifications/message`)
  - [x] `subscriptions/listen`: ack first, `subscriptionId` tagging, opt-in filtering,
        graceful close
  - [x] GET/DELETE → 405 with a JSON-RPC body
  - [x] guards and `req.user` reach tools on the modern era — the load-bearing test for the
        per-request context bridge (`tests/mcp-modern-era-auth.e2e.spec.ts`), including one
        guard covering both eras on the same endpoint
  - [x] Fastify adapter parity on the modern era, incl. SSE progress
        (`tests/mcp-modern-era-fastify.e2e.spec.ts`)
  - [x] **dual-era concurrency**: an old client and a modern client against the *same* endpoint
        in the same process
  - [x] `protocol: 'modern-only'` rejects `initialize` with `-32022` naming its revisions;
        `protocol: 'legacy-only'` serves 2025 and refuses modern
- [x] stdio: modern-era `server/discover` probe + legacy `initialize` fallback
- [ ] Cover the currently-untested legacy paths we're touching: 405/404/400 on GET/DELETE,
      `Session not found`, missing-session-header

### 6.1 Dual-era `e2e/` tier ✅

`e2e/` now drives every example with **both** clients instead of only the pinned old one.

- [x] Added `@modelcontextprotocol/client` alongside the pinned `@modelcontextprotocol/sdk@1.10.0`.
      Different package names, so the old client stays frozen at the floor of our peer range
      no matter where the modern one moves — the suite's original premise is intact.
- [x] `harness.ts` gained `ERAS`, `EraClient`, `createEraClient(era, url)` and
      `createModernClient`. `EraClient` normalises the two client APIs (`callTool` arity
      differs; the v2 client has no raw `request()`), so one test body serves both eras
      instead of branching on `era` everywhere.
- [x] The modern client is **pinned** to `2026-07-28`, not `mode: 'auto'`. `auto` probes and
      silently falls back to `initialize`, so a server that lost its modern leg would still
      go green — pinning makes that a hard failure, which is the whole point of the tier.
- [x] **One server per example, both clients.** e2e wall-clock is dominated by installs and
      boots, not requests, so the second era is nearly free — and it doubles as a dual-era
      concurrency proof against real example servers, including `main-stateful.ts`, where a
      sessionless modern client shares an endpoint with a session-managed legacy one.
- [x] 13 of 15 files run on both eras: **141 legacy + 141 modern**, verified by
      `bun test -t "<era> era"`.
- [x] Legacy-only, deliberately and documented in each file's header:
      `built-in-authorization-server` and `per-tool-authorization-oauth`. The two client
      packages ship different client-side OAuth implementations, so porting them is a rewrite
      against a different auth API, not a parameterisation. The MCP era and the OAuth
      handshake are independent, and per-tool authorization on the modern era is already
      covered by `per-tool-authorization{,-jwt}` (bearer header, both eras).
- [x] Nothing else needed excluding. The suite uses no `sessionId`, `Mcp-Session-Id`,
      `setLevel`, `subscribe`, `ping` or `setNotificationHandler`, and asserts no error
      codes — so the `-32601`→`-32602` change was a non-issue, and `greet-user-interactive`
      only ever appears in a `listTools` assertion, never called (so MRTR is not needed).

### 6.2 Dual-era `tests/` tier ✅

§6 proved the *protocol* on the modern era against a small purpose-built controller. The
**feature** surface — dynamic registration, class-validator pipes, resource query params,
template wildcards, exception filters, the RPC pipeline, per-tool auth, tool-discovery
scoping, multi-module/multi-server isolation — was still only ever driven by a legacy
client. Since the two eras take different server-side paths (`createMcpHandler` vs the
legacy wiring), a feature could work on one and break on the other. This closes that.

- [x] `tests/utils.ts` gained `ERAS`, `Era`, `MODERN_PROTOCOL_VERSION`, `createModernClient`
      and `createEraClient(era, port)`. Much smaller than the `e2e/` equivalent: both eras
      here are the **same** client package, so only `versionNegotiation` differs — no
      `EraClient` wrapper is needed, and `createStreamableClient` keeps its old signature
      and legacy default.
- [x] Pinned to `2026-07-28`, not `mode: 'auto'` — same reasoning as §6.1.
- [x] 31 spec files parameterised via `describe.each(ERAS)`: **246 legacy + 246 modern**,
      verified by `bun test -t "<era> era"`. Total `npm test` 391 → **637 pass, 0 fail**,
      still ~8.7s.
- [x] The transformation wraps the *outer* `describe`, so each era pass gets its **own**
      bootstrapped app. That is deliberate rather than sharing one app: specs like
      `mcp-dynamic-tools` register and unregister tools at runtime, and a shared app would
      leak that mutation across the two era passes. `statefulMode` being legacy-only means
      the modern client is unaffected by the transport config either way.
- [x] Elicitation stays **legacy-only** (`mcp-tool.e2e.spec.ts`). It is a server→client
      request, which on the modern era must travel back over the request-scoped stream
      rather than a session; that wiring (the MRTR wrapper, §9) does not exist yet. This is
      a product gap, not a parameterisation gap. The *fallback* path — a client without the
      elicitation capability — does run on both eras.
- [x] Nothing else needed excluding. The `sessionId` hits in `mcp-oauth-auth` are **OAuth**
      sessions (the auth store), not MCP sessions, so that suite parameterised cleanly.

**Two genuine era differences surfaced, both now pinned per era rather than papered over:**

- `mcp.prefix` — "no MCP endpoint here" rejects on both eras, but with different messages:
  legacy 404s on its `initialize` POST, modern reports its pinned `server/discover` probe as
  unanswered. Asserted per era so both messages stay pinned.
- `mcp-tool` progress delivery — the tool emits **5** notifications; verified on the wire,
  legacy receives `[20, 40, 60, 80]` and modern receives `[20, 40, 60, 80, 100]`.
  Deterministic across repeated runs, in both directions. On the modern era notifications
  travel on the request-scoped stream that the response itself closes, so the response
  cannot overtake them; on legacy they go out on the separate session stream and the last
  one loses the race against the response. **The pre-existing legacy assertion had this loss
  baked in as expected behavior** — worth knowing it is a legacy-transport artifact that the
  modern era does not have, and arguably a legacy bug worth a follow-up.

---

## 7. Docs ✅

- [x] `docs/migration-to-v2.md` — heaviest (statefulMode ×4, stateless ×9, session ×10, SSE ×15)
- [x] `docs/server-examples.md` — stateful/stateless/stdio/fastify setups
- [x] `docs/tools.md` — `reportProgress` / `ctx.log` semantics change
- [x] `docs/how-it-connects.md` — the four-object model gains an era dimension
- [x] `docs/custom-controllers.md` — GET/DELETE verbs are legacy-only now
- [x] `docs/built-in-authorization-server.md` — cites "(2025-06-18)" explicitly
- [x] New doc `docs/protocol-revisions.md`: protocol revisions & dual-era serving; what changes for tool authors (nothing);
      what breaks (`serverMutator` + elicitation/sampling)
- [x] `README.md` — progress example, SDK peer install line
- [x] `CLAUDE.md` — SDK baseline line + dual-era summary

---

## 8. CI / infra

- [x] **`publish.yml` now runs `e2e` on both sides of the release.** Before this, the only
      post-publish check was `examples/server-examples`'s `npm run smoke` — three variants of
      one example, driven by a client with default `versionNegotiation`, i.e. **legacy era
      only**. The `e2e/` suite ran in no workflow at all.
  - [x] *Pre-publish gate* in the `publish` job: `npm run e2e:local` after `Build`, so a
        break stops the release instead of surfacing after the artifact is public.
  - [x] *Post-publish* in the `smoke-test` job: `use-examples.sh published "$V"` +
        `npm run e2e` against the **exact released version** (not the `next` dist-tag, which
        could drift onto another build mid-release). Needed `oven-sh/setup-bun` in that job.
  - ⚠️ The post-publish run fails against any artifact **without** the modern leg — the
        modern client is pinned and does not fall back. Verified against the current `next`
        (`2.0.0-alpha.6`): `Version negotiation failed: the server did not offer pinned
        protocol version 2026-07-28`. It goes green from the first release that ships dual-era
        support. Same caveat applies to `npm run e2e:published` today.
- [ ] `.github/workflows/pipeline.yml` (push/PR) still does **not** run `e2e` — only
      `test:coverage`. Adding it would move the signal earlier than release time; it is also
      the suite that caught the JSON Schema dialect bug. Cost: 15 example installs + boots
      per run, across a 3-version Node matrix.
- [x] `e2e/` gained a second tier: the pinned old `sdk@1.10.0` client **and** a modern
      v2-beta client, both eras against the same example servers. See §6.1.
- [x] `scripts/use-examples.sh` now drops the example lockfile whenever it retargets a
      `@rekog` dep, so `local` mode can no longer be silently overridden by a stale registry
      resolution (see the warning in §1).
- [ ] `scripts/use-examples.sh` has no SDK awareness — extend if examples must pin an SDK version.

---

## 9. Open questions

- [x] Default posture: **dual-era by default** — every existing user keeps working with no
      code change, and modern clients start working immediately.
- [?] Should `statefulMode: true` be deprecated in docs (legacy-only by construction) while
      staying fully supported?
- [?] `Origin` validation default — on, off, or on-for-localhost. **Not implemented**: the spec
      says servers MUST validate `Origin` and answer `403`, and we do not. The SDK entry is
      deliberately validation-free and exports framework-neutral helpers
      (`validateOriginHeader` / `originValidationResponse`) for the host to apply. This is a
      pre-existing gap, not a regression, but it is a real MUST.
- [x] `mcpVersionsSupported` in the auth package: **added `2026-07-28` to the default.** The
      feared test edit turned out not to exist — see §5.

---

## 10. Draft-changelog review (2026-07-26) — remaining conformance work

A full re-read of [`draft/changelog`](https://modelcontextprotocol.io/specification/draft/changelog)
and every page in the draft spec nav, cross-checked against the code. Sections §1–§9 above cover
the *era* work; this section covers what that work did not touch.

Tracked in four tiers, one commit each.

### Tier 1 — outright bugs against conforming modern clients ✅

- [x] **Unknown tool / unknown prompt answered `-32601`.** Now `-32602`
      (`mcp.strategy.ts`, the `tools/call` and `prompts/get` handlers). §5 fixed
      `resources/read` but missed these two. `-32601` is spec-reserved for *"the server does not
      implement the requested RPC method"* (answered HTTP 404) and is load-bearing for client
      era/transport detection, so emitting it for a bad `params.name` invites a client to
      conclude `tools/call` itself is unsupported. The spec's own unknown-tool example uses
      `-32602`.
- [x] **`outputSchema` was force-cast to `type: 'object'`.** Removed. SEP-2106 widened
      `structuredContent` to any JSON value and the spec documents array output schemas
      explicitly (`list_users`). The override spread `type: 'object'` **last**, so
      `{type:'array', items:{…}}` went out as `{items:{…}, type:'object'}` — `type` overwritten,
      `items` orphaned, and every conforming client that validates results rejected them.
      Was a no-op on the Zod path (`normalizeObjectSchema` only ever yields object schemas
      there), so this unbreaks the Standard Schema and raw-JSON-Schema paths only.
- [x] Tests: `tests/mcp-spec-error-codes.e2e.spec.ts`, 12 tests over both eras.
      Suite 637 → **649 pass, 0 fail**.
- [x] §5's dialect claim corrected: the spec does **not** forbid draft-07. 2020-12 is the
      *default and RECOMMENDED* dialect (`basic/index#schema-dialect` explicitly permits an
      explicit `$schema` for another dialect, and the tools page shows a draft-07 example as
      valid). What is true is that **SDK v2 clients** enforce 2020-12 for `outputSchema`. The
      change was right; the justification was overstated. Fixed so nobody later "reverts a
      non-requirement".

Two era-specific behaviours were discovered and are now pinned by test rather than assumed:

1. **The 2025 codec wraps non-object output schemas, correctly.** On the legacy era the SDK's
   `wrapOutputSchemaForLegacy` rewrites `{type:'array',…}` to
   `{type:'object', properties:{result:<natural>}, required:['result']}` (with same-document
   `$ref` pointers rewritten for the new root). The 2025 revision only permitted object output
   schemas, so this is the SDK being era-appropriate, not corruption. Modern era passes the
   schema through verbatim. Both are asserted.
2. **⚠️ SDK client gap: non-object `structuredContent` is unusable today.**
   `@modelcontextprotocol/client@2.0.0-beta.5` still types the field as
   `z.record(z.string(), z.unknown())` in its `CallToolResult` schema, so a result carrying an
   array or scalar `structuredContent` is rejected **client-side** regardless of what the server
   emits. SEP-2106's widening *is* honored on the server side (the SDK even ships
   `appendTextFallbackForNonObject` to add the compensating text block). So advertising a
   non-object `outputSchema` is correct and now works, but the matching result shape cannot
   round-trip until the client catches up. Deliberately not asserted end-to-end; revisit on the
   next SDK bump.

### Tier 2 — authorization security 🚧

- [ ] Token `audience`/`issuer`/`type` validation (spec MUST, currently unmet)
- [ ] Filter requested scopes against `scopesSupported`
- [ ] `iss` in authorization responses (RFC 9207) + `authorization_response_iss_parameter_supported`
- [ ] Canonical-issuer validation (`jwtIssuer` vs `serverUrl` divergence)

### Tier 3 — additive compliance 🚧

- [ ] `cacheHints` transport option (SEP-2549) — default stays `private`
- [ ] `Origin` / `Host` validation option
- [ ] `x-mcp-header` (SEP-2243) handling
- [ ] OpenTelemetry `_meta` keys on `McpContext`
- [ ] PKCE: require `code_challenge`, `S256` only
- [ ] `offline_access` out of protected-resource `scopesSupported` (new SHOULD NOT)
- [ ] `application_type` stored; `disableEndpoints.register`; DCR deprecation docs

### Tier 4 — consent screen, CIMD, step-up authorization 🚧

- [ ] Consent screen (prerequisite for CIMD's "MUST clearly display the redirect URI hostname")
- [ ] Client ID Metadata Documents, opt-in, SSRF-guarded
- [ ] HTTP 403 + `WWW-Authenticate: error="insufficient_scope"` for per-tool scope failures

### Verified as already covered — no work needed

- **`Mcp-Method` / `Mcp-Name` required headers + header↔body cross-check (SEP-2243).** Both are
  already threaded into `classifyInboundRequest` (`streamable-http.transport.ts`), and the SDK's
  validation ladder does the comparison and emits `-32020`. This was the item most likely to be
  a gap and is not one.
- **Deterministic `tools/list` order** (new SHOULD) — satisfied by construction: array spread
  plus `Map` insertion order.
- **`X-Accel-Buffering: no`** on SSE (new SHOULD) and **listen-stream keep-alives** — both in
  the SDK.
- **`extensions` on client/server capabilities** (new field) — flows through
  `options.capabilities` untouched.
- **`$ref` MUST NOT auto-dereference network URIs** — the raw-JSON-Schema path validates via
  AJV (`fromJsonSchema`), which does not fetch remote refs.
- **Pagination** — returning every item with no `nextCursor` is a valid single page.
- **Removal of `ping` / `logging/setLevel` / `roots/list_changed`, SSE resumability,
  `Last-Event-ID`** — legacy-era only; the modern leg never offered them.

### Authorization: what `2026-07-28` actually changed

Smaller than the core-protocol delta, and almost entirely additive:

| Change | Weight on an authorization server |
|---|---|
| DCR **deprecated** in favour of CIMD | DCR stays `MAY`; **removal not eligible until 2027-07-28** |
| CIMD | was *already* `SHOULD` in `2025-11-25` — the draft only removed the alternative |
| `iss` in authorization responses (RFC 9207) | `SHOULD` emit; `MUST` advertise if emitting. Spec says a future revision upgrades this to MUST |
| `application_type` in DCR | client-side MUST only — *"non-OIDC servers safely ignore the parameter"* |
| Client credentials keyed by issuer | client-side only |
| `offline_access` in `scopes_supported` | new **SHOULD NOT** for protected resources |
| AS-metadata `issuer` must equal the well-known URL it was fetched from | client **MUST NOT** use mismatched metadata → de facto AS constraint |

Everything else (RFC 8707 `resource`, PKCE S256, token audience validation, the 401/403/400
table, `WWW-Authenticate` + `resource_metadata`, exact redirect-URI matching) is **unchanged**
from `2025-11-25`. The Tier 2–4 authorization items are therefore mostly *pre-existing* gaps
that the draft review surfaced, not new obligations.

---

## Appendix: verified facts

Empirically established in this workstream, not inferred:

1. MCP-Nest on `main` rejects `2026-07-28` with `-32000 Unsupported protocol version`.
2. `createMcpHandler` serves modern **and** legacy from one factory registering handlers exactly
   the way `McpStrategy` does (raw `server.server.setRequestHandler`) — `server/discover`,
   `tools/list`, `tools/call`, `initialize` all fine; GET → 405.
3. The SDK auto-stamps `resultType: "complete"`, `ttlMs: 0`, `cacheScope: "private"` on raw
   handler results, and `_meta.serverInfo` on beta.5. No strategy changes needed for those.
4. **The real `@modelcontextprotocol/sdk@1.10.0` client** (the floor of our peer range) connects,
   lists and calls tools against a `createMcpHandler` server — 4 factory calls, all `era=legacy`.
5. Progress + logging work on a sessionless modern request via `ctx.mcpReq.notify` /
   `ctx.mcpReq.log`; the response auto-upgrades from JSON to `text/event-stream`.
   `server.server.notification(...)` is silently dropped there.
6. Logging is correctly suppressed by the SDK when the request carries no
   `io.modelcontextprotocol/logLevel` — the spec MUST NOT is satisfied for free.
7. `ctx.requestInfo` is object-identical to the `Request` handed to `handler.fetch()`.
8. The SDK v2 **client** defaults to `versionNegotiation: 'legacy'` — the plain 2025 sequence,
   no probe, no new headers. So a v2 client (MCP Inspector included) reports a dual-era server
   as legacy `2025-11-25` until you opt into `'auto'` or pin `2026-07-28`. The era is chosen by
   the client, per request; the server never prefers one.
9. Both Zod (`z.toJSONSchema`) and ArkType (`~standard.jsonSchema`) accept the target string
   `'draft-2020-12'` and emit the canonical `https://json-schema.org/draft/2020-12/schema`
   URI that the SDK's `DRAFT_2020_12_URIS` set accepts. ArkType rejects `'2020-12'`.
10. npm 9.2.0 defaults `install-links=true`, which **copies** a `file:` dependency instead of
    symlinking it — so an example must be reinstalled after every `bun run build`, and a
    symlink check is not a reliable "is this the local build?" test.
