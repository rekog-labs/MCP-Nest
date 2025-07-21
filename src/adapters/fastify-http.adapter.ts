// Import types conditionally to avoid hard dependency
interface FastifyRequest {
  url: string;
  method: string;
  headers: Record<string, string | string[]>;
  query: Record<string, any>;
  body: any;
  params: Record<string, string>;
  routeOptions?: any;
}

interface FastifyReply {
  status(code: number): this;
  send(payload: any): Promise<void>;
  header(name: string, value: string | string[]): this;
  sent: boolean;
  raw: any;
}

import {
  HttpAdapter,
  HttpRequest,
  HttpResponse,
} from '../interfaces/http-adapter.interface';

/**
 * Fastify HTTP adapter that implements the generic HTTP interface
 */
export class FastifyHttpAdapter implements HttpAdapter {
  adaptRequest(req: FastifyRequest): HttpRequest {
    return {
      url: req.url,
      method: req.method,
      headers: req.headers as Record<string, string | string[] | undefined>,
      query: req.query,
      body: req.body,
      params: req.params,
      get: (name: string) => {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
      raw: (req as any).raw, // Raw Node.js IncomingMessage for MCP transport
    };
  }

  adaptResponse(res: FastifyReply): HttpResponse {
    return {
      status: (code: number) => {
        res.status(code);
        return this.adaptResponse(res);
      },
      json: (body: any) => {
        void res.send(body);
        return this.adaptResponse(res);
      },
      send: (body: string) => {
        void res.send(body);
        return this.adaptResponse(res);
      },
      write: (chunk: any) => {
        void res.raw.write(chunk);
      },
      setHeader: (name: string, value: string | string[]) => {
        res.header(name, value);
      },
      get headersSent() {
        return res.sent;
      },
      get writable() {
        return !res.sent;
      },
      get closed() {
        return res.sent;
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        res.raw.on(event, listener);
      },
      raw: res.raw, // Raw Node.js ServerResponse for MCP transport
    };
  }
}
