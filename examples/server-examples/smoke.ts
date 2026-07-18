import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

// All server variants are started on the same port so the client URL is stable.
// We tear each server down and wait for the port to release before the next one.
const PORT = process.env.SMOKE_PORT ?? '3030';
const URL_STR = `http://localhost:${PORT}/mcp`;

async function waitForServer(proc: ChildProcess): Promise<void> {
  let exited = false;
  let exitInfo = '';
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exited = true;
    exitInfo = `code=${code} signal=${signal}`;
  };
  proc.once('exit', onExit);
  try {
    for (let i = 0; i < 60; i++) {
      if (exited) {
        throw new Error(
          `Server process exited before becoming reachable (${exitInfo})`,
        );
      }
      try {
        await fetch(URL_STR);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error(`Server did not become reachable at ${URL_STR}`);
  } finally {
    proc.off('exit', onExit);
  }
}

async function waitForPortRelease(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(URL_STR);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Port ${PORT} did not release in time`);
}

async function startServer(
  file: string,
  env: NodeJS.ProcessEnv = {},
): Promise<ChildProcess> {
  // Resolve "@rekog/mcp-nest" from node_modules -> the installed/published
  // package. That is the whole point of the smoke test: verify the artifact
  // that npm ships actually boots and serves MCP.
  const proc = spawn('npx', ['ts-node', file], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    env: { ...process.env, PORT, ...env },
  });
  await waitForServer(proc);
  return proc;
}

async function stopServer(proc: ChildProcess): Promise<void> {
  if (proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      // already dead
    }
  }
  await waitForPortRelease();
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'smoke', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(URL_STR));
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function getText(content: unknown): string {
  assert.ok(Array.isArray(content), 'tool result content is not an array');
  const first = content[0] as { type?: string; text?: string };
  assert.equal(first?.type, 'text', 'first content block is not text');
  assert.equal(typeof first.text, 'string', 'text field missing');
  return first.text as string;
}

void test('main-stateless: greet-user is listed and returns the expected greeting', async () => {
  const proc = await startServer('./src/main-stateless.ts');
  try {
    await withClient(async (client) => {
      const tools = await client.listTools();
      assert.ok(
        tools.tools.some((t) => t.name === 'greet-user'),
        'greet-user not present in tools/list',
      );

      const result = await client.callTool({
        name: 'greet-user',
        arguments: { name: 'World', language: 'en' },
      });

      assert.notEqual(result.isError, true, 'greet-user returned isError');
      assert.equal(getText(result.content), 'Hey, World!');
    });
  } finally {
    await stopServer(proc);
  }
});

void test('main-async: awaited async config resolves the server name into the running server', async () => {
  const proc = await startServer('./src/main-async.ts');
  try {
    await withClient(async (client) => {
      // main-async.ts awaits loadConfig() before constructing the strategy.
      // If that async path had not run, the server would never report this
      // implementation name over the initialize handshake.
      const serverInfo = client.getServerVersion();
      assert.equal(
        serverInfo?.name,
        'async-mcp-server',
        `server name should reflect the async config (got ${serverInfo?.name})`,
      );

      const result = await client.callTool({
        name: 'greet-user',
        arguments: { name: 'World', language: 'en' },
      });
      assert.notEqual(result.isError, true, 'greet-user returned isError');
      assert.equal(getText(result.content), 'Hey, World!');
    });
  } finally {
    await stopServer(proc);
  }
});

void test('main-fastify: tool call succeeds over the Fastify adapter', async () => {
  const proc = await startServer('./src/main-fastify.ts');
  try {
    await withClient(async (client) => {
      const tools = await client.listTools();
      assert.ok(
        tools.tools.some((t) => t.name === 'greet-user'),
        'greet-user not present in tools/list',
      );

      const result = await client.callTool({
        name: 'greet-user',
        arguments: { name: 'World', language: 'fr' },
      });

      assert.notEqual(result.isError, true, 'greet-user returned isError');
      assert.equal(getText(result.content), 'Salut, World!');
    });
  } finally {
    await stopServer(proc);
  }
});
