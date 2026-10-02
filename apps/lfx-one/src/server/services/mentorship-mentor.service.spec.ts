// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE } from '@lfx-one/shared/constants';
import type {
  MentorshipMentorRegisterRequest,
  MentorshipUpstreamMentorDetail,
  MentorshipUpstreamMentorProgram,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamProgramMembership,
  MentorshipUpstreamTask,
} from '@lfx-one/shared/interfaces';
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
const ME_PATH = '/mentorship/v1/me';
const MENTOR_USER_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const MENTOR_DETAIL_PATH = `/mentorship/v1/mentors/${MENTOR_USER_ID}`;

function buildReq(): Request {
  return { path: '/api/mentorship/mentor/programs' } as Request;
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

  it('reports no profile when upstream sends the list data as null', async () => {
    proxyRequest.mockResolvedValueOnce({ data: null, meta: { total: 0, limit: 1, offset: 0 } });

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
  let listIdentitiesSafe: MockInstance<InstanceType<typeof EmailVerificationService>['listIdentitiesSafe']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    getUserEmails = vi.spyOn(EmailVerificationService.prototype, 'getUserEmails').mockResolvedValue({
      primary_email: 'test.user@example.com',
      alternate_emails: [],
    });
    listIdentitiesSafe = vi.spyOn(EmailVerificationService.prototype, 'listIdentitiesSafe').mockResolvedValue([]);
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

  it("adds the caller's connected GitHub link to the profile it puts", async () => {
    listIdentitiesSafe.mockResolvedValue([
      { provider: 'github', user_id: 'github-1', connection: 'github', isSocial: true, profileData: { nickname: 'test-user' } },
    ]);
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockResolvedValueOnce({});

    await service.registerMentorProfile(signedInReq(), request);

    expect(listIdentitiesSafe).toHaveBeenCalledWith(expect.anything(), 'auth0|test-user-1');
    expect(proxyRequest.mock.calls[1][5]).toMatchObject({ profile_links: { githubProfileLink: 'https://github.com/test-user' } });
  });

  it('sends no profile links when the caller has no GitHub account connected', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockResolvedValueOnce({});

    await service.registerMentorProfile(signedInReq(), request);

    expect(proxyRequest.mock.calls[1][5]).not.toHaveProperty('profile_links');
  });

  it('refuses with a 409 profile-exists conflict, without writing, when a mentor profile exists', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([{ id: 'profile-1', profile_type: 'mentor' }]));

    await expect(service.registerMentorProfile(signedInReq(), request)).rejects.toMatchObject({
      statusCode: 409,
      code: MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(getUserEmails).not.toHaveBeenCalled();
    expect(listIdentitiesSafe).not.toHaveBeenCalled();
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

  it('reads one page of published programs, as id and name, with the total', async () => {
    proxyRequest.mockResolvedValueOnce({
      data: [{ id: PROGRAM_ID, name: 'Test Program', status: 'published', project_name: 'Test Project' }],
      meta: { total: 45, limit: 20, offset: 0 },
    });

    await expect(service.getOpenPrograms(buildReq())).resolves.toEqual({ data: [{ id: PROGRAM_ID, name: 'Test Program' }], total: 45 });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/programs',
      'GET',
      { status: 'published', limit: 20, offset: 0 },
      undefined
    );
  });

  it('passes the offset, and the search with its wildcards escaped', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([]));

    await service.getOpenPrograms(buildReq(), { search: '50%_off', offset: 40 });

    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/programs',
      'GET',
      { status: 'published', limit: 20, offset: 40, search: '50\\%\\_off' },
      undefined
    );
  });

  it('treats a page with no usable total as the last one, so the picker stops asking', async () => {
    proxyRequest.mockResolvedValueOnce({ data: [{ id: PROGRAM_ID, name: 'Test Program', status: 'published', project_name: 'Test Project' }] });

    await expect(service.getOpenPrograms(buildReq(), { offset: 20 })).resolves.toEqual({ data: [{ id: PROGRAM_ID, name: 'Test Program' }], total: 21 });
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

  it.each(['accept', 'decline'] as const)('answers the invitation with %s, the token escaped into the path', async (decision) => {
    proxyRequest.mockResolvedValueOnce(undefined);

    await expect(service.respondToMentorInvite(buildReq(), 'payload.sig-_', decision)).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      `/mentorship/v1/mentor-invites/payload.sig-_/${decision}`,
      'POST',
      undefined,
      undefined
    );
  });

  it.each([
    [400, 'invalid input: no pending invite found for this user'],
    [403, 'forbidden: invite belongs to a different user'],
  ])("passes upstream's %s through on an invite answer", async (status, error) => {
    const failure = upstreamError(status, { error });
    proxyRequest.mockRejectedValueOnce(failure);

    await expect(service.respondToMentorInvite(buildReq(), 'payload.sig', 'accept')).rejects.toMatchObject({ statusCode: status, errorBody: { error } });
  });

  it('keeps the invite token out of the path and operation a failure logs', async () => {
    const token = 'payload.SECRET-sig';
    const path = `/mentorship/v1/mentor-invites/${token}/accept`;
    proxyRequest.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(
        400,
        'Bad Request',
        { error: 'invalid invite token' },
        'LFX_V2_SERVICE',
        path,
        `post_${path.replace(/\//g, '_')}`
      )
    );

    const failure = await service.respondToMentorInvite(buildReq(), token, 'accept').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MicroserviceError);
    expect(failure).toMatchObject({ statusCode: 400, path: '/mentorship/v1/mentor-invites/redacted/accept' });
    expect(JSON.stringify((failure as InstanceType<typeof MicroserviceError>).getLogContext())).not.toContain('SECRET');
  });

  it('keeps the invite token out of the provisioning log for a first-time user', async () => {
    const token = 'payload.SECRET-sig';
    proxyRequest.mockRejectedValueOnce(upstreamError(401, { error: 'local user is not provisioned' }));
    proxyRequest.mockResolvedValueOnce({});
    proxyRequest.mockResolvedValueOnce(undefined);

    await service.respondToMentorInvite(buildReq(), token, 'decline');

    expect(proxyRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      `/mentorship/v1/mentor-invites/${token}/decline`,
      'POST',
      undefined,
      undefined
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(expect.anything(), 'mentorship_provision_user', expect.any(String), {
      path: '/mentorship/v1/mentor-invites/redacted/decline',
      method: 'POST',
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('SECRET');
  });
});

describe('MentorshipMentorService.getMentorPrograms', () => {
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const GRIDFLOW_ID = '1a2b3c4d-0000-4000-8000-000000000001';
  const ARCHIVE_ID = '1a2b3c4d-0000-4000-8000-000000000002';
  const FALL_TERM_ID = '2b3c4d5e-0000-4000-8000-000000000001';
  const SPRING_TERM_ID = '2b3c4d5e-0000-4000-8000-000000000002';
  const GRIDFLOW_PATH = `/mentorship/v1/programs/${GRIDFLOW_ID}`;
  const ARCHIVE_PATH = `/mentorship/v1/programs/${ARCHIVE_ID}`;

  const program = (id: string, name: string, terms: MentorshipUpstreamMentorProgram['terms']): MentorshipUpstreamMentorProgram => ({
    id,
    name,
    slug: name.toLowerCase(),
    skills: [],
    mentors: [],
    terms,
  });
  const detailWith = (programs: MentorshipUpstreamMentorProgram[]): MentorshipUpstreamMentorDetail => ({
    user_id: MENTOR_USER_ID,
    skills: [],
    joined_at: '2026-01-01T00:00:00Z',
    programs,
    current_mentees: [],
    graduated_mentees: [],
    stats: { programs_mentoring: programs.length, current_mentees: 0, mentees_graduated: 0 },
  });
  const application = (id: string, status: MentorshipUpstreamProgramApplicationRow['status']): MentorshipUpstreamProgramApplicationRow => ({
    user_id: `user-${id}`,
    application_id: id,
    status,
    tasks_submitted: 0,
    tasks_total: 0,
    created_on: '2026-08-01T00:00:00Z',
    updated_on: '2026-08-01T00:00:00Z',
  });
  const submittedTask = (id: string, applicationId: string) => ({
    id,
    application_id: applicationId,
    assignee_id: 'mentee',
    status: 'submitted',
    custom: false,
    created_on: '2026-08-01T00:00:00Z',
    updated_on: '2026-08-01T00:00:00Z',
  });

  /** Answers each upstream read by path, since the per-program reads run in parallel. */
  function answer(routes: Record<string, (query: Record<string, unknown> | undefined) => unknown>) {
    proxyRequest.mockImplementation(async (_req, _service, path, _method, query) => {
      const route = routes[path];
      if (!route) throw new Error(`unexpected upstream call to ${path}`);
      return route(query as Record<string, unknown> | undefined) as never;
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a card for each of the caller's programs from its chosen term's rows, active terms first", async () => {
    answer({
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () =>
        detailWith([
          program(ARCHIVE_ID, 'Archive', [{ id: SPRING_TERM_ID, name: 'Spring 2026', status: 'closed', start_date_time: '2026-03-01T00:00:00Z' }]),
          program(GRIDFLOW_ID, 'GridFlow', [
            { id: FALL_TERM_ID, name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z', end_date_time: '2026-12-15T00:00:00Z' },
          ]),
        ]),
      [GRIDFLOW_PATH]: () => ({ id: GRIDFLOW_ID, name: 'GridFlow', status: 'published', project_name: 'LF Energy' }),
      [`${GRIDFLOW_PATH}/applications`]: () => listOf([application('a1', 'accepted'), application('a2', 'graduated'), application('a3', 'pending')]),
      [`${GRIDFLOW_PATH}/terms/${FALL_TERM_ID}/tasks`]: () => listOf([submittedTask('t1', 'a1'), submittedTask('t2', 'a2')]),
      [ARCHIVE_PATH]: () => ({ id: ARCHIVE_ID, name: 'Archive', status: 'published' }),
      [`${ARCHIVE_PATH}/applications`]: () => listOf([]),
      [`${ARCHIVE_PATH}/terms/${SPRING_TERM_ID}/tasks`]: () => listOf([]),
    });

    const programs = await service.getMentorPrograms(buildReq());

    expect(programs.total).toBe(2);
    expect(programs.data).toEqual([
      {
        id: GRIDFLOW_ID,
        slug: 'gridflow',
        name: 'GridFlow',
        projectName: 'LF Energy',
        term: 'Fall 2026',
        termStatus: 'active-term',
        stats: { mentees: 2, tasksToReview: 1, applicants: 3 },
        termStartDate: '2026-09-01',
        termEndDate: '2026-12-15',
      },
      expect.objectContaining({
        id: ARCHIVE_ID,
        projectName: '',
        term: 'Spring 2026',
        termStatus: 'completed',
        stats: { mentees: 0, tasksToReview: 0, applicants: 0 },
      }),
    ]);
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      `${GRIDFLOW_PATH}/applications`,
      'GET',
      { term: FALL_TERM_ID, limit: 50, offset: 0 },
      undefined
    );
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      `${GRIDFLOW_PATH}/terms/${FALL_TERM_ID}/tasks`,
      'GET',
      { status: 'submitted', limit: 100, offset: 0 },
      undefined
    );
  });

  it('pages applications at 50 until the total is reached', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => application(`a${index}`, 'pending'));
    answer({
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () =>
        detailWith([program(GRIDFLOW_ID, 'GridFlow', [{ id: FALL_TERM_ID, name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }])]),
      [GRIDFLOW_PATH]: () => ({ id: GRIDFLOW_ID, name: 'GridFlow', status: 'published' }),
      [`${GRIDFLOW_PATH}/applications`]: (query) =>
        query?.['offset'] === 0
          ? { data: firstPage, meta: { total: 51, limit: 50, offset: 0 } }
          : { data: [application('a-last', 'accepted')], meta: { total: 51, limit: 50, offset: 50 } },
      [`${GRIDFLOW_PATH}/terms/${FALL_TERM_ID}/tasks`]: () => listOf([]),
    });

    const [card] = (await service.getMentorPrograms(buildReq())).data;

    expect(card.stats).toEqual({ mentees: 1, tasksToReview: 0, applicants: 51 });
  });

  it('reads no rows for a program with no terms and groups it as upcoming with zero counts', async () => {
    answer({
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () => detailWith([program(GRIDFLOW_ID, 'GridFlow', [])]),
      [GRIDFLOW_PATH]: () => ({ id: GRIDFLOW_ID, name: 'GridFlow', status: 'published', project_name: 'LF Energy' }),
    });

    const [card] = (await service.getMentorPrograms(buildReq())).data;

    expect(card).toMatchObject({ term: '', termStatus: 'upcoming', stats: { mentees: 0, tasksToReview: 0, applicants: 0 } });
    expect(proxyRequest).toHaveBeenCalledTimes(3);
  });

  it('reads at most five programs at once', async () => {
    const ids = Array.from({ length: 7 }, (_, index) => `1a2b3c4d-0000-4000-8000-00000000010${index}`);
    let inFlight = 0;
    let peak = 0;
    proxyRequest.mockImplementation(async (_req, _service, path) => {
      if (path === ME_PATH) return { id: MENTOR_USER_ID } as never;
      if (path === MENTOR_DETAIL_PATH) return detailWith(ids.map((id) => program(id, id, []))) as never;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return { status: 'published' } as never;
    });

    await expect(service.getMentorPrograms(buildReq())).resolves.toMatchObject({ total: 7 });
    expect(peak).toBe(5);
  });

  it('returns no programs when upstream has no mentor detail for the caller (404)', async () => {
    answer({
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () => {
        throw upstreamError(404, { error: 'mentor not found' });
      },
    });

    await expect(service.getMentorPrograms(buildReq())).resolves.toEqual({ data: [], total: 0 });
  });

  it("reads only the caller's own mentor detail, and refuses a user without a valid id", async () => {
    answer({ [ME_PATH]: () => ({ id: '../programs' }) });

    await expect(service.getMentorPrograms(buildReq())).rejects.toMatchObject({ statusCode: 502, code: 'MENTORSHIP_INVALID_USER' });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['program', program('..', 'GridFlow', [])],
    ['term', program(GRIDFLOW_ID, 'GridFlow', [{ id: '../tasks', name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }])],
  ])('refuses a %s id from upstream that is not a UUID before building a path from it', async (_kind, mentorProgram) => {
    answer({
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () => detailWith([mentorProgram]),
    });

    await expect(service.getMentorPrograms(buildReq())).rejects.toMatchObject({ statusCode: 502, code: 'MENTORSHIP_INVALID_PROGRAM' });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404])("propagates upstream's %i on a program's rows rather than show counts it could not read", async (status) => {
    const error = upstreamError(status, { error: 'denied' });
    answer({
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () =>
        detailWith([program(GRIDFLOW_ID, 'GridFlow', [{ id: FALL_TERM_ID, name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }])]),
      [GRIDFLOW_PATH]: () => ({ id: GRIDFLOW_ID, name: 'GridFlow', status: 'published' }),
      [`${GRIDFLOW_PATH}/applications`]: () => {
        throw error;
      },
      [`${GRIDFLOW_PATH}/terms/${FALL_TERM_ID}/tasks`]: () => listOf([]),
    });

    await expect(service.getMentorPrograms(buildReq())).rejects.toBe(error);
  });
});

describe('MentorshipMentorService.getMentorProfile', () => {
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const storedProfile = {
    id: 'profile-1',
    profile_type: 'mentor',
    introduction: '<p>I mentor ingestion pipelines.</p>',
    skill_set: { skills: ['Go', 'Kubernetes'], comments: 'kept' },
    profile_links: { resumeLink: 'https://files.example.org/resumes/mentor-cv.pdf' },
  };
  const detail: MentorshipUpstreamMentorDetail = {
    user_id: MENTOR_USER_ID,
    skills: [],
    joined_at: '2026-01-01T00:00:00Z',
    programs: [
      {
        id: 'program-1',
        name: 'GridFlow',
        slug: 'gridflow',
        skills: [],
        mentors: [],
        terms: [{ id: 'term-1', name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }],
      },
    ],
    current_mentees: [{ user_id: 'mentee-1', program_name: 'GridFlow', term_name: 'Fall 2026', status: 'active' }],
    graduated_mentees: [],
    stats: { programs_mentoring: 1, current_mentees: 1, mentees_graduated: 0 },
  };

  /** Answers each upstream read by path, since the profile and history branches run in parallel. */
  function answer(routes: Record<string, () => unknown>) {
    proxyRequest.mockImplementation(async (_req, _service, path) => {
      const route = routes[path];
      if (!route) throw new Error(`unexpected upstream call to ${path}`);
      return route() as never;
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps the caller's mentor row and builds the history from their mentor detail", async () => {
    answer({ [MENTOR_PROFILE_PATH]: () => storedProfile, [ME_PATH]: () => ({ id: MENTOR_USER_ID }), [MENTOR_DETAIL_PATH]: () => detail });

    await expect(service.getMentorProfile(signedInReq())).resolves.toEqual({
      profile: {
        aboutMe: '<p>I mentor ingestion pipelines.</p>',
        skills: ['Go', 'Kubernetes'],
      },
      history: [{ id: 'term-1', programName: 'GridFlow', term: 'Fall 2026', menteesCount: 1, status: 'in-progress' }],
    });
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', MENTOR_PROFILE_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', ME_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', MENTOR_DETAIL_PATH, 'GET', undefined, undefined);
  });

  it('returns an empty profile, with the history, when upstream has no mentor row for the caller (404)', async () => {
    answer({
      [MENTOR_PROFILE_PATH]: () => {
        throw upstreamError(404, { error: 'profile not found' });
      },
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () => detail,
    });

    const response = await service.getMentorProfile(signedInReq());

    expect(response.profile).toEqual({ aboutMe: '', skills: [] });
    expect(response.history).toHaveLength(1);
  });

  it('returns an empty history when upstream has no mentor detail for the caller (404)', async () => {
    answer({
      [MENTOR_PROFILE_PATH]: () => storedProfile,
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () => {
        throw upstreamError(404, { error: 'mentor not found' });
      },
    });

    const response = await service.getMentorProfile(signedInReq());

    expect(response.history).toEqual([]);
    expect(response.profile.skills).toEqual(['Go', 'Kubernetes']);
  });

  it('propagates any other failure of the mentor detail read', async () => {
    const error = upstreamError(500, { error: 'internal server error' });
    answer({
      [MENTOR_PROFILE_PATH]: () => storedProfile,
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () => {
        throw error;
      },
    });

    await expect(service.getMentorProfile(signedInReq())).rejects.toBe(error);
  });

  it('refuses a user without a valid id rather than read another path', async () => {
    answer({ [MENTOR_PROFILE_PATH]: () => storedProfile, [ME_PATH]: () => ({ id: '../programs' }) });

    await expect(service.getMentorProfile(signedInReq())).rejects.toMatchObject({ statusCode: 502, code: 'MENTORSHIP_INVALID_USER' });
    expect(proxyRequest).not.toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', expect.stringContaining('/mentors/'), 'GET', undefined, undefined);
  });

  it("propagates upstream's 409 for more than one mentor profile rather than pick one", async () => {
    const error = upstreamError(409, { error: 'multiple mentor profiles exist for user' });
    answer({
      [MENTOR_PROFILE_PATH]: () => {
        throw error;
      },
      [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
      [MENTOR_DETAIL_PATH]: () => detail,
    });

    await expect(service.getMentorProfile(signedInReq())).rejects.toBe(error);
  });
});

describe('MentorshipMentorService.updateMentorProfile', () => {
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const savedRow = {
    id: 'profile-1',
    profile_type: 'mentor',
    introduction: '<p>Updated.</p>',
    skill_set: { skills: ['Rust'], comments: 'kept' },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  it('patches only the introduction, without reading the stored row', async () => {
    proxyRequest.mockResolvedValueOnce(savedRow);

    await expect(service.updateMentorProfile(signedInReq(), { introduction: '<p>Updated.</p>' })).resolves.toEqual({
      profile: { aboutMe: '<p>Updated.</p>', skills: ['Rust'] },
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', MENTOR_PROFILE_PATH, 'PATCH', undefined, {
      introduction: '<p>Updated.</p>',
    });
  });

  it('layers new skills over the stored skill_set, keeping the keys the BFF does not model', async () => {
    proxyRequest.mockResolvedValueOnce({ id: 'profile-1', profile_type: 'mentor', skill_set: { skills: ['Go'], comments: 'kept' } });
    proxyRequest.mockResolvedValueOnce(savedRow);

    await service.updateMentorProfile(signedInReq(), { skills: ['Rust'] });

    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', MENTOR_PROFILE_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', MENTOR_PROFILE_PATH, 'PATCH', undefined, {
      skill_set: { skills: ['Rust'], comments: 'kept' },
    });
  });

  it('does not patch when the stored row cannot be read', async () => {
    const error = upstreamError(500, { error: 'internal server error' });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.updateMentorProfile(signedInReq(), { skills: ['Rust'] })).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it("does not patch when upstream's read finds more than one mentor profile (409)", async () => {
    const error = upstreamError(409, { error: 'multiple mentor profiles exist for user' });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.updateMentorProfile(signedInReq(), { skills: ['Rust'] })).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('propagates an upstream 404 for a caller with no mentor profile', async () => {
    const error = upstreamError(404, { error: 'profile not found' });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.updateMentorProfile(signedInReq(), { introduction: '<p>Hi.</p>' })).rejects.toBe(error);
  });

  it('logs the changed field names only', async () => {
    proxyRequest.mockResolvedValueOnce(savedRow);

    await service.updateMentorProfile(signedInReq(), { introduction: '<p>Secret text.</p>' });

    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('Secret text');
  });
});

describe('MentorshipMentorService.getMentorProgram', () => {
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const PROGRAM_ID = '1a2b3c4d-0000-4000-8000-000000000001';
  const OTHER_PROGRAM_ID = '1a2b3c4d-0000-4000-8000-000000000002';
  const TERM_ID = '2b3c4d5e-0000-4000-8000-000000000001';
  const PROGRAM_PATH = `/mentorship/v1/programs/${PROGRAM_ID}`;
  const TERM_TASKS_PATH = `${PROGRAM_PATH}/terms/${TERM_ID}/tasks`;
  const ACCEPTED_ID = '3c4d5e6f-0000-4000-8000-000000000001';
  const GRADUATED_ID = '3c4d5e6f-0000-4000-8000-000000000002';
  const PENDING_ID = '3c4d5e6f-0000-4000-8000-000000000003';
  const MENTOR_ROLE_ID = '3c4d5e6f-0000-4000-8000-000000000004';
  const applicationTasksPath = (applicationId: string) => `/mentorship/v1/applications/${applicationId}/tasks`;

  const mentorProgram = (id = PROGRAM_ID, termId = TERM_ID): MentorshipUpstreamMentorProgram => ({
    id,
    name: 'GridFlow',
    slug: 'gridflow',
    skills: [],
    mentors: [],
    terms: [{ id: termId, name: 'Fall 2026', status: 'open', start_date_time: '2026-09-01T00:00:00Z' }],
  });
  const mentorDetail = (programs: MentorshipUpstreamMentorProgram[]): MentorshipUpstreamMentorDetail => ({
    user_id: MENTOR_USER_ID,
    skills: [],
    joined_at: '2026-01-01T00:00:00Z',
    programs,
    current_mentees: [],
    graduated_mentees: [],
    stats: { programs_mentoring: programs.length, current_mentees: 0, mentees_graduated: 0 },
  });
  const row = (
    id: string,
    status: MentorshipUpstreamProgramApplicationRow['status'],
    overrides: Partial<MentorshipUpstreamProgramApplicationRow> = {}
  ): MentorshipUpstreamProgramApplicationRow => ({
    user_id: `user-${id}`,
    application_id: id,
    status,
    name: `Mentee ${id.slice(-1)}`,
    email: `mentee${id.slice(-1)}@example.com`,
    tasks_submitted: 0,
    tasks_total: 0,
    created_on: '2026-08-01T10:00:00Z',
    updated_on: '2026-08-02T10:00:00Z',
    ...overrides,
  });
  const task = (id: string, applicationId: string, status: MentorshipUpstreamTask['status']): MentorshipUpstreamTask => ({
    id,
    application_id: applicationId,
    assignee_id: `user-${applicationId}`,
    status,
    custom: false,
    created_on: '2026-08-05T00:00:00Z',
    updated_on: '2026-09-01T00:00:00Z',
  });
  const rows = [
    row(ACCEPTED_ID, 'accepted', {
      note: 'Strong start.',
      avatar_url: 'https://avatars.example.com/1.png',
      other_applications: [{ program_id: OTHER_PROGRAM_ID, program_name: 'Thanos', status: 'hold' }],
    }),
    row(GRADUATED_ID, 'graduated'),
    row(PENDING_ID, 'pending', { tasks_submitted: 1, tasks_total: 2 }),
  ];

  /** Answers each upstream read by path, since the program reads run in parallel. */
  function answer(routes: Record<string, (query: Record<string, unknown> | undefined) => unknown>) {
    proxyRequest.mockImplementation(async (_req, _service, path, _method, query) => {
      const route = routes[path];
      if (!route) throw new Error(`unexpected upstream call to ${path}`);
      return route(query as Record<string, unknown> | undefined) as never;
    });
  }

  const caller = (programs = [mentorProgram()]) => ({
    [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
    [MENTOR_DETAIL_PATH]: () => mentorDetail(programs),
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.warning).mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the detail from the chosen term's rows and every task on the term, with counts matching the card", async () => {
    answer({
      ...caller(),
      [PROGRAM_PATH]: () => ({ id: PROGRAM_ID, name: 'GridFlow', status: 'published', project_name: 'LF Energy' }),
      [`${PROGRAM_PATH}/applications`]: () => listOf(rows),
      [TERM_TASKS_PATH]: () =>
        listOf([
          { ...task('t1', ACCEPTED_ID, 'submitted'), name: 'Resume', category: 'prerequisite', file: 'resume.pdf', due_date: '2026-09-30T00:00:00Z' },
          task('t2', GRADUATED_ID, 'submitted'),
          task('t3', PENDING_ID, 'incomplete'),
          task('t4', MENTOR_ROLE_ID, 'submitted'),
        ]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail.program).toMatchObject({ id: PROGRAM_ID, projectName: 'LF Energy', term: 'Fall 2026', termStatus: 'active-term' });
    // A graduated mentee's leftover submission and a mentor-role application's task are not waiting on the mentor.
    expect(detail.program.stats).toEqual({ mentees: 2, tasksToReview: 1, applicants: 3 });
    expect(detail.tabCounts).toEqual({ tasks: 1, mentees: 2, applicants: 3 });
    expect(detail.mentees.map((mentee) => mentee.id)).toEqual([ACCEPTED_ID, GRADUATED_ID]);
    expect(detail.mentees[0]).toEqual({
      id: ACCEPTED_ID,
      name: 'Mentee 1',
      email: 'mentee1@example.com',
      avatarUrl: 'https://avatars.example.com/1.png',
      status: 'accepted',
      tasksSubmitted: 0,
      tasksTotal: 0,
      termName: 'Fall 2026',
      note: 'Strong start.',
      tasks: [
        {
          id: 't1',
          name: 'Resume',
          description: '',
          status: 'submitted',
          prerequisite: true,
          createdOn: '2026-08-05T00:00:00Z',
          updatedOn: '2026-09-01T00:00:00Z',
          dueOn: '2026-09-30',
          hasSubmission: true,
          requiresFileSubmission: false,
        },
      ],
    });
    expect(detail.applicants.map((applicant) => applicant.id)).toEqual([ACCEPTED_ID, GRADUATED_ID, PENDING_ID]);
    expect(detail.applicants[0]).toMatchObject({
      createdOn: '2026-08-01',
      updatedOn: '2026-08-02',
      otherApplications: [{ programId: OTHER_PROGRAM_ID, programName: 'Thanos', status: 'pending' }],
    });
    expect(detail.applicants[2].tasks?.map((applicantTask) => applicantTask.status)).toEqual(['pending']);
    expect(JSON.stringify(detail)).not.toContain(MENTOR_ROLE_ID);
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      `${PROGRAM_PATH}/applications`,
      'GET',
      { term: TERM_ID, limit: 50, offset: 0 },
      undefined
    );
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', TERM_TASKS_PATH, 'GET', { limit: 100, offset: 0 }, undefined);
  });

  it("reads each mentee's tasks from their application when the gateway refuses the term task listing", async () => {
    answer({
      ...caller(),
      [PROGRAM_PATH]: () => ({ id: PROGRAM_ID, name: 'GridFlow', status: 'published' }),
      [`${PROGRAM_PATH}/applications`]: () => listOf(rows),
      [TERM_TASKS_PATH]: () => {
        throw upstreamError(403, { error: 'forbidden' });
      },
      [applicationTasksPath(ACCEPTED_ID)]: () => listOf([task('t1', ACCEPTED_ID, 'submitted'), task('t2', ACCEPTED_ID, 'complete')]),
      [applicationTasksPath(GRADUATED_ID)]: () => listOf([task('t3', GRADUATED_ID, 'submitted')]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail.tabCounts).toEqual({ tasks: 1, mentees: 2, applicants: 3 });
    expect(detail.program.stats).toEqual({ mentees: 2, tasksToReview: 1, applicants: 3 });
    expect(detail.mentees.map((mentee) => mentee.tasks?.map((menteeTask) => menteeTask.status))).toEqual([['submitted', 'completed'], ['submitted']]);
    // The pending applicant's application is not read, so the row carries no tasks.
    expect(detail.applicants[2].tasks).toBeUndefined();
    expect(proxyRequest).not.toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', applicationTasksPath(PENDING_ID), 'GET', expect.anything(), undefined);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_get_mentor_program', expect.any(String), { term_id: TERM_ID });
  });

  it('reads at most five mentee applications at once in the fallback', async () => {
    const mentees = Array.from({ length: 7 }, (_, index) => row(`3c4d5e6f-0000-4000-8000-00000000010${index}`, 'accepted'));
    let inFlight = 0;
    let peak = 0;
    const routes: Record<string, () => unknown> = {
      ...caller(),
      [PROGRAM_PATH]: () => ({ id: PROGRAM_ID, name: 'GridFlow', status: 'published' }),
      [`${PROGRAM_PATH}/applications`]: () => listOf(mentees),
      [TERM_TASKS_PATH]: () => {
        throw upstreamError(403, { error: 'forbidden' });
      },
    };
    proxyRequest.mockImplementation(async (_req, _service, path) => {
      if (routes[path]) return routes[path]() as never;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return listOf([]) as never;
    });

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).resolves.toMatchObject({ tabCounts: { mentees: 7 } });
    expect(peak).toBe(5);
  });

  it('refuses a mentee application id from upstream that is not a UUID before building a path from it', async () => {
    answer({
      ...caller(),
      [PROGRAM_PATH]: () => ({ id: PROGRAM_ID, name: 'GridFlow', status: 'published' }),
      [`${PROGRAM_PATH}/applications`]: () => listOf([row('../tasks', 'accepted')]),
      [TERM_TASKS_PATH]: () => {
        throw upstreamError(403, { error: 'forbidden' });
      },
    });

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode: 502, code: 'MENTORSHIP_INVALID_APPLICATION' });
  });

  it('propagates any other failure of the term task listing', async () => {
    const error = upstreamError(500, { error: 'internal server error' });
    answer({
      ...caller(),
      [PROGRAM_PATH]: () => ({ id: PROGRAM_ID, name: 'GridFlow', status: 'published' }),
      [`${PROGRAM_PATH}/applications`]: () => listOf(rows),
      [TERM_TASKS_PATH]: () => {
        throw error;
      },
    });

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toBe(error);
  });

  it('reads no rows for a program with no terms', async () => {
    answer({
      ...caller([{ ...mentorProgram(), terms: [] }]),
      [PROGRAM_PATH]: () => ({ id: PROGRAM_ID, name: 'GridFlow', status: 'published' }),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail).toMatchObject({ mentees: [], applicants: [], tabCounts: { tasks: 0, mentees: 0, applicants: 0 } });
    expect(proxyRequest).toHaveBeenCalledTimes(3);
  });

  it('finds the program whatever the case of the requested id', async () => {
    answer({
      ...caller([{ ...mentorProgram(), terms: [] }]),
      [PROGRAM_PATH]: () => ({ id: PROGRAM_ID, name: 'GridFlow', status: 'published' }),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID.toUpperCase());

    expect(detail.program.id).toBe(PROGRAM_ID);
  });

  it.each([
    ['another program', () => caller([mentorProgram(OTHER_PROGRAM_ID)])],
    [
      'no mentor detail',
      () => ({
        [ME_PATH]: () => ({ id: MENTOR_USER_ID }),
        [MENTOR_DETAIL_PATH]: () => {
          throw upstreamError(404, { error: 'mentor not found' });
        },
      }),
    ],
  ])('answers 404 for a program the caller does not mentor (%s) without reading it', async (_case, routes) => {
    answer(routes());

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode: 404, operation: 'mentorship_get_mentor_program' });
    expect(proxyRequest).not.toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', PROGRAM_PATH, 'GET', undefined, undefined);
  });

  it('refuses a term id from upstream that is not a UUID before building a path from it', async () => {
    answer(caller([mentorProgram(PROGRAM_ID, '../tasks')]));

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: 'MENTORSHIP_INVALID_PROGRAM',
      operation: 'mentorship_get_mentor_program',
    });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });
});
