import type { ElicitationTemplateOptions } from '../interfaces/elicitation-options.interface';

export interface BaseTemplateParams {
  title: string;
  content: string;
  options: ElicitationTemplateOptions;
}

/**
 * Base HTML template with common styles and layout.
 */
export function baseTemplate({ title, content, options }: BaseTemplateParams): string {
  const appName = options.appName ?? 'MCP Server';
  const primaryColor = options.primaryColor ?? '#007bff';
  const logoUrl = options.logoUrl;
  const customCss = options.customCss ?? '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - ${escapeHtml(appName)}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
      max-width: 420px;
      width: 100%;
      padding: 32px;
    }

    .header {
      text-align: center;
      margin-bottom: 24px;
    }

    .logo {
      max-width: 120px;
      max-height: 60px;
      margin-bottom: 16px;
    }

    .app-name {
      font-size: 14px;
      color: #666;
      margin-bottom: 8px;
    }

    h1 {
      font-size: 24px;
      color: #333;
      margin-bottom: 8px;
    }

    .message {
      color: #666;
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #333;
      margin-bottom: 8px;
    }

    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      font-size: 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      transition: border-color 0.2s;
    }

    input[type="text"]:focus,
    input[type="password"]:focus {
      outline: none;
      border-color: ${primaryColor};
    }

    .btn {
      display: inline-block;
      padding: 12px 24px;
      font-size: 16px;
      font-weight: 500;
      text-decoration: none;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.1s;
    }

    .btn:active {
      transform: scale(0.98);
    }

    .btn-primary {
      background: ${primaryColor};
      color: white;
      width: 100%;
    }

    .btn-primary:hover {
      background: ${darkenColor(primaryColor, 10)};
    }

    .btn-secondary {
      background: #6c757d;
      color: white;
      width: 100%;
      margin-top: 12px;
    }

    .btn-secondary:hover {
      background: #5a6268;
    }

    .btn-danger {
      background: #dc3545;
      color: white;
    }

    .btn-danger:hover {
      background: #c82333;
    }

    .warning {
      background: #fff3cd;
      color: #856404;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      border-left: 4px solid #ffc107;
    }

    .success-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .success {
      background: #d4edda;
      color: #155724;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }

    .error {
      background: #f8d7da;
      color: #721c24;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }

    .info {
      background: #d1ecf1;
      color: #0c5460;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }

    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: #999;
    }

    .btn-group {
      display: flex;
      gap: 12px;
    }

    .btn-group .btn {
      flex: 1;
    }

    ${customCss}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(appName)}" class="logo">` : ''}
      <div class="app-name">${escapeHtml(appName)}</div>
      <h1>${escapeHtml(title)}</h1>
    </div>
    ${content}
    <div class="footer">
      This action was requested by an MCP client.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Simple color darkening function.
 */
function darkenColor(hex: string, percent: number): string {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Parse RGB values
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Darken
  r = Math.max(0, Math.floor(r * (1 - percent / 100)));
  g = Math.max(0, Math.floor(g * (1 - percent / 100)));
  b = Math.max(0, Math.floor(b * (1 - percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
