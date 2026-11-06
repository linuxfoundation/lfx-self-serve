// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccess = vi.fn();

vi.mock('../services/social-listening-access.service', () => ({
  socialListeningAccessService: { getAccess: (...args: unknown[]) => getAccess(...args) },
}));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

const { requireSocialListeningAccess } = await import('./require-social-listening-access.middleware');

function buildReq(query: Record<string, string> = {}): Request {
  return { path: '/api/social-listening/mentions-feed', query } as unknown as Request;
}

describe('requireSocialListeningAccess', () => {
  beforeEach(() => {
    getAccess.mockReset();
  });

  it('passes the requested foundation to the access policy and allows when it admits the caller', async () => {
    getAccess.mockResolvedValue({ canView: true, reason: 'group-member' });
    const next = vi.fn();
    const req = buildReq({ foundationSlug: 'tlf' });

    await requireSocialListeningAccess(req, {} as Response, next as unknown as NextFunction);

    expect(getAccess).toHaveBeenCalledWith(req, 'tlf');
    expect(next).toHaveBeenCalledWith();
  });

  it('403s with DASHBOARD_ACCESS_REQUIRED when the policy denies', async () => {
    getAccess.mockResolvedValue({ canView: false, reason: 'none' });
    const next = vi.fn();

    await requireSocialListeningAccess(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(getAccess).toHaveBeenCalledWith(expect.anything(), '');
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: 'DASHBOARD_ACCESS_REQUIRED' });
  });

  it('forwards unexpected errors', async () => {
    const error = new Error('boom');
    getAccess.mockRejectedValue(error);
    const next = vi.fn();

    await requireSocialListeningAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith(error);
  });
});
