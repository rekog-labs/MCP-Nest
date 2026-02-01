import type { ElicitationTemplateOptions } from '../interfaces/elicitation-options.interface';
import { baseTemplate, escapeHtml } from './base.template';

export interface ApiKeyFormParams {
  /** The elicitation ID */
  elicitationId: string;

  /** Message to display to the user */
  message: string;

  /** Label for the API key field */
  fieldLabel?: string;

  /** Placeholder text for the input */
  placeholder?: string;

  /** Description/help text below the input */
  description?: string;

  /** The form action URL */
  actionUrl: string;

  /** Template customization options */
  options: ElicitationTemplateOptions;
}

/**
 * Render the API key collection form.
 */
export function apiKeyFormTemplate(params: ApiKeyFormParams): string {
  const {
    elicitationId,
    message,
    fieldLabel = 'API Key',
    placeholder = 'Enter your API key',
    description,
    actionUrl,
    options,
  } = params;

  const content = `
    <p class="message">${escapeHtml(message)}</p>
    <form method="POST" action="${escapeHtml(actionUrl)}">
      <input type="hidden" name="elicitationId" value="${escapeHtml(elicitationId)}" />
      <div class="form-group">
        <label for="apiKey">${escapeHtml(fieldLabel)}</label>
        <input
          type="password"
          id="apiKey"
          name="apiKey"
          required
          placeholder="${escapeHtml(placeholder)}"
          autocomplete="off"
        />
        ${description ? `<p style="font-size: 12px; color: #666; margin-top: 8px;">${escapeHtml(description)}</p>` : ''}
      </div>
      <button type="submit" class="btn btn-primary">Submit</button>
    </form>
  `;

  return baseTemplate({
    title: fieldLabel,
    content,
    options,
  });
}
