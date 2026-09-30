// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import {
  getMockMentorshipMentorProgramLists,
  getMockMentorshipMentorPrograms,
  MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
  MOCK_MENTORSHIP_MENTOR_PROFILE,
} from '@lfx-one/shared/constants';
import type { MentorshipMentorRegisterRequest } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

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

const { MentorshipMentorService } = await import('./mentorship-mentor.service');
const { MicroserviceProxyService } = await import('./microservice-proxy.service');
const { EmailVerificationService } = await import('./email-verification.service');
const { logger } = await import('./logger.service');
const { MicroserviceError, ResourceNotFoundError } = await import('../errors');

const PROFILES_PATH = '/mentorship/v1/me/profiles';
const MENTOR_PROFILE_PATH = `${PROFILES_PATH}/mentor`;

function buildReq(): Request {
  return { path: '/api/mentorship/mentor/programs/mp_gridflow_fall26' } as Request;
}

/** A signed-in caller, so the service looks up their primary email by sub. */
function signedInReq(): Request {
  return { path: '/api/mentorship/mentor/profile', impersonationActive: false, oidc: { user: { sub: 'auth0|test-user-1' } } } as unknown as Request;
}

function upstreamError(status: number, body: unknown) {
  return MicroserviceError.fromMicroserviceResponse(status, 'Upstream error', body, 'LFX_V2_SERVICE', PROFILES_PATH);
}

function listOf<T>(data: T[]) {
  return { data, meta: { total: data.length, limit: 1, offset: 0 } };
}

describe('MentorshipMentorService.hasMentorProfile', () => {
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  it("reports a profile when the caller's mentor list has a row", async () => {
    proxyRequest.mockResolvedValueOnce(listOf([{ id: 'profile-1', profile_type: 'mentor' }]));

    await expect(service.hasMentorProfile(buildReq())).resolves.toEqual({ hasProfile: true });
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', PROFILES_PATH, 'GET', { profile_type: 'mentor', limit: 1 }, undefined);
  });

  it("reports no profile when the caller's mentor list is empty", async () => {
    proxyRequest.mockResolvedValueOnce(listOf([]));

    await expect(service.hasMentorProfile(buildReq())).resolves.toEqual({ hasProfile: false });
  });

  it('propagates a failed check instead of reporting no profile', async () => {
    const error = upstreamError(500, { error: 'internal server error' });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.hasMentorProfile(buildReq())).rejects.toBe(error);
  });
});

describe('MentorshipMentorService.registerMentorProfile', () => {
  const request: MentorshipMentorRegisterRequest = {
    introduction: '<p>Test intro</p>',
    skills: ['Kubernetes'],
    complianceAccepted: true,
    termsAccepted: true,
  };
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;
  let getUserEmails: MockInstance<InstanceType<typeof EmailVerificationService>['getUserEmails']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    getUserEmails = vi.spyOn(EmailVerificationService.prototype, 'getUserEmails').mockResolvedValue({
      primary_email: 'test.user@example.com',
      alternate_emails: [],
    });
    service = new MentorshipMentorService();
  });

  it('lists the caller mentor rows, then puts the mapped profile when none exists', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockResolvedValueOnce({});

    await expect(service.registerMentorProfile(buildReq(), request)).resolves.toBeUndefined();

    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', PROFILES_PATH, 'GET', { profile_type: 'mentor', limit: 1 }, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', MENTOR_PROFILE_PATH, 'PUT', undefined, {
      introduction: '<p>Test intro</p>',
      terms_and_conditions: true,
      skill_set: { skills: ['Kubernetes'] },
    });
  });

  it("adds the caller's verified primary email, looked up by their sub, to the profile it puts", async () => {
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockResolvedValueOnce({});

    await service.registerMentorProfile(signedInReq(), { ...request, lfxProfile: { firstName: 'Test' } });

    expect(getUserEmails).toHaveBeenCalledWith(expect.anything(), 'auth0|test-user-1');
    expect(proxyRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      MENTOR_PROFILE_PATH,
      'PUT',
      undefined,
      expect.objectContaining({ first_name: 'Test', email: 'test.user@example.com' })
    );
  });

  it('leaves the email out when the lookup fails, and still registers', async () => {
    getUserEmails.mockResolvedValueOnce(null);
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockResolvedValueOnce({});

    await expect(service.registerMentorProfile(signedInReq(), request)).resolves.toBeUndefined();
    expect(proxyRequest.mock.calls[1][5]).not.toHaveProperty('email');
  });

  it('refuses with a 409 profile-exists conflict, without writing, when a mentor profile exists', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([{ id: 'profile-1', profile_type: 'mentor' }]));

    await expect(service.registerMentorProfile(signedInReq(), request)).rejects.toMatchObject({
      statusCode: 409,
      code: MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(getUserEmails).not.toHaveBeenCalled();
  });

  it('fails closed when the existing-profile check fails', async () => {
    const error = upstreamError(500, { error: 'boom' });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.registerMentorProfile(buildReq(), request)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'bad request'],
    [403, 'forbidden'],
  ])('propagates an upstream %i from the write', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.registerMentorProfile(buildReq(), request)).rejects.toBe(error);
  });

  it('does not log the profile answers or the email', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockResolvedValueOnce({});

    await service.registerMentorProfile(signedInReq(), request);

    const logged = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(logged).not.toContain('Test intro');
    expect(logged).not.toContain('test.user@example.com');
  });
});

describe('MentorshipMentorService.getMentorPrograms', () => {
  it('returns every mentor program with its total, as copies of the seed rows', async () => {
    const service = new MentorshipMentorService();
    const seeds = getMockMentorshipMentorPrograms();

    const programs = await service.getMentorPrograms(buildReq());

    expect(programs.total).toBe(seeds.length);
    expect(programs.data.map((program) => program.id)).toEqual(seeds.map((program) => program.id));
    expect(programs.data[0]).not.toBe(seeds[0]);
  });
});

describe('MentorshipMentorService.getMentorProfile', () => {
  it('returns the profile and history as copies, so a caller cannot change the seed', async () => {
    const service = new MentorshipMentorService();

    const response = await service.getMentorProfile(buildReq());
    response.profile.skills.push('Injected');
    response.history[0].programName = 'Injected';

    expect(response.history).toHaveLength(MOCK_MENTORSHIP_MENTOR_PROFILE.history.length);
    expect(MOCK_MENTORSHIP_MENTOR_PROFILE.profile.skills).not.toContain('Injected');
    expect(MOCK_MENTORSHIP_MENTOR_PROFILE.history[0].programName).not.toBe('Injected');
  });
});

describe('MentorshipMentorService.getMentorProgram', () => {
  let service: InstanceType<typeof MentorshipMentorService>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    service = new MentorshipMentorService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves by primary id and returns a fully-built detail (program + tab counts + lists)', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_gridflow_fall26');

    const source = getMockMentorshipMentorPrograms().find((program) => program.id === 'mp_gridflow_fall26')!;
    // Detail carries the raw program plus the derived tab counts and the mentee & applicant lists.
    expect(detail.program.id).toBe(source.id);
    expect(detail.program.slug).toBe(source.slug);
    expect(detail.program.name).toBe(source.name);

    // Tab counts and rows come from the id-keyed mentor lists (term-filtered), not
    // the admin slug map. `tasks` is the submitted-task count on those mentees.
    const lists = getMockMentorshipMentorProgramLists()[source.id];
    expect(detail.tabCounts).toEqual({
      tasks: source.stats.tasksToReview,
      mentees: lists.mentees.length,
      applicants: lists.applicants.length,
    });
    expect(detail.program.stats.tasksToReview).toBe(detail.tabCounts.tasks);
    expect(detail.program.stats.mentees).toBe(lists.mentees.length);
    expect(detail.program.stats.applicants).toBe(lists.applicants.length);
    expect(detail.mentees).toEqual(lists.mentees);
    expect(detail.applicants).toEqual(lists.applicants);
    expect(detail.applicants.every((applicant) => applicant.termName === source.term)).toBe(true);
  });

  it('omits other-application links whose program id the mentor detail endpoint cannot resolve', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_gridflow_fall26');
    const ifeoma = detail.applicants.find((applicant) => applicant.id === 'app_ifeoma_adeyemi');
    expect(ifeoma?.otherApplications?.map((application) => application.programId)).toEqual(['mp_janusgraph_fall26']);
  });

  it('does not join a Fall mentor card to Winter applicant rows stored under the same slug', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_apicurio_fall26');
    const lists = getMockMentorshipMentorProgramLists()['mp_apicurio_fall26'];
    expect(detail.applicants).toEqual(lists.applicants);
    expect(detail.applicants.some((applicant) => applicant.termName === 'Winter 2026')).toBe(false);
    expect(detail.tabCounts.applicants).toBe(detail.applicants.length);
    expect(detail.program.stats.applicants).toBe(detail.applicants.length);
  });

  it('resolves by slug for callers that route via the URL-friendly identifier', async () => {
    const source = getMockMentorshipMentorPrograms()[0];
    const detail = await service.getMentorProgram(buildReq(), source.slug);
    expect(detail.program.id).toBe(source.id);
  });

  it('throws ResourceNotFoundError when neither id nor slug matches', async () => {
    await expect(service.getMentorProgram(buildReq(), 'mp_does_not_exist')).rejects.toBeInstanceOf(ResourceNotFoundError);
    // The error carries the operation tag so log/observability layers can group by it.
    await expect(service.getMentorProgram(buildReq(), 'mp_does_not_exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
      operation: 'mentorship_get_mentor_program',
    });
  });

  it('keeps header counts and rows aligned when a card has no people for its term', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_envoy_fall26');
    expect(detail.mentees).toEqual([]);
    expect(detail.applicants).toEqual([]);
    expect(detail.tabCounts.mentees).toBe(0);
    expect(detail.tabCounts.applicants).toBe(0);
    expect(detail.program.stats.mentees).toBe(0);
    expect(detail.program.stats.applicants).toBe(0);
  });

  it('lists only accepted and graduated mentees on the mentor Mentees tab payload', async () => {
    const detail = await service.getMentorProgram(buildReq(), 'mp_thanos_summer26');
    expect(detail.mentees.every((mentee) => mentee.status === 'accepted' || mentee.status === 'graduated')).toBe(true);
    expect(detail.mentees.map((mentee) => mentee.id)).toEqual(['mnt_thanos_1', 'mnt_thanos_2']);
    expect(detail.tabCounts.mentees).toBe(detail.mentees.length);
    expect(detail.program.stats.mentees).toBe(detail.mentees.length);
  });
});
