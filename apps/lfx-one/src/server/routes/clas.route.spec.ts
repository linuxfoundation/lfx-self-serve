// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the read-only-impersonation gate on the Sign CLA hand-off (#1251).
 *
 * The middleware has its own behaviour; what these tests protect is the *registration*. Signing
 * is a binding legal act with no way to attribute it back to an impersonator, so the hand-off is
 * exactly the class of write `blockDuringImpersonation` exists for. A unit test of the controller
 * would keep passing if the middleware were dropped from the route — which is the regression that
 * matters, because the failure mode is a signature recorded against the wrong person.
 *
 * The read routes are asserted alongside it: impersonated *viewing* of My CLAs must keep working,
 * so a blanket `router.use` would be a bug, not a safer default.
 */

const { getMyClas, getPdfUrl, getSignHandoff, getClaGroupOptions } = vi.hoisted(() => ({
  getMyClas: vi.fn(),
  getPdfUrl: vi.fn(),
  getSignHandoff: vi.fn(),
  getClaGroupOptions: vi.fn(),
}));
const { isImpersonating } = vi.hoisted(() => ({ isImpersonating: vi.fn<() => boolean>(() => false) }));

vi.mock('../controllers/clas.controller', () => ({
  ClasController: class {
    public getMyClas = getMyClas;
    public getPdfUrl = getPdfUrl;
    public getSignHandoff = getSignHandoff;
    public getClaGroupOptions = getClaGroupOptions;
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
  getSignHandoff.mockImplementation(ok);
  getClaGroupOptions.mockImplementation(ok);
});

describe('clas router — Sign CLA hand-off during impersonation', () => {
  it('refuses the hand-off while impersonating', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await fetch(`${baseUrl}/api/me/clas/sign-handoff`);

    expect(res.status).toBe(403);
    // Asserted together with the status: a downstream failure could also produce 403, so the
    // status alone would not prove the gate produced it.
    expect(getSignHandoff).not.toHaveBeenCalled();
  });

  it('reports the read-only impersonation code, so the UI can explain it', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await fetch(`${baseUrl}/api/me/clas/sign-handoff`);

    expect((await res.json()).code).toBe('IMPERSONATION_READ_ONLY');
  });

  it('allows the hand-off in a normal session', async () => {
    const res = await fetch(`${baseUrl}/api/me/clas/sign-handoff`);

    expect(res.status).toBe(200);
    expect(getSignHandoff).toHaveBeenCalled();
  });

  it.each([
    ['My CLAs list', '/api/me/clas'],
    ['PDF URL', '/api/me/clas/sig-1/pdf-url'],
    ['CLA group options', '/api/me/clas/sign-options'],
  ])('keeps %s readable while impersonating', async (_label, path) => {
    isImpersonating.mockReturnValue(true);

    const res = await fetch(`${baseUrl}${path}`);

    expect(res.status).toBe(200);
  });
});
