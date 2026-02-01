import type { ElicitationTemplateOptions } from '../interfaces/elicitation-options.interface';
import { baseTemplate, escapeHtml } from './base.template';

export interface SuccessPageParams {
  /** Title for the success page */
  title?: string;

  /** Message to display */
  message: string;

  /** Additional details (optional) */
  details?: string;

  /** Template customization options */
  options: ElicitationTemplateOptions;
}

/**
 * Render the success page shown after completing an elicitation.
 */
export function successPageTemplate(params: SuccessPageParams): string {
  const {
    title = 'Success',
    message,
    details,
    options,
  } = params;

  const content = `
    <div class="success">
      <div class="success-icon">&#10003;</div>
      <h2>${escapeHtml(title)}</h2>
      <p style="margin-top: 12px;">${escapeHtml(message)}</p>
      ${details ? `<p style="margin-top: 8px; font-size: 14px;">${escapeHtml(details)}</p>` : ''}
    </div>
    <p style="text-align: center; margin-top: 20px; color: #666;">
      You can close this window and return to your MCP client.
    </p>
  `;

  return baseTemplate({
    title,
    content,
    options,
  });
}

export interface CancelledPageParams {
  /** Title for the cancelled page */
  title?: string;

  /** Message to display */
  message: string;

  /** Template customization options */
  options: ElicitationTemplateOptions;
}

/**
 * Render the page shown when the user cancels an elicitation.
 */
export function cancelledPageTemplate(params: CancelledPageParams): string {
  const {
    title = 'Cancelled',
    message,
    options,
  } = params;

  const content = `
    <div class="info">
      <h2>${escapeHtml(title)}</h2>
      <p style="margin-top: 12px;">${escapeHtml(message)}</p>
    </div>
    <p style="text-align: center; margin-top: 20px; color: #666;">
      You can close this window and return to your MCP client.
    </p>
  `;

  return baseTemplate({
    title,
    content,
    options,
  });
}

export interface ErrorPageParams {
  /** Title for the error page */
  title?: string;

  /** Error message to display */
  message: string;

  /** Template customization options */
  options: ElicitationTemplateOptions;
}

/**
 * Render an error page.
 */
export function errorPageTemplate(params: ErrorPageParams): string {
  const {
    title = 'Error',
    message,
    options,
  } = params;

  const content = `
    <div class="error">
      <h2>${escapeHtml(title)}</h2>
      <p style="margin-top: 12px;">${escapeHtml(message)}</p>
    </div>
  `;

  return baseTemplate({
    title,
    content,
    options,
  });
}
