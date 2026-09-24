// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import http from 'node:http';
import type https from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ServiceValidationError } from '../errors';
import { encodePathSegment } from './url-validation';

/**
 * Drives the REAL `fetchSafeUrl` against a real socket.
 *
 * An earlier revision of this spec reproduced the accumulation handler locally with its own 64 KiB
 * constant, on the belief that the SSRF guard made the real function untestable: it rejects
 * `127.0.0.1` and `localhost` outright, so no address a test server can bind to would be accepted.
 *
 * That was wrong, and review caught it. The guard resolves the hostname through `node:dns` and
 * then connects to the resolved IP through `node:https` — both dynamic imports, so both are
 * mockable. Pointing DNS at a public-looking address and the transport at a loopback server lets
 * the production code run end to end, with its own `MAX_RESPONSE_BYTES` in force.
 *
 * That distinction is the whole point: the old test passed with the production ceiling deleted.
 */

// A real server that streams forever. This is the shape the ceiling exists for: the 15s timeout
// bounds TIME, and on a fast link a server can push gigabytes into memory inside it.
let server: http.Server;
let port: number;

vi.mock('node:dns', () => ({
  // A genuinely PUBLIC address, and deliberately not a documentation range.
  //
  // This fixture used 203.0.113.10 (TEST-NET-3) on the reasoning that it is "routable-looking,
  // so it clears the private-IP patterns". That was true of the module-local denylist this file
  // used to gate on, and is false of the shared `isPrivateHost` that replaced it -- RFC 5737
  // documentation space is one of the ranges it rejects. The fixture'd have been quietly
  // asserting against a blocked address rather than exercising the success path.
  //
  // 93.184.216.34 is example.com's address: public, stable, and never routed to by these tests
  // because fetch itself is mocked.
  promises: { resolve4: vi.fn(async () => ['93.184.216.34']), resolve6: vi.fn(async () => []) },
}));

// `fetchSafeUrl` connects to the DNS-resolved IP; redirect the transport to the local server
// while leaving every guard, header and the byte ceiling exactly as production runs them.
// `servername` is a TLS option with no meaning over plain http, so it is dropped rather than
// passed through as undefined.
const toLocalServer = (opts: https.RequestOptions, cb: (res: http.IncomingMessage) => void): http.ClientRequest => {
  const { servername, ...rest } = opts as https.RequestOptions & { servername?: string };
  void servername;
  return http.request({ ...rest, hostname: '127.0.0.1', port }, cb);
};

vi.mock('node:https', () => ({ default: { request: toLocalServer }, request: toLocalServer }));

describe('fetchSafeUrl final URL after redirects', () => {
  let redirectServer: http.Server;

  beforeAll(async () => {
    redirectServer = http.createServer((req, res) => {
      if (req.url === '/old') {
        // Same host, DIFFERENT directory -- the case that silently breaks a relative og:image.
        res.writeHead(302, { location: '/events/new/' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<meta property="og:image" content="hero.jpg" />');
    });
    await new Promise<void>((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
    port = (redirectServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
  });

  it('reports the URL that actually served the response, not the one requested', async () => {
    // Imported INSIDE the test, like the ceiling tests below: the module must load after the
    // `node:https` mock is installed, or it captures the real transport.
    const { fetchSafeUrl } = await import('./url-validation');
    const result = await fetchSafeUrl('https://events.example.com/old', new AbortController().signal);

    expect(result.ok).toBe(true);
    // Resolving a relative `og:image` against the REQUESTED url yields
    // https://events.example.com/hero.jpg -- a path that does not exist, so the hero silently
    // disappears. Against the final url it is .../events/new/hero.jpg, which is the real one.
    expect(result.finalUrl).toBe('https://events.example.com/events/new/');
    expect(new URL('hero.jpg', result.finalUrl).href).toBe('https://events.example.com/events/new/hero.jpg');
  });
});

describe('fetchSafeUrl response byte ceiling', () => {
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      const pump = (): void => {
        if (!res.writableEnded && res.write('x'.repeat(8192))) {
          setImmediate(pump);
        }
      };
      res.on('drain', pump);
      pump();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  // REJECTS rather than truncates. A truncated page is one that lies about its own content, and
  // would reach the extraction prompt as though complete; failing loudly is the honest outcome.
  //
  // The 5 MiB in the matcher is the PRODUCTION constant, not one this file declares — deleting
  // `MAX_RESPONSE_BYTES` or unwiring the `data` handler fails this test rather than leaving it green.
  it('abandons a response that never ends instead of buffering it', async () => {
    const { fetchSafeUrl } = await import('./url-validation');
    const started = Date.now();

    await expect(fetchSafeUrl('https://events.example.com/page', new AbortController().signal)).rejects.toThrow(/exceeded 5242880 bytes/);

    // Far below the 15s timeout that would otherwise bound this. Loose against CI variance, but
    // an unbounded read of an infinite stream cannot finish this fast.
    expect(Date.now() - started).toBeLessThan(10_000);
    // Verified by mutation: with `MAX_RESPONSE_BYTES` unwired this fails in ~15s with
    // "The operation was aborted" -- the request buffers until the 15s abort instead of being
    // destroyed at the ceiling. The old copy-of-the-logic spec stayed green through the same edit.
  });

  // The guard the ceiling sits behind, exercised through the same entry point: a hostname that
  // resolves into a private range is refused before any byte is read.
  it('still refuses a host that resolves to a private address', async () => {
    const dns = await import('node:dns');
    const { fetchSafeUrl } = await import('./url-validation');
    vi.mocked(dns.promises.resolve4).mockResolvedValueOnce(['10.0.0.5']);

    await expect(fetchSafeUrl('https://events.example.com/page', new AbortController().signal)).rejects.toThrow(/private IP/);
  });
});

/**
 * `encodePathSegment` is a thin wrapper around `encodeURIComponent`, and that is exactly why it is
 * tested: the thing worth pinning is not the encoding itself but the property the call sites depend
 * on — that whatever an attacker puts in an identifier, the result is still one *inert* path segment.
 *
 * Without this, the function reads like a pointless wrapper and the obvious "simplification" is to
 * inline it or drop it, silently un-fixing a traversal that reaches an internal service under the
 * caller's own credentials.
 */
describe('encodePathSegment', () => {
  it.each([
    ['a parent-directory traversal', '../../itx/projects/pwn'],
    ['an absolute path', '/itx/projects/pwn'],
    ['a bare separator', 'a/b'],
    ['an already-encoded separator, so it cannot be decoded back into one', '..%2F..%2Fadmin'],
  ])('leaves no path separator in the output for %s', (_label, hostile) => {
    const encoded = encodePathSegment(hostile);

    expect(encoded).not.toContain('/');
    // The URL parser resolves `.` and `..` only between separators, so removing the separators is
    // what defuses a traversal *embedded* in a longer value. A value that is nothing but dots has no
    // separator to remove and is refused outright instead — see below.
    expect(new URL(`https://svc.example/itx/meetings/${encoded}/registrants`).pathname).toBe(`/itx/meetings/${encoded}/registrants`);
  });

  it.each([
    ['the parent directory', '..'],
    ['the current directory', '.'],
  ])('refuses %s, which encoding cannot neutralize', (_label, hostile) => {
    // The reason this arm is a rejection and not more encoding: percent-decoding happens before path
    // normalization, so the encoded form climbs the path exactly as the literal one does. Asserted
    // rather than described, because the whole guard rests on it.
    const encoded = encodeURIComponent(hostile);

    expect(new URL(`https://svc.example/itx/meetings/${encoded}/registrants`).pathname).not.toBe(`/itx/meetings/${encoded}/registrants`);

    expect(() => encodePathSegment(hostile)).toThrow(ServiceValidationError);
  });

  it('answers 400 rather than letting the traversal reach upstream', () => {
    // A refusal that surfaced as a 500 would read as a bug in the app rather than a bad request, and
    // would page whoever owns the service instead of telling the caller what it did wrong.
    expect(() => encodePathSegment('..')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it.each([
    ['a lone high surrogate', '\ud800'],
    ['a lone low surrogate', '\udc00'],
    ['a surrogate buried in an otherwise ordinary uid', 'uid-\ud83d-tail'],
  ])('refuses %s as a bad request rather than crashing on it', (_label, malformed) => {
    // `encodeURIComponent` throws `URIError` on an unpaired surrogate, and `JSON.parse` accepts one,
    // so this arrives from a request body that the batch handlers only check `typeof === 'string'`
    // on. Unhandled it reaches the error middleware as an unrecognized error and answers 500, which
    // pages whoever owns the service over a payload the caller malformed.
    expect(() => encodeURIComponent(malformed)).toThrow(URIError);

    expect(() => encodePathSegment(malformed)).toThrow(ServiceValidationError);
    expect(() => encodePathSegment(malformed)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('strips the query and fragment delimiters that would otherwise truncate the path', () => {
    // `?` and `#` end the path, so an unencoded one turns the rest of the template — including the
    // sub-resource the route was aiming at — into a query string the upstream router never sees.
    expect(encodePathSegment('uid?x=1#frag')).toBe('uid%3Fx%3D1%23frag');
  });

  it.each([
    ['a uuid', '7f3c1a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'],
    ['a slug', 'cncf-kubernetes'],
  ])('is a no-op on %s, the shape every legitimate identifier has', (_label, identifier) => {
    expect(encodePathSegment(identifier)).toBe(identifier);
  });
});

describe('resolved-address SSRF gate uses the shared judge', () => {
  /**
   * This path used to gate on a module-local `PRIVATE_IP_PATTERNS` regex list while the rest of
   * the codebase hardened `isPrivateHost`. The two diverged badly, and the weaker one guarded
   * the REAL fetch: nine of ten sampled addresses that isPrivateHost rejects passed here,
   * including CGNAT, 6to4, multicast, site-local and the reserved ranges.
   *
   * Each case is a range the OLD list missed, so every one of them fails if the shared judge is
   * swapped back out for a local list.
   */
  it.each([
    ['CGNAT (100.64/10)', '100.64.0.1'],
    ['CGNAT upper bound', '100.127.255.254'],
    ['6to4 (2002::/16)', '2002:a00:1::'],
    ['IPv4 multicast', '224.0.0.1'],
    ['IPv6 site-local', 'fec0::1'],
    ['RFC 2544 benchmark space', '198.18.0.1'],
    ['RFC 5737 documentation space', '192.0.2.1'],
    ['limited broadcast', '255.255.255.255'],
    ['reserved 240/4', '240.0.0.1'],
  ])('blocks a host resolving to %s', async (_label, address) => {
    // Imported inside the test, matching this file's existing convention.
    const dns = await import('node:dns');
    const { fetchSafeUrl } = await import('./url-validation');
    vi.mocked(dns.promises.resolve4).mockResolvedValueOnce(address.includes(':') ? [] : [address]);
    vi.mocked(dns.promises.resolve6).mockResolvedValueOnce(address.includes(':') ? [address] : []);

    // Rejected at RESOLUTION time, before any socket is opened -- which is why these cases need
    // no server, unlike the redirect tests above.
    await expect(fetchSafeUrl('https://events.example.com/e', new AbortController().signal)).rejects.toThrow(/private IP/);
  });

  it('does not reject a genuinely public address at the resolution gate', async () => {
    const dns = await import('node:dns');
    const { fetchSafeUrl } = await import('./url-validation');
    const callsBefore = vi.mocked(dns.promises.resolve4).mock.calls.length;
    vi.mocked(dns.promises.resolve4).mockResolvedValueOnce(['93.184.216.34']);
    vi.mocked(dns.promises.resolve6).mockResolvedValueOnce([]);

    // The CONTROL for the cases above: without it, a gate that refused EVERYTHING would pass all
    // nine of them.
    //
    // "no private-IP rejection" alone is too weak -- a run that never reached the gate would
    // also satisfy it -- so the resolver being CALLED is asserted as well. Together they say the
    // address was judged and passed, which is the property the nine cases are being compared
    // against. What the transport does afterwards belongs to the redirect tests.
    let rejection = '';
    try {
      await fetchSafeUrl('https://events.example.com/e', new AbortController().signal);
    } catch (error) {
      rejection = error instanceof Error ? error.message : String(error);
    }
    // Counted ACROSS THIS TEST, not asserted against call history. Nothing clears these mocks
    // between tests and all nine cases above use the same hostname, so both `toHaveBeenCalled()`
    // and `toHaveBeenCalledWith('events.example.com')` are already satisfied before this test
    // runs -- neither can fail, which makes them controls that prove nothing. A delta is the
    // only form that actually witnesses THIS invocation.
    expect(vi.mocked(dns.promises.resolve4).mock.calls.length).toBeGreaterThan(callsBefore);
    expect(rejection).not.toMatch(/private IP/);
  });
});

describe('fetch path enforces the shared port allow-list', () => {
  /**
   * `refuseUnfetchablePort` lives in `@lfx-one/shared/utils/url.utils` and is called from BOTH
   * this path and `canonicalHttpUrl`, so the two cannot drift. They did drift once:
   * `canonicalHttpUrl` persisted `:8443` on a public host while this path refused it, meaning a
   * url one validator approved was one the other would reject.
   *
   * The canonicalizer's half is covered in `url.utils.spec.ts`. This is the fetch-path half.
   */
  it.each([
    ['a non-standard https port', 'https://events.example.com:8443/e'],
    ['an SSH port', 'https://events.example.com:22/e'],
    ['a high ephemeral port', 'https://events.example.com:49152/e'],
  ])('refuses %s', async (_label, url) => {
    const { fetchSafeUrl } = await import('./url-validation');

    // Refused before DNS resolution, so no mock is needed -- the port gate runs on the parsed
    // URL, ahead of the address checks above.
    await expect(fetchSafeUrl(url, new AbortController().signal)).rejects.toThrow(/Only ports 80 and 443/);
  });

  it('allows an explicit default port', async () => {
    // The CONTROL: WHATWG drops a default port, so `:443` must not be mistaken for a custom one.
    // Without this, a gate that refused every explicit port would pass the cases above.
    const dns = await import('node:dns');
    const { fetchSafeUrl } = await import('./url-validation');
    vi.mocked(dns.promises.resolve4).mockResolvedValueOnce(['93.184.216.34']);
    vi.mocked(dns.promises.resolve6).mockResolvedValueOnce([]);

    await expect(fetchSafeUrl('https://events.example.com:443/e', new AbortController().signal)).rejects.not.toThrow(/Only ports/);
  });
});
