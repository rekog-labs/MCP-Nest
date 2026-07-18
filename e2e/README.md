# Example end-to-end tests

These tests boot each `examples/<name>` project as a **real subprocess** and drive
it with a **pinned, intentionally-old MCP client** — `@modelcontextprotocol/sdk@1.10.0`,
the floor of `@rekog/mcp-nest`'s supported peer range (`>=1.10.0`).

Why an old client? The server-side SDK moves (the v1 `@modelcontextprotocol/sdk`
→ v2 `@modelcontextprotocol/{core,node,server}` migration is the immediate reason),
but real users don't upgrade their clients in lockstep. Freezing the client here
means: **if a server/SDK change breaks a client already in the wild, these tests
go red and name what regressed.**

```
static old client  ──drives──▶  example server (moving SDK)
   (this project)                (published OR local build)
```

This project is deliberately **not** part of the npm workspace, so its client SDK
stays pinned no matter what the workspace/examples upgrade to.

## Coverage

One `*.test.ts` per example (165 assertions total): `tools`, `resources`,
`resource-templates`, `prompts`, `dependency-injection`, `dynamic-capabilities`,
`server-mutation`, `tool-discovery`, `multiple-servers`, `server-examples` (6
transport variants), `custom-controllers`, `per-tool-authorization`,
`per-tool-authorization-jwt`, `per-tool-authorization-oauth`, and
`built-in-authorization-server`. Examples needing a real external IdP/Docker
(`azure-ad-*`, `external-authorization-server-casdoor`) are out of scope; the
OAuth/JWT examples run offline via `MCP_FAKE_AUTH=1` with locally-minted tokens.

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
