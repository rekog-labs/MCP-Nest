import { Module } from '@nestjs/common';
import { CasdoorAuthGuard } from './casdoor-auth.guard';
import { GreetingTool } from './greeting.tool';
import { McpHttpController } from './mcp.controller';
import { WellKnownController } from './well-known.controller';

/**
 * External-Auth MCP example — the RESOURCE SERVER.
 *
 * The MCP server is a NestJS microservice transport strategy (`McpStrategy`),
 * NOT an `McpModule`. It exposes a small self-contained greeting capability
 * (`GreetingTool`) and adds a `WellKnownController` advertising self-hosted
 * Casdoor (docker-compose.yml) as the authorization server.
 *
 * Auth is a real NestJS guard (`CasdoorAuthGuard`) on a real HTTP controller
 * (`McpHttpController`), NOT Express middleware. `McpHttpController` binds to the
 * transport directly via `McpHttpControllerFor(mcpTransport)` (see
 * `mcp.controller.ts`), so there is no handler provider to wire here — and that
 * binding also auto-disables the transport's self-mount, so the controller owns
 * the `/mcp` route.
 *
 * Note what is NOT here: no consent controller, no login view, no token issuing.
 * Casdoor owns all of that. This module is purely a resource server.
 */
@Module({
  controllers: [
    // The MCP HTTP route (guarded) + the protected-resource metadata endpoint.
    McpHttpController,
    WellKnownController,
    // @McpController() capability class (RPC handlers, not HTTP routes).
    GreetingTool,
  ],
  providers: [CasdoorAuthGuard],
})
export class AppModule {}
