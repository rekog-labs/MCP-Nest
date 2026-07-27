import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { OAuthModuleOptions } from '../providers/oauth-provider.interface';

/**
 * The name Express records for a `cookie-parser()` middleware layer. The package
 * returns a *named* function expression (`function cookieParser (req, res, next)`),
 * so the name survives onto `layer.handle.name`.
 */
const COOKIE_PARSER_LAYER_NAME = 'cookieParser';

export const COOKIE_PARSER_MISSING_MESSAGE =
  'McpAuthModule requires cookie-parser, which is not mounted on this application. ' +
  'Add `app.use(cookieParser())` to your bootstrap, before `app.listen()` ' +
  '(npm i cookie-parser @types/cookie-parser).\n' +
  'Why: the authorization handshake keeps its in-flight state in the `oauth_session` ' +
  'and `oauth_state` cookies that /authorize sets and /callback reads back off ' +
  '`req.cookies`, which Express only populates when cookie-parser is mounted. ' +
  'Middleware belongs to the host application, so the module cannot register it for you. ' +
  'This is session plumbing, not authentication.\n' +
  'If you populate `req.cookies` by some other means, set `skipCookieParserCheck: true` ' +
  'in McpAuthModule.forRoot() to silence this check.';

/**
 * Refuses to start an application that cannot complete the OAuth handshake.
 *
 * Nothing here can mount the middleware — `app.use()` belongs to the host's
 * bootstrap — so the next best thing is to make the omission impossible to
 * deploy. The failure it replaces was maximally deferred: discovery,
 * registration and `/authorize` all succeeded, the user was bounced through a
 * full IdP login, and only the callback failed, with a bare
 * `400 Missing OAuth session` naming neither cause nor fix. A server that
 * cannot authenticate anyone should not reach the point of accepting traffic.
 *
 * ### Why `onApplicationBootstrap`
 *
 * `NestFactory.create()` returns *before* any lifecycle hook runs, and hosts
 * mount their middleware in that gap. Both `onModuleInit` and
 * `onApplicationBootstrap` therefore observe a fully assembled middleware
 * stack; this is the later of the two, so a host that mounts unusually late
 * still passes.
 *
 * ### Why a name check, and what it costs
 *
 * Express exposes no "is this parser installed?" question, so the router stack
 * is searched for the layer cookie-parser installs. The trade is a false
 * positive when an equivalent parser is mounted under a different name — a
 * wrapped or re-exported cookie-parser, `@fastify/cookie`, a hand-rolled
 * parser. Because the consequence is a refusal to boot, that case gets an
 * explicit way out (`skipCookieParserCheck`) rather than a silent pass, and
 * anything we cannot introspect at all (a non-Express adapter, no router)
 * declines to judge instead of guessing.
 */
@Injectable()
export class CookieParserCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CookieParserCheckService.name);

  constructor(
    @Inject('OAUTH_MODULE_OPTIONS')
    private readonly options: OAuthModuleOptions,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.skipCookieParserCheck) {
      return;
    }

    const stack = this.getRouterStack();
    // Undeterminable, not absent: a non-Express adapter or an app with no
    // router yet. Refusing to boot on a guess would be worse than the late
    // failure this check exists to prevent, and the request-time assertion in
    // the controller still backstops it.
    if (!stack) {
      return;
    }

    const mounted = stack.some(
      (layer) => layer?.handle?.name === COOKIE_PARSER_LAYER_NAME,
    );
    if (mounted) {
      return;
    }

    this.logger.error(COOKIE_PARSER_MISSING_MESSAGE);
    throw new Error(COOKIE_PARSER_MISSING_MESSAGE);
  }

  /**
   * Express 4 keeps the router on `_router` and only creates it once something
   * has been mounted; Express 5 exposes it as `router`. Anything else — a
   * Fastify adapter, a mock — yields `undefined` and is treated as "cannot
   * tell".
   */
  private getRouterStack():
    | Array<{ handle?: { name?: string } }>
    | undefined {
    const instance: any = this.adapterHost?.httpAdapter?.getInstance?.();
    const stack = instance?._router?.stack ?? instance?.router?.stack;
    return Array.isArray(stack) ? stack : undefined;
  }
}
