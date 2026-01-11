import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for marking a tool as publicly accessible
 */
export const MCP_PUBLIC_METADATA_KEY = 'mcp:public-tool';

/**
 * Decorator to mark a tool as publicly accessible, bypassing authentication requirements.
 *
 * Use this when you want a tool to be available even to unauthenticated users
 * when `allowUnauthenticatedAccess` is enabled in McpModule options.
 *
 * When applied to a tool method, it allows the tool to be called without authentication,
 * even if the module has guards configured.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyTools {
 *   @Tool({ name: 'public-search', description: 'Search publicly' })
 *   @PublicTool()
 *   async search() {
 *     return { content: [{ type: 'text', text: 'Public results' }] };
 *   }
 * }
 * ```
 */
export const PublicTool = () => SetMetadata(MCP_PUBLIC_METADATA_KEY, true);
