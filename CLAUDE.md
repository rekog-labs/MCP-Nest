# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# NestJS MCP Server Module

## Project Overview
This is `@rekog/mcp-nest`, a NestJS module that transforms NestJS applications into Model Context Protocol (MCP) servers. It exposes tools, resources, and prompts for AI consumption via decorators, supporting multiple transport protocols (HTTP+SSE, Streamable HTTP, STDIO) with optional OAuth 2.1 authentication.

## Essential Development Commands

### Build, Test & Quality
```bash
npm run build              # TypeScript compilation with source maps
npm test                   # Jest with experimental VM modules (required for ES modules)
npm run test:watch         # Jest in watch mode
npm run lint               # ESLint with automatic fixes
npm run format             # Prettier formatting for src and tests
```

### Running Playground Examples
```bash
npm run start:playground   # Default stateful server (Express)
npm run start:fastify      # Fastify adapter server
npm run test:fastify       # Test Fastify client connection
```

### Single Test Execution
```bash
# Run specific test file
npx --node-options=--experimental-vm-modules jest tests/mcp-tool.e2e.spec.ts

# Run tests matching pattern
npx --node-options=--experimental-vm-modules jest --testNamePattern="auth"
```

## Core Components

### 1. McpModule - The Primary MCP Server Module
Located at `src/mcp/mcp.module.ts:18`. This is the main module for creating MCP servers.

**Key Features**:
- Decorator-based tool/resource/prompt discovery via `McpRegistryService`
- Multi-transport support (HTTP+SSE, Streamable HTTP, STDIO)
- Dynamic controller generation for different transport types
- Module instance isolation with unique `moduleId` per `forRoot()` call

**Basic Usage**:
```typescript
McpModule.forRoot({
  name: 'my-mcp-server',
  version: '1.0.0',
  transport: [McpTransportType.SSE, McpTransportType.STREAMABLE_HTTP],
  guards: [SomeGuard], // Optional authentication
})
```

### 2. McpAuthModule - OAuth 2.1 Authorization Server
Located at `src/authz/mcp-oauth.module.ts:76`. Provides complete OAuth 2.1 compliant Identity Provider implementation.

**Key Features**:
- Built-in GitHub and Google OAuth providers
- Multiple storage backends (memory, TypeORM, custom)
- MCP Authorization specification compliance (2025-06-18)
- Dynamic client registration (RFC 7591)
- PKCE support and comprehensive token validation

**Basic Usage**:
```typescript
McpAuthModule.forRoot({
  provider: GitHubOAuthProvider,
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  jwtSecret: process.env.JWT_SECRET!,
  serverUrl: 'http://localhost:3030',
  apiPrefix: 'auth',
})
```

### 3. Tool Definition Pattern
Tools are defined using decorators with three-parameter method signature:

```typescript
@Injectable()
export class MyService {
  @Tool({
    name: 'my-tool',
    description: 'Description',
    parameters: z.object({ name: z.string() }),
    outputSchema: z.object({ result: z.string() }), // Optional
    annotations: { readOnlyHint: true } // Optional
  })
  async myTool({ name }, context: Context, request: Request) {
    await context.reportProgress({ progress: 50, total: 100 });
    return { content: [{ type: 'text', text: `Hello ${name}` }] };
  }
}
```

**Method Parameters**:
- `args`: Zod-validated parameters from tool call
- `context`: MCP context with `reportProgress`, `mcpServer`, `mcpRequest`, logging
- `request`: HTTP request object (undefined for STDIO transport)

### 4. Transport Architecture
Three transport types with dynamic controller creation:
- **SSE**: `createSseController()` - GET `/sse` + POST `/messages`
- **Streamable HTTP**: `createStreamableHttpController()` - POST `/mcp` (+ GET/DELETE for stateful)
- **STDIO**: `StdioService` - No HTTP endpoints, uses standard input/output

Controllers are generated dynamically in `McpModule.forRoot()` based on transport configuration.

### 5. Module Integration Pattern
Both modules work together for authenticated MCP servers:

```typescript
@Module({
  imports: [
    McpAuthModule.forRoot({ /* OAuth config */ }),
    McpModule.forRoot({
      guards: [McpAuthJwtGuard], // Links auth to MCP
      /* other MCP config */
    }),
  ],
  providers: [McpAuthJwtGuard],
})
class AppModule {}
```

## Documentation Structure
The project maintains comprehensive documentation in the `docs/` directory:

### Core Guides
- `docs/tools.md` - Tool creation, parameters, progress reporting, elicitation
- `docs/resources.md` - Static and dynamic content serving
- `docs/resource-templates.md` - Parameterized resource URIs
- `docs/prompts.md` - Reusable prompt templates
- `docs/server-examples.md` - Complete server configurations and transport examples
- `docs/dependency-injection.md` - NestJS DI patterns within MCP context

### Authorization Documentation
- `docs/built-in-authorization-server.md` - Complete McpAuthModule usage and configuration
- `docs/external-authorization-server/README.md` - External OAuth server integration

## Key Implementation Details

### Module Instance Isolation
Each `McpModule.forRoot()` creates isolated instances with unique `moduleId`:
```typescript
const moduleId = `mcp-module-${instanceIdCounter++}`;
```
This enables multiple MCP servers in one application with different capabilities.

### Request Scoping & Discovery
- `McpRegistryService` discovers decorated methods at bootstrap using `DiscoveryService`
- `McpExecutorService` (REQUEST-scoped) handles per-request tool execution
- Registry maintains maps by `mcpModuleId` for isolation

### Output Schema Validation
Tools with `outputSchema` validate results, throwing `McpError` on failure:
```typescript
if (outputSchema) {
  const validation = outputSchema.safeParse(result);
  if (!validation.success) {
    throw new McpError(ErrorCode.InternalError, `Tool result does not match outputSchema`);
  }
}
```

### Resource URI Templates
Resources use `path-to-regexp` for dynamic URIs:
- Static: `uri: 'mcp://hello-world'`
- Template: `uriTemplate: 'mcp://hello-world/{userId}/{userName}'`

### OAuth Store Configuration
McpAuthModule supports multiple storage backends:
- Memory store (default, testing)
- TypeORM store (production, with unique connection name to avoid clashes)
- Custom store implementation via `IOAuthStore` interface

## Testing Patterns
- E2E tests create actual NestJS apps with different transport configurations
- Tests run scenarios across HTTP+SSE, Streamable HTTP (stateful/stateless), and STDIO
- All tests require `--node-options=--experimental-vm-modules` flag
- Use client helpers: `createSseClient()`, `createStreamableClient()`, `createStdioClient()`

## Project Structure

### File Organization
- `src/mcp/` - Core MCP functionality (McpModule, transports, services)
- `src/authz/` - OAuth authentication module (McpAuthModule)
- `src/mcp/decorators/` - Tool/Resource/Prompt decorators
- `src/mcp/services/handlers/` - MCP protocol request handlers
- `src/mcp/transport/` - Transport implementations (SSE, Streamable HTTP, STDIO)
- `src/authz/providers/` - OAuth providers (GitHub, Google, custom interface)
- `src/authz/stores/` - Storage backends (memory, TypeORM, custom interface)
- `playground/` - Working examples and demo servers
- `tests/` - Comprehensive E2E test suite covering all transports
- `docs/` - Complete documentation for all features

### HTTP Adapter Abstraction
`HttpAdapterFactory` at `src/mcp/adapters/` provides framework-agnostic request/response handling for Express/Fastify compatibility.

## Integration Points

### With NestJS Ecosystem
- Full dependency injection container integration
- Guard/Interceptor support for authentication
- Request scoping for per-request instances
- Module system with dynamic module configuration
- Compatibility with NestJS versioning (VERSION_NEUTRAL)

### With MCP SDK
- Wraps `@modelcontextprotocol/sdk` for transport layer
- Handles MCP protocol message schemas
- Progress reporting via context object
- Elicitation support for interactive tool calls

### External Dependencies
- `@modelcontextprotocol/sdk` - Core MCP protocol implementation
- `zod` - Parameter validation and schema definition
- `path-to-regexp` - Dynamic URI matching for resource templates
- `zod-to-json-schema` - Schema conversion for tool parameters
- `passport` + provider strategies - OAuth authentication
- `@nestjs/jwt` - JWT token management
- `typeorm` (optional) - Database storage for OAuth data

## Key Architecture Principles

### Transform Pattern
The module transforms existing NestJS services into MCP servers through decorators, making business logic available to AI systems without modification.

### Transport Agnostic
Each `McpModule.forRoot()` can serve multiple transport protocols simultaneously, with clients choosing their preferred connection method.

### Security Integration
Authentication is handled at the transport level via NestJS Guards, ensuring all MCP endpoints respect the same security policies as the rest of the application.

### Stateful vs Stateless
Supports both stateful (session-based) and stateless operation modes, with configurable session ID generation for multi-user scenarios.

- don't run linting, I don't care about it or formatting