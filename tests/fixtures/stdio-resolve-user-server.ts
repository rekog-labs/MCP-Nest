/**
 * A stdio server with a `resolveUser` that must never run.
 *
 * `resolveUser` answers "where does per-tool authorization read the caller
 * from", and stdio has no request to read one off. The resolver here counts its
 * own calls and would return a principal holding `reports:read`, so the test can
 * tell the two failure modes apart: a resolver invoked with no request at all
 * (`resolverCalls > 0`), and a scoped tool wrongly opened by it.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  StdioTransport,
  Tool,
  ToolScopes,
} from '@rekog/mcp-nest';

let resolverCalls = 0;

@McpController()
class StdioCaller {
  @Tool({
    name: 'resolver-calls',
    description: 'How often resolveUser ran',
    parameters: z.object({}),
  })
  calls() {
    return {
      content: [{ type: 'text', text: JSON.stringify({ resolverCalls }) }],
    };
  }

  @Tool({
    name: 'scoped',
    description: 'Requires a scope nobody can hold over stdio',
    parameters: z.object({}),
  })
  @ToolScopes(['reports:read'])
  scoped() {
    return { content: [{ type: 'text', text: 'scoped' }] };
  }
}

// stdout is reserved for the MCP protocol over stdio, so all logging is disabled.
const strategy = new McpStrategy({
  name: 'stdio-resolve-user-fixture',
  version: '0.0.1',
  logging: false,
  resolveUser: () => {
    resolverCalls += 1;
    return { scopes: ['reports:read'] };
  },
  transports: [new StdioTransport()],
});

@Module({ controllers: [StdioCaller] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy,
    logger: false,
  });
  await app.listen();
}

void bootstrap();
