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

  it('still redirects an anonymous GET to a protected SSR route', async () => {
    const req = buildReq({ path: '/foundation/overview' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  // LFXV2-2579 — public "View Online" newsletter page and its backing API route.
  // Both must be public (no login redirect / no 401) and must not fail-open onto
  // sibling authenticated newsletter routes.

  it('allows an anonymous GET to the public newsletter "View Online" SSR page', async () => {
    const req = buildReq({ path: '/newsletters/project-123/nl-456/view' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('allows an anonymous GET to the public newsletter "View Online" API route', async () => {
    const req = buildReq({ path: '/public/api/newsletters/project-123/nl-456' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.oidc.login).not.toHaveBeenCalled();
  });

  it('still redirects an anonymous GET to the authenticated newsletter edit route (no fail-open)', async () => {
    const req = buildReq({ path: '/newsletters/project-123/nl-456/edit' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('still redirects an anonymous GET to the authenticated newsletter analytics route (no fail-open)', async () => {
    const req = buildReq({ path: '/newsletters/project-123/nl-456/analytics' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });

  it('still redirects an anonymous GET to the authenticated "my newsletters" route (no fail-open)', async () => {
    const req = buildReq({ path: '/newsletters/my' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(res.oidc.login).toHaveBeenCalledTimes(1);
  });
});
