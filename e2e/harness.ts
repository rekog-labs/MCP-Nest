/**
 * Shared harness for the example e2e tests.
 *
 * Each test boots one `examples/<name>` project as a real child process (via its
 * own `start` script) and drives it with a PINNED, intentionally-old MCP client
 * (`@modelcontextprotocol/sdk@1.10.0`, the floor of @rekog/mcp-nest's supported
 * peer range). The client version is frozen in this project's package.json so it
 * does NOT move when the workspace/examples upgrade their server-side SDK. That's
 * the whole point: if a server-side SDK bump (e.g. the v1 -> v2 migration) breaks
 * a client that real users still run, these tests go red.
 *
 * The example server's SDK, by contrast, is whatever the example resolves at
 * install time (published `@rekog/mcp-nest` on `main`, the local `file:` build on
 * the v2 branch). So: static client + moving server = backward-compat guard.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const EXAMPLES_DIR = resolve(import.meta.dir, '..', 'examples');

/** Ask the OS for a free TCP port. */
export function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolvePort(port));
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveReady, reject) => {
    const attempt = () => {
      const sock = connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolveReady();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`server did not open port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

/**
 * Ensure an example's `node_modules` matches the source it currently declares in
 * package.json, so switching between LOCAL and PUBLISHED is just a package.json
 * flip (`npm run examples:local` / `examples:published`) followed by a test run:
 *
 *   - declared `file:...`  -> LOCAL: node_modules/@rekog/mcp-nest is a symlink
 *   - declared a version    -> PUBLISHED: node_modules/@rekog/mcp-nest is a real dir
 *
 * We only reinstall when the installed state doesn't already match, so repeated
 * runs in the same mode are fast.
 */
function reconcileInstall(dir: string, name: string): void {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const declared: string = pkg.dependencies?.['@rekog/mcp-nest'] ?? '';
  const wantLocal = declared.startsWith('file:');

  const linkPath = join(dir, 'node_modules', '@rekog', 'mcp-nest');
  let state: 'missing' | 'local' | 'published' = 'missing';
  if (existsSync(linkPath)) {
    state = lstatSync(linkPath).isSymbolicLink() ? 'local' : 'published';
  }

  const matches = wantLocal ? state === 'local' : state === 'published';
  if (matches) return;

  if (wantLocal && !existsSync(join(EXAMPLES_DIR, '..', 'packages', 'mcp-nest', 'dist'))) {
    throw new Error(
      `example "${name}" is set to LOCAL (file:) but packages/mcp-nest/dist is missing.\n` +
        `Build the workspace first:  bun run build`,
    );
  }

  // Fresh install so a mode switch can't leave a stale @rekog/mcp-nest behind.
  //
  // The lockfile MUST go too. It records a registry resolution for
  // @rekog/mcp-nest from whenever the example was last installed in PUBLISHED
  // mode, and npm honours that entry over the `file:` spec in package.json —
  // so `examples:local` would flip package.json while the install silently kept
  // serving the published tarball, and this whole suite would test a package
  // that isn't the one being built. Lockfiles here are gitignored, so dropping
  // them costs nothing.
  //
  // `--install-links=false` forces the symlink that `state` above detects.
  // npm 9 defaults `install-links=true`, which COPIES a `file:` dep into
  // node_modules; that copy is indistinguishable from a published install by
  // the lstat check, so every run would look like a mismatch and reinstall.
  rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
  rmSync(join(dir, 'package-lock.json'), { force: true });
  const install = spawnSync(
    'npm',
    ['install', '--no-audit', '--no-fund', '--install-links=false'],
    { cwd: dir, stdio: 'inherit' },
  );
  if (install.status !== 0) {
    throw new Error(`npm install failed for example "${name}"`);
  }
}

export interface RunningExample {
  port: number;
  url: string;
  /** Collected stdout+stderr, for surfacing on failure. */
  output(): string;
  stop(): Promise<void>;
}

/**
 * Boot an example server on `port` and resolve once it is accepting connections.
 * Reconciles the example's install to its declared source (local/published) first.
 */
export async function startExample(
  name: string,
  port: number,
  opts: {
    endpoint?: string;
    readyTimeoutMs?: number;
    /** Extra env for the server process, e.g. `{ MCP_FAKE_AUTH: '1' }`. */
    env?: Record<string, string>;
    /**
     * Override the launch command (still forced to transpile-only). Use when the
     * example's `start` script isn't a plain `ts-node-dev ... src/main.ts`, e.g.
     * `server-examples`, which has several `src/main-*.ts` entries.
     */
    startCommand?: string;
  } = {},
): Promise<RunningExample> {
  const dir = join(EXAMPLES_DIR, name);
  if (!existsSync(dir)) {
    throw new Error(`example not found: ${dir}`);
  }
  reconcileInstall(dir, name);

  // Run the example's own `start` script, but force ts-node into transpile-only
  // mode. When an example is linked to the LOCAL workspace build (file: dep), the
  // symlinked package pulls @nestjs/* from the workspace root while the example's
  // own source pulls it from its own node_modules — two identical-but-distinct
  // copies that ts-node's type-checker rejects. That's a linking artifact, not a
  // product bug; we only care about runtime behavior here, so skip type-checking.
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const startScript: string =
    opts.startCommand ?? pkg.scripts?.start ?? 'ts-node-dev --respawn src/main.ts';
  const command = startScript.replace(/\bts-node-dev\b/, 'ts-node-dev --transpile-only');

  let buffer = '';
  const child: ChildProcess = spawn(command, {
    cwd: dir,
    shell: true,
    env: {
      ...process.env,
      ...opts.env,
      PORT: String(port),
      PATH: `${join(dir, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    },
    detached: true, // become a process-group leader so we can kill the whole tree
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (buffer += d.toString()));
  child.stderr?.on('data', (d) => (buffer += d.toString()));

  const endpoint = opts.endpoint ?? '/mcp';
  const running: RunningExample = {
    port,
    url: `http://127.0.0.1:${port}${endpoint}`,
    output: () => buffer,
    stop: () =>
      new Promise<void>((resolveStop) => {
        if (child.pid === undefined || child.exitCode !== null) {
          resolveStop();
          return;
        }
        child.once('exit', () => resolveStop());
        try {
          process.kill(-child.pid, 'SIGKILL'); // negative pid = kill the group
        } catch {
          resolveStop();
        }
      }),
  };

  try {
    await waitForPort(port, opts.readyTimeoutMs ?? 60_000);
  } catch (err) {
    await running.stop();
    throw new Error(`${(err as Error).message}\n--- server output ---\n${buffer}`);
  }
  return running;
}

/**
 * Connect a pinned-old MCP client over Streamable HTTP, retrying briefly to
 * absorb the gap between "port open" and "route mounted".
 *
 * NOTE: 1.10.0 predates elicitation, so this client cannot drive the
 * `greet-user-interactive` tool — that's intentional. It represents a real
 * old client in the wild, and newer server features must degrade gracefully.
 */
export async function createLegacyClient(
  url: string,
  opts: { requestInit?: RequestInit } = {},
): Promise<Client> {
  const client = new Client(
    { name: 'legacy-e2e-client', version: '1.10.0' },
    { capabilities: {} },
  );

  let lastErr: unknown;
  for (let i = 0; i < 25; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: opts.requestInit,
      });
      await client.connect(transport);
      return client;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`could not connect legacy client to ${url}: ${String(lastErr)}`);
}

// ---------------------------------------------------------------------------
// Dual-era driving
// ---------------------------------------------------------------------------

/**
 * The protocol eras an example server is expected to serve.
 *
 * `legacy` — the pinned `@modelcontextprotocol/sdk@1.10.0` client: `initialize`
 * handshake, sessions, the 2025 wire.
 * `modern`  — `@modelcontextprotocol/client` pinned to revision 2026-07-28: no
 * handshake, no sessions, per-request `_meta` envelope.
 *
 * These are two DIFFERENT npm packages, deliberately. The old one stays frozen
 * at the floor of our supported peer range no matter where the modern one goes.
 */
export const ERAS = ['legacy', 'modern'] as const;
export type Era = (typeof ERAS)[number];

/** The protocol revision the modern client pins. Not exported by the SDK. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/**
 * The slice of MCP both client packages can serve, behind one shape.
 *
 * The two clients differ in API, not just protocol — `callTool` takes
 * `(params, resultSchema, options)` on 1.10.0 and `(params, options)` on the v2
 * client, and the v2 client has no raw `request()` at all. Normalising here is
 * what lets a single test body run against both eras unchanged; without it,
 * every dual-era test would be a pile of `if (era === ...)`.
 */
export interface EraClient {
  era: Era;
  listTools(): Promise<{ tools: any[] }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    opts?: { onprogress?: (p: any) => void },
  ): Promise<any>;
  /**
   * `tools/call` as it appears on the wire, bypassing the old client's strict
   * result parsing (which strips unknown keys like `structuredContent`).
   */
  callToolWire(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<any>;
  listResources(): Promise<{ resources: any[] }>;
  listResourceTemplates(): Promise<{ resourceTemplates: any[] }>;
  readResource(params: { uri: string }): Promise<any>;
  listPrompts(): Promise<{ prompts: any[] }>;
  getPrompt(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<any>;
  getServerVersion(): { name?: string; title?: string; version?: string } | undefined;
  getInstructions(): string | undefined;
  close(): Promise<void>;
  /** Escape hatch to the underlying client for era-specific assertions. */
  raw: any;
}

/** Permissive schema: read the raw wire result without 1.10.0's strict parsing. */
const PASSTHROUGH = { parse: (v: unknown) => v } as any;

function wrapLegacy(client: Client): EraClient {
  return {
    era: 'legacy',
    raw: client,
    listTools: () => client.listTools() as any,
    callTool: (params, opts) =>
      client.callTool(params, undefined, opts as any) as any,
    callToolWire: (params) =>
      client.request({ method: 'tools/call', params } as any, PASSTHROUGH) as any,
    listResources: () => client.listResources() as any,
    listResourceTemplates: () => client.listResourceTemplates() as any,
    readResource: (params) => client.readResource(params) as any,
    listPrompts: () => client.listPrompts() as any,
    getPrompt: (params) => client.getPrompt(params) as any,
    getServerVersion: () => client.getServerVersion() as any,
    getInstructions: () => client.getInstructions(),
    close: () => client.close(),
  };
}

function wrapModern(client: any): EraClient {
  return {
    era: 'modern',
    raw: client,
    listTools: () => client.listTools(),
    callTool: (params, opts) => client.callTool(params, opts),
    // The v2 client already returns the unparsed result, `structuredContent`
    // included, so the raw-wire escape hatch is just `callTool`.
    callToolWire: (params) => client.callTool(params),
    listResources: () => client.listResources(),
    listResourceTemplates: () => client.listResourceTemplates(),
    readResource: (params) => client.readResource(params),
    listPrompts: () => client.listPrompts(),
    getPrompt: (params) => client.getPrompt(params),
    getServerVersion: () => client.getServerVersion(),
    getInstructions: () => client.getInstructions(),
    close: () => client.close(),
  };
}

/**
 * Connect a modern (2026-07-28) client, retrying briefly like the legacy one.
 *
 * Pinned rather than `mode: 'auto'` on purpose: `auto` probes and silently
 * falls back to `initialize`, so a server that lost its modern leg would still
 * go green here. Pinning makes that a hard failure, which is the entire point
 * of running this tier.
 */
export async function createModernClient(
  url: string,
  opts: { requestInit?: RequestInit } = {},
): Promise<EraClient> {
  const { Client: ModernClient, StreamableHTTPClientTransport: ModernTransport } =
    await import('@modelcontextprotocol/client');

  let lastErr: unknown;
  for (let i = 0; i < 25; i++) {
    const client = new ModernClient(
      { name: 'modern-e2e-client', version: '2.0.0' },
      { versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } } },
    );
    try {
      await client.connect(
        new ModernTransport(new URL(url), { requestInit: opts.requestInit }),
      );
      return wrapModern(client);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`could not connect modern client to ${url}: ${String(lastErr)}`);
}

/** Connect whichever client the era calls for, behind the common shape. */
export async function createEraClient(
  era: Era,
  url: string,
  opts: { requestInit?: RequestInit } = {},
): Promise<EraClient> {
  return era === 'legacy'
    ? wrapLegacy(await createLegacyClient(url, opts))
    : createModernClient(url, opts);
}
