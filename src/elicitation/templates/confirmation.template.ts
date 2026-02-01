import type { ElicitationTemplateOptions } from '../interfaces/elicitation-options.interface';
import { baseTemplate, escapeHtml } from './base.template';

export interface ConfirmationFormParams {
  /** The elicitation ID */
  elicitationId: string;

  /** Title for the confirmation page */
  title?: string;

  /** Message to display to the user */
  message: string;

  /** Warning message to display (optional) */
  warning?: string;

  /** Label for the confirm button */
  confirmLabel?: string;

  /** Label for the cancel button */
  cancelLabel?: string;

  /** The form action URL */
  actionUrl: string;

  /** Template customization options */
  options: ElicitationTemplateOptions;
}

/**
 * Render the confirmation form.
 */
export function confirmationFormTemplate(params: ConfirmationFormParams): string {
  const {
    elicitationId,
    title = 'Confirm Action',
    message,
    warning,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    actionUrl,
    options,
  } = params;

  const content = `
    <p class="message">${escapeHtml(message)}</p>
    ${warning ? `<div class="warning"><strong>Warning:</strong> ${escapeHtml(warning)}</div>` : ''}
    <form method="POST" action="${escapeHtml(actionUrl)}">
      <input type="hidden" name="elicitationId" value="${escapeHtml(elicitationId)}" />
      <div class="btn-group">
        <button type="submit" name="action" value="confirm" class="btn btn-primary">${escapeHtml(confirmLabel)}</button>
        <button type="submit" name="action" value="cancel" class="btn btn-secondary">${escapeHtml(cancelLabel)}</button>
      </div>
    </form>
  `;

  return baseTemplate({
    title,
    content,
    options,
  });
}
