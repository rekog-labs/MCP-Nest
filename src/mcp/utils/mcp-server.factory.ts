import { McpOptions } from '../interfaces';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildMcpCapabilities } from './capabilities-builder';
import { McpRegistryService } from '../services/mcp-registry.service';
import { Logger } from '@nestjs/common';

export function createMcpServer(
  mcpModuleId: string,
  registry: McpRegistryService,
  options: McpOptions,
  logger: Logger,
): McpServer {
  const capabilities = buildMcpCapabilities(mcpModuleId, registry, options);

  logger.debug('Built MCP capabilities:', capabilities);

  const mcpServer = new McpServer(
    { name: options.name, version: options.version },
    {
      capabilities,
      instructions: options.instructions || '',
    },
  );

  return options.serverMutator ? options.serverMutator(mcpServer) : mcpServer;
}
