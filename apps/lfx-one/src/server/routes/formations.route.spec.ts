// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { createFormation, getFormationByUid, isImpersonating, logger } = vi.hoisted(() => ({
  createFormation: vi.fn(),
  getFormationByUid: vi.fn(),
  isImpersonating: vi.fn<() => boolean>(() => false),
  logger: {
    warning: vi.fn(),
    error: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));

vi.mock('../controllers/formation.controller', () => ({
  FormationController: class {
    public createFormation = createFormation;
    public getFormationByUid = getFormationByUid;
  },
}));
vi.mock('../utils/auth-helper', () => ({ isImpersonating }));
vi.mock('../services/logger.service', () => ({ logger }));

const formationsRouter = (await import('./formations.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

function ok(_req: express.Request, res: express.Response): void {
  res.json({ ok: true });
}

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.appSession = {
      impersonationToken: 'target-token',
      impersonationExpiresAt: Date.now() + 60_000,
      impersonator: { sub: 'actor-sub' },
      impersonationUser: { sub: 'target-sub' },
    };
    next();
  });
  app.use('/api/formations', formationsRouter);
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
  createFormation.mockImplementation(ok);
  getFormationByUid.mockImplementation(ok);
});

/**
 * Pins that `blockDuringImpersonation` is actually wired on `POST /` (not just imported) — see
 * `formations.route.ts`'s comment: `createFormation` records `submitted_by` via
 * `getEffectiveUsername(req)`, so an impersonated write would be recorded as, and later only
 * readable by, the target user. The unit tests for `blockDuringImpersonation` itself call the
 * middleware directly and would keep passing if this router dropped the registration entirely.
 */
describe('formations router impersonation boundary', () => {
  it('keeps reading a formation by uid while impersonating', async () => {
    isImpersonating.mockReturnValue(true);

    const response = await fetch(`${baseUrl}/api/formations/some-uid`);

    expect(response.status).toBe(200);
    expect(getFormationByUid).toHaveBeenCalled();
  });

  it('blocks submitting a formation while impersonating', async () => {
    isImpersonating.mockReturnValue(true);

    const response = await fetch(`${baseUrl}/api/formations`, { method: 'POST' });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('IMPERSONATION_READ_ONLY');
    expect(createFormation).not.toHaveBeenCalled();
  });

  it('reaches the controller when not impersonating', async () => {
    const response = await fetch(`${baseUrl}/api/formations`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(createFormation).toHaveBeenCalled();
  });
});
