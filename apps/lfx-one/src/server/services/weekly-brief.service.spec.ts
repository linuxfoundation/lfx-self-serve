// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts / committee.controller.spec.ts: the `@lfx-one/shared/*`
// alias isn't wired into this app's vitest config, so runtime collaborators need mocking —
// including `constants`, since this service spreads WEEKLY_BRIEF_DEFAULT_THROTTLE at runtime
// (not just a type import).
const { proxyRequest, proxyRequestWithResponse } = vi.hoisted(() => ({ proxyRequest: vi.fn(), proxyRequestWithResponse: vi.fn() }));

vi.mock('@lfx-one/shared/constants', () => ({
  WEEKLY_BRIEF_DEFAULT_THROTTLE: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3 },
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { WeeklyBriefService } from './weekly-brief.service';

const req = {} as unknown as Request;

describe('WeeklyBriefService', () => {
  let service: WeeklyBriefService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    proxyRequest.mockReset();
    proxyRequestWithResponse.mockReset();
    process.env = { ...originalEnv };
    service = new WeeklyBriefService();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('mock mode (WEEKLY_BRIEF_BACKEND unset)', () => {
    beforeEach(() => {
      delete process.env['WEEKLY_BRIEF_BACKEND'];
      delete process.env['NODE_ENV'];
    });

    it('getCurrentBrief returns a canned brief without calling upstream', async () => {
      const result = await service.getCurrentBrief(req, 'committee-1');
      expect(result.brief).not.toBeNull();
      expect(result.brief?.committee_uid).toBe('committee-1');
      expect(proxyRequest).not.toHaveBeenCalled();
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('generateBrief returns status 200 (synchronous mock completion) without calling upstream', async () => {
      const { status, data } = await service.generateBrief(req, 'committee-1', {});
      expect(status).toBe(200);
      expect(data.brief.state).toBe('generated');
      expect(proxyRequest).not.toHaveBeenCalled();
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });

    it('saveBrief bumps the revision and marks the brief edited', async () => {
      const result = await service.saveBrief(req, 'committee-1', { brief_text: 'updated text', revision: 1 });
      expect(result.state).toBe('edited');
      expect(result.brief_text).toBe('updated text');
      expect(result.revision).toBe(2);
    });

    it('refuses to serve mock data when NODE_ENV=production (LFXV2-2175 review: no auth in mock mode)', async () => {
      process.env['NODE_ENV'] = 'production';
      await expect(service.getCurrentBrief(req, 'committee-1')).rejects.toThrow(/WEEKLY_BRIEF_BACKEND must be "live"/);
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('live mode (WEEKLY_BRIEF_BACKEND=live)', () => {
    beforeEach(() => {
      process.env['WEEKLY_BRIEF_BACKEND'] = 'live';
    });

    it('getCurrentBrief proxies straight through and does not swallow a 404', async () => {
      const upstreamResult = {
        brief: null,
        throttle: { generates_used: 0, generates_limit: 2, regenerations_used: 0, regenerations_limit: 3, window_resets_at: '2026-01-01T00:00:00Z' },
      };
      proxyRequest.mockResolvedValueOnce(upstreamResult);

      const result = await service.getCurrentBrief(req, 'committee-1');

      expect(result).toBe(upstreamResult);
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/committees/committee-1/weekly-briefs/current', 'GET');
    });

    it('getCurrentBrief propagates a 404 as a real error instead of normalizing it to an empty brief', async () => {
      const notFound = Object.assign(new Error('not found'), { statusCode: 404 });
      proxyRequest.mockRejectedValueOnce(notFound);

      await expect(service.getCurrentBrief(req, 'committee-1')).rejects.toBe(notFound);
    });

    it('generateBrief forwards the real upstream status code (202 accepted)', async () => {
      const data = { brief: { uid: 'b1', state: 'generating' }, throttle: {} };
      proxyRequestWithResponse.mockResolvedValueOnce({ status: 202, data, statusText: 'Accepted', headers: {} });

      const result = await service.generateBrief(req, 'committee-1', { force: true });

      expect(result.status).toBe(202);
      expect(result.data).toBe(data);
      expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/committees/committee-1/weekly-briefs/generate', 'POST', undefined, {
        force: true,
      });
    });

    it('URL-encodes the committeeId path segment', async () => {
      proxyRequest.mockResolvedValueOnce({ brief: null, throttle: {} });
      await service.getCurrentBrief(req, 'a/b c');
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/committees/a%2Fb%20c/weekly-briefs/current', 'GET');
    });
  });
});
