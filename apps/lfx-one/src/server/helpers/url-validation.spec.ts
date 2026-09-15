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
  // 203.0.113.0/24 is TEST-NET-3 (RFC 5737) — routable-looking, so it clears the private-IP
  // patterns, and reserved for documentation, so it can never be a real host.
  promises: { resolve4: vi.fn(async () => ['203.0.113.10']), resolve6: vi.fn(async () => []) },
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
