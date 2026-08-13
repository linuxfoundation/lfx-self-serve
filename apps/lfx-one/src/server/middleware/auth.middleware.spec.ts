// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The middleware's import graph transitively reaches Angular's partially-compiled @angular/common
// (via the shared logging/service chain). Under vitest that needs the JIT compiler as a fallback,
// so load it before importing the module under test.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createAuthMiddleware } from './auth.middleware';

// Minimal Express stand-ins. On the code paths exercised here the middleware only reads
// req.oidc.isAuthenticated(), req.path, req.method, req.originalUrl, req.cookies, and logs
// through req.log; the login-redirect path calls res.oidc.login(). Everything else is omitted.
function buildReq(opts: { path: string; method?: string; authenticated?: boolean }): Request {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    path: opts.path,
    originalUrl: opts.path,
    method: opts.method ?? 'GET',
    cookies: {},
    log,
    oidc: { isAuthenticated: () => opts.authenticated ?? false },
  } as unknown as Request;
}

function buildRes(): Response {
  return { oidc: { login: vi.fn(), logout: vi.fn() } } as unknown as Response;
}

describe('authMiddleware route classification', () => {
  const middleware = createAuthMiddleware();

  it('allows an anonymous GET to a public contributor profile (/u/:username)', async () => {
    const req = buildReq({ path: '/u/johndoe' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Public route → allow (next with no error), never a login redirect.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('allows an anonymous GET to /u/not-found', async () => {
    const req = buildReq({ path: '/u/not-found' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('does not treat a nested /u/<username>/<sub> path as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/u/johndoe/settings' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Two-segment path is outside the anchored `/u/<segment>` rule, so it falls through to the
    // catch-all `required` row and an unauthenticated SSR GET redirects to login.
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('allows an anonymous GET to a public meeting join (/meetings/:id)', async () => {
    const req = buildReq({ path: '/meetings/abc123' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('does not treat a nested /meetings/<id>/<sub> path as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/meetings/abc123/extra' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Deeper than the anchored `/meetings/<segment>` rule → falls through to the catch-all `required`
    // row, so an unauthenticated visitor reaches login before the in-shell catch-all 404 (LFXV2-3095).
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('does not treat the reserved /meetings/create segment as public (lookahead exclusion)', async () => {
    const req = buildReq({ path: '/meetings/create' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // `create` is excluded via `(?!create(?:[/;]|$))`, so it falls through to the catch-all `required`
    // row and an unauthenticated SSR GET redirects to login — matching the Angular `writerGuard` boundary.
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('does not treat /meetings/create with a matrix-parameter suffix as public (lookahead delimiter)', async () => {
    const req = buildReq({ path: '/meetings/create;source=link' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Express leaves the `;source=link` matrix suffix in `req.path` while Angular strips it and routes
    // the segment as the protected `create`. The `[/;]` delimiter in the lookahead excludes this case too,
    // so an anonymous SSR GET still redirects to login rather than fail-opening to optional auth.
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('does not treat a percent-encoded /meetings/%63reate as public (decode before classify)', async () => {
    const req = buildReq({ path: '/meetings/%63reate' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Express leaves `req.path` percent-encoded, so classification decodes each segment (`%63reate` →
    // `create`) to match Angular's decoded routing. The `create` lookahead then fires and the anonymous
    // SSR GET redirects to login instead of fail-opening to optional auth.
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an encoded path separator (/u%2Fsomeone) instead of fail-opening to public', async () => {
    const req = buildReq({ path: '/u%2Fsomeone' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Per-segment decoding: `%2F` decodes to `/` within a single segment, which would shift boundaries
    // and match the public `/u/:username` regex. Angular keeps `/u%2Fsomeone` as one segment and falls
    // through to the protected catch-all, so classification fails closed to `required` — an anonymous SSR
    // GET redirects to login rather than fail-opening onto the public profile route.
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('fails closed to required auth for a malformed percent-escape path', async () => {
    const req = buildReq({ path: '/meetings/%ZZ' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // A malformed escape throws in `decodeURIComponent`, so classification fails closed to the default
    // `required` row — an anonymous SSR GET redirects to login rather than being misclassified as public.
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('does not treat a nested /groups/<id>/<sub> path as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/groups/abc123/edit' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('still redirects an anonymous GET to a protected SSR route', async () => {
    const req = buildReq({ path: '/foundation/overview' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });
});
