// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The response byte ceiling in `fetchSafeUrl`.
 *
 * `fetchSafeUrl` itself cannot be called here: its SSRF guard rejects `127.0.0.1` and `localhost`
 * outright — correctly, and that guard is the reason the helper exists — so there is no address a
 * test server can listen on that the real function would agree to fetch.
 *
 * What IS testable is the accumulation rule the ceiling adds, against a real socket streaming a
 * real unbounded response. This reproduces that handler exactly. It proves the mechanism (a
 * destroyed request and a rejection, rather than a buffer that grows until the 15s timeout); the
 * wiring into `fetchSafeUrl` is a two-line read in the same file.
 */
describe('fetchSafeUrl response byte ceiling', () => {
  const MAX_RESPONSE_BYTES = 64 * 1024;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    // Streams forever. This is the shape the ceiling exists for: the 15s timeout bounds TIME, and
    // on a fast link a server can push gigabytes into memory inside it.
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

  function fetchWithCeiling(): Promise<{ length: number }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ length: Buffer.concat(chunks).length }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  }

  // REJECTS rather than truncates. A truncated page is one that lies about its own content, and
  // would reach the extraction prompt as though complete; failing loudly is the honest outcome.
  it('abandons a response that never ends instead of buffering it', async () => {
    const started = Date.now();

    await expect(fetchWithCeiling()).rejects.toThrow(/exceeded 65536 bytes/);

    // Far below the 15s timeout that would otherwise bound this. Loose against CI variance, but
    // an unbounded read of an infinite stream cannot finish this fast.
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
