# MCP-Nest Performance Benchmark

Measures the per-request overhead of `@rekog/mcp-nest` **v2** (`2.0.0-alpha.4`) in **stateless Streamable HTTP** mode, compared against two baselines:

| server | what it tells you |
|---|---|
| `v2-stateless` | the number under test |
| `raw-sdk-stateless` | a plain `@modelcontextprotocol/sdk` server (`node:http`) replicating the *same* per-request create/connect/teardown pattern — the delta vs this is the **total NestJS + mcp-nest overhead** |
| `raw-sdk-nest` | the same raw-SDK server hosted in NestJS/Express but with **zero mcp-nest code** — splits that overhead into the NestJS/Express framework tax (vs `raw-sdk-stateless`) and **mcp-nest's own code tax** (vs `v2-stateless`) |
| `v1-stateless` | `@rekog/mcp-nest@1.9.10` (`McpModule.forRoot` + `statelessMode`) — the delta vs this is the **v1 → v2 regression check** |
| `v2-stateful` | same v2 server with sessions — the delta vs `v2-stateless` is the **per-request server-construction cost** of stateless mode |

## Key results

Full analysis, methodology, and the complete matrix are in **[PERFORMANCE.md](PERFORMANCE.md)**; raw per-cell numbers in [results/report.md](results/report.md). Headline (`tools/call` echo, 50 tools registered, concurrency 10):

- **~2,800 req/s** for stateless tool calls, flat from 1→100 concurrent connections, zero errors, stable ~420 MB RSS.
- **mcp-nest's own overhead is ~7%** on the hot path (0–5% elsewhere, within noise). The four-layer decomposition — raw SDK `3,961` → +NestJS/Express `3,100` (−22%) → +mcp-nest `2,871` (−7%) — shows ~3/4 of the total gap is the framework, not mcp-nest.
- **v2 is ~15% faster than v1** on every path, and handles large request bodies that v1 rejects with HTTP 413.
- **One hotspot:** `tools/list` drops ~3.5× from 5→50 tools (uncached zod→JSON-Schema conversion) — but it lives in the MCP SDK, so the raw-SDK baseline collapses identically and mcp-nest adds ~0 there. `tools/call` is unaffected by tool count.

| layer (`tools/call` echo, c=10) | req/s | this layer's cost |
|---|---:|---:|
| raw `@modelcontextprotocol/sdk` (`node:http`) | 3,961 | baseline |
| + NestJS/Express, no mcp-nest | 3,100 | −21.7% (framework) |
| + mcp-nest v2 (**the number under test**) | **2,871** | **−7.4% (mcp-nest)** |
| v1 (`McpModule`, reference) | 2,481 | v2 is +15.7% faster |

## Why the raw-SDK baseline rebuilds the server per request

mcp-nest's stateless mode creates a fresh `McpServer` + `StreamableHTTPServerTransport` on every POST (`handleStateless`). A raw-SDK server that reused one long-lived server would look faster for architectural reasons, not library-overhead reasons. To isolate what *mcp-nest itself* adds, the raw baseline deliberately mirrors the same per-request pattern.

## Setup

```bash
npm install
(cd v1-baseline && npm install)   # v1 lives in its own npm project — v1 and v2 can't share node_modules
```

## Run

```bash
npm run smoke     # boots each server once, verifies a bare tools/call works, prints driver table
npm run bench     # full matrix -> results/results-<ts>.json + results/report.md
npm run bench -- --quick                    # 5s runs, c={1,10} — for iteration
npm run bench -- --scenario S1-echo         # filter scenarios
npm run bench -- --server v2-stateless      # filter servers
npm run report    # regenerate report.md from the latest results file
npm run profile   # v2-stateless under node --cpu-prof driven by S1 -> results/profiles/*.cpuprofile
```

## Scenarios

| id | request | exposes |
|---|---|---|
| S1-echo | `tools/call echo` (tiny payload) | headline fixed per-request overhead |
| S2-list-n5 / n50 | `tools/list` with 5 vs 50 registered tools | zod→JSON-schema regeneration scaling (v2 converts schemas on every call, uncached) |
| S3-payload-10kb / 100kb | `tools/call echo` with large string arg | body-parsing path |
| S4-stateful-echo | `tools/call echo` over a reused session (v2 stateful) | stateless construction cost, by delta vs S1 |

Concurrency sweep `c ∈ {1, 10, 100}`, 5 s warmup (discarded) + 15 s measured per cell. Servers run strictly one at a time.

All servers expose an identical tool set generated from [tools/shared-tools.ts](tools/shared-tools.ts) (`echo` + N−1 synthetic tools; `TOOL_COUNT` env var, default 50). `v1-baseline/src/shared-tools.ts` is a byte-identical copy, drift-checked by the smoke step.

## Fairness

- Same machine, same Node, `NODE_ENV=production`, Nest `logger: false`, bound to `127.0.0.1`.
- Child stdio redirected to `results/logs/` so console I/O doesn't perturb latency.
- Warmup before every measured window; never two servers alive at once.
- Load generator is [autocannon](https://github.com/mcollina/autocannon) POSTing fixed JSON-RPC bodies (stateless Streamable HTTP needs no `initialize` handshake — verified by the smoke step, with an SDK-client fallback that gets flagged as non-comparable in the report).

## Caveats

- autocannon is itself a Node process and becomes a bottleneck at high concurrency; treat absolute req/s as directional. The benchmark's purpose is **relative deltas between servers run back-to-back on the same box**, not capacity planning.
- Everything runs through `ts-node --transpile-only`; that affects boot time, not steady-state throughput (code is JIT-compiled the same once loaded).
- The stateful S4 scenario uses SDK clients over reused sessions (autocannon can't hold an MCP session), so compare S4 to S1 only in relative terms.
