import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for marking a tool as publicly accessible
 */
export const MCP_PUBLIC_METADATA_KEY = 'mcp:public';

/**
 * Decorator to mark a tool as publicly accessible, bypassing authentication requirements.
 *
 * When applied to a tool method, it allows the tool to be called without authentication,
 * even if the module has guards configured.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyTools {
 *   @Tool({ name: 'public-search', description: 'Search publicly' })
 *   @Public()
 *   async search() {
 *     return { content: [{ type: 'text', text: 'Public results' }] };
 *   }
 * }
 * ```
 */
export const Public = () => SetMetadata(MCP_PUBLIC_METADATA_KEY, true);
