// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

// The service resolves its request-scoped logger through this module; stubbing it here
// avoids booting the real pino instance for a synchronous, in-memory lookup path.
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

const { MentorshipMenteeService } = await import('./mentorship-mentee.service');
const { MicroserviceProxyService } = await import('./microservice-proxy.service');
const { MicroserviceError, ResourceNotFoundError } = await import('../errors');

const PROFILES_PATH = '/mentorship/v1/me/profiles';

function upstreamError(status: number, body: unknown) {
  return MicroserviceError.fromMicroserviceResponse(status, 'Upstream error', body, 'LFX_V2_SERVICE', PROFILES_PATH);
}

function buildReq(): Request {
  return { path: '/api/mentorship/mentee/apply-target' } as Request;
}

describe('MentorshipMenteeService.getMenteeApplyTarget', () => {
  let service: InstanceType<typeof MentorshipMenteeService>;

  beforeEach(() => {
    service = new MentorshipMenteeService();
  });

  it('resolves the program name, project, and the requested term', async () => {
    const target = await service.getMenteeApplyTarget(buildReq(), 'mp_apicurio_winter26', 'trm_apicurio_winter26');

    expect(target).toEqual({
      programName: 'Apicurio Registry: Prompt Template Playground',
      projectName: 'CNCF',
      termName: 'Winter 2026',
    });
  });

  it('rejects an unknown term on a known program', async () => {
    await expect(service.getMenteeApplyTarget(buildReq(), 'mp_apicurio_winter26', 'missing-term')).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});

describe('MentorshipMenteeService profile reads', () => {
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it("reports a profile when the caller's mentee list has a row, reading the list route rather than the single-type one", async () => {
    proxyRequest.mockResolvedValueOnce({ data: [{ id: 'prof-1', profile_type: 'mentee' }], meta: { total: 1, limit: 1, offset: 0 } });

    await expect(service.hasMenteeProfile(buildReq())).resolves.toEqual({ hasProfile: true });
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', PROFILES_PATH, 'GET', { profile_type: 'mentee', limit: 1 }, undefined);
  });

  it("reports no profile when the caller's mentee list is empty", async () => {
    proxyRequest.mockResolvedValueOnce({ data: [], meta: { total: 0, limit: 1, offset: 0 } });

    await expect(service.hasMenteeProfile(buildReq())).resolves.toEqual({ hasProfile: false });
  });

  it.each([
    ['a gateway 404', 404, undefined],
    ['a 500', 500, { error: 'internal server error' }],
  ])('propagates %s instead of reporting no profile', async (_label, status, body) => {
    const error = upstreamError(status, body);
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.hasMenteeProfile(buildReq())).rejects.toBe(error);
  });

  it("maps the caller's mentee row for the profile page, reading the same list route with limit 1", async () => {
    proxyRequest.mockResolvedValueOnce({
      data: [
        {
          id: 'prof-1',
          user_id: 'user-1',
          profile_type: 'mentee',
          introduction: 'Test mentee introduction.',
          skill_set: { skills: ['Go'], improvementSkills: ['Code Review'] },
          terms_and_conditions: true,
          number_of_projects: 0,
          created_on: '2026-01-01T00:00:00Z',
          updated_on: '2026-01-01T00:00:00Z',
        },
      ],
      meta: { total: 1, limit: 1, offset: 0 },
    });

    const result = await service.getMenteeProfile(buildReq());

    expect(result.profile).toMatchObject({ aboutMe: 'Test mentee introduction.', skillsHave: ['Go'], skillsWant: ['Code Review'] });
    expect(result.history).toEqual([]);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', PROFILES_PATH, 'GET', { profile_type: 'mentee', limit: 1 }, undefined);
  });

  it("returns an empty profile when the caller's mentee list is empty, so the apply page loads straight after registering", async () => {
    proxyRequest.mockResolvedValueOnce({ data: [], meta: { total: 0, limit: 1, offset: 0 } });

    await expect(service.getMenteeProfile(buildReq())).resolves.toEqual({
      profile: { aboutMe: '', skillsHave: [], skillsWant: [] },
      history: [],
    });
  });

  it.each([
    ['a gateway 404', 404, undefined],
    ['a 500', 500, { error: 'internal server error' }],
  ])('propagates %s on the profile read', async (_label, status, body) => {
    const error = upstreamError(status, body);
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.getMenteeProfile(buildReq())).rejects.toBe(error);
  });
});
