// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as analytics.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the Social Listening gate (lfx-self-serve-ops#387). The middleware spec
 * calls `requireSocialListeningAccess` directly, so it would keep passing if the gate were dropped,
 * reordered, or moved ahead of the `/access` probe. These tests drive real HTTP requests through the
 * assembled router with the real middleware; only the access policy and the controller are stubbed.
 */

const getAccess = vi.fn();
const handled = vi.fn();

vi.mock('../services/social-listening-access.service', () => ({
  socialListeningAccessService: { getAccess: (...args: unknown[]) => getAccess(...args) },
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    // Read by the production `apiErrorHandler` mounted below.
    getLastOperation: vi.fn(),
  },
}));
vi.mock('../controllers/social-listening.controller', () => ({
  SocialListeningController: class {
    public constructor() {
      return new Proxy(
        {},
        {
          get:
            (_target, method: string) =>
            (_req: unknown, res: express.Response): void => {
              handled(method);
              res.json({ handledBy: method });
            },
        }
      );
    }
  },
}));

const { default: socialListeningRouter } = await import('./social-listening.route');
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/social-listening', socialListeningRouter);
  // The production error handler, so tests observe the status a real client receives.
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
  getAccess.mockReset();
  handled.mockReset();
});

describe('social-listening router — access gate ordering', () => {
  it('serves /access without running the policy, so a caller without access gets canView: false rather than a 403', async () => {
    const res = await fetch(`${baseUrl}/api/social-listening/access?foundationSlug=tlf`);

    expect(res.status).toBe(200);
    expect(handled).toHaveBeenCalledWith('getAccess');
    expect(getAccess).not.toHaveBeenCalled();
  });

  it.each(['/analytics-overview', '/preferences/Social%20Listening%20Bookmarks%20x'])(
    '403s GET %s when the policy denies, before the handler runs',
    async (path) => {
      getAccess.mockResolvedValue({ canView: false, reason: 'none' });

      const res = await fetch(`${baseUrl}/api/social-listening${path}?foundationSlug=tlf`);

      expect(res.status).toBe(403);
      expect(getAccess).toHaveBeenCalledWith(expect.anything(), 'tlf');
      expect(handled).not.toHaveBeenCalled();
    }
  );

  it('403s POST /mentions-feed when the policy denies, reading foundationSlug from the body', async () => {
    getAccess.mockResolvedValue({ canView: false, reason: 'none' });

    const res = await fetch(`${baseUrl}/api/social-listening/mentions-feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foundationSlug: 'tlf' }),
    });

    expect(res.status).toBe(403);
    expect(getAccess).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(handled).not.toHaveBeenCalled();
  });

  it('runs the handler when the policy admits the caller', async () => {
    getAccess.mockResolvedValue({ canView: true, reason: 'group-member' });

    const res = await fetch(`${baseUrl}/api/social-listening/mentions-feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foundationSlug: 'tlf' }),
    });

    expect(res.status).toBe(200);
    expect(handled).toHaveBeenCalledWith('getMentionsFeed');
  });
});
