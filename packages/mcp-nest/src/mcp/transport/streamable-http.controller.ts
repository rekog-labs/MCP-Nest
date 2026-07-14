import { Delete, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { MCP_HTTP_HANDLER, type McpHttpHandler } from './mcp-http-handler';

/** Anything that can hand out MCP HTTP verb handlers — i.e. a transport. */
export interface McpHttpHandlerSource {
  readonly httpHandlers: McpHttpHandler;
}

/**
 * Build a base controller bound DIRECTLY to a specific transport — the
 * legible way to wire a bring-your-own MCP controller.
 *
 * Instead of providing handlers under a DI token and hoping the right one
 * resolves (which gets confusing with multiple servers), the controller simply
 * names the transport it serves. The binding is a concrete reference you can
 * click through to:
 *
 * ```ts
 * @Controller('weather/mcp')
 * @UseGuards(WeatherAuthGuard)
 * export class WeatherMcpController extends McpHttpControllerFor(weatherTransport) {}
 * ```
 *
 * No `MCP_HTTP_HANDLER` provider, no module-local resolution to reason about: a
 * reader sees `weatherTransport`, jumps to where it's declared, and finds it in
 * `weatherStrategy({ server: 'weather' })` next to the weather tools. One hop.
 *
 * Reading `source.httpHandlers` here (at class-definition / import time) also
 * marks the route as claimed, so the transport auto-disables its own self-mount.
 *
 * You still own the subclass decorators — `@Controller(path)`, `@UseGuards`,
 * `@UseInterceptors`, `@Version`, etc. all compose normally; the library only
 * owns the `POST`/`GET`/`DELETE` wiring.
 */
export function McpHttpControllerFor(source: McpHttpHandlerSource) {
  const handlers = source.httpHandlers;

  abstract class BoundMcpHttpController {
    @Post()
    post(@Req() req: unknown, @Res() res: unknown): Promise<void> | void {
      return handlers.handlePost(req, res);
    }

    @Get()
    get(@Req() req: unknown, @Res() res: unknown): Promise<void> | void {
      return handlers.handleGet(req, res);
    }

    @Delete()
    delete(@Req() req: unknown, @Res() res: unknown): Promise<void> | void {
      return handlers.handleDelete(req, res);
    }
  }

  return BoundMcpHttpController;
}

/**
 * Abstract base controller for the streamable-HTTP MCP endpoint.
 *
 * Extend it to mount the MCP route as a real NestJS controller — so guards,
 * interceptors, exception filters and versioning apply the normal Nest way,
 * while the library keeps ownership of the `POST`/`GET`/`DELETE` wiring
 * (session handling, SSE streaming, raw-body reading). You never reimplement the
 * verbs; you just decorate your subclass:
 *
 * ```ts
 * @Controller('mcp')
 * @UseGuards(MyAuthGuard)          // ← authenticate the whole MCP surface, once
 * export class McpController extends StreamableHttpController {}
 * ```
 *
 * Wiring is a single line — provide the transport's handlers under
 * {@link MCP_HTTP_HANDLER} so this base can inject them:
 *
 * ```ts
 * { provide: MCP_HTTP_HANDLER, useValue: mcpTransport.httpHandlers }
 * ```
 *
 * Reading `httpHandlers` there also auto-disables the transport's own
 * self-mount, so you do NOT need `{ mount: false }` — your controller owns the
 * route and there is no double-registration. (Pass `mount` explicitly only to
 * override that.) The path lives on YOUR `@Controller(...)` decorator, not on
 * the transport.
 *
 * Implementation notes:
 * - `@Controller()` must be on the concrete subclass; Nest registers the route
 *   handlers it finds on the prototype chain, including these inherited ones.
 * - The handler is injected via a property (not the constructor) so subclasses
 *   need no constructor and no `super(...)` call — and so it survives NestJS's
 *   inherited-constructor-metadata quirks.
 * - `@Res()` puts Nest in manual-response mode: the SDK transport writes the
 *   response (and SSE stream) directly, so Nest must not serialize a return
 *   value.
 */
export abstract class StreamableHttpController {
  @Inject(MCP_HTTP_HANDLER)
  protected readonly mcpHandler!: McpHttpHandler;

  @Post()
  post(@Req() req: unknown, @Res() res: unknown): Promise<void> | void {
    return this.mcpHandler.handlePost(req, res);
  }

  @Get()
  get(@Req() req: unknown, @Res() res: unknown): Promise<void> | void {
    return this.mcpHandler.handleGet(req, res);
  }

  @Delete()
  delete(@Req() req: unknown, @Res() res: unknown): Promise<void> | void {
    return this.mcpHandler.handleDelete(req, res);
  }
}
