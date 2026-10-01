// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import {
  getMockMentorshipMentorProgramLists,
  getMockMentorshipMentorPrograms,
  MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
  MOCK_MENTORSHIP_MENTOR_PROFILE,
} from '@lfx-one/shared/constants';
import type { MentorshipMentorRegisterRequest, MentorshipUpstreamProgramMembership } from '@lfx-one/shared/interfaces';
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

describe('MentorshipMentorService mentor requests', () => {
  const PROGRAM_ID = '7b0f2a52-55a4-4a3e-9d8c-1f3a2b4c5d6e';
  const REQUEST_ID = '0c6e2d3a-8f71-4b5e-a2c9-3d4e5f6a7b8c';
  const MEMBERSHIPS_PATH = '/mentorship/v1/me/program-memberships';
  const membership: MentorshipUpstreamProgramMembership = {
    id: REQUEST_ID,
    program_id: PROGRAM_ID,
    program_name: 'Test Program',
    member_type: 'mentor',
    status: 'requested',
    created_on: '2026-06-28T10:00:00Z',
    updated_on: '2026-06-29T10:00:00Z',
  };
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  it('lists the published programs, as id and name', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([{ id: PROGRAM_ID, name: 'Test Program', status: 'published', project_name: 'Test Project' }]));

    await expect(service.getOpenPrograms(buildReq())).resolves.toEqual({ data: [{ id: PROGRAM_ID, name: 'Test Program' }] });
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/programs',
      'GET',
      { status: 'published', limit: 100, offset: 0 },
      undefined
    );
  });

  it("lists the caller's mentor memberships as requests, folding the status and moving invitations to their own list", async () => {
    const invitedProgramId = '3c9d8e7f-6a5b-4c3d-9e2f-1a0b9c8d7e6f';
    proxyRequest.mockResolvedValueOnce(listOf([membership, { ...membership, id: 'member-invited', program_id: invitedProgramId, status: 'invited' }]));

    await expect(service.getMentorRequests(buildReq())).resolves.toEqual({
      data: [{ id: REQUEST_ID, programId: PROGRAM_ID, programName: 'Test Program', status: 'pending' }],
      invitedProgramIds: [invitedProgramId],
    });
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      MEMBERSHIPS_PATH,
      'GET',
      { member_type: 'mentor', limit: 100, offset: 0 },
      undefined
    );
  });

  it('asks to join the program with only its id, leaving the user to the token', async () => {
    proxyRequest.mockResolvedValueOnce(membership);

    await expect(service.requestToMentor(buildReq(), PROGRAM_ID)).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', MEMBERSHIPS_PATH, 'POST', undefined, { program_id: PROGRAM_ID });
  });

  it.each([
    [404, 'program not found'],
    [409, 'program membership already exists'],
  ])("passes upstream's %s through on a request", async (status, error) => {
    const failure = upstreamError(status, { error });
    proxyRequest.mockRejectedValueOnce(failure);

    await expect(service.requestToMentor(buildReq(), PROGRAM_ID)).rejects.toBe(failure);
  });

  it('withdraws the request, and passes upstream 409 through when it is no longer pending', async () => {
    proxyRequest.mockResolvedValueOnce(undefined);
    await expect(service.withdrawMentorRequest(buildReq(), REQUEST_ID)).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `${MEMBERSHIPS_PATH}/${REQUEST_ID}/withdraw`, 'POST', undefined, undefined);

    const conflict = upstreamError(409, { error: 'invalid status transition' });
    proxyRequest.mockRejectedValueOnce(conflict);
    await expect(service.withdrawMentorRequest(buildReq(), REQUEST_ID)).rejects.toBe(conflict);
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
