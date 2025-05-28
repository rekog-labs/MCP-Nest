/**
 * Normalizes an endpoint by removing double slashes and ensuring it does not start with a slash.
 */
export function normalizeEndpoint(endpoint?: string | null): string {
  const normalized = endpoint?.replace(/\/+/g, '/') ?? '';
  return normalized.startsWith('/') ? normalized.slice(1) : normalized;
}
