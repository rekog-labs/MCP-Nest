# Example end-to-end tests

These tests boot each `examples/<name>` project as a **real subprocess** and drive
it with **two clients, one per protocol era**:

| Era | Package | What it proves |
|---|---|---|
| `legacy` | `@modelcontextprotocol/sdk@1.10.0` (pinned) | clients already in the wild keep working |
| `modern` | `@modelcontextprotocol/client` pinned to `2026-07-28` | the 2026 leg actually serves |

Why an old client? The server-side SDK moves (the v1 `@modelcontextprotocol/sdk`
→ v2 `@modelcontextprotocol/{core,node,server}` migration is the immediate reason),
but real users don't upgrade their clients in lockstep. Freezing the client here
means: **if a server/SDK change breaks a client already in the wild, these tests
go red and name what regressed.**

They are two *different packages*, deliberately — so the old one stays frozen at the
floor of our peer range no matter where the modern one moves.

```
old client (1.10.0)  ──┐
                       ├──drives──▶  ONE example server (moving SDK)
modern client (2026)  ─┘              (published OR local build)
```

Each example boots **once** and both clients drive it, so the second era costs
almost nothing (wall-clock here is installs and boots, not requests) — and it
doubles as a dual-era concurrency proof, including on `main-stateful.ts`, where a
sessionless modern client shares an endpoint with a session-managed legacy one.

Tests are written once against `EraClient` (see `harness.ts`), which normalises the
two clients' differing APIs, and run via `describe.each(ERAS)`. To run a single era:

```bash
bun test -t "modern era"
bun test -t "legacy era"
```

The modern client is **pinned**, not `mode: 'auto'`: `auto` probes and silently falls
back to `initialize`, so a server that lost its modern leg would still go green.

This project is deliberately **not** part of the npm workspace, so its client SDKs
stay pinned no matter what the workspace/examples upgrade to.

> **Local mode gotcha.** `harness.ts` deletes each example's `package-lock.json` before
> installing and passes `--install-links=false`. Both are load-bearing: a lockfile written
> in published mode pins a *registry* resolution that npm honours over the `file:` spec, and
> npm 9 defaults `install-links=true`, which copies a `file:` dep rather than symlinking it.
> Without these, `e2e:local` silently tests the published package.

## Coverage

One `*.test.ts` per example: `tools`, `resources`,
`resource-templates`, `prompts`, `dependency-injection`, `dynamic-capabilities`,
`server-mutation`, `tool-discovery`, `multiple-servers`, `server-examples` (6
transport variants), `custom-controllers`, `per-tool-authorization`,
`per-tool-authorization-jwt`, `per-tool-authorization-oauth`, and
`built-in-authorization-server`. Examples needing a real external IdP/Docker
(`azure-ad-*`, `external-authorization-server-casdoor`) are out of scope; the
OAuth/JWT examples run offline via `MCP_FAKE_AUTH=1` with locally-minted tokens.

309 assertions: 141 legacy + 141 modern + 27 legacy-only.

**`built-in-authorization-server` and `per-tool-authorization-oauth` are legacy-only**,
deliberately. The two client packages ship different client-side OAuth implementations,
so porting them would be a rewrite against a different auth API rather than a
parameterisation. The MCP era and the OAuth handshake are independent, and per-tool
authorization on the modern era is already covered by `per-tool-authorization` and
`per-tool-authorization-jwt`, which drive the same guards with a bearer header on both
eras. Each file's header says so.

### Auth examples and local linking

The two `@rekog/mcp-nest-auth` examples pass `NODE_OPTIONS=--preserve-symlinks`
(via `startExample`'s `env`) in LOCAL mode: otherwise the symlinked auth package
resolves a second `@nestjs/core` from the workspace root, producing two `ModuleRef`
class tokens and an unresolvable guard dependency. It's a linking-only artifact and
a no-op in published mode. The pure examples don't need it.

## Run

From the repo root:

```bash
npm run e2e:local        # examples -> local workspace build (file:), then test
npm run e2e:published    # examples -> published 2.x (next dist-tag), then test
```

Or directly, once you've picked a mode (see below) and built the workspace:

```bash
cd e2e
bun install
bun test           # all example tests
bun test tools     # just the tools example
```

## Local vs published

The mode is a property of each example's `package.json` dependency on
`@rekog/mcp-nest`, flipped by the root scripts:

```bash
npm run examples:local            # -> "file:../../packages/mcp-nest"  (needs `npm run build` first)
npm run examples:published        # -> "latest" dist-tag  (NB: latest is the v1 line!)
bash scripts/use-examples.sh published next   # -> the 2.x prerelease
```

You don't need to reinstall by hand: the harness reconciles each example's
`node_modules` to whatever its `package.json` declares before booting it (a
symlinked `@rekog/mcp-nest` means local; a real directory means published). It only
reinstalls when the installed state doesn't already match, so same-mode runs are fast.

> **Heads up:** the `latest` dist-tag of `@rekog/mcp-nest` is still the **v1** line
> (`1.9.x`), which the v2-API examples can't run against. For "published" runs use
> the `next` tag (or an explicit `2.0.0-alpha.x`), which is what `npm run e2e:published`
> does.

## How a test works

Each `*.test.ts` uses the shared `harness.ts`:

- `getFreePort()` — pick a free port (pass distinct ports when running servers in parallel).
- `startExample(name, port)` — reconcile install, boot the example's own `start`
  script (forced to `--transpile-only`, see below), resolve once the port is open.
- `createLegacyClient(url)` — connect the pinned 1.10.0 client over Streamable HTTP.

**Why `--transpile-only`:** when an example is linked to the local build, the
symlinked package resolves `@nestjs/*` from the workspace root while the example's
own source resolves it from its own `node_modules` — two identical-but-distinct
copies that ts-node's type-checker rejects. That's a linking artifact, not a
product bug; these tests care about runtime behavior, so type-checking is skipped
at boot.

## Adding a test for another example

Copy `tools.test.ts`, point `startExample()` at the new example directory, and
assert the behaviors documented in that example's `docs/` page. Keep assertions on
substantive content (a greeting is present, an error is surfaced) rather than exact
serialization where the library's wrapping is incidental.
