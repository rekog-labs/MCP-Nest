import { HttpAdapter } from '../interfaces/http-adapter.interface';
import { ExpressHttpAdapter } from './express-http.adapter';
import { FastifyHttpAdapter } from './fastify-http.adapter';

/**
 * Factory for creating HTTP adapters based on the detected framework
 */
export class HttpAdapterFactory {
  private static expressAdapter: ExpressHttpAdapter | null = null;
  private static fastifyAdapter: FastifyHttpAdapter | null = null;

  /**
   * Get the appropriate HTTP adapter for the given request/response objects
   */
  static getAdapter(req: any, res: any): HttpAdapter {
    // Check if it's Express by looking for Express-specific properties
    if (this.isExpressRequest(req) && this.isExpressResponse(res)) {
      if (!this.expressAdapter) {
        this.expressAdapter = new ExpressHttpAdapter();
      }
      return this.expressAdapter;
    }

    // Check if it's Fastify by looking for Fastify-specific properties
    if (this.isFastifyRequest(req) && this.isFastifyReply(res)) {
      if (!this.fastifyAdapter) {
        this.fastifyAdapter = new FastifyHttpAdapter();
      }
      return this.fastifyAdapter;
    }

    // Default to Express adapter for backward compatibility
    if (!this.expressAdapter) {
      this.expressAdapter = new ExpressHttpAdapter();
    }
    return this.expressAdapter;
  }

  /**
   * Check if the request object is from Express
   */
  private static isExpressRequest(req: any): boolean {
    return Boolean(
      req &&
        typeof req === 'object' &&
        typeof req.get === 'function' &&
        req.method !== undefined &&
        req.url !== undefined &&
        !req.routeOptions, // Fastify-specific property
    );
  }

  /**
   * Check if the response object is from Express
   */
  private static isExpressResponse(res: any): boolean {
    return Boolean(
      res &&
        typeof res === 'object' &&
        typeof res.status === 'function' &&
        typeof res.json === 'function' &&
        typeof res.send === 'function' &&
        res.headersSent !== undefined &&
        !res.sent, // Fastify-specific property
    );
  }

  /**
   * Check if the request object is from Fastify
   */
  private static isFastifyRequest(req: any): boolean {
    return Boolean(
      req &&
        typeof req === 'object' &&
        req.routeOptions !== undefined && // Fastify-specific property
        req.method !== undefined &&
        req.url !== undefined,
    );
  }

  /**
   * Check if the response object is from Fastify (FastifyReply)
   */
  private static isFastifyReply(res: any): boolean {
    return Boolean(
      res &&
        typeof res === 'object' &&
        typeof res.status === 'function' &&
        typeof res.send === 'function' &&
        typeof res.header === 'function' &&
        res.sent !== undefined, // Fastify-specific property
    );
  }
}
