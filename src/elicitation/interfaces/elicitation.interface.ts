/**
 * Represents a pending or completed URL elicitation request.
 */
export interface Elicitation {
  /** Unique identifier for this elicitation */
  elicitationId: string;

  /** MCP session ID that initiated the elicitation */
  sessionId: string;

  /** User identifier from authentication (e.g., JWT sub claim) */
  userId?: string;

  /** Current status of the elicitation */
  status: 'pending' | 'complete' | 'expired';

  /** When the elicitation was created */
  createdAt: Date;

  /** When the elicitation expires */
  expiresAt: Date;

  /**
   * Metadata stored with the elicitation.
   * Should include 'type' for lookup via findByUserAndType.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a completed URL elicitation.
 */
export interface ElicitationResult {
  /** The elicitation ID this result belongs to */
  elicitationId: string;

  /** Whether the elicitation completed successfully (user confirmed) */
  success: boolean;

  /** The action the user took */
  action: 'confirm' | 'cancel';

  /** Data submitted by the user (e.g., { apiKey: 'sk-...' }) */
  data?: Record<string, unknown>;

  /** When the elicitation was completed */
  completedAt: Date;

  /** User ID from the elicitation (copied for easier lookup) */
  userId?: string;

  /** Type from metadata (copied for easier lookup) */
  type?: string;
}

/**
 * Parameters for creating a new URL elicitation.
 */
export interface CreateElicitationParams {
  /** MCP session ID */
  sessionId: string;

  /** User identifier (from auth) */
  userId?: string;

  /**
   * Metadata to store with the elicitation.
   * Should include 'type' for lookup via findByUserAndType.
   */
  metadata?: Record<string, unknown>;

  /** Time-to-live in milliseconds (overrides module default) */
  ttlMs?: number;
}

/**
 * Parameters for completing an elicitation.
 */
export interface CompleteElicitationParams {
  /** The elicitation ID to complete */
  elicitationId: string;

  /** Whether the completion was successful */
  success: boolean;

  /** The action taken (confirm or cancel) */
  action: 'confirm' | 'cancel';

  /** Data submitted by the user */
  data?: Record<string, unknown>;
}
