/**
 * URL Elicitation Example Server
 *
 * This server demonstrates URL mode elicitation for collecting sensitive user input.
 * It includes tools that:
 * - Request API keys via URL elicitation
 * - Request user confirmation via URL elicitation
 * - Check for previously stored credentials
 *
 * To test:
 * 1. Start the server: npx ts-node-dev playground/servers/server-elicitation.ts
 * 2. Connect with an MCP client that supports URL elicitation
 * 3. Call the 'connect-external-service' tool with a service name
 * 4. Open the returned URL in your browser to provide the API key
 * 5. After completion, retry the tool call to see the stored key being used
 *
 * Endpoints:
 * - GET /elicit/:id/status - Check elicitation status
 * - GET /elicit/:id/api-key - API key form
 * - POST /elicit/:id/api-key - Submit API key
 * - GET /elicit/:id/confirm - Confirmation page
 * - POST /elicit/:id/confirm - Submit confirmation
 */

import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { McpModule, McpElicitationModule, Tool, Context } from '../../src';

/**
 * Tool for connecting to external services.
 * Demonstrates the full API key elicitation flow.
 */
@Injectable()
class ExternalServiceTool {
  @Tool({
    name: 'connect-external-service',
    description: 'Connect to an external service like Stripe, GitHub, or OpenAI. Requires an API key.',
    parameters: z.object({
      service: z.enum(['stripe', 'github', 'openai']).describe('Service to connect to'),
      action: z.string().optional().describe('Action to perform after connecting'),
    }),
  })
  async connectService({ service, action }, context: Context) {
    // Check if elicitation is available
    if (!context.elicitation) {
      return {
        content: [{
          type: 'text',
          text: 'Elicitation module not configured. Please add McpElicitationModule to your imports.',
        }],
      };
    }

    // For demo purposes, use session ID as user ID
    // In production, you'd get this from authentication
    const sessionId = (context.mcpServer.server.transport as any).sessionId ?? 'anonymous';
    const userId = `user-${sessionId.substring(0, 8)}`;
    const elicitationType = `api-key-${service}`;

    // Check for existing API key
    const existingResult = await context.elicitation.findByUserAndType(userId, elicitationType);

    if (existingResult?.success && existingResult.data?.apiKey) {
      const apiKey = existingResult.data.apiKey as string;
      const maskedKey = `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;

      return {
        content: [{
          type: 'text',
          text: [
            `Connected to ${service} using stored API key: ${maskedKey}`,
            action ? `Performing action: ${action}` : 'No action specified.',
            '',
            '(This is a demo - in production, you would use the API key to make actual requests)',
          ].join('\n'),
        }],
      };
    }

    // Check if client supports URL elicitation
    if (!context.elicitation.isSupported()) {
      return {
        content: [{
          type: 'text',
          text: [
            'URL elicitation is not supported by this client.',
            'The client must declare elicitation.url capability during initialization.',
            '',
            'For testing, use a client that supports elicitation or provide the API key directly.',
          ].join('\n'),
        }],
      };
    }

    // Get service-specific field labels
    const serviceConfig = {
      stripe: { fieldLabel: 'Stripe Secret Key', placeholder: 'sk_live_...' },
      github: { fieldLabel: 'GitHub Personal Access Token', placeholder: 'ghp_...' },
      openai: { fieldLabel: 'OpenAI API Key', placeholder: 'sk-...' },
    }[service];

    // Create URL elicitation for API key
    const { elicitationId, url } = await context.elicitation.createUrl({
      message: `Please enter your ${service} API key to continue.`,
      path: 'api-key',
      metadata: {
        type: elicitationType,
        userId,
        service,
        fieldLabel: serviceConfig.fieldLabel,
        placeholder: serviceConfig.placeholder,
        description: `Your ${service} API key will be stored securely for this session.`,
      },
    });

    console.log(`[Elicitation] Created URL elicitation for ${service}:`);
    console.log(`  Elicitation ID: ${elicitationId}`);
    console.log(`  URL: ${url}`);

    // Throw to signal client that URL elicitation is required
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
 * Tool for dangerous actions that require confirmation.
 * Demonstrates confirmation elicitation flow.
 */
@Injectable()
class DangerousActionTool {
  @Tool({
    name: 'perform-dangerous-action',
    description: 'Perform a dangerous action that requires explicit confirmation',
    parameters: z.object({
      action: z.enum(['delete-all-data', 'reset-settings', 'revoke-tokens'])
        .describe('The dangerous action to perform'),
    }),
  })
  async performAction({ action }, context: Context) {
    if (!context.elicitation) {
      return {
        content: [{ type: 'text', text: 'Elicitation module not configured' }],
      };
    }

    const sessionId = (context.mcpServer.server.transport as any).sessionId ?? 'anonymous';
    const userId = `user-${sessionId.substring(0, 8)}`;
    const confirmationType = `confirm-${action}`;

    // Check for existing confirmation
    const existingResult = await context.elicitation.findByUserAndType(userId, confirmationType);

    if (existingResult) {
      if (existingResult.success && existingResult.action === 'confirm') {
        return {
          content: [{
            type: 'text',
            text: [
              `Action '${action}' has been confirmed and executed.`,
              '',
              '(This is a demo - in production, the actual action would be performed)',
            ].join('\n'),
          }],
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: `Action '${action}' was cancelled by the user.`,
          }],
        };
      }
    }

    if (!context.elicitation.isSupported()) {
      return {
        content: [{
          type: 'text',
          text: 'URL elicitation not supported. Cannot request confirmation.',
        }],
      };
    }

    const actionLabels = {
      'delete-all-data': { title: 'Delete All Data', warning: 'All your data will be permanently deleted.' },
      'reset-settings': { title: 'Reset Settings', warning: 'All settings will be reset to defaults.' },
      'revoke-tokens': { title: 'Revoke All Tokens', warning: 'All active sessions will be terminated.' },
    };

    const config = actionLabels[action];

    const { elicitationId, url } = await context.elicitation.createUrl({
      message: `Are you sure you want to ${action.replace(/-/g, ' ')}?`,
      path: 'confirm',
      metadata: {
        type: confirmationType,
        userId,
        title: config.title,
        warning: config.warning,
        confirmLabel: 'Yes, proceed',
        cancelLabel: 'Cancel',
      },
    });

    console.log(`[Elicitation] Created confirmation for ${action}:`);
    console.log(`  URL: ${url}`);

    context.elicitation.throwRequired([
      {
        mode: 'url',
        message: `Please confirm: ${config.title}`,
        url,
        elicitationId,
      },
    ]);
  }
}

/**
 * Tool to check stored credentials.
 */
@Injectable()
class CheckCredentialsTool {
  @Tool({
    name: 'check-stored-credentials',
    description: 'Check what credentials are stored for the current session',
    parameters: z.object({}),
  })
  async checkCredentials(_, context: Context) {
    if (!context.elicitation) {
      return {
        content: [{ type: 'text', text: 'Elicitation module not configured' }],
      };
    }

    const sessionId = (context.mcpServer.server.transport as any).sessionId ?? 'anonymous';
    const userId = `user-${sessionId.substring(0, 8)}`;

    const services = ['stripe', 'github', 'openai'];
    const results: string[] = [`Stored credentials for session ${sessionId.substring(0, 8)}:`, ''];

    for (const service of services) {
      const result = await context.elicitation.findByUserAndType(userId, `api-key-${service}`);
      if (result?.success && result.data?.apiKey) {
        const apiKey = result.data.apiKey as string;
        results.push(`  - ${service}: ${apiKey.substring(0, 8)}...`);
      }
    }

    if (results.length === 2) {
      results.push('  No credentials stored yet.');
    }

    return {
      content: [{ type: 'text', text: results.join('\n') }],
    };
  }
}

@Module({
  imports: [
    // Elicitation module - provides URL-based credential collection
    McpElicitationModule.forRoot({
      serverUrl: 'http://localhost:3030',
      apiPrefix: 'elicit',
      templateOptions: {
        primaryColor: '#6366f1', // Indigo
      },
    }),
    // MCP module - main server functionality
    McpModule.forRoot({
      name: 'elicitation-demo-server',
      version: '1.0.0',
      streamableHttp: {
        enableJsonResponse: false,
        sessionIdGenerator: () => randomUUID(),
        statelessMode: false,
      },
    }),
  ],
  providers: [ExternalServiceTool, DangerousActionTool, CheckCredentialsTool],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3030);

  console.log('\n=== MCP Elicitation Demo Server ===');
  console.log('Server started on http://localhost:3030\n');
  console.log('Endpoints:');
  console.log('  MCP SSE:            GET  /sse');
  console.log('  MCP Streamable:     POST /mcp');
  console.log('  Elicitation Status: GET  /elicit/:id/status');
  console.log('  API Key Form:       GET  /elicit/:id/api-key');
  console.log('  Confirmation:       GET  /elicit/:id/confirm\n');
  console.log('Tools:');
  console.log('  - connect-external-service: Request API key via URL elicitation');
  console.log('  - perform-dangerous-action: Request confirmation via URL elicitation');
  console.log('  - check-stored-credentials: View stored credentials\n');
}

void bootstrap();
