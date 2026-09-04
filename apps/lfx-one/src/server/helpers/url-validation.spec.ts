// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import http from 'node:http';
import type https from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
