# Per-Tool Authorization

This guide explains **how** fine-grained, per-tool authorization works in your MCP
server using `@PublicTool()`, `@ToolScopes()`, and `@ToolRoles()`. It is the
concepts-and-mechanics reference; for a runnable server pick one of the two
concrete guides:

* **[Per-Tool Authorization with JWT](per-tool-authorization-jwt.md)** — the
  simplest way to try it. A hand-rolled JWT guard and pre-minted tokens, no OAuth
  provider to register. Start here.
* **[Per-Tool Authorization with OAuth](per-tool-authorization-oauth.md)** — the
  production setup: a real OAuth provider (GitHub) fronted by the
  `@rekog/mcp-nest-auth` authorization server.

Both guides wire up the exact same decorators and authorization service described
below — they differ only in how the caller's identity (`req.user`) gets
populated.

## Overview

Per-tool authorization lets you control access to individual tools based on:

* **Authentication** — is the user logged in?
* **Scopes** — does their token include required permissions?
* **Roles** — do they hold specific roles?

### Decorators

* `@PublicTool()` — accessible without authentication
* `@ToolScopes(['scope1', 'scope2'])` — requires specific OAuth scopes
* `@ToolRoles(['role1', 'role2'])` — requires specific user roles
* *(no decorator)* — a protected tool: requires an authenticated user, but no specific scopes or roles

## Security Schemes

Implements the [OpenAI `securitySchemes` spec](https://developers.openai.com/apps-sdk/build/auth#pertool-authentication-with-securityschemes).
Example tool definition:

```json
{
  "name": "admin-delete",
  "description": "Delete a user (admin only)",
  "_meta": {
    "securitySchemes": [{ "type": "oauth2", "scopes": ["admin", "write"] }]
  }
}
```

## How authorization works

Every request goes through two checks, and it helps to keep them separate:

1. **Your guard — is this caller allowed in at all?** A NestJS guard on the MCP
   route reads the incoming token and either turns the request away or lets it in
   and attaches the caller's identity as `req.user`. Because you mount the MCP
   endpoint as an ordinary Nest controller (via `McpHttpControllerFor`), the guard
   runs at the HTTP layer on *every* transport request — the `initialize` POST, the
   `tools/list` POST, and each `tools/call` — before any tool logic runs.
2. **The strategy — which tools may this caller see and use?** The built-in
   `ToolAuthorizationService` reads `req.user` and the `@PublicTool()`,
   `@ToolScopes()`, and `@ToolRoles()` decorators on each tool, filtering
   `tools/list` and rejecting unauthorized `tools/call`.

The guard does **authentication** (who you are, and whether you get in); the
strategy does **authorization** (what you may do once you're in). The strategy
trusts the guard: it never re-checks whether an anonymous caller should have been
let in — that decision belongs to the guard.

Notes:

- There is **no module-level `guards` option** on `McpStrategy`. Put the auth
  guard on the MCP controller with `@UseGuards()` instead — that's what sets
  `req.user`, which list-time filtering needs.
- `allowUnauthenticatedAccess` (freemium) and the per-tool decorators are passed
  to the `McpStrategy` constructor. See the
  [E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts).

## Step-up authorization (`insufficient_scope`)

By default a caller who is authenticated but lacks a tool's `@ToolScopes()` gets a
JSON-RPC error inside an **HTTP 200**. That is a dead end for a well-behaved
client: it never sees a `403` or a `WWW-Authenticate` challenge, so it has no way
to learn *which* scopes to go and ask for. The spec's answer is step-up
authorization:

> the server **SHOULD** respond with `HTTP 403 Forbidden` … a `WWW-Authenticate`
> header with the `Bearer` scheme and additional parameters:
> `error="insufficient_scope"`, `scope="required_scope1 required_scope2"`,
> `resource_metadata="…"`

Turn it on per transport:

```typescript
new StreamableHttpTransport({ stepUpAuthorization: true });

// If authentication is not @rekog/mcp-nest-auth (external AS, gateway, your own
// guard), name the metadata URL — core cannot derive it:
new StreamableHttpTransport({
  stepUpAuthorization: {
    resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
  },
});
```

The check runs **before dispatch**, so it works identically on both eras — on the
modern era the SDK owns response writing, and once it starts writing the status is
no longer ours to change.

**It is opt-in and defaults to off.** The spec text is a SHOULD, and switching it
on changes what a 2025-era client sees for a denial: an HTTP-level failure instead
of a JSON-RPC error result. Enable it once you know your clients handle a `403`
challenge.

What is deliberately **not** challenged, because `insufficient_scope` would be a
lie or actively harmful:

| Case | Why |
|---|---|
| `@ToolRoles()` failure with scopes satisfied | A role deficiency has no scope to request; there is nothing the client could ask for. |
| No resolved `req.user` | A self-mounted route has no guard and so no principal. mcp-nest does not invent authentication. |
| `@PublicTool()`, or a tool with no `@ToolScopes()` | Nothing was required. |
| JSON-RPC batches | A `403` fails the whole HTTP request, killing authorized siblings — and a status code cannot say "element 3 needs scopes". |

The challenge advertises the tool's **full required** scope set, not just the
missing subset: that is what the spec's example shows and what the client hands to
`/authorize`.

Independently of this option, the `401` challenge from `McpAuthJwtGuard` now
always carries a `scope` parameter listing
`protectedResourceMetadata.scopesSupported` (omitted when that list is empty).

## Define Tools

Tools live on an `@McpController()` class. The decorators below are identical
regardless of whether identity comes from a simple JWT guard or a full OAuth
provider — all the guard has to do is populate `req.user`. Read the
authenticated user from the raw request by injecting it with `@McpRawRequest()`:

```typescript
import { McpController, Tool, PublicTool, ToolScopes, ToolRoles, McpRawRequest } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  // Public tool - accessible without authentication
  @Tool({
    name: 'public-search',
    description: 'Search publicly available data',
    parameters: z.object({
      query: z.string(),
    }),
  })
  @PublicTool()
  async publicSearch(@Payload() { query }: { query: string }) {
    return { content: [{ type: 'text', text: `Public search results for: ${query}` }] };
  }

  // Protected tool - requires an authenticated user (set by the auth guard)
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(
    @Payload() _args: unknown,
    @McpRawRequest() req?: { user?: any },
  ) {
    const user = req?.user;
    return { content: [{ type: 'text', text: `Profile for ${user.name}` }] };
  }

  // Requires specific OAuth scopes
  @Tool({
    name: 'admin-delete',
    description: 'Delete user (admin only)',
    parameters: z.object({
      userId: z.string(),
    }),
  })
  @ToolScopes(['admin', 'write'])
  async deleteUser(@Payload() { userId }: { userId: string }) {
    return { content: [{ type: 'text', text: `User ${userId} deleted` }] };
  }

  // Requires specific user roles
  @Tool({ name: 'system-config', description: 'Configure system settings' })
  @ToolRoles(['admin'])
  async configureSystem() {
    return { content: [{ type: 'text', text: 'System configured' }] };
  }
}
```

## Any-of (OR) matching

By default, `@ToolScopes()` and `@ToolRoles()` require the caller to hold
**every** listed scope/role (AND). Pass `{ match: 'any' }` as a second argument
to require only **one** of them instead (OR):

```typescript
// Reachable by 'admin' OR 'support' — only one role is required
@Tool({ name: 'escalate-ticket', description: 'Escalate a ticket' })
@ToolRoles(['admin', 'support'], { match: 'any' })
async escalateTicket() { /* ... */ }

// Reachable with 'premium' OR 'admin' scope — only one scope is required
@Tool({ name: 'premium-report', description: 'View a premium report' })
@ToolScopes(['premium', 'admin'], { match: 'any' })
async premiumReport() { /* ... */ }
```

An invalid `match` value (anything other than `'all'` or `'any'`) throws at
decoration time, the same way an empty array does.

The denial message tells you which mode was in play:

* `all` (default): `Tool 'x' requires roles: admin, support`
* `any`: `Tool 'x' requires any of roles: admin, support`

(and the equivalent `requires scopes: …` / `requires any of scopes: …` for
`@ToolScopes()`). This applies uniformly to `tools/list` filtering and the
`tools/call` denial.

Step-up authorization (below) also honours `match: 'any'`: a caller who holds
**at least one** of the tool's required scopes is not challenged; the `403` only
fires when the caller holds **none** of them, and the challenge still advertises
every listed scope (since obtaining any one of them would satisfy the tool).

Dynamic tools registered via `McpStrategy.registerTool()` accept the same option
through `requiredRolesMatch` / `requiredScopesMatch` on `DynamicToolDefinition` —
see [Dynamic Capabilities](dynamic-capabilities.md).

> **Limitation:** the OpenAI `securitySchemes` advertised in `tools/list` has no
> way to express OR across scopes, so a `match: 'any'` tool still advertises its
> full scope list the same way an `all`-mode tool does.

Each decorator takes a single flat list matched as `all` or `any` — there is no
support for nested/boolean expressions like `(a AND b) OR c`.

## Freemium (unauthenticated access)

`allowUnauthenticatedAccess` decides whether callers with no token are allowed at all:

- **`false` (default)** — a fully authenticated server: callers with no token are
  turned away, and every tool needs a logged-in user.
- **`true` (freemium)** — callers with no token are let in, but can only use
  `@PublicTool()` tools; protected tools still require a valid token.

The flag configures the **strategy** (the second check) automatically. Your
**guard** (the first check) has to make the same call — and because the guard is
your code, the framework can't do it for you. So your guard needs one extra check
for a request that arrives without a token:

```typescript
// inside your guard, when the request has no token:
if (allowUnauthenticatedAccess) {
  return true;                     // freemium: let them in with no req.user
}
throw new UnauthorizedException(); // otherwise: turn them away
```

Keep the guard and the flag in step:

| `allowUnauthenticatedAccess` | Your guard, on a tokenless request |
| --- | --- |
| `false` (default) | reject it |
| `true` (freemium) | let it through (no `req.user`) |

If the two disagree you get a surprise: letting tokenless requests through while
the flag is `false` leaves protected tools reachable by anyone; rejecting them
while the flag is `true` switches freemium off, so even `@PublicTool()` tools
become unreachable.

The built-in `McpAuthJwtGuard` already does exactly this check, so if you use it
(see the [OAuth guide](per-tool-authorization-oauth.md)) it stays in step with the
flag for you. The concrete guides show how to set the flag for each setup — it's a
single toggle, no per-tool code change.

## STDIO Mode

STDIO (local dev) has no HTTP request, so no guard runs and nothing sets
`req.user` — the strategy always sees an anonymous caller. That means a tool is
reachable over STDIO only if it can be used with no user:

* `@PublicTool()` tools — reachable.
* Undecorated (plain protected) tools — reachable, since with no user there is
  nothing to check.
* `@ToolScopes()` / `@ToolRoles()` tools — **not** reachable. They require a
  user, and STDIO can't provide one, so they're filtered out of `tools/list` and
  rejected on `tools/call` with `Tool '<name>' requires authentication`.

So STDIO is fine for exercising your public and protected tools locally, but it
can't test scope- or role-gated tools — there's no identity to satisfy them.

---

**See the [per-tool-auth E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts)** for
a full working example with public, protected, scoped, and role-based tools, and
the [`McpHttpControllerFor` E2E test](../tests/mcp-http-controller-for.e2e.spec.ts)
for the guarded-controller wiring.
