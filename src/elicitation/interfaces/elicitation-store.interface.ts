import type { Elicitation, ElicitationResult } from './elicitation.interface';

/**
 * Interface for elicitation storage backends.
 * Implementations can use memory, Redis, database, etc.
 */
export interface IElicitationStore {
  /**
   * Store a new elicitation.
   */
  storeElicitation(elicitation: Elicitation): Promise<void>;

  /**
   * Get an elicitation by ID.
   * Returns undefined if not found or expired.
   */
  getElicitation(elicitationId: string): Promise<Elicitation | undefined>;

  /**
   * Update an elicitation's properties.
   */
  updateElicitation(
    elicitationId: string,
    updates: Partial<Elicitation>,
  ): Promise<void>;

  /**
   * Store the result of a completed elicitation.
   */
  storeResult(result: ElicitationResult): Promise<void>;

  /**
   * Get a completed elicitation result by elicitation ID.
   */
  getResult(elicitationId: string): Promise<ElicitationResult | undefined>;

  /**
   * Find a completed elicitation result by user ID and type.
   * Type is stored in the elicitation's metadata.type field.
   *
   * @param userId - The user identifier
   * @param type - The elicitation type (from metadata.type)
   * @returns The most recent matching result, or undefined
   */
  findResultByUserAndType(
    userId: string,
    type: string,
  ): Promise<ElicitationResult | undefined>;

  /**
   * Remove an elicitation and its result.
   */
  removeElicitation(elicitationId: string): Promise<void>;

  /**
   * Get all elicitations for a session.
   */
  getElicitationsBySession(sessionId: string): Promise<Elicitation[]>;

  /**
   * Clean up expired elicitations.
   * @returns Number of elicitations removed
   */
  cleanupExpired(): Promise<number>;
}

/**
 * Injection token for the elicitation store.
 */
export const ELICITATION_STORE_TOKEN = 'IElicitationStore';
