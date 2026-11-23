import { describe, it, expect } from 'bun:test';
import {
  matchResourceByUri,
  matchResourceTemplateByUri,
} from './resource-matcher';

describe('matchResourceTemplateByUri', () => {
  it('keeps equal signs in query values', () => {
    const result = matchResourceTemplateByUri(
      [{ uriTemplate: 'mcp://items{?cursor,filter}' }],
      'mcp://items?cursor=YWJjZA==&filter=status=open',
    );
    expect(result?.params).toEqual({
      cursor: 'YWJjZA==',
      filter: 'status=open',
    });
  });

  it('keeps empty query values', () => {
    const result = matchResourceTemplateByUri(
      [{ uriTemplate: 'mcp://items{?a,b}' }],
      'mcp://items?a=&b',
    );
    expect(result?.params).toEqual({ a: '', b: '' });
  });

  it('matches a catch-all path that contains a URL', () => {
    const result = matchResourceTemplateByUri(
      [{ uriTemplate: 'web://{url*}' }],
      'web://https://example.com/docs',
    );
    expect(result?.params).toEqual({ url: 'https://example.com/docs' });
  });

  it('keeps a query value that contains a URL', () => {
    const result = matchResourceTemplateByUri(
      [{ uriTemplate: 'web://fetch{?url}' }],
      'web://fetch?url=https://example.com/docs',
    );
    expect(result?.params).toEqual({ url: 'https://example.com/docs' });
  });
});

describe('literal path-to-regexp syntax in URIs', () => {
  it('matches a static resource whose URI contains a nested URL', () => {
    const resources = [
      { uri: 'mirror://https://example.com' },
      { uri: 'mcp://docs' },
    ];
    expect(
      matchResourceByUri(resources, 'mirror://https://example.com')?.resource,
    ).toBe(resources[0]);
    expect(matchResourceByUri(resources, 'mcp://docs')?.resource).toBe(
      resources[1],
    );
    expect(matchResourceByUri(resources, 'mcp://other')).toBeUndefined();
  });

  it('matches a static URI with colons and other syntax characters', () => {
    const resources = [{ uri: 'mcp://urn:isbn:123(v2)*' }];
    expect(
      matchResourceByUri(resources, 'mcp://urn:isbn:123(v2)*')?.params,
    ).toEqual({});
  });

  it('keeps literal text around template params', () => {
    const result = matchResourceTemplateByUri(
      [{ uriTemplate: 'proxy://{host}://x' }],
      'proxy://a://x',
    );
    expect(result?.params).toEqual({ host: 'a' });
  });
});

describe('matchResourceByUri', () => {
  it('does not match a URI that only starts like the resource', () => {
    const resources = [{ uri: 'mcp://docs' }];
    expect(matchResourceByUri(resources, 'mcp://docs')?.params).toEqual({});
    expect(matchResourceByUri(resources, 'mcp://docs://other')).toBeUndefined();
  });
});
