// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MENTORSHIP_ENROLL_NAME_TAKEN, MENTORSHIP_MAX_OPEN_TERMS_MESSAGE } from '@lfx-one/shared/constants';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../utils/auth-helper', () => ({
  isImpersonating: vi.fn(() => false),
}));

const { MentorshipAdminService } = await import('./mentorship-admin.service');
const { MicroserviceProxyService } = await import('./microservice-proxy.service');
const { MentorshipService } = await import('./mentorship.service');
const { MicroserviceError } = await import('../errors');
const { logger } = await import('./logger.service');

const buildReq = (): Request => ({ path: '/api/mentorship/admin/programs' }) as Request;

const upstreamProgram = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  name,
  status: 'published',
  admin_status: 'open',
  project_name: 'Energy Project',
  term: { id: 't', name: 'Spring', status: 'open' },
  stats: { mentors: 1, mentees: 2, graduated: 0 },
  created_on: '2026-01-01',
  updated_on: '2026-01-02',
  ...overrides,
});

const stubUpstream = (response: { rows?: unknown[]; total?: number } | Error) =>
  vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation(async (_req, _service, path: string) => {
    if (path === '/mentorship/v1/me') return {} as never;
    if (path === '/mentorship/v1/me/programs') {
      if (response instanceof Error) throw response;
      const rows = response.rows ?? [];
      return { data: rows, meta: { total: response.total ?? rows.length, limit: 12, offset: 0 } } as never;
    }
    throw new Error(`unexpected path ${path}`);
  });

describe('MentorshipAdminService.getPrograms', () => {
  let service: InstanceType<typeof MentorshipAdminService>;
  const paging = { offset: 0, limit: 12 };

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the programs upstream returns, mapped for the card, with upstream’s total', async () => {
    stubUpstream({
      rows: [upstreamProgram('p-a', 'Alpha'), upstreamProgram('p-b', 'Beta', { admin_status: 'completed', term: undefined })],
      total: 30,
    });

    const result = await service.getPrograms(buildReq(), paging);

    expect(result.total).toBe(30);
    expect(result.data.map((p) => [p.id, p.status, p.term])).toEqual([
      ['p-a', 'open', 'Spring'],
      ['p-b', 'completed', ''],
    ]);
  });

  it('makes one upstream call that carries the search, status, limit and offset', async () => {
    const spy = stubUpstream({ rows: [] });

    await service.getPrograms(buildReq(), { search: '  50%_off  ', status: 'pending-review', offset: 24, limit: 12 });

    const calls = spy.mock.calls.filter(([, , path]) => path !== '/mentorship/v1/me');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/programs',
      'GET',
      { search: String.raw`50\%\_off`, status: 'pending_review', limit: 12, offset: 24 },
      undefined,
    ]);
  });

  it('sends no search or status when none is given', async () => {
    const spy = stubUpstream({ rows: [] });

    await service.getPrograms(buildReq(), paging);

    expect(spy.mock.calls[0][4]).toEqual({ search: undefined, status: undefined, limit: 12, offset: 0 });
  });

  it('shows an unrecognised admin status as pending review and logs the id and status only', async () => {
    stubUpstream({ rows: [upstreamProgram('p-a', 'Alpha', { admin_status: 'mystery' })] });

    const { data } = await service.getPrograms(buildReq(), paging);

    expect(data[0].status).toBe('pending-review');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_programs', expect.any(String), {
      programId: 'p-a',
      adminStatus: 'mystery',
    });
  });

  it('provisions a first-time caller and retries, then returns an empty page, with a warning, if still not provisioned', async () => {
    const spy = stubUpstream(new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }));

    expect(await service.getPrograms(buildReq(), paging)).toEqual({ data: [], total: 0 });
    expect(spy.mock.calls.map(([, , path, method]) => `${method} ${path}`)).toEqual([
      'GET /mentorship/v1/me/programs',
      'PUT /mentorship/v1/me',
      'GET /mentorship/v1/me/programs',
    ]);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_programs', expect.any(String), {});
  });

  it('passes any other upstream error on', async () => {
    stubUpstream(new Error('upstream down'));

    await expect(service.getPrograms(buildReq(), paging)).rejects.toThrow('upstream down');
  });
});

const PROGRAM_ID = '3f2b8c1e-7a44-4d0e-9b55-0c1d2e3f4a5b';
const APPLICATION_ID = '9a1c2d3e-4b5f-4a6b-8c7d-1e2f3a4b5c6d';
const PROGRAM_PATH = `/mentorship/v1/programs/${PROGRAM_ID}`;

const header = {
  program: { id: PROGRAM_ID, slug: 'grid', name: 'Grid', status: 'published', created_on: '2026-01-01', updated_on: '2026-01-02' },
  active_term: { id: 't1', name: 'Fall', status: 'open' },
  stats: { mentors: 1, mentees: 2, graduated: 0 },
};
const summary = { has_open_term: true, has_closed_term: false, mentees: 2, past_mentees: 4, applicants: 5, mentors: 1, terms: 3 };
const applicationRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  user_id: `u-${id}`,
  application_id: id,
  status: 'hold',
  name: 'Ada Mentee',
  email: 'ada@mentee.example',
  tasks_submitted: 1,
  tasks_total: 2,
  term: { id: 't1', name: 'Fall', status: 'open' },
  created_on: '2026-08-01T00:00:00Z',
  updated_on: '2026-08-02T00:00:00Z',
  ...overrides,
});

/** Answers each read from `routes`; a route set to an Error rejects, and one left out is a test bug. */
const stubProgramReads = (routes: Record<string, unknown>) =>
  vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation(async (_req, _service, path: string) => {
    const route = routes[path];
    if (route === undefined) throw new Error(`unexpected path ${path}`);
    if (route instanceof Error) throw route;
    return route as never;
  });

const pageRoutes = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  [`${PROGRAM_PATH}/header`]: header,
  [`${PROGRAM_PATH}/management-summary`]: summary,
  [`${PROGRAM_PATH}/applications`]: { data: [], meta: { total: 7, limit: 1, offset: 0 } },
  [`${PROGRAM_PATH}/member-management`]: { data: [], meta: { total: 2, limit: 1, offset: 0 } },
  [`${PROGRAM_PATH}/terms`]: {
    data: [
      { id: 't1', name: 'Fall', status: 'open' },
      { id: 't0', name: 'Spring', status: 'closed' },
      { id: 'tx', name: 'Gone', status: 'deleted' },
    ],
    meta: { total: 3, limit: 100, offset: 0 },
  },
  ...overrides,
});

describe('MentorshipAdminService.getProgramPage', () => {
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the header, the four counts and the open and closed terms', async () => {
    stubProgramReads(pageRoutes());

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.program).toMatchObject({ id: PROGRAM_ID, name: 'Grid', term: 'Fall', status: 'open' });
    expect(page.tabCounts).toEqual({ currentMentees: 7, pastMentees: 4, mentors: 2, terms: 3 });
    expect(page.terms).toEqual([
      { id: 't1', name: 'Fall', status: 'open' },
      { id: 't0', name: 'Spring', status: 'closed' },
    ]);
  });

  it('sends the one-row count reads and the largest terms page', async () => {
    const spy = stubProgramReads(pageRoutes());

    await service.getProgramPage(buildReq(), PROGRAM_ID);

    const queries = Object.fromEntries(spy.mock.calls.map(([, , path, , query]) => [path, query]));
    expect(queries[`${PROGRAM_PATH}/applications`]).toEqual({ type: 'current', limit: 1 });
    expect(queries[`${PROGRAM_PATH}/member-management`]).toEqual({ limit: 1 });
    expect(queries[`${PROGRAM_PATH}/terms`]).toEqual({ limit: 100, offset: 0 });
  });

  it('reads every page of the terms at 100 a page', async () => {
    const term = (n: number) => ({ id: `t${n}`, name: `Term ${n}`, status: 'closed' });
    const routes = pageRoutes();
    const spy = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation(async (_req, _service, path: string, _method, query) => {
      if (path === `${PROGRAM_PATH}/terms`) {
        const offset = (query as { offset: number }).offset;
        const count = offset === 0 ? 100 : 5;
        return { data: Array.from({ length: count }, (_, i) => term(offset + i)), meta: { total: 105, limit: 100, offset } } as never;
      }
      return routes[path] as never;
    });

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.terms).toHaveLength(105);
    const termQueries = spy.mock.calls.filter(([, , path]) => path === `${PROGRAM_PATH}/terms`).map(([, , , , query]) => query);
    expect(termQueries).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
    ]);
  });

  it('reads a published program with only closed terms as completed', async () => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/management-summary`]: { ...summary, has_open_term: false, has_closed_term: true } }));

    expect((await service.getProgramPage(buildReq(), PROGRAM_ID)).program.status).toBe('completed');
  });

  it('shows a count as null when its read fails, and the terms as empty', async () => {
    stubProgramReads(
      pageRoutes({
        [`${PROGRAM_PATH}/management-summary`]: new Error('down'),
        [`${PROGRAM_PATH}/applications`]: new Error('down'),
        [`${PROGRAM_PATH}/member-management`]: new Error('down'),
        [`${PROGRAM_PATH}/terms`]: new Error('down'),
      })
    );

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.tabCounts).toEqual({ currentMentees: null, pastMentees: null, mentors: null, terms: null });
    expect(page.terms).toEqual([]);
    expect(page.program.status).toBe('open');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program', expect.any(String), { programId: PROGRAM_ID, failed: 4 });
  });

  it.each([404, 403])('passes a header %i on', async (statusCode) => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/header`]: new MicroserviceError('nope', statusCode, 'UPSTREAM') }));

    await expect(service.getProgramPage(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode });
  });

  it.each(['management-summary', 'applications', 'member-management'])(
    'passes a 403 on the manager-only %s read on, since any viewer may read the header',
    async (route) => {
      stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/${route}`]: new MicroserviceError('Forbidden', 403, 'FORBIDDEN') }));

      await expect(service.getProgramPage(buildReq(), PROGRAM_ID)).rejects.toMatchObject({ statusCode: 403 });
    }
  );

  it('keeps the page when a manager-only read fails with anything but a 403', async () => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/management-summary`]: new MicroserviceError('Bad gateway', 502, 'UPSTREAM') }));

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.tabCounts).toMatchObject({ pastMentees: null, terms: null, currentMentees: 7 });
  });

  it('shows an unrecognised program status as pending review and logs the id and status only', async () => {
    stubProgramReads(pageRoutes({ [`${PROGRAM_PATH}/header`]: { ...header, program: { ...header.program, status: 'mystery' } } }));

    const page = await service.getProgramPage(buildReq(), PROGRAM_ID);

    expect(page.program.status).toBe('pending-review');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program', expect.any(String), {
      programId: PROGRAM_ID,
      status: 'mystery',
    });
  });
});

describe('MentorshipAdminService.getProgramMentees', () => {
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes exactly one applications read with the query as described, and maps the rows', async () => {
    const spy = stubProgramReads({
      [`${PROGRAM_PATH}/applications`]: { data: [applicationRow('a1')], meta: { total: 37, limit: 10, offset: 10 } },
    });

    const result = await service.getProgramMentees(buildReq(), PROGRAM_ID, {
      type: 'current',
      status: 'pending',
      termId: 't1',
      search: '  50%_off ',
      offset: 10,
      limit: 10,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(1)).toEqual([
      'LFX_V2_SERVICE',
      `${PROGRAM_PATH}/applications`,
      'GET',
      { type: 'current', status: 'pending', term: 't1', search: String.raw`50\%\_off`, offset: 10, limit: 10 },
      undefined,
    ]);
    expect(result.total).toBe(37);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'a1', status: 'pending', termId: 't1', termName: 'Fall' });
    expect(result.data[0].tasks).toBeUndefined();
  });

  it('sends Applied as applied and Tasks Completed as tasks_submitted', async () => {
    const spy = stubProgramReads({ [`${PROGRAM_PATH}/applications`]: { data: [], meta: { total: 0, limit: 10, offset: 0 } } });

    await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'current', status: 'applied' });
    await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'current', status: 'tasks-completed' });

    expect(spy.mock.calls[0][4]).toMatchObject({ status: 'applied' });
    expect(spy.mock.calls[1][4]).toMatchObject({ status: 'tasks_submitted' });
  });

  it('defaults to offset 0 and 10 rows, and never sends more than 50', async () => {
    const spy = stubProgramReads({ [`${PROGRAM_PATH}/applications`]: { data: [], meta: { total: 0, limit: 10, offset: 0 } } });

    await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'past' });
    await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'past', limit: 500 });

    expect(spy.mock.calls[0][4]).toMatchObject({ type: 'past', offset: 0, limit: 10, search: undefined, status: undefined, term: undefined });
    expect(spy.mock.calls[1][4]).toMatchObject({ limit: 50 });
  });

  it('returns an empty page when the caller has no mentorship record', async () => {
    stubProgramReads({
      '/mentorship/v1/me': {},
      [`${PROGRAM_PATH}/applications`]: new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }),
    });

    expect(await service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'current' })).toEqual({ data: [], total: 0 });
  });

  it('passes any other upstream error on', async () => {
    stubProgramReads({ [`${PROGRAM_PATH}/applications`]: new MicroserviceError('boom', 500, 'UPSTREAM') });

    await expect(service.getProgramMentees(buildReq(), PROGRAM_ID, { type: 'current' })).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('MentorshipAdminService.getApplicationTasks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads every page of the tasks at 100 a page and maps them', async () => {
    const path = `/mentorship/v1/applications/${APPLICATION_ID}/tasks`;
    const task = (id: string, status: string) => ({
      id,
      application_id: APPLICATION_ID,
      assignee_id: 'mentee',
      status,
      name: id,
      custom: false,
      created_on: '2026-08-01T00:00:00Z',
      updated_on: '2026-08-01T00:00:00Z',
    });
    const spy = vi
      .spyOn(MicroserviceProxyService.prototype, 'proxyRequest')
      .mockResolvedValueOnce({ data: [task('t1', 'incomplete')], meta: { total: 2, limit: 100, offset: 0 } } as never)
      .mockResolvedValueOnce({ data: [task('t2', 'complete')], meta: { total: 2, limit: 100, offset: 1 } } as never);

    const tasks = await new MentorshipAdminService().getApplicationTasks(buildReq(), APPLICATION_ID);

    expect(tasks.map((t) => [t.id, t.status])).toEqual([
      ['t1', 'pending'],
      ['t2', 'completed'],
    ]);
    expect(spy.mock.calls.map(([, , calledPath, , query]) => [calledPath, query])).toEqual([
      [path, { limit: 100, offset: 0 }],
      [path, { limit: 100, offset: 1 }],
    ]);
  });
});

const memberRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: `u-${id}`,
  name: 'Ada Mentor',
  email: 'ada@mentor.example',
  status: 'active',
  created_on: '2026-02-03T10:00:00Z',
  updated_on: '2026-02-04T10:00:00Z',
  profile_created: true,
  ...overrides,
});

const termManagementRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  program_id: PROGRAM_ID,
  name: 'Fall',
  status: 'open',
  active_users: 1,
  created_on: '2026-01-01T00:00:00Z',
  updated_on: '2026-01-02T00:00:00Z',
  pending: 1,
  declined: 0,
  accepted: 2,
  graduated: 0,
  ...overrides,
});

describe('MentorshipAdminService.getProgramMentors', () => {
  let service: InstanceType<typeof MentorshipAdminService>;
  const MEMBERS_PATH = `${PROGRAM_PATH}/member-management`;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the mentor rows and returns upstream’s total', async () => {
    stubProgramReads({
      [MEMBERS_PATH]: { data: [memberRow('m1'), memberRow('m2', { status: 'invited' })], meta: { total: 12, limit: 10, offset: 0 } },
    });

    const result = await service.getProgramMentors(buildReq(), PROGRAM_ID, { offset: 0, limit: 10 });

    expect(result.total).toBe(12);
    expect(result.data.map((m) => [m.id, m.status])).toEqual([
      ['m1', 'active'],
      ['m2', 'invited'],
    ]);
  });

  it('makes one upstream call with the status, escaped search, offset and a capped limit, and no member_type', async () => {
    const spy = stubProgramReads({ [MEMBERS_PATH]: { data: [], meta: { total: 0 } } });

    await service.getProgramMentors(buildReq(), PROGRAM_ID, { status: 'active', search: '  50%_off ', offset: 20, limit: 500 });

    expect(spy.mock.calls).toHaveLength(1);
    expect(spy.mock.calls[0][4]).toEqual({ status: 'active', search: String.raw`50\%\_off`, offset: 20, limit: 50 });
  });

  it('defaults to offset 0 and limit 10', async () => {
    const spy = stubProgramReads({ [MEMBERS_PATH]: { data: [] } });

    await service.getProgramMentors(buildReq(), PROGRAM_ID, {});

    expect(spy.mock.calls[0][4]).toMatchObject({ offset: 0, limit: 10 });
  });

  it('shows an unknown status as pending and logs the ids and status, never the name', async () => {
    stubProgramReads({ [MEMBERS_PATH]: { data: [memberRow('m1', { status: 'mystery' })] } });

    const { data } = await service.getProgramMentors(buildReq(), PROGRAM_ID, {});

    expect(data[0].status).toBe('pending');
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program_mentors', expect.any(String), {
      programId: PROGRAM_ID,
      memberId: 'm1',
      status: 'mystery',
    });
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain('Ada Mentor');
  });

  it('returns an empty page, with a warning, for a caller with no mentorship record', async () => {
    stubProgramReads({
      [MEMBERS_PATH]: new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }),
      '/mentorship/v1/me': {},
    });

    expect(await service.getProgramMentors(buildReq(), PROGRAM_ID, {})).toEqual({ data: [], total: 0 });
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_get_program_mentors', expect.any(String), { programId: PROGRAM_ID });
  });

  it('passes any other upstream error on', async () => {
    stubProgramReads({ [MEMBERS_PATH]: new MicroserviceError('Forbidden', 403, 'FORBIDDEN') });

    await expect(service.getProgramMentors(buildReq(), PROGRAM_ID, {})).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('MentorshipAdminService.getMentorCandidates', () => {
  let service: InstanceType<typeof MentorshipAdminService>;
  const CANDIDATES_PATH = `${PROGRAM_PATH}/mentor-candidates`;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the search unescaped, and maps the candidates with the LFID standing in for a missing name', async () => {
    const spy = stubProgramReads({
      [CANDIDATES_PATH]: {
        data: [{ lfid: 'ada_l', name: 'Ada Lovelace', avatar_url: 'https://cdn.example.com/ada.png' }, { lfid: 'bob' }, { lfid: '', name: 'No Account' }],
      },
    });

    const result = await service.getMentorCandidates(buildReq(), PROGRAM_ID, 'ada_l');

    expect(spy.mock.calls[0][4]).toEqual({ search: 'ada_l' });
    expect(result).toEqual({
      data: [
        { lfid: 'ada_l', name: 'Ada Lovelace', avatarUrl: 'https://cdn.example.com/ada.png' },
        { lfid: 'bob', name: 'bob', avatarUrl: undefined },
      ],
    });
  });

  it('finds no one for a caller with no mentorship record', async () => {
    stubProgramReads({
      [CANDIDATES_PATH]: new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }),
      '/mentorship/v1/me': {},
    });

    expect(await service.getMentorCandidates(buildReq(), PROGRAM_ID, 'ada')).toEqual({ data: [] });
  });

  it('passes any other upstream error on with the search cut from its path', async () => {
    stubProgramReads({
      [CANDIDATES_PATH]: new MicroserviceError('Service Unavailable', 503, 'SERVICE_UNAVAILABLE', {
        path: `https://api.example.org${CANDIDATES_PATH}?search=ada%40example.org`,
      }),
    });

    const error = await service.getMentorCandidates(buildReq(), PROGRAM_ID, 'ada@example.org').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ statusCode: 503, path: `https://api.example.org${CANDIDATES_PATH}` });
    expect(JSON.stringify(error)).not.toContain('example.org?');
  });
});

describe('MentorshipAdminService.inviteProgramMentor', () => {
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the LFID as a mentor member and returns the new member id', async () => {
    const spy = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue({ id: 'mem_1', status: 'invited' } as never);

    const memberId = await service.inviteProgramMentor(buildReq(), PROGRAM_ID, { lfid: 'ada' });

    expect(memberId).toBe('mem_1');
    expect(spy.mock.calls[0][2]).toBe(`${PROGRAM_PATH}/members`);
    expect(spy.mock.calls[0][3]).toBe('POST');
    expect(spy.mock.calls[0][5]).toEqual({ lfid: 'ada', member_type: 'mentor' });
  });

  it.each([409, 422, 503])('passes an upstream %s on', async (status) => {
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockRejectedValue(new MicroserviceError('Upstream', status, 'UPSTREAM'));

    await expect(service.inviteProgramMentor(buildReq(), PROGRAM_ID, { lfid: 'ada' })).rejects.toMatchObject({ statusCode: status });
  });
});

describe('MentorshipAdminService.getProgramTerms', () => {
  let service: InstanceType<typeof MentorshipAdminService>;
  const TERMS_PATH = `${PROGRAM_PATH}/term-management`;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the term rows with their counts, drops a term that is not open or closed, and returns upstream’s total', async () => {
    stubProgramReads({
      [TERMS_PATH]: {
        data: [termManagementRow('t1'), termManagementRow('t2', { status: 'closed' }), termManagementRow('t3', { status: 'deleted' })],
        meta: { total: 3, limit: 10, offset: 0 },
      },
    });

    const result = await service.getProgramTerms(buildReq(), PROGRAM_ID, { offset: 0, limit: 10 });

    expect(result.total).toBe(3);
    expect(result.data.map((t) => [t.id, t.status, t.pending, t.accepted])).toEqual([
      ['t1', 'open', 1, 2],
      ['t2', 'closed', 1, 2],
    ]);
  });

  it('makes one upstream call with the offset and a capped limit', async () => {
    const spy = stubProgramReads({ [TERMS_PATH]: { data: [] } });

    await service.getProgramTerms(buildReq(), PROGRAM_ID, { offset: 10, limit: 500 });

    expect(spy.mock.calls).toHaveLength(1);
    expect(spy.mock.calls[0][4]).toEqual({ offset: 10, limit: 50 });
  });

  it('returns an empty page for a caller with no mentorship record', async () => {
    stubProgramReads({
      [TERMS_PATH]: new MicroserviceError('Unauthorized', 401, 'UNAUTHORIZED', { errorBody: { error: 'local user is not provisioned' } }),
      '/mentorship/v1/me': {},
    });

    expect(await service.getProgramTerms(buildReq(), PROGRAM_ID, {})).toEqual({ data: [], total: 0 });
  });

  it('passes any other upstream error on', async () => {
    stubProgramReads({ [TERMS_PATH]: new Error('upstream down') });

    await expect(service.getProgramTerms(buildReq(), PROGRAM_ID, {})).rejects.toThrow('upstream down');
  });
});

describe('MentorshipAdminService application decisions', () => {
  const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const TERM_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const APPLICATION_PATH = `/mentorship/v1/applications/${APPLICATION_ID}`;
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('patches the status, sending the attendance type only with an accept', async () => {
    const spy = stubProgramReads({ [`${APPLICATION_PATH}/status`]: {} });

    await service.updateApplicationStatus(buildReq(), APPLICATION_ID, { status: 'accepted', attendanceType: 'part_time' });
    await service.updateApplicationStatus(buildReq(), APPLICATION_ID, { status: 'declined', attendanceType: 'full_time' });

    expect(spy.mock.calls.map((call) => [call[3], call[5]])).toEqual([
      ['PATCH', { status: 'accepted', attendance_type: 'part_time' }],
      ['PATCH', { status: 'declined' }],
    ]);
  });

  it('passes an upstream 422 on', async () => {
    stubProgramReads({ [`${APPLICATION_PATH}/status`]: new MicroserviceError('closed', 422, 'UNPROCESSABLE') });

    await expect(service.updateApplicationStatus(buildReq(), APPLICATION_ID, { status: 'graduated' })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('puts the note upstream as the reviewer note of the application', async () => {
    const spy = stubProgramReads({ [`${APPLICATION_PATH}/note`]: {} });

    await service.updateApplicationNote(buildReq(), APPLICATION_ID, 'needs a second look');
    await service.updateApplicationNote(buildReq(), APPLICATION_ID, '');

    expect(spy.mock.calls.map((call) => [call[2], call[3], call[5]])).toEqual([
      [`${APPLICATION_PATH}/note`, 'PUT', { reviewer_note: 'needs a second look' }],
      [`${APPLICATION_PATH}/note`, 'PUT', { reviewer_note: '' }],
    ]);
  });

  it.each([403, 404, 409])('passes an upstream %s on from the note write', async (status) => {
    stubProgramReads({ [`${APPLICATION_PATH}/note`]: new MicroserviceError('upstream', status, 'UPSTREAM') });

    await expect(service.updateApplicationNote(buildReq(), APPLICATION_ID, 'x')).rejects.toMatchObject({ statusCode: status });
  });

  it.each(['pending', 'hold', 'accepted'])('withdraws a %s application on the mentee behalf', async (status) => {
    const spy = stubProgramReads({ [APPLICATION_PATH]: { id: APPLICATION_ID, status }, [`${APPLICATION_PATH}/withdraw-for-mentee`]: {} });

    await service.withdrawApplication(buildReq(), APPLICATION_ID);

    expect(spy.mock.calls.map((call) => [call[3], call[2]])).toEqual([
      ['GET', APPLICATION_PATH],
      ['POST', `${APPLICATION_PATH}/withdraw-for-mentee`],
    ]);
  });

  it.each(['declined', 'withdrawn', 'graduated'])('answers 409 without writing when the application is %s', async (status) => {
    const spy = stubProgramReads({ [APPLICATION_PATH]: { id: APPLICATION_ID, status } });

    await expect(service.withdrawApplication(buildReq(), APPLICATION_ID)).rejects.toMatchObject({
      statusCode: 409,
      message: 'This application changed. The list has been refreshed.',
    });
    expect(spy.mock.calls.every((call) => call[3] === 'GET')).toBe(true);
  });

  it('declines the term pending applications and maps the count', async () => {
    const spy = stubProgramReads({
      [`/mentorship/v1/programs/${PROGRAM_ID}/terms/${TERM_ID}/applications/bulk-decline`]: { declined_count: 4 },
    });

    expect(await service.declinePendingForTerm(buildReq(), PROGRAM_ID, TERM_ID)).toEqual({ declinedCount: 4 });
    expect(spy.mock.calls[0][3]).toBe('POST');
  });
});

describe('MentorshipAdminService.updateProgramMentor', () => {
  const MEMBER_ID = '4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7a8b';
  const MEMBER_PATH = `${PROGRAM_PATH}/members/${MEMBER_ID}`;
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('patches the member of the program with the status only', async () => {
    const spy = stubProgramReads({ [MEMBER_PATH]: {} });

    await service.updateProgramMentor(buildReq(), PROGRAM_ID, MEMBER_ID, { status: 'withdrawn' });

    expect(spy.mock.calls.map((call) => [call[2], call[3], call[5]])).toEqual([[MEMBER_PATH, 'PATCH', { status: 'withdrawn' }]]);
  });

  it.each([403, 404, 409])('passes an upstream %s on', async (status) => {
    stubProgramReads({ [MEMBER_PATH]: new MicroserviceError('upstream', status, 'UPSTREAM') });

    await expect(service.updateProgramMentor(buildReq(), PROGRAM_ID, MEMBER_ID, { status: 'active' })).rejects.toMatchObject({ statusCode: status });
  });
});

describe('MentorshipAdminService term writes', () => {
  const TERM_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const TERMS_PATH = `${PROGRAM_PATH}/terms`;
  const TERM_PATH = `${TERMS_PATH}/${TERM_ID}`;
  const input = {
    name: 'Fall 2026',
    startDate: '2026-09-01',
    endDate: '2026-12-01',
    applicationStartDate: '2026-07-01',
    applicationEndDate: '2026-08-15',
  };
  const upstreamTerm = {
    id: TERM_ID,
    program_id: PROGRAM_ID,
    name: 'Fall 2026',
    status: 'open',
    active_users: 0,
    created_on: '2026-06-01',
    updated_on: '2026-06-01',
  };
  let service: InstanceType<typeof MentorshipAdminService>;

  /** Answers the open-term count read with `openCount` and every write with `writeResult`. */
  const stubTerms = (openCount: number, writeResult: unknown = {}) =>
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockImplementation(async (_req, _service, path: string, method?: string) => {
      if (path === TERMS_PATH && method === 'GET') return { data: [], meta: { total: openCount, limit: 4, offset: 0 } } as never;
      if (writeResult instanceof Error) throw writeResult;
      return writeResult as never;
    });
  const writes = (spy: ReturnType<typeof stubTerms>) => spy.mock.calls.filter((call) => call[3] !== 'GET');

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an open term, sending UTC timestamps with the application end at the end of its day and the term end at the end of its month, and returns its row with zero counts', async () => {
    const spy = stubTerms(3, upstreamTerm);

    const row = await service.createTerm(buildReq(), PROGRAM_ID, input);

    expect(writes(spy).map((call) => [call[2], call[3], call[5]])).toEqual([
      [
        TERMS_PATH,
        'POST',
        {
          name: 'Fall 2026',
          status: 'open',
          start_date_time: '2026-09-01T00:00:00Z',
          end_date_time: '2026-12-31T23:59:59.999Z',
          application_start_date: '2026-07-01T00:00:00Z',
          application_end_date: '2026-08-15T23:59:59.999Z',
        },
      ],
    ]);
    expect(row).toMatchObject({ id: TERM_ID, name: 'Fall 2026', status: 'open', pending: 0, accepted: 0 });
  });

  it('refuses a create at four open terms with a 409 and no write call', async () => {
    const spy = stubTerms(4, upstreamTerm);

    await expect(service.createTerm(buildReq(), PROGRAM_ID, input)).rejects.toMatchObject({ statusCode: 409, message: MENTORSHIP_MAX_OPEN_TERMS_MESSAGE });
    expect(writes(spy)).toEqual([]);
  });

  it('patches an edited term and returns its row', async () => {
    const spy = stubTerms(0, { ...upstreamTerm, name: 'Fall 2026 (edited)' });

    const row = await service.updateTerm(buildReq(), PROGRAM_ID, TERM_ID, { ...input, name: 'Fall 2026 (edited)' });

    expect(writes(spy).map((call) => [call[2], call[3], call[5]])).toEqual([
      [
        TERM_PATH,
        'PATCH',
        {
          name: 'Fall 2026 (edited)',
          start_date_time: '2026-09-01T00:00:00Z',
          end_date_time: '2026-12-31T23:59:59.999Z',
          application_start_date: '2026-07-01T00:00:00Z',
          application_end_date: '2026-08-15T23:59:59.999Z',
        },
      ],
    ]);
    expect(row.name).toBe('Fall 2026 (edited)');
  });

  it.each([
    ['closed', 'closed'],
    [undefined, 'open'],
  ])('reads an edited term answered with status %s as %s', async (upstreamStatus, rowStatus) => {
    stubTerms(0, { ...upstreamTerm, status: upstreamStatus });

    const row = await service.updateTerm(buildReq(), PROGRAM_ID, TERM_ID, input);

    expect(row).toMatchObject({ id: TERM_ID, status: rowStatus });
  });

  it('builds the row from the input, with the given status, when upstream answers with a status the table cannot show', async () => {
    stubTerms(0, { id: TERM_ID, status: 'archived' });

    const row = await service.createTerm(buildReq(), PROGRAM_ID, input);

    expect(row).toEqual({
      id: TERM_ID,
      name: 'Fall 2026',
      status: 'open',
      pending: 0,
      declined: 0,
      accepted: 0,
      graduated: 0,
      startDate: input.startDate,
      endDate: input.endDate,
      applicationStartDate: input.applicationStartDate,
      applicationEndDate: input.applicationEndDate,
    });
  });

  it('closes a term without counting open terms', async () => {
    const spy = stubTerms(4);

    await service.closeTerm(buildReq(), PROGRAM_ID, TERM_ID);

    expect(spy.mock.calls.map((call) => [call[2], call[3]])).toEqual([[`${TERM_PATH}/close`, 'POST']]);
  });

  it('re-opens a term when the program has room', async () => {
    const spy = stubTerms(3);

    await service.reopenTerm(buildReq(), PROGRAM_ID, TERM_ID);

    expect(writes(spy).map((call) => [call[2], call[3]])).toEqual([[`${TERM_PATH}/reopen`, 'POST']]);
  });

  it('refuses a re-open at four open terms with a 409 and no write call', async () => {
    const spy = stubTerms(5);

    await expect(service.reopenTerm(buildReq(), PROGRAM_ID, TERM_ID)).rejects.toMatchObject({ statusCode: 409, message: MENTORSHIP_MAX_OPEN_TERMS_MESSAGE });
    expect(writes(spy)).toEqual([]);
  });

  it('deletes a term', async () => {
    const spy = stubTerms(0);

    await service.deleteTerm(buildReq(), PROGRAM_ID, TERM_ID);

    expect(spy.mock.calls.map((call) => [call[2], call[3]])).toEqual([[TERM_PATH, 'DELETE']]);
  });

  it.each(['closeTerm', 'deleteTerm', 'reopenTerm'] as const)('passes an upstream 409 of %s on', async (method) => {
    stubTerms(0, new MicroserviceError('upstream', 409, 'UPSTREAM'));

    await expect(service[method](buildReq(), PROGRAM_ID, TERM_ID)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('never logs the term name', async () => {
    stubTerms(0, upstreamTerm);

    await service.createTerm(buildReq(), PROGRAM_ID, { ...input, name: 'private-term-name' });

    const logged = JSON.stringify([...vi.mocked(logger.debug).mock.calls, ...vi.mocked(logger.warning).mock.calls].map((call) => call.slice(1)));
    expect(logged).not.toContain('private-term-name');
  });
});

describe('MentorshipAdminService.getEnrollTemplate', () => {
  const TEMPLATE_PATH = `/mentorship/v1/programs/${PROGRAM_ID}/enroll-template`;
  const upstreamTemplate = {
    program: {
      id: PROGRAM_ID,
      name: 'private-program-name',
      description: 'private-program-description',
      industry: 'Go, Rust',
      repo_link: 'https://private.example/repo',
    },
    skills: ['private-skill'],
    prerequisites: [{ name: 'Resume', description: 'private-prereq-description', submitFile: 'required', dueDate: null }],
  };
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the template from the program path and returns it mapped', async () => {
    const spy = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue(upstreamTemplate as never);

    const result = await service.getEnrollTemplate(buildReq(), PROGRAM_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(2, 4)).toEqual([TEMPLATE_PATH, 'GET']);
    expect(result).toMatchObject({
      name: 'private-program-name',
      project: null,
      technologies: ['Go', 'Rust'],
      skills: ['private-skill'],
      prerequisites: [{ id: 'imported-0', name: 'Resume', required: true, requireFile: true, custom: true }],
    });
  });

  it.each([403, 404, 503])('passes an upstream %i through', async (status) => {
    const error = MicroserviceError.fromMicroserviceResponse(status, 'Error', { error: 'nope' }, 'LFX_V2_SERVICE', TEMPLATE_PATH);
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockRejectedValue(error);

    await expect(service.getEnrollTemplate(buildReq(), PROGRAM_ID)).rejects.toBe(error);
  });

  it('never logs the template contents', async () => {
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue(upstreamTemplate as never);

    await service.getEnrollTemplate(buildReq(), PROGRAM_ID);

    const logged = JSON.stringify(Object.values(logger).flatMap((fn) => vi.mocked(fn as () => void).mock.calls.map((call) => call.slice(1))));
    for (const secret of ['private-program-name', 'private-program-description', 'private.example', 'private-skill', 'private-prereq-description']) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('MentorshipAdminService program create and logo upload', () => {
  const PROGRAMS_PATH = '/mentorship/v1/programs';
  const createBody = {
    projectId: '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    projectSlug: 'energy-project',
    projectName: 'Energy Project',
    name: 'private-program-name',
    description: '<p>private-program-description</p>',
    repositoryUrl: 'https://github.com/example/repo',
    skills: ['Go'],
    terms: [{ name: 'Fall 2026', startDate: '2026-09-01', endDate: '2026-12-31', applicationStartDate: '2026-07-01', applicationEndDate: '2026-08-15' }],
    prerequisites: [],
    termsAccepted: true as const,
  };
  let service: InstanceType<typeof MentorshipAdminService>;

  beforeEach(() => {
    service = new MentorshipAdminService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the create body as is and returns the id, slug and status', async () => {
    const spy = vi
      .spyOn(MicroserviceProxyService.prototype, 'proxyRequest')
      .mockResolvedValue({ id: PROGRAM_ID, slug: 'private-program-name', status: 'pending', name: 'private-program-name' } as never);

    await expect(service.createProgram(buildReq(), createBody)).resolves.toEqual({ id: PROGRAM_ID, slug: 'private-program-name', status: 'pending' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(2, 6)).toEqual([PROGRAMS_PATH, 'POST', undefined, createBody]);
  });

  it('patches the program with the snake_case update body and returns the id, slug and status', async () => {
    const spy = vi
      .spyOn(MicroserviceProxyService.prototype, 'proxyRequest')
      .mockResolvedValue({ id: PROGRAM_ID, slug: 'private-program-name', status: 'published' } as never);
    const updateBody = {
      projectId: createBody.projectId,
      projectSlug: createBody.projectSlug,
      projectName: createBody.projectName,
      name: createBody.name,
      description: createBody.description,
      repositoryUrl: createBody.repositoryUrl,
      skills: createBody.skills,
      prerequisites: [],
    };
    const nameCheck = vi.spyOn(MentorshipService.prototype, 'isProgramNameAvailable').mockResolvedValue({ available: true });

    await expect(service.updateProgram(buildReq(), PROGRAM_ID, updateBody)).resolves.toEqual({
      id: PROGRAM_ID,
      slug: 'private-program-name',
      status: 'published',
    });

    expect(nameCheck).toHaveBeenCalledWith(expect.anything(), updateBody.name, PROGRAM_ID);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(2, 5)).toEqual([`${PROGRAMS_PATH}/${PROGRAM_ID}`, 'PATCH', undefined]);
    expect(spy.mock.calls[0][5]).toMatchObject({
      name: updateBody.name,
      repo_link: updateBody.repositoryUrl,
      skills: updateBody.skills,
      project_uid: updateBody.projectId,
    });
  });

  it('answers 409 with no write when another program has the name', async () => {
    const spy = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    vi.spyOn(MentorshipService.prototype, 'isProgramNameAvailable').mockResolvedValue({ available: false });
    const updateBody = { ...createBody, terms: undefined, termsAccepted: undefined };

    await expect(service.updateProgram(buildReq(), PROGRAM_ID, updateBody)).rejects.toMatchObject({
      statusCode: 409,
      code: 'MENTORSHIP_PROGRAM_NAME_TAKEN',
      message: MENTORSHIP_ENROLL_NAME_TAKEN,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to the id when the created program has no slug', async () => {
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue({ id: PROGRAM_ID, status: 'pending' } as never);

    await expect(service.createProgram(buildReq(), createBody)).resolves.toEqual({ id: PROGRAM_ID, slug: PROGRAM_ID, status: 'pending' });
  });

  it.each([400, 409])('passes an upstream %i on create through', async (status) => {
    const error = MicroserviceError.fromMicroserviceResponse(status, 'Error', { error: 'conflict' }, 'LFX_V2_SERVICE', PROGRAMS_PATH);
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockRejectedValue(error);

    await expect(service.createProgram(buildReq(), createBody)).rejects.toBe(error);
  });

  it('provisions a first-time user and retries the create once', async () => {
    const notProvisioned = MicroserviceError.fromMicroserviceResponse(
      401,
      'Unauthorized',
      { error: 'local user is not provisioned' },
      'LFX_V2_SERVICE',
      PROGRAMS_PATH
    );
    const spy = vi
      .spyOn(MicroserviceProxyService.prototype, 'proxyRequest')
      .mockRejectedValueOnce(notProvisioned)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({ id: PROGRAM_ID, slug: 's', status: 'pending' } as never);

    await expect(service.createProgram(buildReq(), createBody)).resolves.toMatchObject({ id: PROGRAM_ID });
    expect(spy.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      [PROGRAMS_PATH, 'POST'],
      ['/mentorship/v1/me', 'PUT'],
      [PROGRAMS_PATH, 'POST'],
    ]);
  });

  it('never logs the program name or description on create', async () => {
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue({ id: PROGRAM_ID, status: 'pending' } as never);

    await service.createProgram(buildReq(), createBody);

    const logged = JSON.stringify(Object.values(logger).flatMap((fn) => vi.mocked(fn as () => void).mock.calls.map((call) => call.slice(1))));
    expect(logged).not.toContain('private-program-name');
    expect(logged).not.toContain('private-program-description');
  });

  it('sends the logo bytes to the program logo-upload path with the content type', async () => {
    const spy = vi
      .spyOn(MicroserviceProxyService.prototype, 'proxyRequest')
      .mockResolvedValue({ public_url: 'https://cdn.example/logo.png', filename: 'a.png', content_type: 'image/png', size: 3 } as never);
    const bytes = Buffer.from([1, 2, 3]);

    await expect(service.uploadProgramLogo(buildReq(), PROGRAM_ID, bytes, 'image/png')).resolves.toEqual({ logoUrl: 'https://cdn.example/logo.png' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0].slice(2)).toEqual([`${PROGRAMS_PATH}/${PROGRAM_ID}/logo-upload`, 'POST', undefined, bytes, { 'Content-Type': 'image/png' }]);
  });

  it.each([403, 404, 409, 413, 415, 503])('passes an upstream %i on the logo upload through', async (status) => {
    const error = MicroserviceError.fromMicroserviceResponse(status, 'Error', { error: 'no' }, 'LFX_V2_SERVICE', PROGRAMS_PATH);
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockRejectedValue(error);

    await expect(service.uploadProgramLogo(buildReq(), PROGRAM_ID, Buffer.from([1]), 'image/jpeg')).rejects.toBe(error);
  });

  it('logs the program id, byte size and content type of a logo upload, and nothing else', async () => {
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue({ public_url: 'https://cdn.example/secret-logo.png' } as never);

    await service.uploadProgramLogo(buildReq(), PROGRAM_ID, Buffer.from([1, 2]), 'image/png');

    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(expect.anything(), 'mentorship_admin_upload_program_logo', expect.any(String), {
      programId: PROGRAM_ID,
      sizeBytes: 2,
      contentType: 'image/png',
    });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('secret-logo');
  });
});
