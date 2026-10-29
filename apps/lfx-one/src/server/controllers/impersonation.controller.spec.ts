// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exchangeToken, fetchTargetUserProfile, startImpersonation, resolveRealAccessToken, decodeJwtPayload } = vi.hoisted(() => ({
  exchangeToken: vi.fn(),
  fetchTargetUserProfile: vi.fn(),
  startImpersonation: vi.fn(),
  resolveRealAccessToken: vi.fn(),
  decodeJwtPayload: vi.fn(),
}));

vi.mock('../services/impersonation.service', () => ({
  ImpersonationService: vi.fn().mockImplementation(function () {
    return { exchangeToken, fetchTargetUserProfile, startImpersonation };
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/auth-helper', () => ({ resolveRealAccessToken, decodeJwtPayload }));

import { AuthorizationError } from '../errors';
import { ImpersonationController } from './impersonation.controller';

describe('ImpersonationController.startImpersonation', () => {
  const controller = new ImpersonationController();
  const res = { json: vi.fn() } as unknown as Response;
  let next: NextFunction;

  const buildReq = (appSession: Record<string, unknown> = {}): Request =>
    ({
      body: { targetUser: 'jdoe' },
      appSession,
      bearerToken: 'current-bearer',
      oidc: { accessToken: { access_token: 'real-token' } },
    }) as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
    decodeJwtPayload.mockImplementation((token: string) =>
      token === 'target-token' ? { sub: 'auth0|target', 'http://lfx.dev/claims/email': 'j@example.test' } : { 'http://lfx.dev/claims/can_impersonate': true }
    );
    resolveRealAccessToken.mockResolvedValue('real-token');
    exchangeToken.mockResolvedValue({ access_token: 'target-token', token_type: 'Bearer', expires_in: 3600 });
    fetchTargetUserProfile.mockResolvedValue({});
  });

  it('switches users while already impersonating, exchanging the impersonator token', async () => {
    const req = buildReq({ impersonationToken: 'old-target-token' });

    await controller.startImpersonation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(exchangeToken).toHaveBeenCalledWith(req, 'jdoe', 'real-token');
    expect(startImpersonation).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ impersonating: true }));
  });

  it('rejects switching to the user already being impersonated', async () => {
    decodeJwtPayload.mockImplementation((token: string) =>
      token === 'target-token' ? { sub: 'auth0|target' } : { 'http://lfx.dev/claims/can_impersonate': true }
    );
    const req = buildReq({ impersonationToken: 'old-target-token', impersonationUser: { sub: 'auth0|target' } });

    await controller.startImpersonation(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, code: 'ALREADY_IMPERSONATING_TARGET' }));
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it('rejects when the real token lacks the can_impersonate claim', async () => {
    decodeJwtPayload.mockReturnValue({});

    await controller.startImpersonation(buildReq({ impersonationToken: 'old-target-token' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(exchangeToken).not.toHaveBeenCalled();
  });

  it('fails closed when the real session token cannot be resolved', async () => {
    resolveRealAccessToken.mockResolvedValue(null);

    await controller.startImpersonation(buildReq({ impersonationToken: 'old-target-token' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(exchangeToken).not.toHaveBeenCalled();
    expect(startImpersonation).not.toHaveBeenCalled();
  });
});
