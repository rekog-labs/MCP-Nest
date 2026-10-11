import { describe, expect, it } from 'bun:test';
import { matchesRegisteredRedirectUri } from './redirect-uri';

describe('matchesRegisteredRedirectUri', () => {
  it('accepts an exact match', () => {
    expect(
      matchesRegisteredRedirectUri(
        ['https://app.example.com/cb'],
        'https://app.example.com/cb',
      ),
    ).toBe(true);
  });

  it('rejects empty input', () => {
    expect(matchesRegisteredRedirectUri([], 'http://localhost/cb')).toBe(false);
    expect(matchesRegisteredRedirectUri(undefined, 'http://localhost/cb')).toBe(
      false,
    );
    expect(matchesRegisteredRedirectUri(['http://localhost/cb'], '')).toBe(
      false,
    );
    expect(
      matchesRegisteredRedirectUri(['http://localhost/cb'], undefined),
    ).toBe(false);
  });

  describe('loopback port variance (RFC 8252 §7.3)', () => {
    it.each([
      ['http://localhost/callback', 'http://localhost:3118/callback'],
      ['http://localhost:9000/callback', 'http://localhost:3118/callback'],
      ['http://127.0.0.1/callback', 'http://127.0.0.1:41234/callback'],
      ['http://[::1]/callback', 'http://[::1]:41234/callback'],
      ['http://localhost:3118/callback', 'http://localhost/callback'],
    ])('registered %s accepts %s', (registered, candidate) => {
      expect(matchesRegisteredRedirectUri([registered], candidate)).toBe(true);
    });

    it('accepts what Claude Code actually sends against its published document', () => {
      const claudeCode = [
        'http://localhost/callback',
        'http://127.0.0.1/callback',
      ];
      expect(
        matchesRegisteredRedirectUri(claudeCode, 'http://localhost:3118/callback'),
      ).toBe(true);
      expect(
        matchesRegisteredRedirectUri(claudeCode, 'http://127.0.0.1:3118/callback'),
      ).toBe(true);
    });

    it('does not let localhost stand in for 127.0.0.1 or vice versa', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://localhost/callback'],
          'http://127.0.0.1:3118/callback',
        ),
      ).toBe(false);
      expect(
        matchesRegisteredRedirectUri(
          ['http://127.0.0.1/callback'],
          'http://localhost:3118/callback',
        ),
      ).toBe(false);
    });

    it('still requires scheme, path and query to match', () => {
      const registered = ['http://localhost/callback?x=1'];
      expect(
        matchesRegisteredRedirectUri(registered, 'https://localhost:3118/callback?x=1'),
      ).toBe(false);
      expect(
        matchesRegisteredRedirectUri(registered, 'http://localhost:3118/callback/'),
      ).toBe(false);
      expect(
        matchesRegisteredRedirectUri(registered, 'http://localhost:3118/other?x=1'),
      ).toBe(false);
      expect(
        matchesRegisteredRedirectUri(registered, 'http://localhost:3118/callback?x=2'),
      ).toBe(false);
      expect(
        matchesRegisteredRedirectUri(registered, 'http://localhost:3118/callback?x=1'),
      ).toBe(true);
    });
  });

  describe('only the port may differ', () => {
    it('rejects userinfo the registered URI does not have', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://localhost/callback'],
          'http://attacker@localhost:3118/callback',
        ),
      ).toBe(false);
    });

    it('rejects a fragment the registered URI does not have', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://localhost/callback'],
          'http://localhost:3118/callback#x',
        ),
      ).toBe(false);
    });

    it.each([
      // `URL` would fold each of these into `http://<host>:3118/callback`.
      'http://localhost:3118/x/../callback',
      'http://LOCALHOST:3118/callback',
      'http://127.1:3118/callback',
      'http://2130706433:3118/callback',
      'http://localhost:03118/callback',
      // An explicit default port is not canonical either.
      'http://localhost:80/callback',
    ])('rejects the non-canonical spelling %s', (candidate) => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://localhost/callback', 'http://127.0.0.1/callback'],
          candidate,
        ),
      ).toBe(false);
    });

    it('keeps the scheme it was registered with, https included', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['https://localhost/callback'],
          'https://localhost:8443/callback',
        ),
      ).toBe(true);
      expect(
        matchesRegisteredRedirectUri(
          ['https://localhost/callback'],
          'http://localhost:8443/callback',
        ),
      ).toBe(false);
    });

    it('gives 0.0.0.0 no leniency: it is every interface, not loopback', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://0.0.0.0/callback'],
          'http://0.0.0.0:3118/callback',
        ),
      ).toBe(false);
    });

    it('does not treat other 127/8 addresses as 127.0.0.1', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://127.0.0.1/callback'],
          'http://127.0.0.2:3118/callback',
        ),
      ).toBe(false);
    });
  });

  describe('non-loopback hosts stay exact', () => {
    it('rejects a port change on a public host', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['https://app.example.com/cb'],
          'https://app.example.com:8443/cb',
        ),
      ).toBe(false);
    });

    it('rejects a loopback-looking subdomain', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://localhost/cb'],
          'http://localhost.evil.example:80/cb',
        ),
      ).toBe(false);
      expect(
        matchesRegisteredRedirectUri(
          ['http://localhost.evil.example/cb'],
          'http://localhost.evil.example:8080/cb',
        ),
      ).toBe(false);
    });

    it('rejects a candidate whose registered entry is not loopback', () => {
      expect(
        matchesRegisteredRedirectUri(
          ['http://app.example.com/cb'],
          'http://localhost:3118/cb',
        ),
      ).toBe(false);
    });

    it('rejects unparseable URIs without throwing', () => {
      expect(matchesRegisteredRedirectUri(['not a url'], 'http://localhost:1/cb')).toBe(
        false,
      );
      expect(matchesRegisteredRedirectUri(['http://localhost/cb'], 'not a url')).toBe(
        false,
      );
    });
  });
});
