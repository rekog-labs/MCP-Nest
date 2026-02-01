import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  CompleteElicitationParams,
  CreateElicitationParams,
  Elicitation,
  ElicitationResult,
} from '../interfaces/elicitation.interface';
import type { IElicitationStore } from '../interfaces/elicitation-store.interface';
import { ELICITATION_STORE_TOKEN } from '../interfaces/elicitation-store.interface';
import type { ResolvedElicitationOptions } from '../interfaces/elicitation-options.interface';

/**
 * Token for injecting the completion notifier registry.
 * Maps elicitationId -> notifier callback.
 */
export const COMPLETION_NOTIFIER_REGISTRY = 'COMPLETION_NOTIFIER_REGISTRY';

/**
 * Type for completion notifier callbacks.
 */
export type CompletionNotifier = () => Promise<void>;

/**
 * Registry for storing completion notifier callbacks.
 * Stored in memory since callbacks cannot be serialized.
 */
export type CompletionNotifierRegistry = Map<string, CompletionNotifier>;

/**
 * Injection token for elicitation module options.
 */
export const ELICITATION_MODULE_OPTIONS = 'ELICITATION_MODULE_OPTIONS';

/**
 * Service for managing URL elicitations.
 */
@Injectable()
export class ElicitationService implements OnModuleDestroy {
  private readonly logger = new Logger(ElicitationService.name);
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(ELICITATION_STORE_TOKEN)
    private readonly store: IElicitationStore,
    @Inject(ELICITATION_MODULE_OPTIONS)
    private readonly options: ResolvedElicitationOptions,
    @Inject(COMPLETION_NOTIFIER_REGISTRY)
    private readonly notifierRegistry: CompletionNotifierRegistry,
  ) {
    // Start periodic cleanup
    this.startCleanupInterval();
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create a new elicitation.
   *
   * @returns The elicitation ID
   */
  async createElicitation(params: CreateElicitationParams): Promise<string> {
    const elicitationId = randomUUID();
    const now = new Date();
    const ttlMs = params.ttlMs ?? this.options.elicitationTtlMs;

    const elicitation: Elicitation = {
      elicitationId,
      sessionId: params.sessionId,
      userId: params.userId,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      metadata: params.metadata,
    };

    await this.store.storeElicitation(elicitation);

    this.logger.log(
      `Created elicitation ${elicitationId} for session ${params.sessionId}`,
    );

    return elicitationId;
  }

  /**
   * Register a completion notifier for an elicitation.
   * The notifier will be called when the elicitation is completed.
   */
  registerCompletionNotifier(
    elicitationId: string,
    notifier: CompletionNotifier,
  ): void {
    this.notifierRegistry.set(elicitationId, notifier);
    this.logger.debug(`Registered notifier for elicitation ${elicitationId}`);
  }

  /**
   * Build the URL for an elicitation endpoint.
   *
   * @param elicitationId - The elicitation ID
   * @param path - The endpoint path (e.g., 'api-key', 'confirm')
   * @param additionalParams - Additional query parameters
   */
  buildElicitationUrl(
    elicitationId: string,
    path?: string,
    additionalParams?: Record<string, string>,
  ): string {
    const baseUrl = this.options.serverUrl.replace(/\/$/, '');
    const prefix = this.options.apiPrefix;

    let url = `${baseUrl}/${prefix}/${elicitationId}`;

    if (path) {
      url += `/${path}`;
    }

    if (additionalParams && Object.keys(additionalParams).length > 0) {
      const params = new URLSearchParams(additionalParams);
      url += `?${params.toString()}`;
    }

    return url;
  }

  /**
   * Get an elicitation by ID.
   */
  async getElicitation(
    elicitationId: string,
  ): Promise<Elicitation | undefined> {
    return this.store.getElicitation(elicitationId);
  }

  /**
   * Complete an elicitation with the user's response.
   *
   * @returns Whether the completion notification was sent
   */
  async completeElicitation(
    params: CompleteElicitationParams,
  ): Promise<boolean> {
    const elicitation = await this.store.getElicitation(params.elicitationId);

    if (!elicitation) {
      this.logger.warn(
        `Attempted to complete non-existent elicitation ${params.elicitationId}`,
      );
      return false;
    }

    if (elicitation.status === 'complete') {
      this.logger.warn(
        `Elicitation ${params.elicitationId} is already complete`,
      );
      return false;
    }

    // Create and store the result
    const result: ElicitationResult = {
      elicitationId: params.elicitationId,
      success: params.success,
      action: params.action,
      data: params.data,
      completedAt: new Date(),
      userId: elicitation.userId,
      type: elicitation.metadata?.type as string | undefined,
    };

    await this.store.storeResult(result);

    this.logger.log(
      `Completed elicitation ${params.elicitationId}, success: ${params.success}`,
    );

    // Send completion notification
    const notifier = this.notifierRegistry.get(params.elicitationId);
    if (notifier) {
      try {
        await notifier();
        this.logger.debug(
          `Sent completion notification for elicitation ${params.elicitationId}`,
        );
        // Clean up the notifier
        this.notifierRegistry.delete(params.elicitationId);
        return true;
      } catch (error) {
        this.logger.error(
          `Failed to send completion notification for elicitation ${params.elicitationId}`,
          error,
        );
        return false;
      }
    } else {
      this.logger.debug(
        `No notifier registered for elicitation ${params.elicitationId}`,
      );
      return false;
    }
  }

  /**
   * Get a completed elicitation result by elicitation ID.
   */
  async getResult(
    elicitationId: string,
  ): Promise<ElicitationResult | undefined> {
    return this.store.getResult(elicitationId);
  }

  /**
   * Find a completed elicitation result by user ID and type.
   *
   * @param userId - The user identifier
   * @param type - The elicitation type (from metadata.type)
   */
  async findResultByUserAndType(
    userId: string,
    type: string,
  ): Promise<ElicitationResult | undefined> {
    return this.store.findResultByUserAndType(userId, type);
  }

  /**
   * Remove an elicitation and its associated data.
   */
  async removeElicitation(elicitationId: string): Promise<void> {
    await this.store.removeElicitation(elicitationId);
    this.notifierRegistry.delete(elicitationId);
    this.logger.debug(`Removed elicitation ${elicitationId}`);
  }

  /**
   * Get all elicitations for a session.
   */
  async getElicitationsBySession(sessionId: string): Promise<Elicitation[]> {
    return this.store.getElicitationsBySession(sessionId);
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(
      () => {
        this.store.cleanupExpired().catch((error) => {
          this.logger.error('Error during elicitation cleanup', error);
        });
      },
      this.options.cleanupIntervalMs,
    );

    // Don't prevent Node.js from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
}
