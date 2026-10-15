// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, isFlagEnabled } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  isFlagEnabled: vi.fn(),
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./launchdarkly-server.service', () => ({
  LaunchDarklyServerService: { getInstance: () => ({ isFlagEnabled }) },
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));
// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config.
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/insights-tokens.constants')),
  INSIGHTS_PUBLIC_API_TOKEN_ACCESS_FLAG: 'insights-public-api-token-access',
}));

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
    isFlagEnabled.mockReset().mockResolvedValue(false);
    service = new InsightsTokensService();
  });

  const eligible = { canCreate: true, checkFailed: false };

  describe('access gate', () => {
    const operations: [string, (s: InsightsTokensService) => Promise<unknown>][] = [
      ['listTokens', (s) => s.listTokens(req)],
      ['createToken', (s) => s.createToken(req, 'ci-pipeline')],
      ['revokeToken', (s) => s.revokeToken(req, patToken.uid)],
    ];

    it.each(operations)('%s refuses a user the flag is off for with 403 not_enabled, without calling the PAT service', async (_name, run) => {
      const error = (await run(service).catch((e: unknown) => e)) as MicroserviceError;

      expect(isFlagEnabled).toHaveBeenCalledWith(req, 'insights-public-api-token-access', false);
      expect(error).toBeInstanceOf(MicroserviceError);
      expect(error.statusCode).toBe(403);
      expect(error.toResponse()).toMatchObject({ upstreamCode: 'not_enabled' });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('lets a flag-enabled user create, list and revoke through the PAT service, using the user bearer', async () => {
      isFlagEnabled.mockResolvedValue(true);
      proxyRequest.mockResolvedValueOnce({ tokens: [] }).mockResolvedValueOnce({ token: patToken, secret: 'lfi_x' }).mockResolvedValueOnce(undefined);

      await service.listTokens(req);
      await service.createToken(req, 'ci-pipeline');
      await service.revokeToken(req, patToken.uid);

      expect(proxyRequest.mock.calls.map((call) => call[2])).toEqual(['/tokens', '/tokens', `/tokens/${patToken.uid}`]);
      expect(proxyRequest.mock.calls.every((call) => call[0] === req && call[1] === 'LFX_V2_SERVICE')).toBe(true);
    });
  });

  describe('getEligibility', () => {
    it('evaluates the flag on the server for the request, defaulting to off', async () => {
      await service.getEligibility(req);

      expect(isFlagEnabled).toHaveBeenCalledWith(req, 'insights-public-api-token-access', false);
    });

    it('is eligible when the flag is on for the user, with no upstream call', async () => {
      isFlagEnabled.mockResolvedValue(true);

      expect(await service.getEligibility(req)).toEqual({ canCreate: true, checkFailed: false });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('is ineligible when the flag is off, as a confirmed answer rather than a failed check', async () => {
      expect(await service.getEligibility(req)).toEqual({ canCreate: false, checkFailed: false });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('ignores anything the client sends', async () => {
      const forged = { bearerToken: 'user-token', headers: { 'x-insights-public-api-flag': 'true' } } as unknown as Request;

      expect(await service.getEligibility(forged)).toEqual({ canCreate: false, checkFailed: false });
      expect(isFlagEnabled).toHaveBeenCalledWith(forged, 'insights-public-api-token-access', false);
    });
  });

  describe('listTokens', () => {
    beforeEach(() => {
      vi.spyOn(service, 'getEligibility').mockResolvedValue(eligible);
    });

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
    beforeEach(() => {
      vi.spyOn(service, 'getEligibility').mockResolvedValue(eligible);
    });

    it('posts name with the fixed audience using the user bearer and returns the secret once', async () => {
      proxyRequest.mockResolvedValueOnce({ secret: 'lfi_Ab3kZ9QmT2xLsecret', token: patToken });

      const created = await service.createToken(req, 'ci-pipeline');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/tokens', 'POST', { v: '1' }, { name: 'ci-pipeline', audience: 'insights' });
      expect(created.secret).toBe('lfi_Ab3kZ9QmT2xLsecret');
      expect(created.token.lookupId).toBe('Ab3kZ9QmT2xL');
    });

    it('drops the refusal prose, which repeats the token name, but keeps the upstream code for the UI', async () => {
      proxyRequest.mockRejectedValueOnce(
        MicroserviceError.fromMicroserviceResponse(
          409,
          'Conflict',
          { error: 'token_name_taken', message: 'a token named "ci-pipeline" already exists' },
          'LFX_V2_SERVICE',
          '/tokens',
          'post__tokens'
        )
      );

      const error = (await service.createToken(req, 'ci-pipeline').catch((e: unknown) => e)) as MicroserviceError;

      expect(error).toBeInstanceOf(MicroserviceError);
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT');
      expect(error.toResponse()['upstreamCode']).toBe('token_name_taken');
      expect(JSON.stringify({ message: error.message, ...error.getLogContext(), ...error.toResponse() })).not.toContain('ci-pipeline');
    });

    it('rethrows non-upstream errors unchanged', async () => {
      const boom = new Error('socket hang up');
      proxyRequest.mockRejectedValueOnce(boom);
      await expect(service.createToken(req, 'ci-pipeline')).rejects.toBe(boom);
    });
  });

  describe('revokeToken', () => {
    beforeEach(() => {
      vi.spyOn(service, 'getEligibility').mockResolvedValue(eligible);
    });

    it('deletes by uid', async () => {
      proxyRequest.mockResolvedValueOnce(undefined);
      await service.revokeToken(req, patToken.uid);
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/tokens/${patToken.uid}`, 'DELETE', { v: '1' });
    });
  });
});
