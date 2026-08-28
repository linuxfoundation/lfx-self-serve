// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSummary, isImpersonating, logger, redeemPromotion } = vi.hoisted(() => ({
  getSummary: vi.fn(),
  isImpersonating: vi.fn<() => boolean>(() => false),
  logger: {
    warning: vi.fn(),
    error: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
  redeemPromotion: vi.fn(),
}));

vi.mock('../controllers/rewards.controller', () => ({
  RewardsController: class {
    public getSummary = getSummary;
    public redeemPromotion = redeemPromotion;
  },
}));
vi.mock('../utils/auth-helper', () => ({ isImpersonating }));
vi.mock('../services/logger.service', () => ({ logger }));

const rewardsRouter = (await import('./rewards.route')).default;
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
  app.use('/api/rewards', rewardsRouter);
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
  getSummary.mockImplementation(ok);
  redeemPromotion.mockImplementation(ok);
});

describe('rewards router impersonation boundary', () => {
  it('keeps the rewards summary readable while impersonating', async () => {
    isImpersonating.mockReturnValue(true);

    const response = await fetch(`${baseUrl}/api/rewards/summary`);

    expect(response.status).toBe(200);
    expect(getSummary).toHaveBeenCalled();
  });

  it('blocks direct coupon generation before controller invocation', async () => {
    isImpersonating.mockReturnValue(true);

    const response = await fetch(`${baseUrl}/api/rewards/promotions/subscriber/redeem`, { method: 'POST' });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('IMPERSONATION_READ_ONLY');
    expect(redeemPromotion).not.toHaveBeenCalled();
  });

  it('records actor, target, action, and blocked outcome without coupon data', async () => {
    isImpersonating.mockReturnValue(true);

    await fetch(`${baseUrl}/api/rewards/promotions/subscriber/redeem`, { method: 'POST' });

    expect(logger.warning).toHaveBeenCalledWith(
      expect.anything(),
      'impersonation_readonly',
      'Blocked write during impersonation',
      expect.objectContaining({
        impersonator_sub: 'actor-sub',
        target_sub: 'target-sub',
        action: 'redeem',
        outcome: 'blocked',
      })
    );
    const logContext = logger.warning.mock.calls[0]?.[3];
    expect(logContext).not.toHaveProperty('coupon');
    expect(logContext).not.toHaveProperty('coupon_code');
  });
});
