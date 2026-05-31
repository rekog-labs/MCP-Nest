import { match } from 'path-to-regexp';

/** Strips the scheme (`mcp://foo` -> `foo`). */
function stripScheme(uri: string): string {
  return uri.includes('://') ? uri.split('://')[1] : uri;
}

/** RFC 6570 template -> path-to-regexp path: drop `{?query}`, turn `{p}` into `:p`. */
function convertTemplate(template: string): string {
  if (!template) return template;
  const withoutQuery = template.replace(/\{\?[^}]+\}/g, '');
  return withoutQuery.replace(/{(\w+)}/g, ':$1');
}

function extractTemplateQueryParams(template: string): string[] {
  const m = template.match(/\{\?([^}]+)\}/);
  return m ? m[1].split(',').map((p) => p.trim()) : [];
}

function parseQueryString(uri: string): Record<string, string> {
  const i = uri.indexOf('?');
  if (i === -1) return {};
  const params: Record<string, string> = {};
  for (const pair of uri.substring(i + 1).split('&')) {
    const [k, v] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return params;
}

function stripQueryString(uri: string): string {
  const i = uri.indexOf('?');
  return i === -1 ? uri : uri.substring(0, i);
}

/** Finds a static resource whose URI matches `inputUri`, extracting any path params. */
export function matchResourceByUri<T extends { uri?: string }>(
  resources: T[],
  inputUri: string,
): { resource: T; params: Record<string, string> } | undefined {
  const input = stripScheme(inputUri);
  for (const resource of resources) {
    if (!resource.uri) continue;
    const matcher = match(convertTemplate(stripScheme(resource.uri)), {
      decode: decodeURIComponent,
    });
    const result = matcher(input);
    if (result) {
      return { resource, params: result.params as Record<string, string> };
    }
  }
  return undefined;
}

/** Finds a resource template matching `inputUri`, extracting path + declared query params. */
export function matchResourceTemplateByUri<T extends { uriTemplate?: string }>(
  templates: T[],
  inputUri: string,
): { template: T; params: Record<string, string> } | undefined {
  const input = stripQueryString(stripScheme(inputUri));
  const inputQuery = parseQueryString(inputUri);
  for (const template of templates) {
    if (!template.uriTemplate) continue;
    const matcher = match(convertTemplate(stripScheme(template.uriTemplate)), {
      decode: decodeURIComponent,
    });
    const result = matcher(input);
    if (result) {
      const params = result.params as Record<string, string>;
      const query: Record<string, string> = {};
      for (const name of extractTemplateQueryParams(template.uriTemplate)) {
        if (inputQuery[name] !== undefined) query[name] = inputQuery[name];
      }
      return { template, params: { ...params, ...query } };
    }
  }
  return undefined;
}
