import { match } from 'path-to-regexp';

/** Strips the scheme (`mcp://foo` -> `foo`). */
function stripScheme(uri: string): string {
  return uri.includes('://') ? uri.split('://')[1] : uri;
}

/**
 * RFC 6570 template -> path-to-regexp (v8) path:
 * - drop the `{?query}` form,
 * - turn a catch-all `{path*}` into a wildcard `*path` (matches one or more
 *   segments across `/`),
 * - turn a single `{p}` into `:p` (one segment).
 *
 * The catch-all rule MUST run before the single-param rule: `{(\w+)}` can't
 * match `{path*}` (the `*` sits between `\w+` and `}`), which is the bug that
 * previously left `{path*}` untouched so it never matched.
 */
function convertTemplate(template: string): string {
  if (!template) return template;
  return template
    .replace(/\{\?[^}]+\}/g, '')
    .replace(/\{(\w+)\*\}/g, '*$1')
    .replace(/\{(\w+)\}/g, ':$1');
}

/**
 * path-to-regexp v8 returns wildcard (`*path`) params as an array of segments,
 * while named (`:id`) params come back as strings. Join wildcard arrays with
 * `/` so a `{path*}` template hands the handler a single string
 * (e.g. `docs/readme.md`), preserving the documented contract.
 */
function flattenParams(
  params: Partial<Record<string, string | string[]>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join('/') : value;
  }
  return out;
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
      return { resource, params: flattenParams(result.params) };
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
      const params = flattenParams(result.params);
      const query: Record<string, string> = {};
      for (const name of extractTemplateQueryParams(template.uriTemplate)) {
        if (inputQuery[name] !== undefined) query[name] = inputQuery[name];
      }
      return { template, params: { ...params, ...query } };
    }
  }
  return undefined;
}
