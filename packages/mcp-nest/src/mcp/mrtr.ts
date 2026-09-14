/**
 * Multi Round-Trip Requests (MRTR) — protocol revision `2026-07-28`.
 *
 * On the modern revision a server never pushes `elicitation/create`,
 * `sampling/createMessage` or `roots/list` down to the client. Instead a
 * `@Tool`, `@Resource`/`@ResourceTemplate` or `@Prompt` handler returns
 * `inputRequired({ inputRequests, requestState })`; the client fulfils the
 * embedded requests and retries the same call with `inputResponses` and a
 * byte-exact echo of `requestState`. On re-entry the handler reads them via
 * `McpContext.getInputResponses()` / `getAcceptedContent()` /
 * `getRequestState()`.
 *
 * These are the SDK's own helpers, re-exported so an application does not have
 * to depend on `@modelcontextprotocol/server` directly. They are the same
 * objects — mixing imports from either package is fine.
 *
 * See `docs/mrtr.md`.
 */
export {
  acceptedContent,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  isInputRequiredResult,
} from '@modelcontextprotocol/server';
export type {
  InputRequest,
  InputRequests,
  InputRequiredResult,
  InputRequiredSpec,
  InputResponse,
  InputResponses,
  InputResponseView,
  RequestStateCodec,
  RequestStateCodecOptions,
} from '@modelcontextprotocol/server';
