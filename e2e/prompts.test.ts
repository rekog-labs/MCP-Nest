/**
 * e2e for `examples/prompts` — verifies the behaviors documented in docs/prompts.md
 * against a real, spawned example server, driven by a pinned old MCP client.
 *
 * Run:  bun test prompts.test.ts        (from the e2e/ directory)
 *
 * Green on `main` = an old (1.10.0) client fully interoperates with the current
 * server. If the v1->v2 SDK migration (or any future server change) breaks that,
 * one of these assertions fails and names exactly what regressed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 90_000;

let server: RunningExample;
let client: Client;

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('prompts', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/prompts e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('prompts/list advertises every documented prompt with argument schemas', async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        'multilingual-greeting-guide',
        'code-review-guide',
        'interview-guide',
        'task-planner',
        'image-content-demo',
      ].sort(),
    );

    const greeting = prompts.find((p) => p.name === 'multilingual-greeting-guide');
    expect(greeting?.description).toBe(
      'Simple instruction for greeting users in their native languages',
    );
    expect(greeting?.arguments).toEqual([
      { name: 'name', description: 'The name of the person to greet', required: true },
      { name: 'language', description: 'The language to use for the greeting', required: true },
    ]);

    const codeReview = prompts.find((p) => p.name === 'code-review-guide');
    expect(codeReview?.arguments?.map((a) => a.name).sort()).toEqual(
      ['codeLanguage', 'focusArea'].sort(),
    );

    const taskPlanner = prompts.find((p) => p.name === 'task-planner');
    expect(taskPlanner?.arguments?.map((a) => a.name).sort()).toEqual(
      ['task', 'complexity'].sort(),
    );

    const imageDemo = prompts.find((p) => p.name === 'image-content-demo');
    expect(imageDemo?.arguments ?? []).toEqual([]);
  });

  test('basic prompt interpolates arguments into a single user message', async () => {
    const res = await client.getPrompt({
      name: 'multilingual-greeting-guide',
      arguments: { name: 'Alice', language: 'es' },
    });
    expect(res.description).toBe('Greet users in their native languages!');
    expect(res.messages).toEqual([
      {
        role: 'user',
        content: {
          type: 'text',
          text: 'Greet Alice in their preferred language: es',
        },
      },
    ]);
  });

  test('code-review-guide exercises both assistant and user roles', async () => {
    const res = await client.getPrompt({
      name: 'code-review-guide',
      arguments: { codeLanguage: 'Python', focusArea: 'security' },
    });
    expect(res.description).toBe('Guide for conducting thorough code reviews');
    expect(res.messages).toEqual([
      {
        role: 'assistant',
        content: { type: 'text', text: 'You are an expert Python code reviewer.' },
      },
      {
        role: 'user',
        content: { type: 'text', text: 'Please review this code focusing on: security' },
      },
    ]);
  });

  test('interview-guide returns a multi-turn conversation', async () => {
    const res = await client.getPrompt({
      name: 'interview-guide',
      arguments: { role: 'Engineer', experience: '5' },
    });
    expect(res.description).toBe('Interview guide for Engineer position');
    expect(res.messages).toEqual([
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: 'You are conducting a technical interview. Be thorough but encouraging.',
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: "Hello! I understand you're applying for a Engineer position with 5 years of experience.",
        },
      },
      {
        role: 'user',
        content: {
          type: 'text',
          text: "Yes, that's correct. I'm excited to discuss the role.",
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: "Great! Let's start with some technical questions relevant to your experience level.",
        },
      },
    ]);
  });

  test('task-planner branches on complexity (dynamic prompt)', async () => {
    const medium = await client.getPrompt({
      name: 'task-planner',
      arguments: { task: 'Write docs', complexity: 'medium' },
    });
    expect(medium.description).toBe('Task planning for medium task');
    expect(medium.messages[1]).toEqual({
      role: 'user',
      content: {
        type: 'text',
        text: 'Plan the following task: Write docs\n\nBreak it down into clear phases with dependencies.',
      },
    });

    const complex = await client.getPrompt({
      name: 'task-planner',
      arguments: { task: 'Launch product', complexity: 'complex' },
    });
    expect(complex.description).toBe('Task planning for complex task');
    expect(complex.messages[1]).toEqual({
      role: 'user',
      content: {
        type: 'text',
        text: 'Plan the following task: Launch product\n\nCreate a detailed plan with milestones, risks, and alternatives.',
      },
    });
  });

  test('image-content-demo returns an image content block', async () => {
    const res = await client.getPrompt({ name: 'image-content-demo', arguments: {} });
    expect(res.description).toBe('Prompt message using image content');
    expect(res.messages).toEqual([
      {
        role: 'user',
        content: {
          type: 'image',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          mimeType: 'image/png',
        },
      },
    ]);
  });

  test('getPrompt for an unknown prompt name rejects', async () => {
    await expect(client.getPrompt({ name: 'does-not-exist' })).rejects.toThrow();
  });
});
