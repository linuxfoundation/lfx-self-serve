// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the read-only-impersonation gate on the prepare-sign write (#1252).
 *
 * The middleware has its own behaviour; what these tests protect is the *registration*. A unit
 * test of the controller would keep passing if the middleware were dropped from the route — which
 * is the regression that matters, because the failure mode is a signing session opened against
 * the impersonated person's EasyCLA record, attributed to them rather than to the administrator
 * who caused it, with no in-payload trace of who did.
 *
 * The read routes are asserted alongside it: impersonated *viewing* of CLAs and of the linked
 * accounts must keep working, so a blanket `router.use` would be a bug, not a safer default.
 */

const { getMyClas, getPdfUrl, getClaGroupOptions, getGithubAccounts, prepareSign } = vi.hoisted(() => ({
  getMyClas: vi.fn(),
  getPdfUrl: vi.fn(),
  getClaGroupOptions: vi.fn(),
  getGithubAccounts: vi.fn(),
  prepareSign: vi.fn(),
}));
const { isImpersonating } = vi.hoisted(() => ({ isImpersonating: vi.fn<() => boolean>(() => false) }));

vi.mock('../controllers/clas.controller', () => ({
  ClasController: class {
    public getMyClas = getMyClas;
    public getPdfUrl = getPdfUrl;
    public getClaGroupOptions = getClaGroupOptions;
    public getGithubAccounts = getGithubAccounts;
    public prepareSign = prepareSign;
  },
}));
vi.mock('../utils/auth-helper', () => ({ isImpersonating }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));

const clasRouter = (await import('./clas.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

/** Each controller stub just 200s — these tests assert only whether the gate let the request through. */
function ok(_req: express.Request, res: express.Response): void {
  res.json({ ok: true });
}

beforeAll(async () => {
  const app = express();
  app.use('/api/me', clasRouter);
  // The app's own handler, not a stand-in: the status and code a blocked hand-off returns are
  // part of what this test is asserting, so they should come from the same place production's do.
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  isImpersonating.mockReturnValue(false);
  getMyClas.mockImplementation(ok);
  getPdfUrl.mockImplementation(ok);
  getClaGroupOptions.mockImplementation(ok);
  getGithubAccounts.mockImplementation(ok);
  prepareSign.mockImplementation(ok);
});

describe('clas router — prepare-sign write during impersonation', () => {
  /** POST helper — the guarded route is a write, so it cannot be reached with a bare fetch. */
  function prepare(): Promise<Response> {
    return fetch(`${baseUrl}/api/me/clas/prepare-sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubId: '12345', claGroupId: '3fee6d72-0c80-4145-99c2-fb382b3a93fb' }),
    });
  }

  it('refuses to open a signing session while impersonating', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await prepare();

    expect(res.status).toBe(403);
    // Asserted together with the status: a downstream failure could also produce 403, so the
    // status alone would not prove the gate produced it.
    expect(prepareSign).not.toHaveBeenCalled();
  });

  it('reports the read-only impersonation code, so the UI can explain it', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await prepare();

    expect((await res.json()).code).toBe('IMPERSONATION_READ_ONLY');
  });

  it('allows the write in a normal session', async () => {
    const res = await prepare();

    expect(res.status).toBe(200);
    expect(prepareSign).toHaveBeenCalled();
  });

  it('no longer serves the retired signing-identity path', async () => {
    // The request contract changed (the CLA group is now required), so the old path is removed
    // rather than quietly given a new required field a leftover caller would omit.
    const res = await fetch(`${baseUrl}/api/me/clas/signing-identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubId: '12345' }),
    });

    expect(res.status).toBe(404);
  });

  it.each([
    ['CLAs list', '/api/me/clas'],
    ['PDF URL', '/api/me/clas/sig-1/pdf-url'],
    ['CLA group options', '/api/me/clas/sign-options'],
    ['linked GitHub accounts', '/api/me/clas/github-accounts'],
  ])('keeps %s readable while impersonating', async (_label, path) => {
    isImpersonating.mockReturnValue(true);

    const res = await fetch(`${baseUrl}${path}`);

    expect(res.status).toBe(200);
  });
});
