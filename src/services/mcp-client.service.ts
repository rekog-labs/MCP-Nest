import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryService } from '../transport/in-memory.service';

/**
 * Service that provides access to the MCP client.
 * This service can be injected in other modules to get access to the MCP client.
 */
@Injectable()
export class McpClientService {
  constructor(private readonly inMemoryService: InMemoryService) {}

  /**
   * Get the MCP client instance.
   * @returns The MCP client instance
   * @throws Error if the client is not initialized or transport isn't IN_MEMORY
   */
  getClient(): Client {
    if (!this.inMemoryService) {
      throw new Error(
        'InMemoryService is not available. Make sure the transport includes IN_MEMORY and McpModule is properly imported.',
      );
    }
    return this.inMemoryService.client;
  }
}
