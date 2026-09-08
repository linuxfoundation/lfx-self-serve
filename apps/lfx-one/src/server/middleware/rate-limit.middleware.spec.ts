// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { aiRateLimiter } from './rate-limit.middleware';

// `aiRateLimiter` counts in the default in-process MemoryStore, so the counter is shared across
// every test in this file. express-rate-limit exposes no reset, so each test has to use its own key
// instead — and the keys are keyed off the test's own name rather than written by hand, so a test
// added later cannot silently land in a bucket an earlier test already drained.
const AI_LIMIT = 10;

/** The /56 prefix handed to each test name on first use — see `testIpv6Prefix`. */
const ipv6PrefixesByTest = new Map<string, string>();

/** A `sub` unique to the running test, so no two tests share a rate-limit bucket. */
function testSub(): string {
  return `auth0|${(expect.getState().currentTestName ?? 'unknown').replace(/[^a-z0-9]+/gi, '-')}`;
}

/**
 * An IPv6 /56 prefix unique to the running test.
 *
 * The limiter masks anonymous callers to /56 — the first three groups plus the high byte of the
 * fourth — so tests that need two addresses inside one bucket vary only the fourth group's low byte,
 * and a different prefix is a different bucket.
 *
 * Handed out sequentially on first use rather than hashed from the test name: a hash has to fold the
 * name into the 16 bits the third group holds, so two names could collide onto one prefix and share a
 * bucket — which is the exact failure this function exists to rule out.
 */
function testIpv6Prefix(): string {
  const name = expect.getState().currentTestName ?? 'unknown';
  const existing = ipv6PrefixesByTest.get(name);

  if (existing) {
    return existing;
  }

  const prefix = `2001:db8:${(ipv6PrefixesByTest.size + 1).toString(16).padStart(4, '0')}`;
  ipv6PrefixesByTest.set(name, prefix);

  return prefix;
}

// Minimal Express stand-ins. express-rate-limit only reads `req.ip`, `req.oidc` (through our
// keyGenerator) and `req.app.get('trust proxy')`, and only writes through `res.setHeader` plus
// `res.status().send()` on the reject path.
function buildReq(opts: { sub?: string; ip?: string }): Request {
  return {
    ip: opts.ip ?? '203.0.113.10',
    app: { get: () => undefined },
    ...(opts.sub ? { oidc: { user: { sub: opts.sub } } } : {}),
  } as unknown as Request;
}

function buildRes(): Response & { statusCode?: number; headers: Record<string, string> } {
  const headers: Record<string, string> = {};

  const res = {
    headersSent: false,
    headers,
    // Declared up front so `status()` writing to `this.statusCode` type-checks.
    statusCode: undefined as number | undefined,
    setHeader: (name: string, value: string) => {
      headers[name] = String(value);
    },
    getHeader: (name: string) => headers[name],
    status(code: number) {
      this.statusCode = code;

      return this;
    },
    send: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };

  return res as unknown as Response & { statusCode?: number; headers: Record<string, string> };
}

/** Drives the limiter once and reports whether the request was allowed through. */
async function request(opts: { sub?: string; ip?: string } = {}): Promise<{
  allowed: boolean;
  statusCode?: number;
  headers: Record<string, string>;
  body: unknown;
}> {
  const req = buildReq(opts);
  const res = buildRes();
  const next = vi.fn() as unknown as NextFunction;

  await aiRateLimiter(req, res, next);

  const sent = res.send as unknown as ReturnType<typeof vi.fn>;

  return {
    allowed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    statusCode: res.statusCode,
    headers: res.headers,
    // `undefined` when the limiter let the request through — it only writes a body on reject.
    body: sent.mock.calls[0]?.[0],
  };
}

describe('aiRateLimiter', () => {
  it('allows the first ten requests in the window and rejects the eleventh with 429', async () => {
    const sub = testSub();

    for (let attempt = 1; attempt <= AI_LIMIT; attempt++) {
      const result = await request({ sub });

      expect(result.allowed, `request ${attempt} should be allowed`).toBe(true);
    }

    const rejected = await request({ sub });

    // A 429 rather than a pass-through: the LiteLLM fan-out behind this route is the thing being
    // bounded, so exhausting the budget has to stop the request, not just annotate it.
    expect(rejected.allowed).toBe(false);
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['Retry-After']).toBe('60');
    // Asserted so the shape is on record: the limiter is configured with no `handler` and no
    // `message`, so a throttled caller gets express-rate-limit's default plain-text body — not this
    // app's JSON error envelope, and not something `HttpErrorService` can pull a `message` out of.
    // The client shows its own copy for a 429, so the body is unread today; a change to it is a
    // change to the endpoint's contract and should have to update this line.
    expect(rejected.body).toBe('Too many requests, please try again later.');
  });

  it('advertises the limit in the standard RateLimit headers, not the legacy X-RateLimit ones', async () => {
    const result = await request({ sub: testSub() });

    expect(result.headers['RateLimit-Limit']).toBe(String(AI_LIMIT));
    expect(result.headers['RateLimit-Policy']).toBe(`${AI_LIMIT};w=60`);
    expect(result.headers['X-RateLimit-Limit']).toBeUndefined();
  });

  it('keys on the authenticated sub so one user cannot exhaust a shared egress IP', async () => {
    const sharedIp = '198.51.100.7';
    const noisyNeighbour = `${testSub()}|noisy`;
    const innocentBystander = `${testSub()}|innocent`;

    // Burn the whole budget for one user behind the shared IP.
    for (let attempt = 1; attempt <= AI_LIMIT; attempt++) {
      await request({ sub: noisyNeighbour, ip: sharedIp });
    }

    expect((await request({ sub: noisyNeighbour, ip: sharedIp })).allowed).toBe(false);

    // A different user on the same IP still has their own budget — the whole point of keying on
    // `sub` rather than letting the IP fallback bucket a corporate NAT together.
    expect((await request({ sub: innocentBystander, ip: sharedIp })).allowed).toBe(true);
  });

  it('falls back to a /56-masked IP key for anonymous callers', async () => {
    const prefix = testIpv6Prefix();

    // Two addresses inside the same IPv6 /56 must share a bucket: masking is what stops a caller
    // with a routed prefix from minting a fresh budget per address.
    for (let attempt = 1; attempt <= AI_LIMIT; attempt++) {
      await request({ ip: `${prefix}:0001:0:0:0:1` });
    }

    expect((await request({ ip: `${prefix}:0001:0:0:0:1` })).allowed).toBe(false);
    expect((await request({ ip: `${prefix}:00ff:0:0:0:9` })).allowed).toBe(false);

    // A different /56 is a different caller and keeps its own budget. The fourth group's *high* byte
    // is what has to differ — `0100` and above leave the exhausted /56.
    expect((await request({ ip: `${prefix}:0100:0:0:0:1` })).allowed).toBe(true);
  });
});
