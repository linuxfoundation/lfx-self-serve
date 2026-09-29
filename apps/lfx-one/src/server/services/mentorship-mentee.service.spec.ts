// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { MentorshipUpstreamApplication, MentorshipUpstreamTask } from '@lfx-one/shared/interfaces';
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
const { logger } = await import('./logger.service');
const { MicroserviceError, ResourceNotFoundError } = await import('../errors');

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

  it("maps the caller's mentee row and fills the history from their applications", async () => {
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () =>
        listOf([
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
        ]),
      [ME_APPLICATIONS_PATH]: () => listOf([upstreamApplication()]),
    });

    const result = await service.getMenteeProfile(buildReq());

    expect(result.profile).toMatchObject({ aboutMe: 'Test mentee introduction.', skillsHave: ['Go'], skillsWant: ['Code Review'] });
    expect(result.history).toEqual([{ id: 'app-1', programName: 'Test Program', termName: 'Fall 2026', submittedOn: 'Jun 28, 2026', status: 'pending' }]);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', PROFILES_PATH, 'GET', { profile_type: 'mentee', limit: 1 }, undefined);
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      ME_APPLICATIONS_PATH,
      'GET',
      { role: 'mentee', limit: 100, offset: 0 },
      undefined
    );
  });

  it("returns an empty profile when the caller's mentee list is empty, so the apply page loads straight after registering", async () => {
    routeProxy(proxyRequest, { [PROFILES_PATH]: () => listOf([]), [ME_APPLICATIONS_PATH]: () => listOf([]) });

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
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => {
        throw error;
      },
      [ME_APPLICATIONS_PATH]: () => listOf([]),
    });

    await expect(service.getMenteeProfile(buildReq())).rejects.toBe(error);
  });

  it('leaves the history empty when the applications read fails on the profile read', async () => {
    routeProxy(proxyRequest, {
      [PROFILES_PATH]: () => listOf([]),
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

  it('stops paging on an empty page even when the total says there are more', async () => {
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: (query) =>
        query?.['offset'] === 0
          ? { data: [upstreamApplication()], meta: { total: 5, limit: 100, offset: 0 } }
          : { data: [], meta: { total: 5, limit: 100, offset: 1 } },
    });

    await expect(service.getMenteeApplications(buildReq(), false)).resolves.toMatchObject({ total: 1 });
  });

  it('stops after one page when the page carries no total', async () => {
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: () => ({ data: [upstreamApplication()] }),
    });

    await expect(service.getMenteeApplications(buildReq(), false)).resolves.toMatchObject({ total: 1 });
    expect(proxyRequest.mock.calls.filter(([, , path]) => path === ME_APPLICATIONS_PATH)).toHaveLength(1);
  });

  it('stops at the page cap when upstream keeps returning rows', async () => {
    routeProxy(proxyRequest, {
      [ME_APPLICATIONS_PATH]: () => ({ data: [upstreamApplication()], meta: { total: Number.MAX_SAFE_INTEGER, limit: 100, offset: 0 } }),
    });

    await expect(service.getMenteeApplications(buildReq(), false)).resolves.toMatchObject({ total: 50 });
    expect(proxyRequest.mock.calls.filter(([, , path]) => path === ME_APPLICATIONS_PATH)).toHaveLength(50);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_list_all_pages', expect.any(String), {
      path: ME_APPLICATIONS_PATH,
      max_pages: 50,
      count: 50,
    });
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
