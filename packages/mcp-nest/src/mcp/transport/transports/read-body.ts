import { HttpRequest } from '../../interfaces/http-adapter.interface';

/**
 * Resolves the JSON request body for an MCP HTTP request.
 *
 * Prefers an already-parsed body (`adaptedReq.body`) when a framework body-parser
 * ran (e.g. Fastify parses before route handlers). Otherwise reads the raw Node
 * stream — the case for Express, where MCP routes are mounted before NestJS adds
 * its body-parser middleware, so `req.body` is undefined and the stream is intact.
 * Reading once here also lets the transport inspect the payload (e.g. to detect an
 * `initialize` request) before handing off to the SDK.
 */
export async function readJsonBody(adaptedReq: HttpRequest): Promise<unknown> {
  if (adaptedReq.body !== undefined) {
    return adaptedReq.body;
  }
  const rawReq = adaptedReq.raw;
  if (rawReq?.body !== undefined) {
    return rawReq.body;
  }
  return new Promise((resolve) => {
    let data = '';
    rawReq.on('data', (chunk: Buffer | string) => {
      data += chunk.toString();
    });
    rawReq.on('end', () => {
      if (!data) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(undefined);
      }
    });
    rawReq.on('error', () => resolve(undefined));
  });
}
