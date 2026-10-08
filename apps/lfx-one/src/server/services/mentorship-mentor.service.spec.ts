// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE, MENTORSHIP_MENTOR_TASK_NOT_SUBMITTED_ERROR_CODE } from '@lfx-one/shared/constants';
import type {
  MentorshipMentorRegisterRequest,
  MentorshipUpstreamMentorDetail,
  MentorshipUpstreamMentoredProgram,
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
const MENTOR_PROGRAMS_PATH = '/mentorship/v1/me/mentor-programs';

function buildReq(): Request {
  return { path: '/api/mentorship/mentor/programs' } as Request;
}

/** A signed-in caller, so the service looks up their primary email by sub. */
function signedInReq(): Request {
  return { path: '/api/mentorship/mentor/profile', impersonationActive: false, oidc: { user: { sub: 'auth0|test-user-1' } } } as unknown as Request;
}

/** A caller being impersonated, so a not-provisioned 401 is not answered by provisioning them. */
function impersonatingReq(): Request {
  return { path: '/api/mentorship/mentor/programs', impersonationActive: true } as unknown as Request;
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

  const mentored = (id: string, name: string, overrides: Partial<MentorshipUpstreamMentoredProgram> = {}): MentorshipUpstreamMentoredProgram => ({
    id,
    slug: name.toLowerCase(),
    name,
    status: 'open',
    stats: { mentees: 0, applicants: 0, tasks_to_review: 0 },
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.warning).mockClear();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  it("builds a card for each row of the caller's mentor programs, in upstream's order, from one read", async () => {
    proxyRequest.mockResolvedValueOnce(
      listOf([
        mentored(GRIDFLOW_ID, 'GridFlow', {
          project_name: 'LF Energy',
          logo_url: 'https://cdn.example.org/gridflow.png',
          stats: { mentees: 2, applicants: 5, tasks_to_review: 1 },
        }),
        mentored(ARCHIVE_ID, 'Archive', { slug: undefined, status: 'completed' }),
      ])
    );

    const programs = await service.getMentorPrograms(buildReq());

    expect(programs).toEqual({
      total: 2,
      data: [
        {
          id: GRIDFLOW_ID,
          slug: 'gridflow',
          name: 'GridFlow',
          projectName: 'LF Energy',
          status: 'open',
          stats: { mentees: 2, tasksToReview: 1, applicants: 5 },
          logoUrl: 'https://cdn.example.org/gridflow.png',
        },
        {
          id: ARCHIVE_ID,
          slug: ARCHIVE_ID,
          name: 'Archive',
          projectName: '',
          status: 'completed',
          stats: { mentees: 0, tasksToReview: 0, applicants: 0 },
        },
      ],
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', MENTOR_PROGRAMS_PATH, 'GET', { limit: 100, offset: 0 }, undefined);
  });

  it('pages the list at 100 until the total is reached', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => mentored(`1a2b3c4d-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, `P${index}`));
    proxyRequest.mockResolvedValueOnce({ data: firstPage, meta: { total: 101, limit: 100, offset: 0 } });
    proxyRequest.mockResolvedValueOnce({ data: [mentored(ARCHIVE_ID, 'Archive')], meta: { total: 101, limit: 100, offset: 100 } });

    await expect(service.getMentorPrograms(buildReq())).resolves.toMatchObject({ total: 101 });
    expect(proxyRequest).toHaveBeenLastCalledWith(expect.anything(), 'LFX_V2_SERVICE', MENTOR_PROGRAMS_PATH, 'GET', { limit: 100, offset: 100 }, undefined);
  });

  it('shows a status it does not know as open and logs it at warning', async () => {
    proxyRequest.mockResolvedValueOnce(listOf([mentored(GRIDFLOW_ID, 'GridFlow', { status: 'archived' })]));

    const [card] = (await service.getMentorPrograms(buildReq())).data;

    expect(card.status).toBe('open');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_get_mentor_programs', expect.any(String), {
      program_id: GRIDFLOW_ID,
      status: 'archived',
    });
  });

  it('returns no programs for a caller with no mentorship record', async () => {
    proxyRequest.mockRejectedValueOnce(upstreamError(401, { error: 'local user is not provisioned' }));

    await expect(service.getMentorPrograms(impersonatingReq())).resolves.toEqual({ data: [], total: 0 });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404, 500])("propagates upstream's %i rather than show an empty list", async (status) => {
    const error = upstreamError(status, { error: 'denied' });
    proxyRequest.mockRejectedValueOnce(error);

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
  const SPRING_TERM_ID = '2b3c4d5e-0000-4000-8000-000000000002';
  const PROGRAM_PATH = `/mentorship/v1/programs/${PROGRAM_ID}`;
  const TERM_TASKS_PATH = `${PROGRAM_PATH}/terms/${TERM_ID}/tasks`;
  const SPRING_TERM_TASKS_PATH = `${PROGRAM_PATH}/terms/${SPRING_TERM_ID}/tasks`;
  const ACCEPTED_ID = '3c4d5e6f-0000-4000-8000-000000000001';
  const GRADUATED_ID = '3c4d5e6f-0000-4000-8000-000000000002';
  const PENDING_ID = '3c4d5e6f-0000-4000-8000-000000000003';
  const MENTOR_ROLE_ID = '3c4d5e6f-0000-4000-8000-000000000004';
  const FALL = { id: TERM_ID, name: 'Fall 2026', status: 'open' as const };
  const SPRING = { id: SPRING_TERM_ID, name: 'Spring 2026', status: 'closed' as const };
  const applicationTasksPath = (applicationId: string) => `/mentorship/v1/applications/${applicationId}/tasks`;

  const mentored = (overrides: Partial<MentorshipUpstreamMentoredProgram> = {}): MentorshipUpstreamMentoredProgram => ({
    id: PROGRAM_ID,
    slug: 'gridflow',
    name: 'GridFlow',
    project_name: 'LF Energy',
    status: 'open',
    stats: { mentees: 2, applicants: 3, tasks_to_review: 1 },
    ...overrides,
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
    term: FALL,
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
    row(GRADUATED_ID, 'graduated', { term: SPRING }),
    row(PENDING_ID, 'pending', { tasks_submitted: 1, tasks_total: 2 }),
  ];

  /** Answers each upstream read by path, since the term task reads run in parallel. */
  function answer(routes: Record<string, (query: Record<string, unknown> | undefined) => unknown>) {
    proxyRequest.mockImplementation(async (_req, _service, path, _method, query) => {
      const route = routes[path];
      if (!route) throw new Error(`unexpected upstream call to ${path}`);
      return route(query as Record<string, unknown> | undefined) as never;
    });
  }

  const caller = (programs = [mentored()]) => ({
    [MENTOR_PROGRAMS_PATH]: () => listOf(programs),
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.warning).mockClear();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  it("builds the detail from the program's row and every application and task on all its terms", async () => {
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf(rows),
      [TERM_TASKS_PATH]: () =>
        listOf([
          { ...task('t1', ACCEPTED_ID, 'submitted'), name: 'Resume', category: 'prerequisite', file: 'resume.pdf', due_date: '2026-09-30T00:00:00Z' },
          task('t3', PENDING_ID, 'incomplete'),
          task('t4', MENTOR_ROLE_ID, 'submitted'),
        ]),
      [SPRING_TERM_TASKS_PATH]: () => listOf([task('t2', GRADUATED_ID, 'submitted')]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    // The header is the program's My Programs row, counts and all.
    expect(detail.program).toEqual({
      id: PROGRAM_ID,
      slug: 'gridflow',
      name: 'GridFlow',
      projectName: 'LF Energy',
      status: 'open',
      stats: { mentees: 2, tasksToReview: 1, applicants: 3 },
    });
    // A graduated mentee's leftover submission and a mentor-role application's task are not waiting on the mentor.
    expect(detail.tabCounts).toEqual({ tasks: 1, mentees: 2, applicants: 3 });
    // Each row's term is its own application's.
    expect(detail.mentees.map((mentee) => [mentee.id, mentee.termName])).toEqual([
      [ACCEPTED_ID, 'Fall 2026'],
      [GRADUATED_ID, 'Spring 2026'],
    ]);
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
    expect(detail.mentees[1].tasks?.map((menteeTask) => menteeTask.id)).toEqual(['t2']);
    expect(detail.applicants.map((applicant) => applicant.id)).toEqual([ACCEPTED_ID, GRADUATED_ID, PENDING_ID]);
    expect(detail.applicants[0]).toMatchObject({
      createdOn: '2026-08-01',
      updatedOn: '2026-08-02',
      otherApplications: [{ programId: OTHER_PROGRAM_ID, programName: 'Thanos', status: 'pending' }],
    });
    expect(detail.applicants[2].tasks?.map((applicantTask) => applicantTask.status)).toEqual(['pending']);
    expect(JSON.stringify(detail)).not.toContain(MENTOR_ROLE_ID);
    // Applications are read across the open terms, with no term filter, and each term's tasks once.
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      `${PROGRAM_PATH}/applications`,
      'GET',
      { type: 'current', limit: 50, offset: 0 },
      undefined
    );
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', TERM_TASKS_PATH, 'GET', { limit: 100, offset: 0 }, undefined);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', SPRING_TERM_TASKS_PATH, 'GET', { limit: 100, offset: 0 }, undefined);
    expect(proxyRequest).toHaveBeenCalledTimes(4);
  });

  it('pages applications at 50 until the total is reached', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => row(`3c4d5e6f-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, 'pending'));
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: (query) =>
        query?.['offset'] === 0
          ? { data: firstPage, meta: { total: 51, limit: 50, offset: 0 } }
          : { data: [row(ACCEPTED_ID, 'accepted')], meta: { total: 51, limit: 50, offset: 50 } },
      [TERM_TASKS_PATH]: () => listOf([]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail.tabCounts).toMatchObject({ mentees: 1, applicants: 51 });
    expect(proxyRequest.mock.calls.filter(([, , path]) => path === TERM_TASKS_PATH)).toHaveLength(1);
  });

  it('reads at most five terms at once', async () => {
    const termIds = Array.from({ length: 7 }, (_, index) => `2b3c4d5e-0000-4000-8000-00000000010${index}`);
    let inFlight = 0;
    let peak = 0;
    const routes: Record<string, () => unknown> = {
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () =>
        listOf(termIds.map((termId, index) => row(`3c4d5e6f-0000-4000-8000-00000000010${index}`, 'accepted', { term: { ...FALL, id: termId } }))),
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
    expect(proxyRequest).toHaveBeenCalledTimes(9);
  });

  it("reads each mentee's tasks from their application when the gateway refuses a term task listing", async () => {
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf(rows),
      [TERM_TASKS_PATH]: () => listOf([]),
      [SPRING_TERM_TASKS_PATH]: () => {
        throw upstreamError(403, { error: 'forbidden' });
      },
      [applicationTasksPath(ACCEPTED_ID)]: () => listOf([task('t1', ACCEPTED_ID, 'submitted'), task('t2', ACCEPTED_ID, 'complete')]),
      [applicationTasksPath(GRADUATED_ID)]: () => listOf([task('t3', GRADUATED_ID, 'submitted')]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail.tabCounts).toEqual({ tasks: 1, mentees: 2, applicants: 3 });
    expect(detail.mentees.map((mentee) => mentee.tasks?.map((menteeTask) => menteeTask.status))).toEqual([['submitted', 'completed'], ['submitted']]);
    // The pending applicant's application is not read, so the row carries no tasks.
    expect(detail.applicants[2].tasks).toBeUndefined();
    expect(proxyRequest).not.toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', applicationTasksPath(PENDING_ID), 'GET', expect.anything(), undefined);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_get_mentor_program', expect.any(String), { term_count: 2 });
  });

  it('reads at most five mentee applications at once in the fallback', async () => {
    const mentees = Array.from({ length: 7 }, (_, index) => row(`3c4d5e6f-0000-4000-8000-00000000010${index}`, 'accepted'));
    let inFlight = 0;
    let peak = 0;
    const routes: Record<string, () => unknown> = {
      ...caller(),
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

  it.each([
    ['refused', true],
    ['allowed', false],
  ])('refuses an application id from upstream that is not a UUID when the term task listing is %s', async (_kind, refused) => {
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf([row('../tasks', 'accepted')]),
      [TERM_TASKS_PATH]: () => {
        if (refused) throw upstreamError(403, { error: 'forbidden' });
        return listOf([]);
      },
    });

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode: 502, code: 'MENTORSHIP_INVALID_APPLICATION' });
  });

  it('refuses a term id from upstream that is not a UUID before building a path from it', async () => {
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf([row(ACCEPTED_ID, 'accepted'), row(PENDING_ID, 'pending', { term: { ...FALL, id: '../tasks' } })]),
    });

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: 'MENTORSHIP_INVALID_PROGRAM',
      operation: 'mentorship_get_mentor_program',
    });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('propagates any other failure of a term task listing', async () => {
    const error = upstreamError(500, { error: 'internal server error' });
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf(rows),
      [TERM_TASKS_PATH]: () => listOf([]),
      [SPRING_TERM_TASKS_PATH]: () => {
        throw error;
      },
    });

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toBe(error);
  });

  it('reads no tasks for a program with no applications', async () => {
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf([]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail).toMatchObject({ mentees: [], applicants: [], tabCounts: { tasks: 0, mentees: 0, applicants: 0 } });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('leaves the term name empty and reads no term tasks for an application with no term', async () => {
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf([row(PENDING_ID, 'pending', { term: undefined })]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail.applicants.map((applicant) => applicant.termName)).toEqual(['']);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('shows a status it does not know as open in the header and logs it at warning', async () => {
    answer({
      ...caller([mentored({ status: 'archived' })]),
      [`${PROGRAM_PATH}/applications`]: () => listOf([]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail.program.status).toBe('open');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_get_mentor_program', expect.any(String), {
      program_id: PROGRAM_ID,
      status: 'archived',
    });
  });

  it('finds the program whatever the case of the requested id', async () => {
    answer({
      ...caller(),
      [`${PROGRAM_PATH}/applications`]: () => listOf([]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID.toUpperCase());

    expect(detail.program.id).toBe(PROGRAM_ID);
  });

  it('skips a listed program whose id is not a UUID instead of failing the lookup', async () => {
    answer({
      ...caller([mentored({ id: 42 as unknown as string }), mentored()]),
      [`${PROGRAM_PATH}/applications`]: () => listOf([]),
    });

    const detail = await service.getMentorProgram(buildReq(), PROGRAM_ID);

    expect(detail.program.id).toBe(PROGRAM_ID);
  });

  it.each([
    ['another program', () => caller([mentored({ id: OTHER_PROGRAM_ID })])],
    ['no mentor programs', () => caller([])],
  ])('answers 404 for a program the caller does not mentor (%s) without reading it', async (_case, routes) => {
    answer(routes());

    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(service.getMentorProgram(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode: 404, operation: 'mentorship_get_mentor_program' });
    expect(proxyRequest.mock.calls.every(([, , path]) => path === MENTOR_PROGRAMS_PATH)).toBe(true);
  });

  it('answers 404 for a caller with no mentorship record', async () => {
    proxyRequest.mockRejectedValue(upstreamError(401, { error: 'local user is not provisioned' }));

    await expect(service.getMentorProgram(impersonatingReq(), PROGRAM_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });
});

describe('MentorshipMentorService.updateApplicationNote', () => {
  const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';
  const NOTE_PATH = `/mentorship/v1/applications/${APPLICATION_ID}/note`;
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.debug).mockClear();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  it('PUTs the note as reviewer_note, without logging its text', async () => {
    proxyRequest.mockResolvedValueOnce({ note: 'Strong screening call.' });

    await expect(service.updateApplicationNote(buildReq(), APPLICATION_ID, { note: 'Strong screening call.' })).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', NOTE_PATH, 'PUT', undefined, { reviewer_note: 'Strong screening call.' });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('Strong screening call.');
  });

  it('sends an empty reviewer_note to clear the note', async () => {
    proxyRequest.mockResolvedValueOnce({ note: '' });

    await service.updateApplicationNote(buildReq(), APPLICATION_ID, { note: '' });
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', NOTE_PATH, 'PUT', undefined, { reviewer_note: '' });
  });

  it.each([
    [403, 'only program mentors and admins can review applications'],
    [404, 'application not found'],
  ])("passes upstream's %s through", async (status, error) => {
    const failure = upstreamError(status, { error });
    proxyRequest.mockRejectedValueOnce(failure);

    await expect(service.updateApplicationNote(buildReq(), APPLICATION_ID, { note: 'Note' })).rejects.toBe(failure);
  });
});

describe('MentorshipMentorService.reviewMenteeTask', () => {
  const TASK_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const TASK_PATH = `/mentorship/v1/tasks/${TASK_ID}`;
  const REVIEW_PATH = `${TASK_PATH}/review`;
  let service: InstanceType<typeof MentorshipMentorService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const task = (status: MentorshipUpstreamTask['status']): Partial<MentorshipUpstreamTask> => ({ id: TASK_ID, status });

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMentorService();
  });

  it.each(['complete', 'incomplete'] as const)('reads the submitted task, then PATCHes the review route with only %s', async (status) => {
    proxyRequest.mockResolvedValueOnce(task('submitted')).mockResolvedValueOnce(task(status));

    await expect(service.reviewMenteeTask(buildReq(), TASK_ID, status)).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', TASK_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', REVIEW_PATH, 'PATCH', undefined, { status });
  });

  it.each([
    ['complete', 'complete'],
    ['incomplete', 'in_progress'],
    ['incomplete', 'incomplete'],
    ['incomplete', 'complete'],
  ] as const)('refuses %s on a task that is %s with a 409 and never PATCHes', async (status, current) => {
    proxyRequest.mockResolvedValueOnce(task(current));

    await expect(service.reviewMenteeTask(buildReq(), TASK_ID, status)).rejects.toMatchObject({
      statusCode: 409,
      code: MENTORSHIP_MENTOR_TASK_NOT_SUBMITTED_ERROR_CODE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('encodes the task id into both paths', async () => {
    proxyRequest.mockResolvedValueOnce(task('submitted')).mockResolvedValueOnce(task('complete'));

    await service.reviewMenteeTask(buildReq(), 'a/b?c', 'complete');
    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', '/mentorship/v1/tasks/a%2Fb%3Fc', 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', '/mentorship/v1/tasks/a%2Fb%3Fc/review', 'PATCH', undefined, {
      status: 'complete',
    });
  });

  it.each([
    [403, 'actor is not a member of this program'],
    [404, 'task not found'],
  ])("passes the read's %s through without PATCHing", async (status, error) => {
    const failure = upstreamError(status, { error });
    proxyRequest.mockRejectedValueOnce(failure);

    await expect(service.reviewMenteeTask(buildReq(), TASK_ID, 'complete')).rejects.toBe(failure);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'actor is not a member of this program'],
    [409, 'invalid state transition'],
  ])("passes the review's %s through", async (status, error) => {
    const failure = upstreamError(status, { error });
    proxyRequest.mockResolvedValueOnce(task('submitted')).mockRejectedValueOnce(failure);

    await expect(service.reviewMenteeTask(buildReq(), TASK_ID, 'complete')).rejects.toBe(failure);
  });
});
