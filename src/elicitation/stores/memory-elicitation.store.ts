import { Injectable, Logger } from '@nestjs/common';
import type {
  Elicitation,
  ElicitationResult,
} from '../interfaces/elicitation.interface';
import type { IElicitationStore } from '../interfaces/elicitation-store.interface';

/**
 * In-memory implementation of the elicitation store.
 * Suitable for development and single-instance deployments.
 * For production with multiple instances, use a Redis or database store.
 */
@Injectable()
export class MemoryElicitationStore implements IElicitationStore {
  private readonly logger = new Logger(MemoryElicitationStore.name);

  private elicitations = new Map<string, Elicitation>();
  private results = new Map<string, ElicitationResult>();

  // Index for faster user+type lookups
  private userTypeIndex = new Map<string, string>(); // key(userId:type) -> elicitationId

  async storeElicitation(elicitation: Elicitation): Promise<void> {
    this.elicitations.set(elicitation.elicitationId, elicitation);

    // Update user+type index if applicable
    const userId = elicitation.userId;
    const type = elicitation.metadata?.type as string | undefined;
    if (userId && type) {
      const indexKey = this.buildUserTypeKey(userId, type);
      this.userTypeIndex.set(indexKey, elicitation.elicitationId);
    }

    this.logger.debug(
      `Stored elicitation ${elicitation.elicitationId} for session ${elicitation.sessionId}`,
    );
  }

  async getElicitation(
    elicitationId: string,
  ): Promise<Elicitation | undefined> {
    const elicitation = this.elicitations.get(elicitationId);

    if (!elicitation) {
      return undefined;
    }

    // Check if expired
    if (elicitation.expiresAt < new Date()) {
      this.logger.debug(`Elicitation ${elicitationId} has expired, removing`);
      await this.removeElicitation(elicitationId);
      return undefined;
    }

    return elicitation;
  }

  async updateElicitation(
    elicitationId: string,
    updates: Partial<Elicitation>,
  ): Promise<void> {
    const elicitation = this.elicitations.get(elicitationId);
    if (!elicitation) {
      this.logger.warn(
        `Attempted to update non-existent elicitation ${elicitationId}`,
      );
      return;
    }

    const updated = { ...elicitation, ...updates };
    this.elicitations.set(elicitationId, updated);
    this.logger.debug(`Updated elicitation ${elicitationId}`);
  }

  async storeResult(result: ElicitationResult): Promise<void> {
    this.results.set(result.elicitationId, result);

    // Mark the elicitation as complete
    const elicitation = this.elicitations.get(result.elicitationId);
    if (elicitation) {
      elicitation.status = 'complete';
      this.elicitations.set(result.elicitationId, elicitation);
    }

    this.logger.debug(
      `Stored result for elicitation ${result.elicitationId}, success: ${result.success}`,
    );
  }

  async getResult(
    elicitationId: string,
  ): Promise<ElicitationResult | undefined> {
    return this.results.get(elicitationId);
  }

  async findResultByUserAndType(
    userId: string,
    type: string,
  ): Promise<ElicitationResult | undefined> {
    const indexKey = this.buildUserTypeKey(userId, type);
    const elicitationId = this.userTypeIndex.get(indexKey);

    if (!elicitationId) {
      return undefined;
    }

    const result = this.results.get(elicitationId);
    if (!result) {
      return undefined;
    }

    // Verify the result matches the requested user and type
    if (result.userId === userId && result.type === type) {
      return result;
    }

    // Fallback: scan all results (slower, but handles edge cases)
    for (const r of this.results.values()) {
      if (r.userId === userId && r.type === type) {
        return r;
      }
    }

    return undefined;
  }

  async removeElicitation(elicitationId: string): Promise<void> {
    const elicitation = this.elicitations.get(elicitationId);

    if (elicitation) {
      // Remove from user+type index
      const userId = elicitation.userId;
      const type = elicitation.metadata?.type as string | undefined;
      if (userId && type) {
        const indexKey = this.buildUserTypeKey(userId, type);
        const indexedId = this.userTypeIndex.get(indexKey);
        if (indexedId === elicitationId) {
          this.userTypeIndex.delete(indexKey);
        }
      }
    }

    this.elicitations.delete(elicitationId);
    this.results.delete(elicitationId);
    this.logger.debug(`Removed elicitation ${elicitationId}`);
  }

  async getElicitationsBySession(sessionId: string): Promise<Elicitation[]> {
    const result: Elicitation[] = [];
    const now = new Date();

    for (const elicitation of this.elicitations.values()) {
      if (elicitation.sessionId === sessionId && elicitation.expiresAt > now) {
        result.push(elicitation);
      }
    }

    return result;
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date();
    let removed = 0;

    for (const [id, elicitation] of this.elicitations.entries()) {
      if (elicitation.expiresAt < now) {
        await this.removeElicitation(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired elicitations`);
    }

    return removed;
  }

  private buildUserTypeKey(userId: string, type: string): string {
    return `${userId}:${type}`;
  }
}
