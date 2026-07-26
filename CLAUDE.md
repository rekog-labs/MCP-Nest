# CLAUDE.md

## What this repo is
This is a NestJS package that lets *users* expose their existing NestJS providers as MCP tools, resources,
and prompts, with DI, guards, pipes, interceptors, and filters applying natively.

**Dual-era**: one endpoint serves both the 2025-era protocol (`initialize` handshake, sessions)
and the new stateless revision `2026-07-28`. Each POST is classified with the SDK's own
`classifyInboundRequest`; modern traffic goes to `createMcpHandler`, 2025 traffic to the
existing wiring. `GET`/`DELETE`, `statefulMode`, `enableJsonResponse` and `sessionIdGenerator`
are all **legacy-era only**. See `docs/protocol-revisions.md` and `SPEC-2026-07-28-SUPPORT.md`.
Do not read `LATEST_PROTOCOL_VERSION` from the SDK as "the newest revision we speak" — it is
`2025-11-25`; the modern revision string is not exported and must be written literally.

## Packages
- `packages/mcp-nest` → **`@rekog/mcp-nest`** (core). `McpStrategy` (a NestJS
  `CustomTransportStrategy`), `@McpController`, the `@Tool`/`@Resource`/`@ResourceTemplate`/`@Prompt`
  decorators, Streamable HTTP + STDIO transports, and per-tool authorization primitives
  (`@ToolScopes`/`@ToolRoles`). Deliberately dependency-light.
- `packages/mcp-nest-auth` → **`@rekog/mcp-nest-auth`** (optional). A *built-in OAuth
  authorization server* (`McpAuthModule`): your Nest app itself implements the MCP auth spec —
  dynamic client registration, consent, token issuance — while federating user login to an IdP
  (GitHub, Google, Keycloak…). Users who already have an MCP-spec-compliant authz server don't
  need this package at all; they just expose protected-resource metadata (see
  `docs/external-authorization-server.md`).

## Layout
- `docs/` — user-facing guides; `docs/README.md` is the index. Most docs have a matching runnable
  project in `examples/` under the same name.
- `examples/<project>` — standalone npm projects consuming the published or local packages.
- `tests/` — unit/integration specs for the packages (bun test).
- `e2e/` — separate suite driving `examples/` with a **pinned old MCP client** to check
  backward compatibility.

## Commands
- `npm test` / `npm run test:watch` — bun test over `tests/` and `packages/**/*.spec.ts`.
  Most specs are parameterised over both protocol eras via `describe.each(ERAS)`; run one
  era with `bun test tests/ -t "modern era"` (or `"legacy era"`).
- `npm run e2e` — e2e suite driven by a pinned OLD MCP client; `npm run e2e:local` builds first
- `npm run examples:local` / `npm run examples:published` — repoint examples at local vs published packages
- Each `examples/<project>` is a standalone npm project — see `examples/README.md`

## Gotchas
- **There is no `McpModule`.** v2 is a NestJS microservice transport strategy (`McpStrategy`) plus
  `@McpController`. See `docs/migration-to-v2.md`. Anything you recall about `McpModule.forRoot()`
  is v1 and will not compile.
- `@rekog/mcp-nest-auth` ships as a separate package so core stays free of
  `typeorm`/`passport`/`@nestjs/jwt`. Import every auth symbol from it, not from core.
- Tool methods are `(args, context, request)` — `request` is `undefined` under STDIO.
- Tool `parameters` accept any Standard Schema, not just Zod (`zod` is not a core dependency).
- `jest.config.js` at the root is a dead leftover; tests run under `bun test`.

## Directives
- don't run linting, I don't care about it or formatting
