// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listTokens, createToken, revokeToken, getEligibility } = vi.hoisted(() => ({
  listTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  getEligibility: vi.fn(),
}));

vi.mock('../services/insights-tokens.service', () => ({
  InsightsTokensService: class {
    public listTokens = listTokens;
    public createToken = createToken;
    public revokeToken = revokeToken;
    public getEligibility = getEligibility;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// The `@lfx-one/shared/*` aliases aren't wired into this app's vitest config, and the `utils` barrel
// pulls Angular-dependent modules; deep-import the real UUID and length checks so a regression still fails here.
vi.mock('@lfx-one/shared/constants', () => import('../../../../../packages/shared/src/constants/insights-tokens.constants'));
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await import('../../../../../packages/shared/src/utils/string.utils');
  return { codePointLength: actual.codePointLength, isUuid: actual.isUuid };
});

import { ServiceValidationError } from '../errors/service-validation.error';
import { InsightsTokensController } from './insights-tokens.controller';

const TOKEN_UID = '8d4c5a2e-3b1f-4c6d-9e7a-1f2b3c4d5e6f';
const token = { uid: TOKEN_UID, name: 'ci-pipeline', lookupId: 'Ab3kZ9QmT2xL', createdAt: '2026-09-21T12:00:00Z', lastUsedAt: null };

function mockRes(): Response {
  const res = { json: vi.fn(), send: vi.fn(), set: vi.fn() } as unknown as Response & { status: ReturnType<typeof vi.fn> };
  res.status = vi.fn(() => res);
  return res;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return { path: '/insights-tokens', body: {}, params: {}, ...overrides } as unknown as Request;
}

describe('InsightsTokensController', () => {
  let controller: InsightsTokensController;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new InsightsTokensController();
    next = vi.fn() as unknown as NextFunction;
  });

  it('lists tokens with no-store', async () => {
    listTokens.mockResolvedValueOnce([token]);
    const res = mockRes();

    await controller.listTokens(mockReq(), res, next);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith([token]);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes list errors to next', async () => {
    const error = new Error('upstream down');
    listTokens.mockRejectedValueOnce(error);

    await controller.listTokens(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('returns eligibility', async () => {
    getEligibility.mockResolvedValueOnce({ canCreate: true, orgs: [{ uid: 'org-1', name: 'Acme Corporation' }], checkFailed: false });
    const res = mockRes();

    await controller.getEligibility(mockReq(), res, next);

    expect(res.json).toHaveBeenCalledWith({ canCreate: true, orgs: [{ uid: 'org-1', name: 'Acme Corporation' }], checkFailed: false });
  });

  describe('createToken', () => {
    it.each([
      ['missing', undefined],
      ['blank', '   '],
      ['too long', 'x'.repeat(101)],
      ['control characters', 'bad\nname'],
      ['non-string', 42],
    ])('rejects a %s name without calling upstream', async (_label, name) => {
      await controller.createToken(mockReq({ body: { name } }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(createToken).not.toHaveBeenCalled();
    });

    it('counts the name in code points, like the PAT service, so 100 emoji are accepted', async () => {
      createToken.mockResolvedValueOnce({ token, secret: 'lfi_Ab3kZ9QmT2xLsecret' });
      const name = '🔑'.repeat(100);

      await controller.createToken(mockReq({ body: { name } }), mockRes(), next);

      expect(createToken).toHaveBeenCalledWith(expect.anything(), name);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects 101 emoji as too long', async () => {
      await controller.createToken(mockReq({ body: { name: '🔑'.repeat(101) } }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(createToken).not.toHaveBeenCalled();
    });

    it('creates with the trimmed name and returns 201 without caching', async () => {
      createToken.mockResolvedValueOnce({ token, secret: 'lfi_Ab3kZ9QmT2xLsecret' });
      const res = mockRes();

      await controller.createToken(mockReq({ body: { name: '  ci-pipeline  ' } }), res, next);

      expect(createToken).toHaveBeenCalledWith(expect.anything(), 'ci-pipeline');
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ ['Cache-Control']: 'no-store, no-cache, must-revalidate, private' }));
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ token, secret: 'lfi_Ab3kZ9QmT2xLsecret' });
    });

    it('passes service refusals (403, 503, upstream 409s) through to next', async () => {
      const conflict = new Error('token_name_taken');
      createToken.mockRejectedValueOnce(conflict);

      await controller.createToken(mockReq({ body: { name: 'ci-pipeline' } }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(conflict);
    });
  });

  describe('revokeToken', () => {
    it('rejects a non-UUID uid', async () => {
      await controller.revokeToken(mockReq({ params: { uid: 'not-a-uuid' } }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(revokeToken).not.toHaveBeenCalled();
    });

    it('revokes and returns 204', async () => {
      revokeToken.mockResolvedValueOnce(undefined);
      const res = mockRes();

      await controller.revokeToken(mockReq({ params: { uid: TOKEN_UID } }), res, next);

      expect(revokeToken).toHaveBeenCalledWith(expect.anything(), TOKEN_UID);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });
  });
});
