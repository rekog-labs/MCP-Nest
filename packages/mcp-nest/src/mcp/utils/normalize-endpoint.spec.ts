import { normalizeEndpoint } from './normalize-endpoint';

describe('normalizeEndpoint', () => {
  it('returns empty string for null or undefined', () => {
    expect(normalizeEndpoint(null)).toBe('');
    expect(normalizeEndpoint(undefined)).toBe('');
  });

  it('collapses multiple slashes in the path', () => {
    const input = 'foo//bar///baz';
    const expected = 'foo/bar/baz';
    expect(normalizeEndpoint(input)).toBe(expected);
  });

  it('removes leading slash', () => {
    const input = '/foo/bar';
    const expected = 'foo/bar';
    expect(normalizeEndpoint(input)).toBe(expected);
  });

  it('preserves http protocol and collapses slashes after domain', () => {
    const input = 'http://localhost:3000//remote-auth/auth/callback';
    const expected = 'http://localhost:3000/remote-auth/auth/callback';
    expect(normalizeEndpoint(input)).toBe(expected);
  });

  it('preserves https protocol and collapses slashes after domain', () => {
    const input = 'https://example.com///path///to';
    const expected = 'https://example.com/path/to';
    expect(normalizeEndpoint(input)).toBe(expected);
  });

  it('preserves other protocols (ftp)', () => {
    const input = 'ftp://example.com//dir/file';
    const expected = 'ftp://example.com/dir/file';
    expect(normalizeEndpoint(input)).toBe(expected);
  });

  it('handles no protocol and leading double slashes', () => {
    const input = '//foo//bar';
    const expected = 'foo/bar';
    expect(normalizeEndpoint(input)).toBe(expected);
  });
});
