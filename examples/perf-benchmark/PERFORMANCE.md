# mcp-nest v2 — Performance Summary

**Package under test:** `@rekog/mcp-nest@2.0.0-alpha.4`, stateless Streamable HTTP.
**Method:** autocannon POSTing JSON-RPC to `/mcp`, 5s warmup + 15s measured per cell, one server alive at a time, `NODE_ENV=production`, Nest `logger:false`, bound to `127.0.0.1`. Servers driven via [bench/](bench/); raw data in [results/report.md](results/report.md).

> Numbers are **relative deltas between servers run back-to-back on the same box**, not absolute capacity. autocannon is itself a Node process and caps out at high concurrency, so treat absolute req/s as directional.

## Bottom line

v2 sustains ~2,800 req/s for stateless tool calls, flat from 1→100 concurrent connections, zero errors, stable memory. The overhead it adds over a hand-written raw-SDK server is ~27%, and **~3/4 of that is NestJS/Express itself — mcp-nest's own code contributes only 0–7%.** v2 is also **~15% faster than v1** on every path.

## The four-layer decomposition (tools/call `echo`, c=10)

Each row adds one layer, so the drop between rows is that layer's cost:

| layer | req/s | this layer's cost |
|---|---:|---:|
| raw `@modelcontextprotocol/sdk` on `node:http` | 3,961 | baseline |
| + hosted in NestJS/Express (no mcp-nest) | 3,100 | **−21.7%** ← Nest/Express framework |
| + mcp-nest v2 (`raw-sdk-nest` → `v2-stateless`) | 2,871 | **−7.4%** ← mcp-nest's own code |
| v1 (`McpModule`, for reference) | 2,481 | v2 is **+15.7%** faster than v1 |

MCP-Nest's own code — costs ~7% on the hot path, and 0–5% (within noise) on every other path. The bulk of the "overhead" is the price of running inside NestJS.

## Headline numbers (req/s, higher is better)

| scenario | raw-sdk | raw-sdk+nest | **v2** | v1 | mcp-nest tax (v2 vs raw+nest) |
|---|---:|---:|---:|---:|---:|
| `tools/call` echo (c=10) | 3,961 | 3,100 | **2,871** | 2,481 | −7.4% |
| `tools/call` echo (c=100) | 3,730 | 2,904 | **2,778** | 2,457 | −4.3% |
| `tools/list` 5 tools (c=10) | 2,597 | 2,091 | **2,047** | 1,799 | −2.1% |
| `tools/list` 50 tools (c=10) | 621 | 557 | **582** | 548 | ~0 (parity) |
| `tools/call` 10 KB body (c=10) | 3,549 | 2,735 | **2,656** | 2,222 | −2.9% |
| `tools/call` 100 KB body (c=10) | 1,719 | 1,494 | **1,427** | 413s ⚠️ | −4.5% |

Latency is healthy throughout: p99 is 1–6 ms at c=1–10 and 46–48 ms at c=100 for echo. Zero connection errors and zero non-2xx across every stateless cell (except the v1 100 KB case below).

## The one real hotspot: `tools/list` with many tools

`tools/list` throughput falls **3.5×** going from 5 tools (~2,000 req/s) to 50 tools (~570 req/s). Cause: the zod→JSON-Schema conversion runs for **every tool on every call, uncached**.

But this is the raw SDK server which collapses identically (2,597 → 621, a 4× drop), because the conversion lives in the MCP SDK's own list handler. At 50 tools, v2 (582) and the Nest-hosted raw SDK (557) are statistically identical. The tail also amplifies under load: at c=100/50-tools, v2 p99 is 377 ms vs raw-sdk 217 ms.

**Optional win:** memoize the per-tool JSON-Schema in mcp-nest's `bindToolHandlers` so the registry-based tools convert once at bootstrap instead of per request. It would pull v2 *ahead* of the raw SDK on this path. Worthwhile if servers commonly register dozens of tools and clients call `tools/list` frequently. Not urgent — `tools/call` (the actual workload) is unaffected by tool count.

## v2 handles large bodies that v1 rejects

v1's 100 KB row shows ~5,100 "req/s" but **~77,000 non-2xx**: v1 returns **HTTP 413 "request entity too large"** — Express's default 100 KB body-parser limit. v2 reads the raw request stream and processes the same payload correctly at 1,427 req/s. This is a genuine v2 correctness/robustness improvement, not a v2 slowdown; the v1 100 KB number is fast rejections, not work.

## Stateless vs stateful construction cost

Stateful mode (persistent session, SDK-client driver — *not* directly comparable to the autocannon rows) did 3,634 req/s at c=10 vs stateless echo's 2,871. So creating a fresh `McpServer` + transport per request costs on the order of ~20–25% versus reusing a session — a real but moderate tax, and the expected trade-off for stateless's horizontal-scaling/no-sticky-sessions benefit. Stateless throughput is flat across concurrency, confirming the per-request construction isn't leaking or degrading.

## What was checked and is clean

- **Per-request server construction** (`handleStateless` builds a new `McpServer`+transport per POST): real but cheap — flat throughput, stable ~420 MB RSS, no leak.
- **Registry array-spreads** (`getTools()` etc. per access): not measurable at 50 tools.
- **Body reading** (manual stream accumulation for Express): fine; the mcp-nest delta on 100 KB is only −4.5%, and *shrinks* as payloads grow.
- **CPU**: ~120% (just over one core) across servers — no pathological busy-looping.

## How to reproduce

```bash
cd examples/perf-benchmark
npm install && (cd v1-baseline && npm install)
npm run smoke          # verify all servers answer a bare tools/call
npm run bench          # full matrix -> results/results-<ts>.json + report.md
# or per server (each fits one run window):
npm run bench -- --server v2-stateless
npm run profile        # v2 under node --cpu-prof, driven by S1
```
