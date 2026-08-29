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

  it('captures impersonation as immutable request state during authentication', async () => {
    const req = buildReq({ path: '/api/rewards/summary', authenticated: true });
    req.appSession = {
      impersonationToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0YXJnZXQifQ.',
      impersonationExpiresAt: Date.now() + 60_000,
      impersonationUser: { username: 'targetuser' },
    };
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(req.impersonationActive).toBe(true);
    expect(req.bearerToken).toBe('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0YXJnZXQifQ.');
    expect(next).toHaveBeenCalledWith();
  });

  it('captures impersonation for required routes that do not extract a bearer token', async () => {
    const req = buildReq({ path: '/api/profile/auth/start', authenticated: true });
    req.appSession = {
      impersonationToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0YXJnZXQifQ.',
      impersonationExpiresAt: Date.now() + 60_000,
      impersonationUser: { username: 'targetuser' },
    };
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(req.impersonationActive).toBe(true);
    expect(req.bearerToken).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('allows an anonymous GET to a public contributor profile (/u/:username)', async () => {
    const req = buildReq({ path: '/u/johndoe' });
    req.appSession = {
      impersonationToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0YXJnZXQifQ.',
      impersonationExpiresAt: Date.now() + 60_000,
      impersonationUser: { username: 'targetuser' },
    };
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Public route → allow (next with no error), never a login redirect.
    expect(req.impersonationActive).toBe(false);
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

  it('returns a 401 (not a login redirect) for a malformed /api path so XHR clients get JSON', async () => {
    const req = buildReq({ path: '/api/foo/%ZZ' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // Decoding fails on the malformed escape, but a raw `/api`-prefixed path fails closed to the API
    // classification (`type: 'api'`, `required`, `tokenRequired`) rather than the SSR fallback. An
    // unauthenticated API route returns a 401 via `next(AuthenticationError)` — never an HTML login
    // redirect that a fetch/XHR client can't follow.
    expect(res.oidc.login).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'AuthenticationError' }));
  });

  it('returns a 401 (not a login redirect) for an encoded separator on an /api path', async () => {
    const req = buildReq({ path: '/api/foo/bar%2Fbaz' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // The catch block's other throw site: `bar%2Fbaz` decodes to `bar/baz`, reintroducing a separator (the `%ZZ`
    // cases throw inside `decodeURIComponent`). Still `apiFallback` → JSON 401, never an HTML login redirect.
    expect(res.oidc.login).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'AuthenticationError' }));
  });

  it('returns a 401 (not a login redirect) for a malformed /public/api path so XHR clients get JSON', async () => {
    const req = buildReq({ path: '/public/api/foo/%ZZ' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // `/public/api` normally allows anonymous (optional auth), but an undecodable path can't be trusted to
    // be that public route. It fails closed to the API classification (`type: 'api'`, `required`,
    // `tokenRequired`), so an unauthenticated request returns a JSON 401 via `next(AuthenticationError)`
    // rather than an HTML login redirect a fetch/XHR client can't follow.
    expect(res.oidc.login).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'AuthenticationError' }));
  });

  it('fails closed for an encoded separator on a /public/api path instead of fail-opening to optional auth', async () => {
    const req = buildReq({ path: '/public/api/foo%2Fbar' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // The sharp end of the `encoded path separator` throw: without it this would decode to `/public/api/foo/bar`,
    // match the `optional` row, and allow the request. Failing closed makes it a JSON 401 instead.
    expect(res.oidc.login).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'AuthenticationError' }));
  });

  it('does not treat a nested /groups/<id>/<sub> path as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/groups/abc123/edit' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('allows an anonymous GET to a public foundation group directory (/foundations/:slug/groups)', async () => {
    const req = buildReq({ path: '/foundations/acme/groups' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('does not treat a nested /foundations/:slug/groups/<sub> path as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/foundations/acme/groups/extra' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // No `/foundations/:slug/groups/<sub>` route exists in app.routes.ts — the anchor is now a single
    // trailing segment, so this falls through to the catch-all `required` row and redirects to login.
    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('allows an anonymous GET to a public project group directory (/projects/:slug/groups)', async () => {
    const req = buildReq({ path: '/projects/acme/groups' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('does not treat a nested /projects/:slug/groups/<sub> path as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/projects/acme/groups/extra' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('allows an anonymous GET to the public project calendar (/projects/:slug/calendar)', async () => {
    const req = buildReq({ path: '/projects/acme/calendar' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('does not treat a nested /projects/:slug/calendar/<sub> path as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/projects/acme/calendar/extra' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('allows an anonymous GET to the invite error page (/invite/error)', async () => {
    const req = buildReq({ path: '/invite/error' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('does not treat /invite/error-extra as public (anchored regex, no fail-open)', async () => {
    const req = buildReq({ path: '/invite/error-extra' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    // A bare-string pattern would `startsWith`-match this; the anchored regex requires an exact
    // (optionally trailing-slash) path, so this falls through to the catch-all and redirects to login.
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
