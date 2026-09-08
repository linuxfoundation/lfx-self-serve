// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiRateLimiter } from './rate-limit.middleware';

// `aiRateLimiter` counts in the default in-process MemoryStore, so the counter is shared across
// every test in this file. Each test therefore uses its own key (a distinct `sub` or IP) rather
// than trying to reset the store, which express-rate-limit does not expose.
const AI_LIMIT = 10;

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
async function request(opts: { sub?: string; ip?: string }): Promise<{ allowed: boolean; statusCode?: number; headers: Record<string, string> }> {
  const req = buildReq(opts);
  const res = buildRes();
  const next = vi.fn() as unknown as NextFunction;

  await aiRateLimiter(req, res, next);

  return { allowed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0, statusCode: res.statusCode, headers: res.headers };
}

describe('aiRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the first ten requests in the window and rejects the eleventh with 429', async () => {
    const sub = 'auth0|budget-holder';

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
  });

  it('advertises the limit in the standard RateLimit headers, not the legacy X-RateLimit ones', async () => {
    const result = await request({ sub: 'auth0|header-reader' });

    expect(result.headers['RateLimit-Limit']).toBe(String(AI_LIMIT));
    expect(result.headers['RateLimit-Policy']).toBe(`${AI_LIMIT};w=60`);
    expect(result.headers['X-RateLimit-Limit']).toBeUndefined();
  });

  it('keys on the authenticated sub so one user cannot exhaust a shared egress IP', async () => {
    const sharedIp = '198.51.100.7';

    // Burn the whole budget for one user behind the shared IP.
    for (let attempt = 1; attempt <= AI_LIMIT; attempt++) {
      await request({ sub: 'auth0|noisy-neighbour', ip: sharedIp });
    }

    expect((await request({ sub: 'auth0|noisy-neighbour', ip: sharedIp })).allowed).toBe(false);

    // A different user on the same IP still has their own budget — the whole point of keying on
    // `sub` rather than letting the IP fallback bucket a corporate NAT together.
    expect((await request({ sub: 'auth0|innocent-bystander', ip: sharedIp })).allowed).toBe(true);
  });

  it('falls back to a /56-masked IP key for anonymous callers', async () => {
    // Two addresses inside the same IPv6 /56 must share a bucket: masking is what stops a caller
    // with a routed prefix from minting a fresh budget per address.
    for (let attempt = 1; attempt <= AI_LIMIT; attempt++) {
      await request({ ip: '2001:db8:aaaa:0001:0:0:0:1' });
    }

    expect((await request({ ip: '2001:db8:aaaa:0001:0:0:0:1' })).allowed).toBe(false);
    expect((await request({ ip: '2001:db8:aaaa:00ff:0:0:0:9' })).allowed).toBe(false);

    // A different /56 is a different caller and keeps its own budget.
    expect((await request({ ip: '2001:db8:bbbb:0001:0:0:0:1' })).allowed).toBe(true);
  });
});
