// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import {
  MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
} from '@lfx-one/shared/constants';
import type { MentorshipMenteeRegisterRequest, MentorshipUpstreamApplication, MentorshipUpstreamTask } from '@lfx-one/shared/interfaces';
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
const { EmailVerificationService } = await import('./email-verification.service');
const { logger } = await import('./logger.service');
const { MicroserviceError } = await import('../errors');

const PROFILES_PATH = '/mentorship/v1/me/profiles';
const ME_APPLICATIONS_PATH = '/mentorship/v1/me/applications';
const APPLICATIONS_PATH = '/mentorship/v1/applications';
const PROGRAMS_PATH = '/mentorship/v1/programs';

function upstreamError(status: number, body: unknown) {
  return MicroserviceError.fromMicroserviceResponse(status, 'Upstream error', body, 'LFX_V2_SERVICE', PROFILES_PATH);
}

function buildReq(): Request {
  return { path: '/api/mentorship/mentee/apply-target' } as Request;
}

/** A signed-in caller, so the service looks up their primary email by sub. */
function signedInReq(): Request {
  return { path: '/api/mentorship/mentee/profile', impersonationActive: false, oidc: { user: { sub: 'auth0|test-user-1' } } } as unknown as Request;
}

function listOf<T>(data: T[]) {
  return { data, meta: { total: data.length, limit: 100, offset: 0 } };
}

function upstreamApplication(overrides: Partial<MentorshipUpstreamApplication> = {}): MentorshipUpstreamApplication {
  return {
    id: 'app-1',
    program_term_id: 'term-1',
    user_id: 'user-1',
    role: 'mentee',
    status: 'pending',
    tasks_submitted: false,
    admin_notified: false,
    created_on: '2026-06-28T10:00:00Z',
    updated_on: '2026-06-29T10:00:00Z',
    program: { id: 'prog-1', name: 'Test Program', slug: 'test-program' },
    term: { id: 'term-1', name: 'Fall 2026', status: 'open' },
    ...overrides,
  };
}

function upstreamTask(overrides: Partial<MentorshipUpstreamTask> = {}): MentorshipUpstreamTask {
  return {
    id: 'task-1',
    assignee_id: 'user-1',
    name: 'Test task',
    category: 'prerequisite',
    status: 'incomplete',
    custom: false,
    created_on: '2026-06-01T10:00:00Z',
    updated_on: '2026-06-05T10:00:00Z',
    ...overrides,
  };
}

/** Answers each proxied call by its upstream path; an unrouted path fails the test. */
function routeProxy(
  proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>,
  routes: Record<string, (query?: Record<string, unknown>) => unknown>
) {
  proxyRequest.mockImplementation(async (_req, _service, path, _method, query) => {
    const handler = routes[path];
    if (!handler) {
      throw new Error(`Unexpected upstream path ${path}`);
    }
    return handler(query as Record<string, unknown> | undefined) as never;
  });
}

describe('MentorshipMenteeService.registerMenteeProfile', () => {
  const MENTEE_PROFILE_PATH = `${PROFILES_PATH}/mentee`;
  const request: MentorshipMenteeRegisterRequest = {
    introduction: '<p>Test intro</p>',
    skillsHave: ['Java'],
    skillsWant: ['Python'],
    additionalNotes: 'Test notes',
    country: 'KE',
    demographics: { age: '20-39', education: 'college' },
    ageEligible: true,
    workAuthorized: true,
    noDuplicateProfile: true,
    complianceAccepted: true,
    termsAccepted: true,
  };
  let service: InstanceType<typeof MentorshipMenteeService>;
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
    service = new MentorshipMenteeService();
  });

  it('lists the caller mentee rows, then puts the mapped profile when none exists', async () => {
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([]),
      [MENTEE_PROFILE_PATH]: () => ({}),
    });

    await expect(service.registerMenteeProfile(buildReq(), request)).resolves.toBeUndefined();

    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', PROFILES_PATH, 'GET', { profile_type: 'mentee', limit: 1 }, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'PUT', undefined, {
      introduction: '<p>Test intro</p>',
      terms_and_conditions: true,
      age_eligible: true,
      work_eligible: true,
      skill_set: { skills: ['Java'], improvementSkills: ['Python'], comments: 'Test notes' },
      address: { country: 'KE' },
      demographics: { age: '20-39' },
      socioeconomics: { educationLevel: 'college' },
    });
  });

  it("adds the caller's verified primary email, looked up by their sub, to the profile it puts", async () => {
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([]),
      [MENTEE_PROFILE_PATH]: () => ({}),
    });

    await service.registerMenteeProfile(signedInReq(), { ...request, lfxProfile: { firstName: 'Test' } });

    expect(getUserEmails).toHaveBeenCalledWith(expect.anything(), 'auth0|test-user-1');
    expect(proxyRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      MENTEE_PROFILE_PATH,
      'PUT',
      undefined,
      expect.objectContaining({ first_name: 'Test', email: 'test.user@example.com' })
    );
  });

  it('leaves the email out when the lookup fails, and still registers', async () => {
    getUserEmails.mockResolvedValueOnce(null);
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([]),
      [MENTEE_PROFILE_PATH]: () => ({}),
    });

    await expect(service.registerMenteeProfile(signedInReq(), request)).resolves.toBeUndefined();
    expect(proxyRequest.mock.calls[1][5]).not.toHaveProperty('email');
  });

  it("adds the caller's connected GitHub link to the profile it puts", async () => {
    listIdentitiesSafe.mockResolvedValue([
      { provider: 'github', user_id: 'github-1', connection: 'github', isSocial: true, profileData: { nickname: 'test-user' } },
    ]);
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([]),
      [MENTEE_PROFILE_PATH]: () => ({}),
    });

    await service.registerMenteeProfile(signedInReq(), request);

    expect(listIdentitiesSafe).toHaveBeenCalledWith(expect.anything(), 'auth0|test-user-1');
    expect(proxyRequest.mock.calls[1][5]).toMatchObject({ profile_links: { githubProfileLink: 'https://github.com/test-user' } });
  });

  it('sends no profile links when the caller has no GitHub account connected', async () => {
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([]),
      [MENTEE_PROFILE_PATH]: () => ({}),
    });

    await service.registerMenteeProfile(signedInReq(), request);

    expect(proxyRequest.mock.calls[1][5]).not.toHaveProperty('profile_links');
  });

  it('refuses with a 409 profile-exists conflict, without writing, when a mentee profile exists', async () => {
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([{ id: 'profile-1', profile_type: 'mentee' }]),
    });

    await expect(service.registerMenteeProfile(signedInReq(), request)).rejects.toMatchObject({
      statusCode: 409,
      code: MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(getUserEmails).not.toHaveBeenCalled();
    expect(listIdentitiesSafe).not.toHaveBeenCalled();
  });

  it('fails closed when the existing-profile check fails', async () => {
    const error = upstreamError(500, { error: 'boom' });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.registerMenteeProfile(buildReq(), request)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'bad request'],
    [403, 'forbidden'],
    [422, 'age eligibility is required'],
  ])('propagates an upstream %i from the write', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockResolvedValueOnce(listOf([]));
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.registerMenteeProfile(buildReq(), request)).rejects.toBe(error);
  });

  it('does not log the profile answers', async () => {
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([]),
      [MENTEE_PROFILE_PATH]: () => ({}),
    });

    await service.registerMenteeProfile(signedInReq(), request);

    const logged = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(logged).not.toContain('Test intro');
    expect(logged).not.toContain('Test notes');
    expect(logged).not.toContain('college');
    expect(logged).not.toContain('test.user@example.com');
  });
});

describe('MentorshipMenteeService apply', () => {
  const programId = '3b1f6c0e-2d4a-4e8b-9c1d-5f6a7b8c9d0e';
  const programTermId = '8e2d4c6a-1b3f-4a5c-8d7e-9f0a1b2c3d4e';
  const programPath = `${PROGRAMS_PATH}/${programId}`;
  const termPath = `${programPath}/terms/${programTermId}`;
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it('builds the apply target from the program and the term', async () => {
    routeProxy(proxyRequest, {
      [programPath]: () => ({ id: programId, name: 'Test Program', status: 'published', project_name: 'Test Project' }),
      // No window dates, so the term takes applications whatever today is.
      [termPath]: () => ({ id: programTermId, program_id: programId, name: 'Fall 2026', status: 'open' }),
    });

    await expect(service.getMenteeApplyTarget(buildReq(), programId, programTermId)).resolves.toEqual({
      programName: 'Test Program',
      projectName: 'Test Project',
      termName: 'Fall 2026',
      acceptingApplications: true,
    });
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', programPath, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', termPath, 'GET', undefined, undefined);
  });

  it('reports a closed term as not accepting applications', async () => {
    routeProxy(proxyRequest, {
      [programPath]: () => ({ id: programId, name: 'Test Program', status: 'published' }),
      [termPath]: () => ({ id: programTermId, program_id: programId, name: 'Fall 2026', status: 'closed' }),
    });

    await expect(service.getMenteeApplyTarget(buildReq(), programId, programTermId)).resolves.toMatchObject({
      projectName: '',
      acceptingApplications: false,
    });
  });

  it('propagates a 404 on the term read', async () => {
    const error = upstreamError(404, { error: 'not found' });
    routeProxy(proxyRequest, {
      [programPath]: () => ({ id: programId, name: 'Test Program', status: 'published' }),
      [termPath]: () => {
        throw error;
      },
    });

    await expect(service.getMenteeApplyTarget(buildReq(), programId, programTermId)).rejects.toBe(error);
  });

  it('posts a mentee application to the term, with only the role in the body', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamApplication({ program_term_id: programTermId, program: undefined, term: undefined }));

    await expect(service.applyToMenteeTerm(buildReq(), programId, programTermId)).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `${termPath}/applications`, 'POST', undefined, { role: 'mentee' });
  });

  it.each([
    [422, 'eligibility criteria not met: applications are not open for this term'],
    [409, 'conflict'],
    [404, 'not found'],
  ])('propagates an upstream %i on apply', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.applyToMenteeTerm(buildReq(), programId, programTermId)).rejects.toBe(error);
  });
});

describe('MentorshipMenteeService profile reads', () => {
  const MENTEE_PROFILE_PATH = `${PROFILES_PATH}/mentee`;
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

  it('reports no profile when upstream sends the list data as null', async () => {
    proxyRequest.mockResolvedValueOnce({ data: null, meta: { total: 0, limit: 1, offset: 0 } });

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

  it("maps the caller's mentee row from the typed read and fills the history from their applications", async () => {
    routeProxy(proxyRequest, {
      [MENTEE_PROFILE_PATH]: () => ({
        id: 'prof-1',
        user_id: 'user-1',
        profile_type: 'mentee',
        introduction: 'Test mentee introduction.',
        skill_set: { skills: ['Go'], improvementSkills: ['Code Review'] },
        terms_and_conditions: true,
        number_of_projects: 0,
        created_on: '2026-01-01T00:00:00Z',
        updated_on: '2026-01-01T00:00:00Z',
      }),
      [ME_APPLICATIONS_PATH]: () => listOf([upstreamApplication()]),
    });

    const result = await service.getMenteeProfile(buildReq());

    expect(result.profile).toMatchObject({ aboutMe: 'Test mentee introduction.', skillsHave: ['Go'], skillsWant: ['Code Review'] });
    expect(result.history).toEqual([
      { id: 'app-1', programId: 'prog-1', programName: 'Test Program', termName: 'Fall 2026', submittedOn: 'Jun 28, 2026', status: 'pending' },
    ]);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      ME_APPLICATIONS_PATH,
      'GET',
      { role: 'mentee', limit: 100, offset: 0 },
      undefined
    );
  });

  it('returns an empty profile when upstream has no mentee row for the caller (404), so the apply page loads straight after registering', async () => {
    routeProxy(proxyRequest, {
      [MENTEE_PROFILE_PATH]: () => {
        throw upstreamError(404, { error: 'profile not found' });
      },
      [ME_APPLICATIONS_PATH]: () => listOf([]),
    });

    await expect(service.getMenteeProfile(buildReq())).resolves.toEqual({
      profile: { aboutMe: '', skillsHave: [], skillsWant: [] },
      history: [],
    });
  });

  it.each([
    ["upstream's 409 for more than one mentee profile, rather than pick one,", 409, { error: 'multiple mentee profiles exist for user' }],
    ['a 500', 500, { error: 'internal server error' }],
  ])('propagates %s on the profile read', async (_label, status, body) => {
    const error = upstreamError(status, body);
    routeProxy(proxyRequest, {
      [MENTEE_PROFILE_PATH]: () => {
        throw error;
      },
      [ME_APPLICATIONS_PATH]: () => listOf([]),
    });

    await expect(service.getMenteeProfile(buildReq())).rejects.toBe(error);
  });

  it('leaves the history empty when the applications read fails on the profile read', async () => {
    routeProxy(proxyRequest, {
      [MENTEE_PROFILE_PATH]: () => {
        throw upstreamError(404, { error: 'profile not found' });
      },
      [ME_APPLICATIONS_PATH]: () => {
        throw upstreamError(500, { error: 'internal server error' });
      },
    });

    await expect(service.getMenteeProfile(buildReq())).resolves.toEqual({
      profile: { aboutMe: '', skillsHave: [], skillsWant: [] },
      history: [],
    });
  });
});

describe('MentorshipMenteeService.getMenteeApplications', () => {
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it('joins each application to its tasks and the project on its embedded program', async () => {
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: () =>
        listOf([
          upstreamApplication({ program: { id: 'prog-1', name: 'Test Program', slug: 'test-program', project_name: 'Test Project' } }),
          upstreamApplication({ id: 'app-2' }),
        ]),
      [`${APPLICATIONS_PATH}/app-1/tasks`]: () => listOf([upstreamTask()]),
      [`${APPLICATIONS_PATH}/app-2/tasks`]: () => listOf([]),
    });

    const result = await service.getMenteeApplications(buildReq(), true);

    expect(result.total).toBe(2);
    expect(result.data.map((app) => [app.id, app.projectName, app.tasks?.map((task) => task.id)])).toEqual([
      ['app-1', 'Test Project', ['task-1']],
      ['app-2', undefined, []],
    ]);
    // The project comes embedded, so no program is read.
    expect(proxyRequest.mock.calls.some(([, , path]) => path.startsWith(PROGRAMS_PATH))).toBe(false);
  });

  it('skips the task reads without withTasks', async () => {
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: () => listOf([upstreamApplication()]),
    });

    const result = await service.getMenteeApplications(buildReq(), false);

    expect(result.data[0]).not.toHaveProperty('tasks');
    expect(proxyRequest.mock.calls.some(([, , path]) => path.startsWith(APPLICATIONS_PATH))).toBe(false);
  });

  it('reads tasks only for pending, accepted and graduated applications', async () => {
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: () =>
        listOf([
          upstreamApplication(),
          upstreamApplication({ id: 'app-accepted', status: 'accepted' }),
          upstreamApplication({ id: 'app-graduated', status: 'graduated' }),
          ...(['declined', 'withdrawn', 'hold'] as const).map((status) => upstreamApplication({ id: `app-${status}`, status })),
        ]),
      [`${APPLICATIONS_PATH}/app-1/tasks`]: () => listOf([upstreamTask()]),
      [`${APPLICATIONS_PATH}/app-accepted/tasks`]: () => listOf([]),
      [`${APPLICATIONS_PATH}/app-graduated/tasks`]: () => listOf([]),
    });

    const result = await service.getMenteeApplications(buildReq(), true);

    const taskPaths = proxyRequest.mock.calls.map(([, , path]) => path).filter((path) => path.startsWith(APPLICATIONS_PATH));
    expect(taskPaths).toEqual([`${APPLICATIONS_PATH}/app-1/tasks`, `${APPLICATIONS_PATH}/app-accepted/tasks`, `${APPLICATIONS_PATH}/app-graduated/tasks`]);
    expect(result.data.filter((app) => app.tasks !== undefined).map((app) => app.id)).toEqual(['app-1', 'app-accepted', 'app-graduated']);
  });

  it('reads every page of applications', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => upstreamApplication({ id: `app-${index}` }));
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: (query) =>
        query?.['offset'] === 0
          ? { data: firstPage, meta: { total: 101, limit: 100, offset: 0 } }
          : { data: [upstreamApplication({ id: 'app-last' })], meta: { total: 101, limit: 100, offset: 100 } },
    });

    const result = await service.getMenteeApplications(buildReq(), false);

    expect(result.total).toBe(101);
    expect(result.data.at(-1)?.id).toBe('app-last');
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      ME_APPLICATIONS_PATH,
      'GET',
      { role: 'mentee', limit: 100, offset: 100 },
      undefined
    );
  });

  it('reads tasks a few applications at a time', async () => {
    const applications = Array.from({ length: 7 }, (_, index) => upstreamApplication({ id: `app-${index}` }));
    let inFlight = 0;
    let peak = 0;
    const tasksRoutes = Object.fromEntries(
      applications.map((application) => [
        `${APPLICATIONS_PATH}/${application.id}/tasks`,
        async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 0));
          inFlight--;
          return listOf([]);
        },
      ])
    );
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: () => listOf(applications),
      ...tasksRoutes,
    });

    const result = await service.getMenteeApplications(buildReq(), true);

    expect(result.data.map((app) => app.id)).toEqual(applications.map((application) => application.id));
    expect(peak).toBe(5);
  });

  it('propagates a failed task read', async () => {
    const error = upstreamError(500, { error: 'internal server error' });
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: () => listOf([upstreamApplication()]),
      [`${APPLICATIONS_PATH}/app-1/tasks`]: () => {
        throw error;
      },
    });

    await expect(service.getMenteeApplications(buildReq(), true)).rejects.toBe(error);
  });
});

describe('MentorshipMenteeService.withdrawMenteeApplication', () => {
  const applicationId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it('posts to the application withdraw route with no body', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamApplication({ id: applicationId, status: 'withdrawn' }));

    await expect(service.withdrawMenteeApplication(buildReq(), applicationId)).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      `${APPLICATIONS_PATH}/${applicationId}/withdraw`,
      'POST',
      undefined,
      undefined
    );
  });

  it.each([
    [409, 'invalid state transition: cannot transition application from "accepted" to "withdrawn"'],
    [403, 'forbidden'],
    [404, 'not found'],
  ])('propagates an upstream %i', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.withdrawMenteeApplication(buildReq(), applicationId)).rejects.toBe(error);
  });
});

describe('MentorshipMenteeService.updateMenteeProfile', () => {
  const MENTEE_PROFILE_PATH = `${PROFILES_PATH}/mentee`;
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const updatedRow = {
    id: 'prof-1',
    user_id: 'user-1',
    profile_type: 'mentee',
    introduction: '<p>Updated introduction.</p>',
    skill_set: { skills: ['Go'], improvementSkills: ['Rust'], comments: 'Test notes.' },
    demographics: { age: '20-39', gender: 'female', race: 'asian' },
    socioeconomics: { income: 'workingClass', educationLevel: 'college' },
    profile_links: { resumeLink: 'https://example.com/files/test-resume.pdf' },
    terms_and_conditions: true,
    number_of_projects: 0,
    created_on: '2026-01-01T00:00:00Z',
    updated_on: '2026-01-02T00:00:00Z',
  };
  const bareStoredRow = { id: 'prof-1', user_id: 'user-1', profile_type: 'mentee' };

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it('reads the stored row, then patches the single-type mentee route with only the built upstream body', async () => {
    proxyRequest.mockResolvedValueOnce(bareStoredRow).mockResolvedValueOnce(updatedRow);

    await service.updateMenteeProfile(buildReq(), { skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: 'Test notes.' } });

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'PATCH', undefined, {
      skill_set: { skills: ['Go'], improvementSkills: ['Rust'], comments: 'Test notes.' },
    });
  });

  it('layers each changed JSON column over its stored value, so keys the BFF does not model survive', async () => {
    const storedRow = {
      ...updatedRow,
      skill_set: { skills: ['C'], improvementSkills: ['Zig'], comments: 'Old notes.', legacyLevel: 'beginner' },
      demographics: { age: 30, gender: 'female', legacyField: 'kept' },
    };
    proxyRequest.mockResolvedValueOnce(storedRow).mockResolvedValueOnce(updatedRow);

    await service.updateMenteeProfile(buildReq(), { skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] }, demographics: { gender: 'male' } });

    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'PATCH', undefined, {
      skill_set: { legacyLevel: 'beginner', skills: ['Go'], improvementSkills: ['Rust'] },
      demographics: { age: 30, gender: 'male', legacyField: 'kept' },
    });
  });

  it('reads the stored row before a country change and keeps the legacy address keys', async () => {
    const storedRow = { ...updatedRow, address: { country: 'US', city: 'Test City', zipCode: '00000' } };
    proxyRequest.mockResolvedValueOnce(storedRow).mockResolvedValueOnce({ ...updatedRow, address: { country: 'KE', city: 'Test City', zipCode: '00000' } });

    const result = await service.updateMenteeProfile(buildReq(), { country: 'KE' });

    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'PATCH', undefined, {
      address: { country: 'KE', city: 'Test City', zipCode: '00000' },
    });
    expect(result.profile.country).toBe('KE');
  });

  it.each([
    ['a 500', 500, { error: 'boom' }],
    ["upstream's 409 for more than one mentee profile", 409, { error: 'multiple mentee profiles exist for user' }],
  ])('does not patch when the stored-row read before a JSON column change fails with %s', async (_label, status, body) => {
    const error = upstreamError(status, body);
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.updateMenteeProfile(buildReq(), { demographics: { age: '20-39' } })).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('sends the introduction HTML as is and maps demographics keys on the way upstream', async () => {
    proxyRequest.mockResolvedValueOnce(bareStoredRow).mockResolvedValueOnce(updatedRow);

    await service.updateMenteeProfile(buildReq(), {
      introduction: '<p>Hello &amp; <strong>welcome</strong></p>',
      demographics: { age: '20-39', raceEthnicity: 'asian' },
      socioeconomics: { education: 'college' },
    });

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'PATCH', undefined, {
      introduction: '<p>Hello &amp; <strong>welcome</strong></p>',
      demographics: { age: '20-39', race: 'asian' },
      socioeconomics: { educationLevel: 'college' },
    });
  });

  it('never sends profile_links or a key for a group the caller did not change, and skips the stored read', async () => {
    proxyRequest.mockResolvedValueOnce(updatedRow);

    await service.updateMenteeProfile(buildReq(), { introduction: '<p>Hello</p>' });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    const body = proxyRequest.mock.calls[0][5] as Record<string, unknown>;
    expect(body).toEqual({ introduction: '<p>Hello</p>' });
    expect(Object.keys(body)).not.toContain('profile_links');
  });

  it('returns the mapped profile and demographics without a history', async () => {
    proxyRequest.mockResolvedValueOnce(updatedRow);

    const result = await service.updateMenteeProfile(buildReq(), { introduction: 'Updated introduction.' });

    expect(result).toEqual({
      profile: {
        aboutMe: '<p>Updated introduction.</p>',
        skillsHave: ['Go'],
        skillsWant: ['Rust'],
        additionalNotes: 'Test notes.',
      },
      demographics: { age: '20-39', gender: 'female', raceEthnicity: 'asian', income: 'workingClass', education: 'college' },
    });
    expect(result).not.toHaveProperty('history');
  });

  it('leaves demographics undefined when the saved row holds no answers', async () => {
    proxyRequest.mockResolvedValueOnce({ ...updatedRow, demographics: undefined, socioeconomics: undefined });

    const result = await service.updateMenteeProfile(buildReq(), { introduction: 'Updated introduction.' });

    expect(result.demographics).toBeUndefined();
  });

  it.each([
    [404, 'not found'],
    [409, 'conflict'],
  ])('propagates an upstream %i', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.updateMenteeProfile(buildReq(), { introduction: 'x' })).rejects.toBe(error);
  });

  it('retries once after the not-provisioned 401 through the shared proxy helper', async () => {
    const notProvisioned = MicroserviceError.fromMicroserviceResponse(
      401,
      'Unauthorized',
      { error: 'local user is not provisioned' },
      'LFX_V2_SERVICE',
      MENTEE_PROFILE_PATH
    );
    proxyRequest.mockRejectedValueOnce(notProvisioned).mockResolvedValueOnce({}).mockResolvedValueOnce(updatedRow);

    await expect(service.updateMenteeProfile(buildReq(), { introduction: '<p>x</p>' })).resolves.toMatchObject({ profile: { skillsHave: ['Go'] } });

    expect(proxyRequest).toHaveBeenCalledTimes(3);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(proxyRequest).toHaveBeenNthCalledWith(3, expect.anything(), 'LFX_V2_SERVICE', MENTEE_PROFILE_PATH, 'PATCH', undefined, { introduction: '<p>x</p>' });
  });

  it('logs group names only, never the values', async () => {
    proxyRequest.mockResolvedValueOnce(bareStoredRow).mockResolvedValueOnce(updatedRow);

    await service.updateMenteeProfile(buildReq(), { introduction: 'Private text', skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'] } });

    const logged = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(logged).toContain('introduction');
    expect(logged).not.toContain('Private text');
  });
});

describe('MentorshipMenteeService.updateMenteeTaskStatus', () => {
  const taskId = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const TASKS_PATH = '/mentorship/v1/tasks';
  const TASK_PATH = `${TASKS_PATH}/${taskId}`;
  const SUBMISSION_PATH = `${TASK_PATH}/submission`;
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  /** The caller's applications: `app-1`, whose term takes applications until 2026-09-30. */
  const applicationsClosingSeptember30 = () =>
    listOf([upstreamApplication({ term: { id: 'term-1', name: 'Fall 2026', status: 'open', application_end_date: '2026-09-30' } })]);

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it('patches the task submission route with a body of only the status', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress' }));

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'in_progress')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `${TASKS_PATH}/${taskId}/submission`, 'PATCH', undefined, {
      status: 'in_progress',
    });
  });

  it('never sends file, even when submitting', async () => {
    proxyRequest
      .mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress', submit_file: 'required', file: 'https://files.example.com/upload.pdf' }))
      .mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'submitted', submit_file: 'required', file: 'https://files.example.com/upload.pdf' }));

    await service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted');

    const body = proxyRequest.mock.calls[1][5];
    expect(body).toEqual({ status: 'submitted' });
    expect(Object.keys(body as object)).toEqual(['status']);
  });

  it('reads the task before a submit and patches it while its due date has not ended', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T23:59:59Z'));
    proxyRequest
      .mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress', due_date: '2026-09-30' }))
      .mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'submitted', due_date: '2026-09-30' }));

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', `${TASKS_PATH}/${taskId}`, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', `${TASKS_PATH}/${taskId}/submission`, 'PATCH', undefined, {
      status: 'submitted',
    });
  });

  it('submits a non-prerequisite task with no due date, without reading the applications', async () => {
    proxyRequest
      .mockResolvedValueOnce(upstreamTask({ id: taskId, application_id: 'app-1', category: 'non_prerequisite', status: 'in_progress' }))
      .mockResolvedValueOnce(upstreamTask({ id: taskId }));

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest.mock.calls[1][3]).toBe('PATCH');
  });

  it('refuses a prerequisite with no due date once its term application close has ended in UTC, without patching', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    routeProxy(proxyRequest, {
      [TASK_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-1', status: 'in_progress' }),
      [ME_APPLICATIONS_PATH]: applicationsClosingSeptember30,
    });

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).rejects.toMatchObject({
      statusCode: 400,
      code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('submits a prerequisite with no due date until its term application close has ended', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T23:59:59Z'));
    routeProxy(proxyRequest, {
      [TASK_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-1', status: 'in_progress' }),
      [ME_APPLICATIONS_PATH]: applicationsClosingSeptember30,
      [SUBMISSION_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-1', status: 'submitted' }),
    });

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'LFX_V2_SERVICE',
      ME_APPLICATIONS_PATH,
      'GET',
      { role: 'mentee', limit: 100, offset: 0 },
      undefined
    );
    expect(proxyRequest).toHaveBeenNthCalledWith(3, expect.anything(), 'LFX_V2_SERVICE', SUBMISSION_PATH, 'PATCH', undefined, { status: 'submitted' });
  });

  it('checks a prerequisite with a due date of its own against that date, without reading the applications', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    routeProxy(proxyRequest, {
      [TASK_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-1', status: 'in_progress', due_date: '2026-10-01' }),
      [SUBMISSION_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-1', status: 'submitted' }),
    });

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it("submits a prerequisite with no due date whose application is not among the caller's", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    routeProxy(proxyRequest, {
      [TASK_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-2', status: 'in_progress' }),
      [ME_APPLICATIONS_PATH]: applicationsClosingSeptember30,
      [SUBMISSION_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-2', status: 'submitted' }),
    });

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(3);
  });

  it('propagates a failed applications read without patching', async () => {
    const error = upstreamError(500, { error: 'internal error' });
    routeProxy(proxyRequest, {
      [TASK_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-1', status: 'in_progress' }),
      [ME_APPLICATIONS_PATH]: () => {
        throw error;
      },
    });

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('refuses a submit once the due date has ended in UTC, without patching', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress', due_date: '2026-09-30' }));

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).rejects.toMatchObject({
      statusCode: 400,
      code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('still lets a past-due task be started, without reading it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress', due_date: '2026-09-30' }));

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'in_progress')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest.mock.calls[0][3]).toBe('PATCH');
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not found'],
  ])('propagates a failed task read (%i) without patching', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('URL-encodes the task id in the path', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamTask());

    await service.updateMenteeTaskStatus(buildReq(), 'a/b?c', 'in_progress');

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `${TASKS_PATH}/a%2Fb%3Fc/submission`, 'PATCH', undefined, expect.anything());
  });

  it('provisions the user and retries once when upstream says the local user is not provisioned', async () => {
    proxyRequest
      .mockRejectedValueOnce(upstreamError(401, { error: 'local user is not provisioned' }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress' }));

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'in_progress')).resolves.toBeUndefined();
    expect(proxyRequest).toHaveBeenCalledTimes(3);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(proxyRequest).toHaveBeenNthCalledWith(3, expect.anything(), 'LFX_V2_SERVICE', `${TASKS_PATH}/${taskId}/submission`, 'PATCH', undefined, {
      status: 'in_progress',
    });
  });

  it.each([
    [400, 'invalid input: submitted tasks requiring a file must include file'],
    [403, 'forbidden'],
    [404, 'not found'],
    [409, 'invalid state transition: cannot transition task from "submitted" to "in_progress"'],
  ])('propagates an upstream %i from the patch', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress' })).mockRejectedValueOnce(error);

    await expect(service.updateMenteeTaskStatus(buildReq(), taskId, 'submitted')).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });
});

describe('MentorshipMenteeService.uploadMenteeTaskFile', () => {
  const taskId = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const TASK_PATH = `/mentorship/v1/tasks/${taskId}`;
  const UPLOAD_PATH = `${TASK_PATH}/file-upload`;
  const fileName = 'private-report-name.pdf';
  const file = Buffer.from('%PDF-1.7 private-file-bytes');
  const stored = { filename: 'private-report-name.pdf', content_type: 'application/pdf', size: file.byteLength };
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  /** The multipart body sent upstream on the given call, as text, so its part headers can be read. */
  const sentForm = (call: number): { headers: Record<string, string>; body: string } => {
    const form = proxyRequest.mock.calls[call][5] as { getHeaders: () => Record<string, string>; getBuffer: () => Buffer };
    return { headers: form.getHeaders(), body: form.getBuffer().toString('latin1') };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.debug).mockClear();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it('reads the task, then posts the bytes as the multipart part `file` with the transfer timeout, and maps the stored file', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress' })).mockResolvedValueOnce(stored);

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).resolves.toEqual({
      fileName: 'private-report-name.pdf',
      contentType: 'application/pdf',
      size: file.byteLength,
    });

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', TASK_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', UPLOAD_PATH, 'POST', undefined, expect.anything(), undefined, {
      timeoutMs: 120_000,
    });
    const { headers, body } = sentForm(1);
    expect(headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(body).toContain(`Content-Disposition: form-data; name="file"; filename="${fileName}"`);
    expect(body).toContain('Content-Type: application/octet-stream');
    expect(body).toContain('%PDF-1.7 private-file-bytes');
  });

  it('returns empty values when upstream answers with no body', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId })).mockResolvedValueOnce(undefined);

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).resolves.toEqual({ fileName: '', contentType: '', size: 0 });
  });

  it('uploads on the last day of the due date', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T23:59:59Z'));
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress', due_date: '2026-09-30' })).mockResolvedValueOnce(stored);

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).resolves.toMatchObject({ size: file.byteLength });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('refuses the upload once the due date has ended in UTC, without uploading', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress', due_date: '2026-09-30' }));

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).rejects.toMatchObject({
      statusCode: 400,
      code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
      message: MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest.mock.calls.map((call) => call[2])).not.toContain(UPLOAD_PATH);
  });

  it('refuses the upload on a prerequisite with no due date once its term application close has ended', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    routeProxy(proxyRequest, {
      [TASK_PATH]: () => upstreamTask({ id: taskId, application_id: 'app-1', status: 'in_progress' }),
      [ME_APPLICATIONS_PATH]: () =>
        listOf([upstreamApplication({ term: { id: 'term-1', name: 'Fall 2026', status: 'open', application_end_date: '2026-09-30' } })]),
    });

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).rejects.toMatchObject({
      statusCode: 400,
      code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not found'],
  ])('propagates a failed task read (%i) without uploading', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'forbidden'],
    [409, 'task is completed'],
    [413, 'file exceeds 20 MB'],
    [415, 'File must be PDF, DOC, DOCX or plain text'],
    [503, 'storage is not configured'],
  ])('propagates an upstream %i from the upload', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress' })).mockRejectedValueOnce(error);

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('provisions the user and resends the same form with the timeout, with no timeout on the provisioning call', async () => {
    proxyRequest
      .mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress' }))
      .mockRejectedValueOnce(upstreamError(401, { error: 'local user is not provisioned' }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(stored);

    await expect(service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file)).resolves.toMatchObject({ fileName });

    expect(proxyRequest).toHaveBeenCalledTimes(4);
    expect(proxyRequest).toHaveBeenNthCalledWith(3, expect.anything(), 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(proxyRequest.mock.calls[3][5]).toBe(proxyRequest.mock.calls[1][5]);
    expect(proxyRequest.mock.calls[3][7]).toEqual({ timeoutMs: 120_000 });
    expect(sentForm(3).body).toContain(`filename="${fileName}"`);
  });

  it('URL-encodes the task id in both paths', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamTask()).mockResolvedValueOnce(stored);

    await service.uploadMenteeTaskFile(buildReq(), 'a/b?c', fileName, file);

    expect(proxyRequest.mock.calls.map((call) => call[2])).toEqual(['/mentorship/v1/tasks/a%2Fb%3Fc', '/mentorship/v1/tasks/a%2Fb%3Fc/file-upload']);
  });

  it('logs the task id and size, never the file name or the bytes', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId })).mockResolvedValueOnce(stored);

    await service.uploadMenteeTaskFile(buildReq(), taskId, fileName, file);

    const logged = JSON.stringify(vi.mocked(logger.debug).mock.calls.map((call) => call.slice(1)));
    expect(logged).toContain(taskId);
    expect(logged).toContain(`"sizeBytes":${file.byteLength}`);
    expect(logged).not.toContain('private-report-name');
    expect(logged).not.toContain('private-file-bytes');
  });
});

describe('MentorshipMenteeService.deleteMenteeTaskFile', () => {
  const taskId = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const TASK_PATH = `/mentorship/v1/tasks/${taskId}`;
  const FILE_PATH = `${TASK_PATH}/file`;
  let service: InstanceType<typeof MentorshipMenteeService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipMenteeService();
  });

  it('reads the task, then deletes its file', async () => {
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress' })).mockResolvedValueOnce(undefined);

    await expect(service.deleteMenteeTaskFile(buildReq(), taskId)).resolves.toBeUndefined();

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest).toHaveBeenNthCalledWith(1, expect.anything(), 'LFX_V2_SERVICE', TASK_PATH, 'GET', undefined, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, expect.anything(), 'LFX_V2_SERVICE', FILE_PATH, 'DELETE', undefined, undefined);
  });

  it('refuses the delete once the due date has ended in UTC, without deleting', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'in_progress', due_date: '2026-09-30' }));

    await expect(service.deleteMenteeTaskFile(buildReq(), taskId)).rejects.toMatchObject({
      statusCode: 400,
      code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
      message: MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest.mock.calls.map((call) => call[3])).not.toContain('DELETE');
  });

  it('propagates a failed task read without deleting', async () => {
    const error = upstreamError(404, { error: 'not found' });
    proxyRequest.mockRejectedValueOnce(error);

    await expect(service.deleteMenteeTaskFile(buildReq(), taskId)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not found'],
    [409, 'task is submitted'],
  ])('propagates an upstream %i from the delete', async (status, message) => {
    const error = upstreamError(status, { error: message });
    proxyRequest.mockResolvedValueOnce(upstreamTask({ id: taskId, status: 'submitted' })).mockRejectedValueOnce(error);

    await expect(service.deleteMenteeTaskFile(buildReq(), taskId)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });
});
