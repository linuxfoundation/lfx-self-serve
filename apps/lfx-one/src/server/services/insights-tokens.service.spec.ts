// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, loggerWarning, getUsernameFromAuth, generateM2MToken } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  loggerWarning: vi.fn(),
  getUsernameFromAuth: vi.fn(),
  generateM2MToken: vi.fn(),
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: loggerWarning,
    debug: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config.
vi.mock('@lfx-one/shared/constants', () => import('../../../../../packages/shared/src/constants/insights-tokens.constants'));

import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { InsightsTokensService } from './insights-tokens.service';

const req = { bearerToken: 'user-token' } as unknown as Request;

const patToken = {
  uid: '8d4c5a2e-3b1f-4c6d-9e7a-1f2b3c4d5e6f',
  name: 'ci-pipeline',
  audience: 'insights',
  lookup_id: 'Ab3kZ9QmT2xL',
  username: 'jdoe',
  created_at: '2026-09-21T12:00:00Z',
};

describe('InsightsTokensService', () => {
  let service: InsightsTokensService;

  beforeEach(() => {
    proxyRequest.mockReset();
    loggerWarning.mockReset();
    getUsernameFromAuth.mockReset().mockResolvedValue('jdoe');
    generateM2MToken.mockReset().mockResolvedValue('m2m-token');
    service = new InsightsTokensService();
  });

  describe('listTokens', () => {
    it('forces the insights audience and maps snake_case to camelCase', async () => {
      proxyRequest.mockResolvedValueOnce({ tokens: [patToken, { ...patToken, uid: 'u2', last_used_at: '2026-09-22T08:30:00Z' }] });

      const tokens = await service.listTokens(req);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/tokens', 'GET', { v: '1', audience: 'insights' });
      expect(tokens).toEqual([
        { uid: patToken.uid, name: 'ci-pipeline', lookupId: 'Ab3kZ9QmT2xL', createdAt: '2026-09-21T12:00:00Z', lastUsedAt: null },
        { uid: 'u2', name: 'ci-pipeline', lookupId: 'Ab3kZ9QmT2xL', createdAt: '2026-09-21T12:00:00Z', lastUsedAt: '2026-09-22T08:30:00Z' },
      ]);
    });

    it('returns an empty list when upstream omits tokens', async () => {
      proxyRequest.mockResolvedValueOnce({});
      expect(await service.listTokens(req)).toEqual([]);
    });
  });

  describe('createToken', () => {
    it('posts name with the fixed audience using the user bearer and returns the secret once', async () => {
      proxyRequest.mockResolvedValueOnce({ secret: 'lfi_Ab3kZ9QmT2xLsecret', token: patToken });

      const created = await service.createToken(req, 'ci-pipeline');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/tokens', 'POST', { v: '1' }, { name: 'ci-pipeline', audience: 'insights' });
      expect(created.secret).toBe('lfi_Ab3kZ9QmT2xLsecret');
      expect(created.token.lookupId).toBe('Ab3kZ9QmT2xL');
    });
  });

  describe('revokeToken', () => {
    it('deletes by uid', async () => {
      proxyRequest.mockResolvedValueOnce(undefined);
      await service.revokeToken(req, patToken.uid);
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/tokens/${patToken.uid}`, 'DELETE', { v: '1' });
    });
  });

  describe('getEligibility', () => {
    it('is eligible when any org has a company name, without inspecting the tier, and scopes M2M to the call', async () => {
      proxyRequest.mockResolvedValueOnce([
        { b2b_org_uid: 'org-1', company_name: 'Acme Corporation', tier: 'silver' },
        { b2b_org_uid: 'org-1', company_name: 'Acme Corporation', tier: 'gold' },
        { b2b_org_uid: 'org-2', company_name: '  ', tier: 'platinum' },
        { b2b_org_uid: 'org-3' },
      ]);

      const result = await service.getEligibility(req);

      expect(result).toEqual({ canCreate: true, orgs: [{ uid: 'org-1', name: 'Acme Corporation' }], checkFailed: false });
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/b2b_orgs/member-tiers/jdoe', 'GET', { v: '1' }, undefined, undefined, {
        bearerToken: 'm2m-token',
      });
      expect(req.bearerToken).toBe('user-token');
    });

    it('encodes the username in the path', async () => {
      getUsernameFromAuth.mockResolvedValueOnce('a/b c');
      proxyRequest.mockResolvedValueOnce([]);
      await service.getEligibility(req);
      expect(proxyRequest.mock.calls[0][2]).toBe('/b2b_orgs/member-tiers/a%2Fb%20c');
    });

    it('is ineligible when the user is not a key contact of any org', async () => {
      proxyRequest.mockResolvedValueOnce([]);
      expect(await service.getEligibility(req)).toEqual({ canCreate: false, orgs: [], checkFailed: false });
    });

    it('fails closed when the tier endpoint errors', async () => {
      proxyRequest.mockRejectedValueOnce(new Error('403 Forbidden'));
      expect(await service.getEligibility(req)).toEqual({ canCreate: false, orgs: [], checkFailed: true });
      expect(loggerWarning).toHaveBeenCalled();
    });

    it('keeps the username out of the failure log, even though the upstream error path carries it', async () => {
      proxyRequest.mockRejectedValueOnce(
        MicroserviceError.fromMicroserviceResponse(403, 'Forbidden', {}, 'LFX_V2_SERVICE', '/b2b_orgs/member-tiers/jdoe', 'get__b2b_orgs_member-tiers_jdoe')
      );
      await service.getEligibility(req);
      expect(loggerWarning).toHaveBeenCalledWith(req, 'get_insights_token_eligibility', expect.any(String), { status: 403, code: 'FORBIDDEN' });
      expect(JSON.stringify(loggerWarning.mock.calls)).not.toContain('jdoe');
    });

    it('fails closed when the M2M token cannot be minted', async () => {
      generateM2MToken.mockRejectedValueOnce(new Error('auth down'));
      expect(await service.getEligibility(req)).toEqual({ canCreate: false, orgs: [], checkFailed: true });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('fails closed without calling upstream when there is no username', async () => {
      getUsernameFromAuth.mockResolvedValueOnce(null);
      expect(await service.getEligibility(req)).toEqual({ canCreate: false, orgs: [], checkFailed: false });
      expect(generateM2MToken).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });
});
