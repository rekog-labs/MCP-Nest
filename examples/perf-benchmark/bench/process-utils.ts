import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { ServerSpec } from './types';

const READY_POLL_INTERVAL_MS = 250;
const READY_TIMEOUT_MS = 60_000;
const KILL_POLL_INTERVAL_MS = 250;
const KILL_ESCALATE_MS = 5_000;

export interface StartedServer {
  pid: number;
  kill: () => Promise<void>;
}

function tailLog(logFile: string, maxChars = 4000): string {
  try {
    const content = fs.readFileSync(logFile, 'utf8');
    return content.length > maxChars ? content.slice(-maxChars) : content;
  } catch {
    return '(no log content available)';
  }
}

async function waitForReady(
  url: string,
  proc: ChildProcess,
  logFile: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = false;
  let exitInfo = '';
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exited = true;
    exitInfo = `code=${code} signal=${signal}`;
  };
  proc.once('exit', onExit);
  try {
    while (Date.now() < deadline) {
      if (exited) {
        throw new Error(
          `Server process exited before becoming ready (${exitInfo}). Log tail:\n${tailLog(
            logFile,
          )}`,
        );
      }
      try {
        await fetch(url);
        return;
      } catch {
        // connection refused / not listening yet - retry
      }
      await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
    }
    throw new Error(
      `Server did not become ready at ${url} within ${READY_TIMEOUT_MS}ms. Log tail:\n${tailLog(
        logFile,
      )}`,
    );
  } finally {
    proc.off('exit', onExit);
  }
}

async function waitForPortRelease(url: string): Promise<void> {
  const deadline = Date.now() + KILL_ESCALATE_MS + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, KILL_POLL_INTERVAL_MS));
  }
}

/**
 * Walks /proc (Linux) to find all descendant PIDs of rootPid (including rootPid
 * itself). Used because `npx ts-node ...` forks child processes, and pidusage
 * needs to sample the actual node process(es) doing work.
 */
export async function resolveServerPids(rootPid: number): Promise<number[]> {
  const all = new Set<number>([rootPid]);
  const toVisit = [rootPid];

  while (toVisit.length > 0) {
    const parent = toVisit.pop()!;
    let children: number[] = [];
    try {
      children = await childPidsOf(parent);
    } catch {
      children = [];
    }
    for (const child of children) {
      if (!all.has(child)) {
        all.add(child);
        toVisit.push(child);
      }
    }
  }

  return Array.from(all);
}

function childPidsOf(parentPid: number): Promise<number[]> {
  return new Promise((resolve) => {
    // ps -o pid= --ppid <pid> lists direct children; works on Linux.
    const proc = spawn('ps', ['-o', 'pid=', '--ppid', String(parentPid)]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      const pids = out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n));
      resolve(pids);
    });
    proc.on('error', () => resolve([]));
  });
}

export async function startServer(
  spec: ServerSpec,
  opts: { toolCount: number; logDir: string; extraNodeArgs?: string[] },
): Promise<StartedServer> {
  fs.mkdirSync(opts.logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(opts.logDir, `${spec.id}-${timestamp}.log`);
  const logFd = fs.openSync(logFile, 'a');

  const proc = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: {
      ...process.env,
      ...spec.env,
      PORT: String(spec.port),
      TOOL_COUNT: String(opts.toolCount),
      NODE_ENV: 'production',
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });

  // fd is duplicated by the child; safe to close our copy once spawned.
  fs.closeSync(logFd);

  if (!proc.pid) {
    throw new Error(`Failed to spawn server ${spec.id}: no pid assigned`);
  }
  const pid = proc.pid;

  const url = `http://127.0.0.1:${spec.port}${spec.endpoint}`;

  try {
    await waitForReady(url, proc, logFile);
  } catch (err) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already dead
    }
    throw err;
  }

  const kill = async (): Promise<void> => {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // already dead
      return;
    }

    const graceDeadline = Date.now() + KILL_ESCALATE_MS;
    let released = false;
    while (Date.now() < graceDeadline) {
      try {
        await fetch(url);
      } catch {
        released = true;
        break;
      }
      await new Promise((r) => setTimeout(r, KILL_POLL_INTERVAL_MS));
    }

    if (!released) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // already dead
      }
      await waitForPortRelease(url);
    }
  };

  return { pid, kill };
}
