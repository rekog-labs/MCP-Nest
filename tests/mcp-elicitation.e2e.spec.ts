import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { McpModule, McpTransportType, Tool } from '../src';
import type { Context } from '../src';
import { McpElicitationModule } from '../src/elicitation/mcp-elicitation.module';
import { ElicitationService } from '../src/elicitation/services/elicitation.service';
import { MemoryElicitationStore } from '../src/elicitation/stores/memory-elicitation.store';
import type { IElicitationStore } from '../src/elicitation/interfaces/elicitation-store.interface';
import { createSseClient, createStreamableClient } from './utils';
import { randomUUID } from 'crypto';

/**
 * Custom store that wraps MemoryElicitationStore for testing.
 * Ensures we can track and verify store operations.
 */
@Injectable()
class TestElicitationStore extends MemoryElicitationStore implements IElicitationStore {}

/**
 * Tool that demonstrates URL elicitation for API key collection.
 */
@Injectable()
class ApiKeyTool {
  @Tool({
    name: 'connect-external-service',
    description: 'Connect to an external service (requires API key)',
    parameters: z.object({
      service: z.string().describe('Service name'),
    }),
  })
  async connectService({ service }, context: Context) {
    // Check if elicitation is available
    if (!context.elicitation) {
      return {
        content: [
          {
            type: 'text',
            text: 'Elicitation module not configured',
          },
        ],
      };
    }

    // Check if client supports URL elicitation
    if (!context.elicitation.isSupported()) {
      return {
        content: [
          {
            type: 'text',
            text: 'URL elicitation is not supported by this client',
          },
        ],
      };
    }

    // Create URL elicitation for API key
    const { elicitationId, url } = await context.elicitation.createUrl({
      message: `Please enter your ${service} API key`,
      path: 'api-key',
      metadata: {
        type: `api-key-${service}`,
        service,
        fieldLabel: `${service} API Key`,
      },
    });

    // Throw the required error to signal client
    context.elicitation.throwRequired([
      {
        mode: 'url',
        message: `Please enter your ${service} API key`,
        url,
        elicitationId,
      },
    ]);
  }
}

/**
 * Tool that demonstrates URL elicitation for confirmation.
 */
@Injectable()
class ConfirmationTool {
  @Tool({
    name: 'delete-account',
    description: 'Delete user account (requires confirmation)',
    parameters: z.object({}),
  })
  async deleteAccount(_, context: Context) {
    // Check if elicitation is available
    if (!context.elicitation) {
      return {
        content: [{ type: 'text', text: 'Elicitation module not configured' }],
      };
    }

    // Check if client supports URL elicitation
    if (!context.elicitation.isSupported()) {
      return {
        content: [
          { type: 'text', text: 'URL elicitation is not supported by this client' },
        ],
      };
    }

    // Create URL elicitation for confirmation
    const { elicitationId, url } = await context.elicitation.createUrl({
      message: 'Are you sure you want to delete your account?',
      path: 'confirm',
      metadata: {
        type: 'delete-account-confirmation',
        title: 'Delete Account',
        warning: 'This action cannot be undone',
      },
    });

    // Throw the required error to signal client
    context.elicitation.throwRequired([
      {
        mode: 'url',
        message: 'Please confirm account deletion',
        url,
        elicitationId,
      },
    ]);
  }
}

/**
 * Tool that checks for existing elicitation result.
 */
@Injectable()
class CheckElicitationTool {
  @Tool({
    name: 'check-api-key',
    description: 'Check if an API key has been provided',
    parameters: z.object({
      service: z.string().describe('Service name'),
      userId: z.string().describe('User ID to check'),
    }),
  })
  async checkApiKey({ service, userId }, context: Context) {
    if (!context.elicitation) {
      return {
        content: [{ type: 'text', text: 'Elicitation module not configured' }],
      };
    }

    // Look up existing result
    const result = await context.elicitation.findByUserAndType(
      userId,
      `api-key-${service}`,
    );

    if (result?.success && result.data?.apiKey) {
      return {
        content: [
          {
            type: 'text',
            text: `Found API key for ${service}: ${(result.data.apiKey as string).substring(0, 8)}...`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `No API key found for ${service}`,
        },
      ],
    };
  }
}

describe('E2E: McpElicitationModule', () => {
  let app: INestApplication;
  let testPort: number;
  let elicitationService: ElicitationService;
  let testStore: TestElicitationStore;
  let testServerUrl: string;

  jest.setTimeout(15000);

  beforeAll(async () => {
    // Create a shared store instance
    testStore = new TestElicitationStore();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpElicitationModule.forRoot({
          serverUrl: 'http://localhost:3000', // Will be updated with actual port
          apiPrefix: 'elicit',
          storeConfiguration: {
            type: 'custom',
            store: testStore,
          },
        }),
        McpModule.forRoot({
          name: 'test-elicitation-server',
          version: '0.0.1',
          guards: [],
          streamableHttp: {
            enableJsonResponse: false,
            sessionIdGenerator: () => randomUUID(),
            statelessMode: false,
          },
        }),
      ],
      providers: [ApiKeyTool, ConfirmationTool, CheckElicitationTool],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = (server.address() as import('net').AddressInfo).port;
    testServerUrl = `http://localhost:${testPort}`;
    elicitationService = moduleFixture.get<ElicitationService>(ElicitationService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Elicitation Endpoints', () => {
    describe('GET /:id/status', () => {
      it('should return elicitation status for valid ID', async () => {
        // Create an elicitation directly
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: { type: 'test' },
        });

        const response = await request(app.getHttpServer())
          .get(`/elicit/${elicitationId}/status`)
          .expect(200);

        expect(response.body).toMatchObject({
          elicitationId,
          status: 'pending',
          completed: false,
        });
        expect(response.body.createdAt).toBeDefined();
        expect(response.body.expiresAt).toBeDefined();
      });

      it('should return 404 for invalid elicitation ID', async () => {
        await request(app.getHttpServer())
          .get('/elicit/invalid-id/status')
          .expect(404);
      });
    });

    describe('GET /:id/api-key', () => {
      it('should render API key form for valid elicitation', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: {
            message: 'Enter your API key',
            fieldLabel: 'API Key',
          },
        });

        const response = await request(app.getHttpServer())
          .get(`/elicit/${elicitationId}/api-key`)
          .expect(200);

        expect(response.headers['content-type']).toContain('text/html');
        expect(response.text).toContain('Enter your API key');
        expect(response.text).toContain('API Key');
        expect(response.text).toContain('<form');
      });

      it('should show error for invalid elicitation ID', async () => {
        const response = await request(app.getHttpServer())
          .get('/elicit/invalid-id/api-key')
          .expect(400);

        expect(response.headers['content-type']).toContain('text/html');
        // The error message is 'Elicitation not found or expired'
        expect(response.text.toLowerCase()).toContain('not found');
      });
    });

    describe('POST /:id/api-key', () => {
      it('should accept valid API key submission', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: { type: 'test-api-key' },
        });

        const response = await request(app.getHttpServer())
          .post(`/elicit/${elicitationId}/api-key`)
          .send({ apiKey: 'sk-test-1234567890' })
          .expect(200);

        expect(response.headers['content-type']).toContain('text/html');
        expect(response.text).toContain('API Key Received');

        // Verify the result was stored
        const result = await elicitationService.getResult(elicitationId);
        expect(result).toBeDefined();
        expect(result?.success).toBe(true);
        expect(result?.data?.apiKey).toBe('sk-test-1234567890');
      });

      it('should reject empty API key', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: {},
        });

        const response = await request(app.getHttpServer())
          .post(`/elicit/${elicitationId}/api-key`)
          .send({ apiKey: '' })
          .expect(400);

        expect(response.text).toContain('required');
      });

      it('should reject already completed elicitation', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: {},
        });

        // Complete the elicitation first
        await elicitationService.completeElicitation({
          elicitationId,
          success: true,
          action: 'confirm',
          data: { apiKey: 'first-key' },
        });

        const response = await request(app.getHttpServer())
          .post(`/elicit/${elicitationId}/api-key`)
          .send({ apiKey: 'second-key' })
          .expect(400);

        expect(response.text).toContain('already been completed');
      });
    });

    describe('GET /:id/confirm', () => {
      it('should render confirmation page for valid elicitation', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: {
            title: 'Delete Account',
            message: 'Are you sure?',
            warning: 'This cannot be undone',
          },
        });

        const response = await request(app.getHttpServer())
          .get(`/elicit/${elicitationId}/confirm`)
          .expect(200);

        expect(response.headers['content-type']).toContain('text/html');
        expect(response.text).toContain('Delete Account');
        expect(response.text).toContain('Are you sure?');
        expect(response.text).toContain('cannot be undone');
        expect(response.text).toContain('<form');
      });
    });

    describe('POST /:id/confirm', () => {
      it('should handle confirmation action', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: {},
        });

        const response = await request(app.getHttpServer())
          .post(`/elicit/${elicitationId}/confirm`)
          .send({ action: 'confirm' })
          .expect(200);

        expect(response.headers['content-type']).toContain('text/html');
        expect(response.text).toContain('Confirmed');

        // Verify the result was stored
        const result = await elicitationService.getResult(elicitationId);
        expect(result).toBeDefined();
        expect(result?.success).toBe(true);
        expect(result?.action).toBe('confirm');
      });

      it('should handle cancel action', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: {},
        });

        const response = await request(app.getHttpServer())
          .post(`/elicit/${elicitationId}/confirm`)
          .send({ action: 'cancel' })
          .expect(200);

        expect(response.headers['content-type']).toContain('text/html');
        expect(response.text).toContain('Cancelled');

        // Verify the result was stored
        const result = await elicitationService.getResult(elicitationId);
        expect(result).toBeDefined();
        expect(result?.success).toBe(false);
        expect(result?.action).toBe('cancel');
      });

      it('should reject invalid action', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: {},
        });

        await request(app.getHttpServer())
          .post(`/elicit/${elicitationId}/confirm`)
          .send({ action: 'invalid' })
          .expect(400);
      });
    });
  });

  describe('ElicitationService', () => {
    describe('createElicitation', () => {
      it('should create elicitation with default TTL', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-1',
          userId: 'user-1',
        });

        expect(elicitationId).toBeDefined();
        expect(typeof elicitationId).toBe('string');

        const elicitation = await elicitationService.getElicitation(elicitationId);
        expect(elicitation).toBeDefined();
        expect(elicitation?.status).toBe('pending');
        expect(elicitation?.sessionId).toBe('session-1');
        expect(elicitation?.userId).toBe('user-1');
      });

      it('should create elicitation with metadata', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-2',
          metadata: {
            type: 'api-key-stripe',
            provider: 'stripe',
          },
        });

        const elicitation = await elicitationService.getElicitation(elicitationId);
        expect(elicitation?.metadata?.type).toBe('api-key-stripe');
        expect(elicitation?.metadata?.provider).toBe('stripe');
      });
    });

    describe('buildElicitationUrl', () => {
      // Note: The module was configured with serverUrl='http://localhost:3000' (static)
      // so the URLs will use that base, not the dynamically assigned port
      const configuredServerUrl = 'http://localhost:3000';

      it('should build URL with path', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-url',
        });

        const url = elicitationService.buildElicitationUrl(elicitationId, 'api-key');
        expect(url).toBe(`${configuredServerUrl}/elicit/${elicitationId}/api-key`);
      });

      it('should build URL without path', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-url',
        });

        const url = elicitationService.buildElicitationUrl(elicitationId);
        expect(url).toBe(`${configuredServerUrl}/elicit/${elicitationId}`);
      });

      it('should build URL with query params', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-url',
        });

        const url = elicitationService.buildElicitationUrl(elicitationId, 'api-key', {
          theme: 'dark',
        });
        expect(url).toBe(`${configuredServerUrl}/elicit/${elicitationId}/api-key?theme=dark`);
      });
    });

    describe('completeElicitation', () => {
      it('should complete pending elicitation', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-complete',
          userId: 'user-complete',
          metadata: { type: 'test-type' },
        });

        const success = await elicitationService.completeElicitation({
          elicitationId,
          success: true,
          action: 'confirm',
          data: { key: 'value' },
        });

        // Returns false because no notifier was registered
        expect(success).toBe(false);

        const result = await elicitationService.getResult(elicitationId);
        expect(result).toBeDefined();
        expect(result?.success).toBe(true);
        expect(result?.action).toBe('confirm');
        expect(result?.data?.key).toBe('value');
        expect(result?.userId).toBe('user-complete');
        expect(result?.type).toBe('test-type');
      });

      it('should not complete already completed elicitation', async () => {
        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-double',
        });

        await elicitationService.completeElicitation({
          elicitationId,
          success: true,
          action: 'confirm',
          data: {},
        });

        const success = await elicitationService.completeElicitation({
          elicitationId,
          success: false,
          action: 'cancel',
          data: {},
        });

        expect(success).toBe(false);
      });
    });

    describe('findResultByUserAndType', () => {
      it('should find result by user and type', async () => {
        const userId = `user-${randomUUID()}`;
        const type = 'api-key-github';

        const elicitationId = await elicitationService.createElicitation({
          sessionId: 'session-find',
          userId,
          metadata: { type },
        });

        await elicitationService.completeElicitation({
          elicitationId,
          success: true,
          action: 'confirm',
          data: { apiKey: 'ghp_test123' },
        });

        const result = await elicitationService.findResultByUserAndType(userId, type);
        expect(result).toBeDefined();
        expect(result?.data?.apiKey).toBe('ghp_test123');
      });

      it('should return undefined for non-existent user/type', async () => {
        const result = await elicitationService.findResultByUserAndType(
          'non-existent-user',
          'non-existent-type',
        );
        expect(result).toBeUndefined();
      });
    });
  });

  describe('MCP Client Integration', () => {
    // These tests verify that tools are discoverable and callable.
    // The ElicitationService is lazily resolved via ModuleRef, making it
    // available when McpElicitationModule is imported as a sibling module.

    describe('using http+sse client', () => {
      it('should list tools that use elicitation', async () => {
        const client = await createSseClient(testPort);
        try {
          const tools = await client.listTools();
          const apiKeyTool = tools.tools.find(
            (t) => t.name === 'connect-external-service',
          );
          const confirmTool = tools.tools.find((t) => t.name === 'delete-account');
          const checkTool = tools.tools.find((t) => t.name === 'check-api-key');

          expect(apiKeyTool).toBeDefined();
          expect(confirmTool).toBeDefined();
          expect(checkTool).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should indicate URL elicitation not supported by client without elicitation capability', async () => {
        // Standard client without elicitation capability
        const client = await createSseClient(testPort);
        try {
          const result: any = await client.callTool({
            name: 'connect-external-service',
            arguments: { service: 'stripe' },
          });

          // Client doesn't declare elicitation capability, so tool returns appropriate message
          expect(result.content[0].text).toContain('URL elicitation is not supported');
        } finally {
          await client.close();
        }
      });

      it('should check for API key when elicitation is configured', async () => {
        const client = await createSseClient(testPort);
        try {
          const result: any = await client.callTool({
            name: 'check-api-key',
            arguments: { service: 'stripe', userId: 'test-user' },
          });

          // Elicitation context is available, tool checks for stored API key
          expect(result.content[0].text).toContain('No API key found');
        } finally {
          await client.close();
        }
      });
    });

    describe('using streamable http client', () => {
      it('should list tools that use elicitation', async () => {
        const client = await createStreamableClient(testPort);
        try {
          const tools = await client.listTools();
          const apiKeyTool = tools.tools.find(
            (t) => t.name === 'connect-external-service',
          );
          expect(apiKeyTool).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should indicate URL elicitation not supported by client without elicitation capability', async () => {
        const client = await createStreamableClient(testPort);
        try {
          const result: any = await client.callTool({
            name: 'delete-account',
            arguments: {},
          });

          // Client doesn't declare elicitation capability, so tool returns appropriate message
          expect(result.content[0].text).toContain('URL elicitation is not supported');
        } finally {
          await client.close();
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle expired elicitation', async () => {
      // Create elicitation with very short TTL
      const elicitationId = await elicitationService.createElicitation({
        sessionId: 'session-expired',
        ttlMs: 1, // 1ms TTL
      });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The store auto-removes expired elicitations on getElicitation
      const elicitation = await elicitationService.getElicitation(elicitationId);
      expect(elicitation).toBeUndefined();

      // Try to access the endpoint - should get an error response (400 for HTML endpoints)
      const response = await request(app.getHttpServer())
        .get(`/elicit/${elicitationId}/api-key`);

      // Should return an error (either 400 from renderError or 404 if route not matched)
      expect([400, 404]).toContain(response.status);
      if (response.status === 400) {
        expect(response.text.toLowerCase()).toContain('not found');
      }
    });

    it('should handle non-existent elicitation', async () => {
      const fakeId = randomUUID();

      // Status endpoint throws NotFoundException (404)
      await request(app.getHttpServer())
        .get(`/elicit/${fakeId}/status`)
        .expect(404);

      // HTML form endpoints return 400 via renderError
      const apiKeyResponse = await request(app.getHttpServer())
        .get(`/elicit/${fakeId}/api-key`);
      expect(apiKeyResponse.status).toBe(400);
      expect(apiKeyResponse.text.toLowerCase()).toContain('not found');

      const confirmResponse = await request(app.getHttpServer())
        .get(`/elicit/${fakeId}/confirm`);
      expect(confirmResponse.status).toBe(400);
      expect(confirmResponse.text.toLowerCase()).toContain('not found');

      const postApiKeyResponse = await request(app.getHttpServer())
        .post(`/elicit/${fakeId}/api-key`)
        .send({ apiKey: 'test' });
      expect(postApiKeyResponse.status).toBe(400);

      const postConfirmResponse = await request(app.getHttpServer())
        .post(`/elicit/${fakeId}/confirm`)
        .send({ action: 'confirm' });
      expect(postConfirmResponse.status).toBe(400);
    });
  });
});
