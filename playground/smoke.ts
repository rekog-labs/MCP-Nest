import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const URL_STR = 'http://localhost:3030/mcp';

async function waitForServer(proc: ChildProcess): Promise<void> {
  let exited = false;
  let exitInfo = '';
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exited = true;
    exitInfo = `code=${code} signal=${signal}`;
  };
  proc.once('exit', onExit);
  try {
    for (let i = 0; i < 30; i++) {
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
  throw new Error('Port 3030 did not release in time');
}

async function startServer(
  file: string,
  env: NodeJS.ProcessEnv = {},
): Promise<ChildProcess> {
  // When TS_NODE_PROJECT is set (smoke:local), pass through tsconfig-paths so
  // the spawned ts-node resolves "@rekog/mcp-nest" to live ../src/index.ts.
  // In CI (smoke), TS_NODE_PROJECT is unset and resolution falls through to
  // node_modules → the installed package.
  const tsNodeArgs = ['ts-node'];
  if (process.env.TS_NODE_PROJECT) {
    tsNodeArgs.push('-r', 'tsconfig-paths/register');
  }
  tsNodeArgs.push(file);

  const proc = spawn('npx', tsNodeArgs, {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    env: { ...process.env, ...env },
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

void test('server-stateless: greet-world returns expected greeting', async () => {
  const proc = await startServer('./servers/server-stateless.ts');
  try {
    await withClient(async (client) => {
      const tools = await client.listTools();
      assert.ok(
        tools.tools.some((t) => t.name === 'greet-world'),
        'greet-world not present in tools/list',
      );

      const result = await client.callTool({
        name: 'greet-world',
        arguments: {},
      });

      assert.notEqual(result.isError, true, 'greet-world returned isError');
      assert.equal(getText(result.content), '"Hello, World!"');
    });
  } finally {
    await stopServer(proc);
  }
});

void test('server-stateless-async: forRootAsync resolves options through useFactory into the running server', async () => {
  const expectedName = 'async-smoke-server';
  const proc = await startServer('./servers/server-stateless-async.ts', {
    MCP_NAME: expectedName,
  });
  try {
    await withClient(async (client) => {
      // Assert the async factory actually resolved MCP_NAME from env into the
      // server's MCP Implementation. If forRootAsync's useFactory hadn't run,
      // the server would report the hardcoded default instead.
      const serverInfo = client.getServerVersion();
      assert.equal(
        serverInfo?.name,
        expectedName,
        `server name should reflect MCP_NAME override (got ${serverInfo?.name})`,
      );

      const tools = await client.listTools();
      assert.ok(
        tools.tools.some((t) => t.name === 'greet-world'),
        'greet-world not present in tools/list',
      );

      const result = await client.callTool({
        name: 'greet-world',
        arguments: {},
      });

      assert.notEqual(result.isError, true, 'greet-world returned isError');
      assert.equal(getText(result.content), '"Hello, World!"');
    });
  } finally {
    await stopServer(proc);
  }
});

void test('server-stateful-fastify: hello-world exercises DI through MockUserRepository', async () => {
  const proc = await startServer('./servers/server-stateful-fastify.ts');
  try {
    await withClient(async (client) => {
      const tools = await client.listTools();
      assert.ok(
        tools.tools.some((t) => t.name === 'hello-world'),
        'hello-world not present in tools/list',
      );

      const result = await client.callTool({
        name: 'hello-world',
        arguments: { name: 'World' },
      });

      assert.notEqual(
        result.isError,
        true,
        'hello-world returned isError (DI likely broken)',
      );
      // "Repository User Name" can only appear if MockUserRepository was injected
      assert.equal(
        getText(result.content),
        'Hello, Repository User Name World! (via Fastify)',
      );
    });
  } finally {
    await stopServer(proc);
  }
});
